# Image Studio

Image Studio is a cross-platform image analysis application for Windows and Linux.

It uses ImageJ/Fiji for ImageJ-based analyses and also includes native Rust analysis for pixel-level camera evaluation. The application layer adds preview, Line Profile charts, statistics, peak detection, outlier evaluation, white-defect-pixel listing, CSV linkage, and camera-oriented inspection workflows.

## Current focus

The current implementation focuses on practical camera and image-quality evaluation workflows, especially Line Profile analysis and white-defect-pixel listing.

Typical workflow:

```text
Open image
  -> Select analysis type
  -> Configure Line Profile, ROI, or white defect threshold
  -> Run ImageJ/Fiji or native Rust analysis
  -> Load generated CSV
  -> Review graph, statistics, outliers, image overlay, and CSV table
```

## Features

### Application

- Tauri v2 + Rust backend
- Vite frontend
- Windows/Linux oriented project structure
- Image Studio application identity and icon
- Tabbed UI:
  - Analysis
  - Result
  - Log
  - Settings
- Timestamped CSV output:

```text
<Output directory>/<Base name>_YYYYMMDD_HHMMSS.csv
```

### Analysis engines

- ImageJ/Fiji engine for ImageJ-compatible analyses
- Rust native engine for White Defect Pixel analysis
- RAW image loader for Rust native analyses

### ImageJ/Fiji integration

- ImageJ/Fiji executable selection
- ImageJ/Fiji auto-detection attempt
- ImageJ1-compatible batch execution
- Generated ImageJ macro execution
- CSV output validation
- Runtime log forwarding to the GUI

Fiji is recommended on Windows:

```text
C:\Fiji.app\ImageJ-win64.exe
```

### Supported analysis types

#### Measure

Measures image or ROI intensity statistics.

Typical use:

- Exposure check
- Gain check
- Saturation check
- Basic brightness/noise confirmation

#### Line Profile

Samples pixel values along a line from `(X1, Y1)` to `(X2, Y2)`.

Current CSV columns:

```csv
index,x,y,value,value_minus_mean
```

Line Profile includes:

- Realtime red preview line overlay from current `X1/Y1/X2/Y2`
- Full-width horizontal preset
- Full-height vertical preset
- Index-value chart
- Mean line
- ±3σ guide lines
- Hover tooltip
- Click-to-fix selected point
- Image preview marker
- CSV row synchronization
- Statistics cards
- Peak ranking
- Outlier evaluation
- PASS/FAIL summary

#### White Defect Pixel

Lists bright pixels in a dark image that exceed the configured white-point threshold. This analysis runs in the Rust native engine, not through ImageJ/Fiji, so it is suitable for large camera images and RAW image files.

Current CSV columns:

```csv
type,x,y,value,threshold,delta
```

Detection rule:

```text
white defect: value >= White threshold
```

Input image assumption:

```text
Dark image / black image
```

Typical use:

- White-point defect listing
- Bright pixel screening on dark frames
- Camera sensor evaluation

`Particle Analysis` was removed from the main analysis menu for now. Pixel-level defects are better handled by dedicated defect-pixel analyses instead of area-based particle detection. Black defect detection should be implemented as a separate analysis because it requires a bright image.


## RAW image input

Image Studio can treat the input file as a raw image by enabling **RAW image** in the input-format section below the input file path.

RAW input is an input format setting, not an Analysis-specific setting. In the current implementation, RAW files are processed by Rust-native analyses such as `White Defect Pixel`. ImageJ/Fiji-based analyses still require formats that ImageJ can open directly.

RAW parameters:

- `Width`
- `Height`
- `Bit depth`
- `Endian`
- `Header offset`

Current RAW support:

| Format | Status | Notes |
|---|---:|---|
| 8-bit RAW | Supported | 1 byte/pixel |
| 10/12/14-bit RAW | Supported as unpacked 16-bit container | 2 bytes/pixel |
| 16-bit RAW | Supported | 2 bytes/pixel |
| Packed RAW | Not supported yet | planned separately if needed |

RAW preview is not implemented yet. When RAW mode is enabled, the preview pane uses the configured Width/Height as the image size for analysis parameters, but it does not render the raw image. The RAW settings are intentionally placed next to the input image path because they describe the file format itself.

## Line Profile evaluation

Line Profile is currently the most developed analysis mode.

### Statistics

The Result tab calculates and displays:

- Mean
- StdDev
- Min
- Max
- Peak-to-Peak
- RMS delta

### Outlier rule

Outliers are detected using:

```text
|value_minus_mean| >= max(DN threshold, sigma threshold * StdDev)
```

Default thresholds:

```text
DN threshold    = 5
Sigma threshold = 3
```

A profile result is `PASS` when no samples exceed the effective threshold.

### Interactive linkage

The following views are synchronized:

- Line Profile chart
- Image preview marker/line overlay
- Peak table
- CSV table

Clicking a chart point, CSV row, or peak row selects the corresponding sample.

## White Defect Pixel analysis

White Defect Pixel scans the selected dark image or ROI and writes all pixels above the threshold to CSV.

Parameter:

- `White threshold`: pixels greater than or equal to this value are listed as `white` defects.

The Result tab shows a compact summary with the white count and maximum threshold delta. The CSV table remains the authoritative list of detected pixels.

Black defect detection is intentionally not included in this analysis. It will be added later as a separate analysis type for bright-image evaluation.

## Preview line overlay

When the analysis type is `Line Profile`, Image Studio displays the configured line on the image preview.

The preview line updates immediately when:

- `X1` changes
- `Y1` changes
- `X2` changes
- `Y2` changes
- `Full-width Horizontal` is selected
- `Full-height Vertical` is selected
- The preview image is reloaded

The overlay is display-only. Direct mouse dragging on the preview to set `X1/Y1/X2/Y2` is planned for a later phase.

## Requirements

### Runtime

- ImageJ or Fiji for Measure / Line Profile
- White Defect Pixel can run without ImageJ/Fiji
- Windows or Linux

### Development

- Node.js LTS recommended
- Rust toolchain
- Tauri prerequisites for the target OS

## Development commands

```bat
npm install
npm run build
cargo check --manifest-path src-tauri\Cargo.toml
npm run tauri:dev
```

Release build:

```bat
npm run tauri:build
```

## Project structure

```text
image-studio/
  src/
    main.js
    style.css
  src-tauri/
    src/
    macros/
    icons/
    Cargo.toml
    tauri.conf.json
  index.html
  package.json
  README.md
```

## Architecture

```text
+------------------------------+
|        Image Studio GUI       |
|     Tauri WebView / JS        |
+---------------+--------------+
                |
                v
+------------------------------+
|       Rust/Tauri backend      |
|  Job control / preview / CSV  |
+---------------+--------------+
                |
                v
+------------------------------+
|        ImageJ/Fiji engine     |
|      Macro execution / CSV    |
+------------------------------+
```

Future analysis engines can be added without changing the user-facing workflow:

```text
Analysis Engine
  - ImageJ/Fiji       current
  - Rust native       planned for pixel/statistics-heavy camera evaluation
  - OpenCV            candidate
```

## Known limitations

- Image preview support depends on WebView image decoding. PNG/JPEG/BMP are usually stable; TIFF support may vary.
- ImageJ/Fiji is required for Measure and Line Profile. Rust-native analyses such as White Defect Pixel do not require ImageJ/Fiji.
- RAW preview is not implemented yet.
- Preview-line dragging is not implemented yet.
- Graph zoom/pan is not implemented yet.
- Row Mean Profile and Column Mean Profile are not implemented yet.
- Report export is not implemented yet.

## Roadmap

### Phase 4 candidates

- Row Mean Profile
- Column Mean Profile
- Shutter Line Detection
- Defect-pixel overlay on image preview
- Graph zoom/pan
- Direct line drawing on the image preview
- Profile width / averaged profile
- HTML/PDF report export

### Camera evaluation direction

Image Studio is intended to grow toward a camera-oriented image evaluation workbench:

- Line Profile
- Row/Column statistics
- Banding analysis
- FPN analysis
- Uniformity
- Shutter line detection
- Defect pixel inspection

## Development policy

- Keep changes small and commit-oriented.
- Update README when user-visible behavior changes.
- Prefer reusable analysis/evaluation logic over one-off UI code.
- Keep ImageJ/Fiji as an analysis engine, not as the application identity.


## Result panel scrolling

The Result tab uses the whole `CSV Result` card as the scroll container.
This keeps the chart, evaluation summary, statistics, peak tables, and CSV rows in one continuous result view, avoiding clipping on smaller screens.
The CSV header remains sticky while scrolling through the result panel.

## Large CSV and performance policy

White Defect Pixel can generate very large CSV files when many pixels exceed the threshold. The application therefore uses a preview-oriented result display:

- The full CSV is always written to disk.
- The GUI loads only the first 2,000 defect rows for White Defect Pixel to keep tab switching responsive.
- The total number of detected rows is counted from the CSV and shown in the summary.
- CSV loading is streamed in Rust and does not read the whole file into memory.
- During Rust native scanning, progress events are emitted so the user can distinguish long processing from a frozen application.

This is intentional. The CSV file is the complete record; the GUI preview is for quick inspection and navigation.


## RAW input support

RAW files are detected by file extension (`.raw`, `.bin`, `.dat`, `.img`).
No separate RAW checkbox is required. When a RAW file is selected, the RAW settings panel is shown automatically.

Supported RAW formats in the current implementation:

- 8-bit unpacked grayscale RAW: 1 byte per pixel
- 10/12/14/16-bit unpacked grayscale RAW: 2 bytes per pixel
- Little endian / big endian selection for 16-bit based formats
- Header offset in bytes

Packed RAW formats are not supported yet.

RAW preview is generated by the Rust backend as an 8-bit grayscale PNG preview. This allows incorrect width, height, bit depth, endian, or offset settings to be noticed before running an analysis.

White Defect Pixel can use RAW input directly without ImageJ/Fiji.
