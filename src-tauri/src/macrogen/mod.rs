use crate::job::{AnalysisKind, JobRequest, Roi};

const MEASURE_TEMPLATE: &str = include_str!("../../macros/measure.ijm");
const PROFILE_TEMPLATE: &str = include_str!("../../macros/profile.ijm");

fn macro_string(s: &str) -> String {
    // ImageJ macro strings are more robust with forward slashes,
    // especially on Windows paths and non-ASCII filenames.
    s.replace('\\', "/").replace('"', "\\\"")
}

fn roi_code(roi: &Option<Roi>) -> String {
    match roi {
        Some(r) => format!("makeRectangle({}, {}, {}, {});", r.x, r.y, r.width, r.height),
        None => String::new(),
    }
}

fn render_template(template: &str, replacements: &[(&str, String)]) -> String {
    let mut out = template.to_string();
    for (key, value) in replacements {
        out = out.replace(key, value);
    }
    out
}

pub fn generate_macro(req: &JobRequest, output_csv: &str) -> String {
    match req.analysis {
        AnalysisKind::Measure => generate_measure(req, output_csv),
        AnalysisKind::Profile => generate_profile(req, output_csv),
        AnalysisKind::WhiteDefectPixels => String::new(),
    }
}

fn generate_measure(req: &JobRequest, output_csv: &str) -> String {
    render_template(
        MEASURE_TEMPLATE,
        &[
            ("${INPUT}", macro_string(&req.input_image)),
            ("${OUTPUT}", macro_string(output_csv)),
            ("${ROI_CODE}", roi_code(&req.roi)),
        ],
    )
}

fn generate_profile(req: &JobRequest, output_csv: &str) -> String {
    render_template(
        PROFILE_TEMPLATE,
        &[
            ("${INPUT}", macro_string(&req.input_image)),
            ("${OUTPUT}", macro_string(output_csv)),
            ("${X1}", req.profile.x1.to_string()),
            ("${Y1}", req.profile.y1.to_string()),
            ("${X2}", req.profile.x2.to_string()),
            ("${Y2}", req.profile.y2.to_string()),
        ],
    )
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::job::{DefectPixelParams, JobRequest, ProfileParams, RawImageParams};

    fn base_request() -> JobRequest {
        JobRequest {
            imagej_path: "C:/Fiji.app/ImageJ-win64.exe".to_string(),
            input_image: "C:\\Images\\test image.png".to_string(),
            output_dir: "C:\\Results".to_string(),
            base_name: "out".to_string(),
            analysis: AnalysisKind::Measure,
            roi: Some(Roi { x: 10, y: 20, width: 30, height: 40 }),
            profile: ProfileParams::default(),
            defect_pixels: DefectPixelParams::default(),
        }
    }

    #[test]
    fn measure_template_is_rendered_without_placeholders() {
        let req = base_request();
        let macro_text = generate_macro(&req, "C:/Results/out_20260629_132455.csv");
        assert!(macro_text.contains("C:/Images/test image.png"));
        assert!(macro_text.contains("C:/Results/out_20260629_132455.csv"));
        assert!(macro_text.contains("makeRectangle(10, 20, 30, 40);"));
        assert!(!macro_text.contains("${"));
    }

    #[test]
    fn profile_template_keeps_imagej_loop_braces() {
        let mut req = base_request();
        req.analysis = AnalysisKind::Profile;
        let macro_text = generate_macro(&req, "C:/Results/out_20260629_132455.csv");
        assert!(macro_text.contains("for (i = 0; i < count; i++) {"));
        assert!(macro_text.contains("}"));
        assert!(!macro_text.contains("${"));
    }

}