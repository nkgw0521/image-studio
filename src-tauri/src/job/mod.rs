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
    Profile,
    WhiteDefectPixels,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobRequest {
    pub imagej_path: String,
    pub input_image: String,
    pub output_dir: String,
    pub base_name: String,
    pub analysis: AnalysisKind,
    pub roi: Option<Roi>,
    pub profile: ProfileParams,
    #[serde(default)]
    pub raw_image: RawImageParams,
    #[serde(rename = "white_defect_pixels", alias = "defect_pixels")]
    pub defect_pixels: DefectPixelParams,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Roi {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DefectPixelParams {
    pub white_threshold: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawImageParams {
    pub enabled: bool,
    pub width: u32,
    pub height: u32,
    pub bit_depth: u16,
    pub endian: String,
    pub header_offset: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileParams {
    pub x1: i32,
    pub y1: i32,
    pub x2: i32,
    pub y2: i32,
}

impl Default for DefectPixelParams {
    fn default() -> Self {
        Self { white_threshold: 240 }
    }
}

impl Default for RawImageParams {
    fn default() -> Self {
        Self {
            enabled: false,
            width: 0,
            height: 0,
            bit_depth: 8,
            endian: "little".to_string(),
            header_offset: 0,
        }
    }
}

impl Default for ProfileParams {
    fn default() -> Self {
        Self { x1: 0, y1: 0, x2: 100, y2: 0 }
    }
}

impl JobRequest {
    pub fn validate(&self) -> Result<(), AppError> {
        if !matches!(self.analysis, AnalysisKind::WhiteDefectPixels) {
            if self.imagej_path.trim().is_empty() {
                return Err(AppError::Validation("ImageJ/Fiji executable is required".into()));
            }
            if !Path::new(&self.imagej_path).is_file() {
                return Err(AppError::Validation(format!("ImageJ/Fiji executable not found: {}", self.imagej_path)));
            }
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
        if self.raw_image.enabled {
            if self.raw_image.width == 0 || self.raw_image.height == 0 {
                return Err(AppError::Validation("RAW width/height must be positive".into()));
            }
            if !(1..=16).contains(&self.raw_image.bit_depth) {
                return Err(AppError::Validation("RAW bit depth must be 1..16".into()));
            }
            let endian = self.raw_image.endian.to_ascii_lowercase();
            if endian != "little" && endian != "big" {
                return Err(AppError::Validation("RAW endian must be little or big".into()));
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
