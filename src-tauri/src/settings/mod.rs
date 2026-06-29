use std::path::PathBuf;

pub fn detect_imagej_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    #[cfg(target_os = "windows")]
    {
        for p in [
            r"C:\Fiji.app\ImageJ-win64.exe",
            r"C:\ImageJ\ImageJ-win64.exe",
            r"C:\ImageJ\ImageJ.exe",
            r"C:\Program Files\Fiji.app\ImageJ-win64.exe",
        ] {
            let path = PathBuf::from(p);
            if path.is_file() {
                candidates.push(path);
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        for p in [
            "/opt/Fiji.app/ImageJ-linux64",
            "/usr/local/Fiji.app/ImageJ-linux64",
            "/usr/bin/imagej",
            "/usr/local/bin/imagej",
        ] {
            let path = PathBuf::from(p);
            if path.is_file() {
                candidates.push(path);
            }
        }
    }

    candidates
}
