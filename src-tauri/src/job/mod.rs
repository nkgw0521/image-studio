use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Child;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnalysisKind {
    Measure,
    Particles,
    Profile,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobRequest {
    pub imagej_path: String,
    pub input_image: String,
    pub output_dir: String,
    pub base_name: String,
    pub analysis: AnalysisKind,
    pub roi: Option<Roi>,
    pub particles: ParticleParams,
    pub profile: ProfileParams,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Roi {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParticleParams {
    pub threshold: String,
    pub min_area: f64,
    pub max_area: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileParams {
    pub x1: i32,
    pub y1: i32,
    pub x2: i32,
    pub y2: i32,
}

impl Default for ParticleParams {
    fn default() -> Self {
        Self { threshold: "Otsu dark".to_string(), min_area: 20.0, max_area: None }
    }
}

impl Default for ProfileParams {
    fn default() -> Self {
        Self { x1: 0, y1: 0, x2: 100, y2: 0 }
    }
}

impl JobRequest {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.imagej_path.trim().is_empty() {
            return Err(AppError::Validation("ImageJ/Fiji executable is required".into()));
        }
        if !Path::new(&self.imagej_path).is_file() {
            return Err(AppError::Validation(format!("ImageJ/Fiji executable not found: {}", self.imagej_path)));
        }
        if self.input_image.trim().is_empty() {
            return Err(AppError::Validation("Input image is required".into()));
        }
        if !Path::new(&self.input_image).is_file() {
            return Err(AppError::Validation(format!("Input image not found: {}", self.input_image)));
        }
        if self.output_dir.trim().is_empty() {
            return Err(AppError::Validation("Output directory is required".into()));
        }
        let output_dir = Path::new(&self.output_dir);
        if !output_dir.is_dir() {
            return Err(AppError::Validation(format!("Output directory not found: {}", output_dir.display())));
        }
        if self.base_name.trim().is_empty() {
            return Err(AppError::Validation("Base name is required".into()));
        }
        if let Some(roi) = &self.roi {
            if roi.width <= 0 || roi.height <= 0 {
                return Err(AppError::Validation("ROI width/height must be positive".into()));
            }
        }
        Ok(())
    }
}

#[derive(Default)]
pub struct JobState {
    pub next_id: AtomicU64,
    pub current: Arc<Mutex<Option<RunningJob>>>,
}

pub struct RunningJob {
    pub id: u64,
    pub child: Arc<Mutex<Child>>,
}

impl JobState {
    pub fn alloc_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::SeqCst) + 1
    }
}
