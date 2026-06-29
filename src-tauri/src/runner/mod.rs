use crate::error::AppError;
use crate::job::{JobRequest, JobState, RunningJob};
use crate::macrogen::generate_macro;
use serde::Serialize;
use std::fs;
use std::io::{BufRead, BufReader};
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
        crate::job::AnalysisKind::Particles => "particles.ijm",
        crate::job::AnalysisKind::Profile => "profile.ijm",
    });
    fs::write(&macro_path, generate_macro(req, &output_csv.to_string_lossy()))?;
    Ok(macro_path)
}
