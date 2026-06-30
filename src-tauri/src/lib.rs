mod error;
mod job;
mod macrogen;
mod runner;
mod settings;

use job::{AnalysisKind, JobRequest, JobState, RawImageParams};
use runner::{cancel_current_job, run_job_async};
use settings::detect_imagej_candidates;
use tauri::{AppHandle, Emitter};

#[tauri::command]
fn start_analysis(app: AppHandle, request: JobRequest) -> Result<u64, String> {
    request.validate().map_err(|e| e.to_string())?;
    run_job_async(app, request).map_err(|e| e.to_string())
}

#[tauri::command]
fn cancel_analysis(app: AppHandle) -> Result<(), String> {
    cancel_current_job(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_supported_analyses() -> Vec<AnalysisKind> {
    vec![AnalysisKind::Measure, AnalysisKind::Profile, AnalysisKind::WhiteDefectPixels]
}

#[tauri::command]
fn detect_imagej() -> Vec<String> {
    detect_imagej_candidates()
        .into_iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect()
}

#[derive(Debug, Clone, serde::Serialize)]
struct ImagePreview {
    data_url: String,
    file_name: String,
}

#[derive(Debug, Clone, serde::Serialize)]
struct CsvPreview {
    headers: Vec<String>,
    rows: Vec<Vec<String>>,
    truncated: bool,
    total_rows: usize,
}

#[tauri::command]
fn preview_image_data_url(path: String) -> Result<ImagePreview, String> {
    use base64::{engine::general_purpose, Engine as _};
    use std::fs;
    use std::path::Path;

    let p = Path::new(&path);
    if !p.is_file() {
        return Err(format!("Input image not found: {path}"));
    }
    let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "bmp" => "image/bmp",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "tif" | "tiff" => "image/tiff",
        _ => return Err(format!("Preview is not supported for .{ext}. Use PNG/JPEG/BMP/TIFF.")),
    };
    let bytes = fs::read(p).map_err(|e| e.to_string())?;
    const MAX_PREVIEW_BYTES: usize = 50 * 1024 * 1024;
    if bytes.len() > MAX_PREVIEW_BYTES {
        return Err(format!("Preview file is too large: {} bytes", bytes.len()));
    }
    let encoded = general_purpose::STANDARD.encode(bytes);
    let file_name = p.file_name().and_then(|s| s.to_str()).unwrap_or("image").to_string();
    Ok(ImagePreview { data_url: format!("data:{mime};base64,{encoded}"), file_name })
}


#[tauri::command]
fn preview_raw_image_data_url(path: String, raw_image: RawImageParams) -> Result<ImagePreview, String> {
    use base64::{engine::general_purpose, Engine as _};
    use image::{codecs::png::PngEncoder, ColorType, ImageEncoder};
    use std::fs::File;
    use std::io::{Cursor, Read, Seek, SeekFrom};
    use std::path::Path;

    let p = Path::new(&path);
    if !p.is_file() {
        return Err(format!("RAW file not found: {path}"));
    }
    if raw_image.width == 0 || raw_image.height == 0 {
        return Err("RAW Width / Height must be positive".into());
    }
    if !(1..=16).contains(&raw_image.bit_depth) {
        return Err("RAW Bit depth must be 1..16".into());
    }
    let endian = raw_image.endian.to_ascii_lowercase();
    if endian != "little" && endian != "big" {
        return Err("RAW endian must be little or big".into());
    }

    let bytes_per_pixel: u64 = if raw_image.bit_depth <= 8 { 1 } else { 2 };
    let expected = raw_image.header_offset
        .saturating_add(u64::from(raw_image.width).saturating_mul(u64::from(raw_image.height)).saturating_mul(bytes_per_pixel));
    let actual = std::fs::metadata(p).map_err(|e| e.to_string())?.len();
    if actual < expected {
        return Err(format!("RAW file is too small: actual={actual} bytes, expected at least={expected} bytes"));
    }

    // Generate a display-sized 8-bit grayscale PNG. This keeps the WebView responsive
    // even for multi-megapixel RAW frames.
    const MAX_PREVIEW_SIDE: u32 = 1600;
    let src_w = raw_image.width;
    let src_h = raw_image.height;
    let scale = ((src_w.max(src_h) + MAX_PREVIEW_SIDE - 1) / MAX_PREVIEW_SIDE).max(1);
    let dst_w = (src_w + scale - 1) / scale;
    let dst_h = (src_h + scale - 1) / scale;
    let mut preview = vec![0u8; (dst_w as usize).saturating_mul(dst_h as usize)];

    let mut input = File::open(p).map_err(|e| e.to_string())?;
    let row_bytes = u64::from(src_w).saturating_mul(bytes_per_pixel);
    let little = endian == "little";
    let max_value = if raw_image.bit_depth >= 16 { 65535u32 } else { (1u32 << raw_image.bit_depth) - 1 };

    if bytes_per_pixel == 1 {
        let mut row = vec![0u8; src_w as usize];
        for dy in 0..dst_h {
            let sy = (dy * scale).min(src_h - 1);
            let offset = raw_image.header_offset + u64::from(sy) * row_bytes;
            input.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
            input.read_exact(&mut row).map_err(|e| e.to_string())?;
            for dx in 0..dst_w {
                let sx = (dx * scale).min(src_w - 1) as usize;
                preview[(dy * dst_w + dx) as usize] = row[sx];
            }
        }
    } else {
        let mut row = vec![0u8; src_w as usize * 2];
        for dy in 0..dst_h {
            let sy = (dy * scale).min(src_h - 1);
            let offset = raw_image.header_offset + u64::from(sy) * row_bytes;
            input.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
            input.read_exact(&mut row).map_err(|e| e.to_string())?;
            for dx in 0..dst_w {
                let sx = (dx * scale).min(src_w - 1) as usize * 2;
                let v16 = if little {
                    u16::from_le_bytes([row[sx], row[sx + 1]])
                } else {
                    u16::from_be_bytes([row[sx], row[sx + 1]])
                };
                let v = u32::from(v16).min(max_value);
                preview[(dy * dst_w + dx) as usize] = ((v * 255 + max_value / 2) / max_value) as u8;
            }
        }
    }

    let mut png = Vec::new();
    {
        let mut cursor = Cursor::new(&mut png);
        let encoder = PngEncoder::new(&mut cursor);
        encoder
            .write_image(&preview, dst_w, dst_h, ColorType::L8.into())
            .map_err(|e| e.to_string())?;
    }

    let encoded = general_purpose::STANDARD.encode(png);
    let file_name = p.file_name().and_then(|s| s.to_str()).unwrap_or("raw").to_string();
    Ok(ImagePreview { data_url: format!("data:image/png;base64,{encoded}"), file_name })
}

#[tauri::command]
fn read_csv_preview(path: String, max_rows: Option<usize>) -> Result<CsvPreview, String> {
    use std::fs::File;
    use std::io::{BufRead, BufReader};
    use std::path::Path;

    let p = Path::new(&path);
    if !p.is_file() {
        return Err(format!("CSV not found: {path}"));
    }

    // Stream the CSV instead of reading the entire file into memory.
    // Defect-pixel analysis may generate very large CSV files; loading all rows
    // makes the WebView unresponsive.
    let limit = max_rows.unwrap_or(100);
    let file = File::open(p).map_err(|e| e.to_string())?;
    let mut lines = BufReader::new(file).lines();

    let headers = match lines.next() {
        Some(Ok(line)) => parse_csv_line(&line),
        Some(Err(e)) => return Err(e.to_string()),
        None => Vec::new(),
    };

    let mut rows = Vec::new();
    let mut total_rows = 0usize;
    for line in lines {
        let line = line.map_err(|e| e.to_string())?;
        if total_rows < limit {
            rows.push(parse_csv_line(&line));
        }
        total_rows += 1;
    }
    let truncated = total_rows > rows.len();

    Ok(CsvPreview { headers, rows, truncated, total_rows })
}

fn parse_csv_line(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut chars = line.chars().peekable();
    let mut in_quotes = false;
    while let Some(c) = chars.next() {
        match c {
            '"' if in_quotes && chars.peek() == Some(&'"') => { cur.push('"'); let _ = chars.next(); }
            '"' => in_quotes = !in_quotes,
            ',' if !in_quotes => { out.push(cur.trim().to_string()); cur.clear(); }
            _ => cur.push(c),
        }
    }
    out.push(cur.trim().to_string());
    out
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(JobState::default())
        .invoke_handler(tauri::generate_handler![
            start_analysis,
            cancel_analysis,
            get_supported_analyses,
            detect_imagej,
            preview_image_data_url,
            preview_raw_image_data_url,
            read_csv_preview
        ])
        .setup(|app| {
            let _ = app.emit("backend-ready", serde_json::json!({ "ready": true }));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
