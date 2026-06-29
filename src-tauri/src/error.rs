use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    Validation(String),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("another job is already running")]
    Busy,
    #[error("no running job")]
    NoRunningJob,
    #[error("process handle is unavailable")]
    MissingProcess,
}
