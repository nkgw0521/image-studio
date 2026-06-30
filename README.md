# Image Studio

Image Studio is a cross-platform image analysis application for Windows and Linux.

It currently uses ImageJ/Fiji as the analysis engine and adds an application-side evaluation layer for preview, Line Profile charts, statistics, peak detection, outlier evaluation, CSV linkage, and camera-oriented inspection workflows.

## Current focus

The current implementation focuses on building a practical Line Profile Analyzer for camera and image-quality evaluation.

Typical workflow:

```text
Open image
  -> Select analysis type
  -> Configure Line Profile or ROI
  -> Run ImageJ/Fiji in batch mode
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

#### Particle Analysis

Runs threshold-based particle analysis through ImageJ/Fiji.

Typical use:

- Dust detection
- Scratch/defect candidate extraction
- Binary particle counting

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

- ImageJ or Fiji
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
  - Rust native       planned
  - OpenCV            candidate
```

## Known limitations

- Image preview support depends on WebView image decoding. PNG/JPEG/BMP are usually stable; TIFF support may vary.
- ImageJ/Fiji is currently required for analysis execution.
- Preview-line dragging is not implemented yet.
- Graph zoom/pan is not implemented yet.
- Row Mean Profile and Column Mean Profile are not implemented yet.
- Report export is not implemented yet.

## Roadmap

### Phase 4 candidates

- Row Mean Profile
- Column Mean Profile
- Shutter Line Detection
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
