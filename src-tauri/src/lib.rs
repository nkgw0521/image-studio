mod error;
mod job;
mod macrogen;
mod runner;
mod settings;

use job::{AnalysisKind, JobRequest, JobState};
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
    vec![AnalysisKind::Measure, AnalysisKind::Particles, AnalysisKind::Profile]
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
fn read_csv_preview(path: String, max_rows: Option<usize>) -> Result<CsvPreview, String> {
    use std::fs;
    use std::path::Path;
    let p = Path::new(&path);
    if !p.is_file() {
        return Err(format!("CSV not found: {path}"));
    }
    let text = fs::read_to_string(p).map_err(|e| e.to_string())?;
    let limit = max_rows.unwrap_or(100);
    let mut lines = text.lines();
    let headers = lines.next().map(parse_csv_line).unwrap_or_default();
    let mut rows = Vec::new();
    let mut truncated = false;
    for (i, line) in lines.enumerate() {
        if i >= limit { truncated = true; break; }
        rows.push(parse_csv_line(line));
    }
    Ok(CsvPreview { headers, rows, truncated })
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
            read_csv_preview
        ])
        .setup(|app| {
            let _ = app.emit("backend-ready", serde_json::json!({ "ready": true }));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
