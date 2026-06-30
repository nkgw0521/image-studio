use crate::error::AppError;
use crate::job::{AnalysisKind, JobRequest, JobState, RawImageParams, RunningJob};
use crate::macrogen::generate_macro;
use serde::Serialize;
use std::fs;
use std::io::{BufRead, BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Serialize)]
struct JobEvent {
    id: u64,
    level: String,
    message: String,
    output_csv: Option<String>,
}

fn emit(app: &AppHandle, id: u64, level: &str, message: impl Into<String>) {
    emit_with_output(app, id, level, message, None);
}

fn emit_with_output(app: &AppHandle, id: u64, level: &str, message: impl Into<String>, output_csv: Option<String>) {
    let _ = app.emit("job-event", JobEvent { id, level: level.into(), message: message.into(), output_csv });
}

pub fn run_job_async(app: AppHandle, req: JobRequest) -> Result<u64, AppError> {
    let state = app.state::<JobState>();
    let id = state.alloc_id();

    {
        let guard = state.current.lock().map_err(|_| AppError::Busy)?;
        if guard.is_some() {
            return Err(AppError::Busy);
        }
    }

    let output_csv = make_output_csv_path(&req)?;
    ensure_output_dir(&req)?;

    if matches!(req.analysis, AnalysisKind::WhiteDefectPixels) {
        return run_white_defect_pixels_native(app, id, req, output_csv);
    }

    let macro_path = write_macro_file(id, &req, &output_csv)?;
    let mut command = Command::new(&req.imagej_path);
    command
        .arg("-batch")
        .arg(&macro_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    emit(&app, id, "info", format!("START {:?}", req.analysis));
    emit(&app, id, "info", format!("ImageJ: {}", req.imagej_path));
    emit(&app, id, "info", format!("Input: {}", req.input_image));
    emit(&app, id, "info", format!("Output directory: {}", req.output_dir));
    emit(&app, id, "info", format!("Base name: {}", req.base_name));
    emit(&app, id, "info", format!("Output CSV: {}", output_csv.display()));
    emit(&app, id, "info", format!("Macro: {}", macro_path.display()));
    emit(&app, id, "info", "Command mode: ImageJ1-compatible -batch");

    let mut child = command.spawn()?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let child = Arc::new(Mutex::new(child));

    {
        let mut guard = state.current.lock().map_err(|_| AppError::Busy)?;
        *guard = Some(RunningJob { id, child: child.clone() });
    }

    if let Some(out) = stdout {
        let app2 = app.clone();
        thread::spawn(move || {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                emit(&app2, id, "stdout", line);
            }
        });
    }
    if let Some(err) = stderr {
        let app2 = app.clone();
        thread::spawn(move || {
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                emit(&app2, id, "stderr", line);
            }
        });
    }

    let app2 = app.clone();
    thread::spawn(move || {
        let status = {
            match child.lock() {
                Ok(mut c) => c.wait(),
                Err(_) => {
                    emit(&app2, id, "error", "Process mutex poisoned");
                    cleanup_current(&app2, id);
                    return;
                }
            }
        };

        match status {
            Ok(s) => {
                emit(&app2, id, "info", format!("ImageJ exit status: {}", s));
                if output_csv.is_file() {
                    emit_with_output(&app2, id, "success", format!("DONE: output CSV created: {}", output_csv.display()), Some(output_csv.to_string_lossy().to_string()));
                } else {
                    emit(&app2, id, "error", format!("FAILED: output CSV was not created: {}", output_csv.display()));
                    emit(&app2, id, "error", format!("Generated macro remains at: {}", macro_path.display()));
                }
            }
            Err(e) => emit(&app2, id, "error", format!("FAILED to wait ImageJ process: {e}")),
        }
        cleanup_current(&app2, id);
    });

    Ok(id)
}


fn run_white_defect_pixels_native(app: AppHandle, id: u64, req: JobRequest, output_csv: PathBuf) -> Result<u64, AppError> {
    emit(&app, id, "info", "START WhiteDefectPixels");
    emit(&app, id, "info", "Engine: Rust native white defect pixel scanner");
    emit(&app, id, "info", format!("Input: {}", req.input_image));
    emit(&app, id, "info", format!("Output CSV: {}", output_csv.display()));
    emit(&app, id, "info", format!("White threshold: {}", req.defect_pixels.white_threshold));

    let app2 = app.clone();
    thread::spawn(move || {
        match scan_white_defect_pixels(&app2, id, &req, &output_csv) {
            Ok(summary) => {
                emit(&app2, id, "info", summary);
                emit_with_output(&app2, id, "success", format!("DONE: output CSV created: {}", output_csv.display()), Some(output_csv.to_string_lossy().to_string()));
            }
            Err(e) => {
                emit(&app2, id, "error", format!("FAILED: {e}"));
            }
        }
    });

    Ok(id)
}

fn scan_white_defect_pixels(app: &AppHandle, id: u64, req: &JobRequest, output_csv: &Path) -> Result<String, AppError> {
    if req.raw_image.enabled {
        return scan_white_defect_pixels_raw(app, id, req, output_csv);
    }

    let img = image::open(&req.input_image)
        .map_err(|e| AppError::Validation(format!("failed to open image: {e}")))?;
    let width = img.width();
    let height = img.height();
    let bits_per_channel = img.color().bits_per_pixel() / u16::from(img.color().channel_count().max(1));
    let use_u16 = bits_per_channel > 8;

    let (rx, ry, rw, rh) = match &req.roi {
        Some(r) => (r.x.max(0) as u32, r.y.max(0) as u32, r.width.max(0) as u32, r.height.max(0) as u32),
        None => (0, 0, width, height),
    };
    let x_end = rx.saturating_add(rw).min(width);
    let y_end = ry.saturating_add(rh).min(height);

    if rx >= width || ry >= height || x_end <= rx || y_end <= ry {
        return Err(AppError::Validation("ROI is outside the image".into()));
    }

    let white_threshold = req.defect_pixels.white_threshold.max(0) as u32;

    let file = fs::File::create(output_csv)?;
    let mut writer = BufWriter::new(file);
    writeln!(writer, "type,x,y,value,threshold,delta")?;

    let mut white_count: u64 = 0;
    let mut scanned: u64 = 0;
    let total_scan: u64 = u64::from(x_end - rx) * u64::from(y_end - ry);
    let progress_row_step: u32 = ((y_end - ry) / 20).max(1);

    emit(app, id, "progress", format!("Scanning 0/{total_scan} px (0.0%), defects=0"));

    if use_u16 {
        let gray = img.to_luma16();
        for y in ry..y_end {
            for x in rx..x_end {
                scanned += 1;
                let value = u32::from(gray.get_pixel(x, y).0[0]);
                if value >= white_threshold {
                    white_count += 1;
                    let delta = i64::from(value) - i64::from(white_threshold);
                    writeln!(writer, "white,{x},{y},{value},{white_threshold},+{delta}")?;
                }
            }
            if (y - ry) % progress_row_step == 0 || y + 1 == y_end {
                let pct = if total_scan > 0 { (scanned as f64) * 100.0 / (total_scan as f64) } else { 100.0 };
                emit(app, id, "progress", format!("Scanning {scanned}/{total_scan} px ({pct:.1}%), defects={white_count}"));
            }
        }
    } else {
        let gray = img.to_luma8();
        for y in ry..y_end {
            for x in rx..x_end {
                scanned += 1;
                let value = u32::from(gray.get_pixel(x, y).0[0]);
                if value >= white_threshold {
                    white_count += 1;
                    let delta = i64::from(value) - i64::from(white_threshold);
                    writeln!(writer, "white,{x},{y},{value},{white_threshold},+{delta}")?;
                }
            }
            if (y - ry) % progress_row_step == 0 || y + 1 == y_end {
                let pct = if total_scan > 0 { (scanned as f64) * 100.0 / (total_scan as f64) } else { 100.0 };
                emit(app, id, "progress", format!("Scanning {scanned}/{total_scan} px ({pct:.1}%), defects={white_count}"));
            }
        }
    }
    writer.flush()?;

    Ok(format!(
        "Native white defect scan complete: scanned={} px, white={}, source_depth={} bit/channel",
        scanned,
        white_count,
        bits_per_channel
    ))
}


fn scan_white_defect_pixels_raw(app: &AppHandle, id: u64, req: &JobRequest, output_csv: &Path) -> Result<String, AppError> {
    let raw = &req.raw_image;
    validate_raw_file_size(&req.input_image, raw)?;

    let bytes_per_pixel: u64 = if raw.bit_depth <= 8 { 1 } else { 2 };
    let width = raw.width;
    let height = raw.height;
    let row_bytes = u64::from(width) * bytes_per_pixel;

    let (rx, ry, rw, rh) = match &req.roi {
        Some(r) => (r.x.max(0) as u32, r.y.max(0) as u32, r.width.max(0) as u32, r.height.max(0) as u32),
        None => (0, 0, width, height),
    };
    let x_end = rx.saturating_add(rw).min(width);
    let y_end = ry.saturating_add(rh).min(height);
    if rx >= width || ry >= height || x_end <= rx || y_end <= ry {
        return Err(AppError::Validation("ROI is outside the RAW image".into()));
    }

    let white_threshold = req.defect_pixels.white_threshold.max(0) as u32;
    let file = fs::File::create(output_csv)?;
    let mut writer = BufWriter::new(file);
    writeln!(writer, "type,x,y,value,threshold,delta")?;

    let mut input = fs::File::open(&req.input_image)?;
    let mut white_count: u64 = 0;
    let mut scanned: u64 = 0;
    let total_scan: u64 = u64::from(x_end - rx) * u64::from(y_end - ry);
    let progress_row_step: u32 = ((y_end - ry) / 20).max(1);
    let little_endian = raw.endian.eq_ignore_ascii_case("little");

    emit(app, id, "info", format!("RAW input: {} x {}, {} bit, {} endian, offset {}", raw.width, raw.height, raw.bit_depth, raw.endian, raw.header_offset));
    emit(app, id, "progress", format!("Scanning RAW 0/{total_scan} px (0.0%), defects=0"));

    if bytes_per_pixel == 1 {
        let mut row = vec![0u8; (x_end - rx) as usize];
        for y in ry..y_end {
            let offset = raw.header_offset + u64::from(y) * row_bytes + u64::from(rx);
            input.seek(SeekFrom::Start(offset))?;
            input.read_exact(&mut row)?;
            for (i, b) in row.iter().enumerate() {
                scanned += 1;
                let value = u32::from(*b);
                if value >= white_threshold {
                    white_count += 1;
                    let x = rx + i as u32;
                    let delta = i64::from(value) - i64::from(white_threshold);
                    writeln!(writer, "white,{x},{y},{value},{white_threshold},+{delta}")?;
                }
            }
            if (y - ry) % progress_row_step == 0 || y + 1 == y_end {
                let pct = if total_scan > 0 { (scanned as f64) * 100.0 / (total_scan as f64) } else { 100.0 };
                emit(app, id, "progress", format!("Scanning RAW {scanned}/{total_scan} px ({pct:.1}%), defects={white_count}"));
            }
        }
    } else {
        let mut row = vec![0u8; (x_end - rx) as usize * 2];
        for y in ry..y_end {
            let offset = raw.header_offset + u64::from(y) * row_bytes + u64::from(rx) * 2;
            input.seek(SeekFrom::Start(offset))?;
            input.read_exact(&mut row)?;
            for (i, chunk) in row.chunks_exact(2).enumerate() {
                scanned += 1;
                let value16 = if little_endian {
                    u16::from_le_bytes([chunk[0], chunk[1]])
                } else {
                    u16::from_be_bytes([chunk[0], chunk[1]])
                };
                let value = u32::from(value16);
                if value >= white_threshold {
                    white_count += 1;
                    let x = rx + i as u32;
                    let delta = i64::from(value) - i64::from(white_threshold);
                    writeln!(writer, "white,{x},{y},{value},{white_threshold},+{delta}")?;
                }
            }
            if (y - ry) % progress_row_step == 0 || y + 1 == y_end {
                let pct = if total_scan > 0 { (scanned as f64) * 100.0 / (total_scan as f64) } else { 100.0 };
                emit(app, id, "progress", format!("Scanning RAW {scanned}/{total_scan} px ({pct:.1}%), defects={white_count}"));
            }
        }
    }
    writer.flush()?;

    Ok(format!(
        "Native RAW white defect scan complete: scanned={} px, white={}, raw={}x{} {}bit {} endian",
        scanned,
        white_count,
        raw.width,
        raw.height,
        raw.bit_depth,
        raw.endian
    ))
}

fn validate_raw_file_size(input_path: &str, raw: &RawImageParams) -> Result<(), AppError> {
    let bytes_per_pixel: u64 = if raw.bit_depth <= 8 { 1 } else { 2 };
    let expected = raw.header_offset
        .saturating_add(u64::from(raw.width).saturating_mul(u64::from(raw.height)).saturating_mul(bytes_per_pixel));
    let actual = fs::metadata(input_path)?.len();
    if actual < expected {
        return Err(AppError::Validation(format!(
            "RAW file is too small: actual={} bytes, expected at least={} bytes",
            actual, expected
        )));
    }
    Ok(())
}

pub fn cancel_current_job(app: &AppHandle) -> Result<(), AppError> {
    let state = app.state::<JobState>();
    let running = {
        let mut guard = state.current.lock().map_err(|_| AppError::NoRunningJob)?;
        guard.take()
    };
    let Some(job) = running else { return Err(AppError::NoRunningJob); };
    emit(app, job.id, "warn", "Cancel requested");
    let result = match job.child.lock() {
        Ok(mut child) => {
            child.kill()?;
            emit(app, job.id, "warn", "Process killed");
            Ok(())
        }
        Err(_) => Err(AppError::MissingProcess),
    };
    result
}

fn cleanup_current(app: &AppHandle, id: u64) {
    if let Some(state) = app.try_state::<JobState>() {
        if let Ok(mut guard) = state.current.lock() {
            if guard.as_ref().map(|j| j.id) == Some(id) {
                *guard = None;
            }
        }
    }
}

fn ensure_output_dir(req: &JobRequest) -> Result<(), AppError> {
    let dir = PathBuf::from(&req.output_dir);
    fs::create_dir_all(&dir)?;
    Ok(())
}

fn make_output_csv_path(req: &JobRequest) -> Result<PathBuf, AppError> {
    let mut dir = PathBuf::from(&req.output_dir);
    let base = sanitize_base_name(&req.base_name);
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    dir.push(format!("{base}_{timestamp}.csv"));
    Ok(dir)
}

fn sanitize_base_name(name: &str) -> String {
    let trimmed = name.trim();
    let without_ext = trimmed.strip_suffix(".csv").unwrap_or(trimmed);
    let sanitized: String = without_ext
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let sanitized = sanitized.trim_matches(|c| c == ' ' || c == '.');
    if sanitized.is_empty() { "result".to_string() } else { sanitized.to_string() }
}

fn write_macro_file(id: u64, req: &JobRequest, output_csv: &Path) -> Result<PathBuf, AppError> {
    let mut dir = std::env::temp_dir();
    let epoch = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    dir.push(format!("image-studio-{id}-{epoch}"));
    fs::create_dir_all(&dir)?;
    let macro_path = dir.join(match req.analysis {
        crate::job::AnalysisKind::Measure => "measure.ijm",
        crate::job::AnalysisKind::Profile => "profile.ijm",
        crate::job::AnalysisKind::WhiteDefectPixels => "white_defect_pixels_native.csv",
    });
    fs::write(&macro_path, generate_macro(req, &output_csv.to_string_lossy()))?;
    Ok(macro_path)
}
