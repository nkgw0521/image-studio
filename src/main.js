import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import "./style.css";

const STORAGE_KEY = "image-studio-phase3-settings-v2";
const state = {
  running: false,
  currentJobId: null,
  settings: {},
  lastCsvPath: "",
  lastOutputCsv: "",
  imageWidth: 0,
  imageHeight: 0,
  lastCsvData: null,
  profileChart: null,
  selectedProfilePoint: null,
  selectedCsvRow: null,
  profileEval: { dnThreshold: 5, sigmaThreshold: 3 },
  profileLine: null,
  previewLineEnabled: true,
};

const app = document.querySelector("#app");
app.innerHTML = `
  <header class="topbar">
    <div>
      <h1>Image Studio</h1>
      <p>Fiji/ImageJ を headless 実行して CSV を出力します。</p>
    </div>
    <div class="status idle" id="status">Idle</div>
  </header>

  <nav class="tabs" aria-label="Main tabs">
    <button class="tab active" data-tab="analysis">解析</button>
    <button class="tab" data-tab="result">結果</button>
    <button class="tab" data-tab="log">ログ</button>
    <button class="tab" data-tab="settings">設定</button>
  </nav>

  <main class="main-shell">
    <section id="tab-analysis" class="tab-page active">
      <div class="analysis-layout">
        <section class="card preview-card">
          <div class="panel-header">
            <div>
              <h2>Image Preview</h2>
              <p class="muted">入力画像を確認します。PNG/JPEG/BMPは安定、TIFFはWebView対応に依存します。</p>
            </div>
            <div class="preview-toolbar">
              <label class="check preview-line-toggle"><input id="previewLineEnabled" type="checkbox" checked /> Preview Line</label>
              <button id="btnRefreshPreview">更新</button>
            </div>
          </div>

          <div class="main-input-row">
            <div class="field">
              <label>Input image <span>required</span></label>
              <div class="row two-actions">
                <input id="inputImage" placeholder="input.tif / input.png" />
                <button id="btnInput">選択</button>
              </div>
            </div>
          </div>

          <div id="dropZone" class="drop-zone">
            <svg id="imageProfileLineOverlay" class="image-profile-line-overlay hidden" aria-hidden="true">
              <line id="imageProfileLine" x1="0" y1="0" x2="0" y2="0"></line>
            </svg>
            <div id="imageProfileMarker" class="image-profile-marker hidden">
              <div class="marker-v"></div><div class="marker-h"></div><div class="marker-dot"></div>
            </div>
            <div id="previewEmpty" class="preview-empty">
              画像を選択してください。<br />ドラッグ&ドロップも試行できます。
            </div>
            <img id="imagePreview" class="hidden" alt="input preview" />
          </div>
          <div id="previewInfo" class="preview-info">No image loaded</div>
          <div id="profileLineInfo" class="preview-info profile-line-info hidden">Line: -</div>
        </section>

        <section class="card analysis-card">
          <h2>Analysis</h2>
          <div class="field">
            <label>Analysis type</label>
            <select id="analysisType">
              <option value="measure">輝度統計 / Measure</option>
              <option value="particles">粒子解析 / Particle Analysis</option>
              <option value="profile">ラインプロファイル / Line Profile</option>
            </select>
          </div>

          <div class="roi-grid">
            <div class="field"><label>ROI X</label><input id="roiX" type="number" placeholder="empty" /></div>
            <div class="field"><label>ROI Y</label><input id="roiY" type="number" placeholder="empty" /></div>
            <div class="field"><label>ROI W</label><input id="roiW" type="number" placeholder="empty" /></div>
            <div class="field"><label>ROI H</label><input id="roiH" type="number" placeholder="empty" /></div>
          </div>
          <small class="help block-help">ROIは4項目すべて入力した場合のみ有効です。空欄なら全画像です。</small>

          <div id="particlesPanel" class="subpanel hidden">
            <h3>Particle parameters</h3>
            <div class="field"><label>Threshold</label><input id="threshold" value="Otsu dark" /></div>
            <div class="inline-fields">
              <div class="field"><label>Min area</label><input id="minArea" type="number" value="20" /></div>
              <div class="field"><label>Max area</label><input id="maxArea" type="number" placeholder="empty = Infinity" /></div>
            </div>
          </div>

          <div id="profilePanel" class="subpanel hidden">
            <h3>Profile parameters</h3>
            <div class="profile-presets">
              <button id="btnProfileHorizontal" type="button">全幅 Horizontal</button>
              <button id="btnProfileVertical" type="button">全高 Vertical</button>
            </div>
            <div class="line-grid">
              <div class="field"><label>X1</label><input id="lineX1" type="number" value="0" /></div>
              <div class="field"><label>Y1</label><input id="lineY1" type="number" value="0" /></div>
              <div class="field"><label>X2</label><input id="lineX2" type="number" value="100" /></div>
              <div class="field"><label>Y2</label><input id="lineY2" type="number" value="0" /></div>
            </div>
            <small class="help block-help">Line ProfileはROI設定を使いません。X1/Y1からX2/Y2までの線分を直接サンプリングします。</small>
          </div>

          <div class="output-summary">
            <div><strong>Output</strong></div>
            <div id="outputSummary">設定タブで出力先とベース名を指定してください。</div>
          </div>

          <div class="actions">
            <button id="btnRun" class="primary">解析実行</button>
            <button id="btnCancel" disabled>キャンセル</button>
            <button id="btnOpenSettings">設定を開く</button>
          </div>
        </section>
      </div>
    </section>

    <section id="tab-result" class="tab-page">
      <section class="card full-card">
        <div class="panel-header">
          <div>
            <h2>CSV Result</h2>
            <p id="csvInfo" class="muted">No CSV loaded</p>
          </div>
          <button id="btnReloadCsv">再読込</button>
        </div>
        <div id="profileChartWrap" class="profile-chart-wrap hidden">
          <div class="chart-title-row">
            <div>
              <h3>Line Profile Chart</h3>
              <p id="profileChartInfo" class="muted">x: index, y: value</p>
            </div>
          </div>
          <div class="profile-chart-canvas-wrap">
            <canvas id="profileChart" width="1200" height="260"></canvas>
            <div id="profileChartHover" class="profile-chart-hover hidden"></div>
          </div>
        </div>
        <div id="profileEvalWrap" class="profile-eval-wrap hidden"></div>
        <div id="profileStatsWrap" class="profile-stats-wrap hidden"></div>
        <div id="profilePeaksWrap" class="profile-peaks-wrap hidden"></div>
        <div id="csvTableWrap" class="csv-table-wrap"></div>
      </section>
    </section>

    <section id="tab-log" class="tab-page">
      <section class="card full-card">
        <div class="panel-header">
          <div>
            <h2>Log</h2>
            <p class="muted">通常操作中は見なくてよい詳細ログです。エラー時の調査に使います。</p>
          </div>
          <div class="button-row">
            <button id="btnCopyLog">コピー</button>
            <button id="btnClear">ログ消去</button>
          </div>
        </div>
        <div id="log" class="log-lines"></div>
      </section>
    </section>

    <section id="tab-settings" class="tab-page">
      <section class="card full-card settings-page-card">
        <h2>Settings</h2>
        <div class="settings-grid">
          <div class="field field-imagej">
            <label>ImageJ/Fiji executable <span>required</span></label>
            <div class="row imagej-row">
              <input id="imagejPath" placeholder="C:\\Fiji.app\\ImageJ-win64.exe" />
              <button id="btnImagej">選択</button>
              <button id="btnDetect">検出</button>
            </div>
            <small class="help">Windowsでは Fiji の <code>ImageJ-win64.exe</code> を推奨します。</small>
          </div>

          <div class="field">
            <label>Output directory <span>required</span></label>
            <div class="row two-actions">
              <input id="outputDir" placeholder="C:\\Users\\...\\Documents" />
              <button id="btnOutputDir">選択</button>
            </div>
          </div>

          <div class="field">
            <label>Base name <span>required</span></label>
            <input id="baseName" placeholder="result" />
            <small class="help">出力CSVは <code>base_YYYYMMDD_HHMMSS.csv</code> 形式で自動生成します。</small>
          </div>

          <div class="settings-section">
            <h3>Advanced</h3>
            <label class="check"><input id="showStderr" type="checkbox" /> STDERR警告もログ表示する</label>
          </div>
        </div>
      </section>
    </section>
  </main>
`;

const $ = (id) => document.querySelector(id);
const els = {
  imagejPath: $("#imagejPath"), inputImage: $("#inputImage"), outputDir: $("#outputDir"), baseName: $("#baseName"),
  analysisType: $("#analysisType"), roiX: $("#roiX"), roiY: $("#roiY"), roiW: $("#roiW"), roiH: $("#roiH"),
  threshold: $("#threshold"), minArea: $("#minArea"), maxArea: $("#maxArea"),
  lineX1: $("#lineX1"), lineY1: $("#lineY1"), lineX2: $("#lineX2"), lineY2: $("#lineY2"),
  particlesPanel: $("#particlesPanel"), profilePanel: $("#profilePanel"),
  log: $("#log"), status: $("#status"), btnRun: $("#btnRun"), btnCancel: $("#btnCancel"),
  imagePreview: $("#imagePreview"), previewEmpty: $("#previewEmpty"), previewInfo: $("#previewInfo"),
  csvInfo: $("#csvInfo"), csvTableWrap: $("#csvTableWrap"), showStderr: $("#showStderr"),
  profileChartWrap: $("#profileChartWrap"), profileChart: $("#profileChart"), profileChartInfo: $("#profileChartInfo"), profileChartHover: $("#profileChartHover"),
  profileStatsWrap: $("#profileStatsWrap"), profilePeaksWrap: $("#profilePeaksWrap"), profileEvalWrap: $("#profileEvalWrap"), imageProfileMarker: $("#imageProfileMarker"),
  imageProfileLineOverlay: $("#imageProfileLineOverlay"), imageProfileLine: $("#imageProfileLine"), profileLineInfo: $("#profileLineInfo"), previewLineEnabled: $("#previewLineEnabled"),
  outputSummary: $("#outputSummary"),
};

function redrawPreviewOverlaySoon() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      updatePreviewProfileLine();
      if (state.selectedProfilePoint) showProfileMarker(state.selectedProfilePoint);
    });
  });
}

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab-page").forEach((p) => p.classList.toggle("active", p.id === `tab-${name}`));
  if (name === "result" && state.lastCsvData) {
    requestAnimationFrame(() => renderCsvTable(state.lastCsvData));
  }
  if (name === "analysis") {
    redrawPreviewOverlaySoon();
  }
}

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => switchTab(button.dataset.tab));
});
$("#btnOpenSettings").addEventListener("click", () => switchTab("settings"));

function loadSettings() {
  try { state.settings = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { state.settings = {}; }
  const s = state.settings;
  els.imagejPath.value = s.imagejPath || "";
  els.inputImage.value = s.inputImage || "";
  els.outputDir.value = s.outputDir || s.outputCsv?.replace(/[\\/][^\\/]*$/, "") || "";
  els.baseName.value = s.baseName || "result";
  els.analysisType.value = s.analysisType || "measure";
  els.threshold.value = s.threshold || "Otsu dark";
  els.minArea.value = s.minArea ?? "20";
  els.maxArea.value = s.maxArea ?? "";
  els.roiX.value = s.roiX ?? ""; els.roiY.value = s.roiY ?? ""; els.roiW.value = s.roiW ?? ""; els.roiH.value = s.roiH ?? "";
  els.lineX1.value = s.lineX1 ?? "0"; els.lineY1.value = s.lineY1 ?? "0"; els.lineX2.value = s.lineX2 ?? "100"; els.lineY2.value = s.lineY2 ?? "0";
  els.showStderr.checked = !!s.showStderr;
  els.previewLineEnabled.checked = s.previewLineEnabled !== false;
  state.previewLineEnabled = els.previewLineEnabled.checked;
  state.profileEval.dnThreshold = Number.isFinite(Number(s.profileEvalDnThreshold)) ? Number(s.profileEvalDnThreshold) : 5;
  state.profileEval.sigmaThreshold = Number.isFinite(Number(s.profileEvalSigmaThreshold)) ? Number(s.profileEvalSigmaThreshold) : 3;
  updateAnalysisPanels();
  updateOutputSummary();
  updatePreviewProfileLine();
}

function saveSettings() {
  const s = {
    imagejPath: els.imagejPath.value, inputImage: els.inputImage.value, outputDir: els.outputDir.value, baseName: els.baseName.value,
    analysisType: els.analysisType.value, threshold: els.threshold.value,
    minArea: els.minArea.value, maxArea: els.maxArea.value,
    roiX: els.roiX.value, roiY: els.roiY.value, roiW: els.roiW.value, roiH: els.roiH.value,
    lineX1: els.lineX1.value, lineY1: els.lineY1.value, lineX2: els.lineX2.value, lineY2: els.lineY2.value,
    showStderr: els.showStderr.checked,
    previewLineEnabled: els.previewLineEnabled.checked,
    profileEvalDnThreshold: state.profileEval.dnThreshold,
    profileEvalSigmaThreshold: state.profileEval.sigmaThreshold,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  updateOutputSummary();
}

function updateOutputSummary() {
  const dir = els.outputDir.value.trim() || "未設定";
  const base = els.baseName.value.trim() || "未設定";
  els.outputSummary.textContent = `${dir} / ${base}_YYYYMMDD_HHMMSS.csv`;
}

function status(text, mode = "idle") {
  els.status.textContent = text;
  els.status.className = `status ${mode}`;
}

function log(message, level = "info") {
  if (level === "stderr" && !els.showStderr.checked) return;
  const t = new Date().toLocaleTimeString();
  const div = document.createElement("div");
  div.className = `log-line ${level}`;
  div.textContent = `[${t}] ${level.toUpperCase()}: ${message}`;
  els.log.appendChild(div);
  els.log.scrollTop = els.log.scrollHeight;
}

function setRunning(running) {
  state.running = running;
  els.btnRun.disabled = running;
  els.btnCancel.disabled = !running;
  status(running ? "Running" : "Idle", running ? "running" : "idle");
}

function numberOrNull(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`数値ではありません: ${s}`);
  return n;
}

function parseRoi() {
  const vals = [els.roiX.value, els.roiY.value, els.roiW.value, els.roiH.value].map(numberOrNull);
  const filled = vals.filter((v) => v !== null).length;
  if (filled === 0) return null;
  if (filled !== 4) throw new Error("ROIは X/Y/W/H をすべて入力するか、すべて空欄にしてください。");
  if (vals[2] <= 0 || vals[3] <= 0) throw new Error("ROI W/H は正の値にしてください。");
  return { x: vals[0], y: vals[1], width: vals[2], height: vals[3] };
}

function parseLine() {
  const vals = [els.lineX1.value, els.lineY1.value, els.lineX2.value, els.lineY2.value].map(numberOrNull);
  if (vals.some((v) => v === null)) throw new Error("Line Profileは X1/Y1/X2/Y2 をすべて入力してください。");
  if (vals[0] === vals[2] && vals[1] === vals[3]) throw new Error("Line Profileは始点と終点を別の座標にしてください。");
  return { x1: vals[0], y1: vals[1], x2: vals[2], y2: vals[3] };
}

function requestFromUi() {
  if (!els.imagejPath.value.trim()) throw new Error("ImageJ/Fiji executable を設定タブで指定してください。");
  if (!els.inputImage.value.trim()) throw new Error("Input image を指定してください。");
  if (!els.outputDir.value.trim()) throw new Error("Output directory を設定タブで指定してください。");
  if (!els.baseName.value.trim()) throw new Error("Base name を設定タブで指定してください。");
  return {
    imagej_path: els.imagejPath.value.trim(),
    input_image: els.inputImage.value.trim(),
    output_dir: els.outputDir.value.trim(),
    base_name: els.baseName.value.trim(),
    analysis: els.analysisType.value,
    roi: parseRoi(),
    particles: {
      threshold: els.threshold.value.trim() || "Otsu dark",
      min_area: Number(els.minArea.value || 20),
      max_area: els.maxArea.value.trim() ? Number(els.maxArea.value) : null,
    },
    profile: parseLine(),
  };
}

function updateAnalysisPanels() {
  els.particlesPanel.classList.toggle("hidden", els.analysisType.value !== "particles");
  els.profilePanel.classList.toggle("hidden", els.analysisType.value !== "profile");
  updatePreviewProfileLine();
}

function readProfileLineFromInputs() {
  const vals = [els.lineX1.value, els.lineY1.value, els.lineX2.value, els.lineY2.value].map((v) => Number(String(v ?? "").trim()));
  if (!vals.every(Number.isFinite)) return null;
  if (vals[0] === vals[2] && vals[1] === vals[3]) return null;
  return { x1: vals[0], y1: vals[1], x2: vals[2], y2: vals[3] };
}

function updatePreviewProfileLine() {
  state.previewLineEnabled = !!els.previewLineEnabled?.checked;
  if (!state.previewLineEnabled || els.analysisType.value !== "profile") {
    hideProfileLine();
    return;
  }
  const line = readProfileLineFromInputs();
  state.profileLine = line;
  if (line) showProfileLine(line);
  else hideProfileLine();
}

async function loadPreview(path = els.inputImage.value.trim()) {
  els.imagePreview.classList.add("hidden");
  els.previewEmpty.classList.remove("hidden");
  if (!path) { els.previewInfo.textContent = "No image loaded"; return; }
  try {
    els.previewInfo.textContent = "Loading preview...";
    const preview = await invoke("preview_image_data_url", { path });
    els.imagePreview.onload = () => {
      state.imageWidth = els.imagePreview.naturalWidth;
      state.imageHeight = els.imagePreview.naturalHeight;
      els.previewInfo.textContent = `${preview.file_name} / ${state.imageWidth} x ${state.imageHeight}`;
      updatePreviewProfileLine();
      if (state.selectedProfilePoint) showProfileMarker(state.selectedProfilePoint);
    };
    els.imagePreview.onerror = () => {
      els.previewInfo.textContent = "Preview decode failed. TIFF may not be supported by this WebView.";
    };
    els.imagePreview.src = preview.data_url;
    els.previewEmpty.classList.add("hidden");
    els.imagePreview.classList.remove("hidden");
  } catch (e) {
    els.previewInfo.textContent = String(e);
    els.previewEmpty.classList.remove("hidden");
  }
}


function numericColumnIndex(headers, name) {
  return headers.findIndex((h) => String(h).trim().toLowerCase() === name);
}


function hideProfileMarker() {
  if (els.imageProfileMarker) els.imageProfileMarker.classList.add("hidden");
}

function previewImageMetrics() {
  const img = els.imagePreview;
  const zone = $("#dropZone");
  const imageWidth = state.imageWidth || img?.naturalWidth || 0;
  const imageHeight = state.imageHeight || img?.naturalHeight || 0;
  if (!img || !zone || img.classList.contains("hidden") || !imageWidth || !imageHeight) return null;
  const zoneRect = zone.getBoundingClientRect();
  const imgRect = img.getBoundingClientRect();
  if (zoneRect.width <= 0 || zoneRect.height <= 0 || imgRect.width <= 0 || imgRect.height <= 0) return null;
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const map = (x, y) => ({
    x: imgRect.left - zoneRect.left + (clamp(Number(x), 0, imageWidth - 1) / Math.max(1, imageWidth - 1)) * imgRect.width,
    y: imgRect.top - zoneRect.top + (clamp(Number(y), 0, imageHeight - 1) / Math.max(1, imageHeight - 1)) * imgRect.height,
  });
  return { zoneRect, imgRect, imageWidth, imageHeight, map };
}

function hideProfileLine() {
  if (els.imageProfileLineOverlay) els.imageProfileLineOverlay.classList.add("hidden");
  if (els.profileLineInfo) els.profileLineInfo.classList.add("hidden");
}

function showProfileLine(line = state.profileLine) {
  const overlay = els.imageProfileLineOverlay;
  const svgLine = els.imageProfileLine;
  if (!state.previewLineEnabled || els.analysisType.value !== "profile") { hideProfileLine(); return; }
  if (!overlay || !svgLine || !line) { hideProfileLine(); return; }
  const m = previewImageMetrics();
  if (!m) {
    // プレビュータブが非表示のときは矩形が0になるため、line情報だけ保持して後で再描画する。
    if (els.profileLineInfo) {
      els.profileLineInfo.textContent = `Line: (${line.x1}, ${line.y1}) → (${line.x2}, ${line.y2})`;
      els.profileLineInfo.classList.remove("hidden");
    }
    return;
  }
  const x1 = Number(line.x1), y1 = Number(line.y1), x2 = Number(line.x2), y2 = Number(line.y2);
  if (![x1, y1, x2, y2].every(Number.isFinite)) { hideProfileLine(); return; }

  const a = m.map(x1, y1);
  const b = m.map(x2, y2);
  overlay.setAttribute("viewBox", `0 0 ${m.zoneRect.width} ${m.zoneRect.height}`);
  overlay.setAttribute("width", `${m.zoneRect.width}`);
  overlay.setAttribute("height", `${m.zoneRect.height}`);
  overlay.style.width = `${m.zoneRect.width}px`;
  overlay.style.height = `${m.zoneRect.height}px`;
  svgLine.setAttribute("x1", String(a.x));
  svgLine.setAttribute("y1", String(a.y));
  svgLine.setAttribute("x2", String(b.x));
  svgLine.setAttribute("y2", String(b.y));
  overlay.classList.remove("hidden");
  if (els.profileLineInfo) {
    els.profileLineInfo.textContent = `Line: (${x1}, ${y1}) → (${x2}, ${y2})`;
    els.profileLineInfo.classList.remove("hidden");
  }
}

function showProfileMarker(point) {
  const marker = els.imageProfileMarker;
  if (!marker || !point) return;
  const x = Number(point.x);
  const y = Number(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const m = previewImageMetrics();
  if (!m) return;
  const p = m.map(x, y);

  marker.style.setProperty("--marker-left", `${p.x}px`);
  marker.style.setProperty("--marker-top", `${p.y}px`);
  marker.style.setProperty("--image-left", `${m.imgRect.left - m.zoneRect.left}px`);
  marker.style.setProperty("--image-top", `${m.imgRect.top - m.zoneRect.top}px`);
  marker.style.setProperty("--image-width", `${m.imgRect.width}px`);
  marker.style.setProperty("--image-height", `${m.imgRect.height}px`);
  marker.classList.remove("hidden");
}

function profileStats(points, meanY) {
  let min = points[0], max = points[0];
  let sumSq = 0;
  for (const p of points) {
    if (p.value < min.value) min = p;
    if (p.value > max.value) max = p;
    const d = p.value - meanY;
    sumSq += d * d;
  }
  const variance = sumSq / points.length;
  const stdDev = Math.sqrt(variance);
  const rmsDelta = Math.sqrt(sumSq / points.length);
  const withAbs = points.map((p) => {
    const d = Number.isFinite(Number(p.delta)) ? Number(p.delta) : p.value - meanY;
    return { ...p, delta: d, absDelta: Math.abs(d) };
  });
  const sortedPos = [...withAbs].sort((a, b) => b.delta - a.delta).slice(0, 5);
  const sortedNeg = [...withAbs].sort((a, b) => a.delta - b.delta).slice(0, 5);
  const largestAbs = [...withAbs].sort((a, b) => b.absDelta - a.absDelta).slice(0, 10);
  const dnThreshold = Math.max(0, Number(state.profileEval.dnThreshold || 0));
  const sigmaThreshold = Math.max(0, Number(state.profileEval.sigmaThreshold || 0));
  const sigmaDn = sigmaThreshold > 0 ? sigmaThreshold * stdDev : Infinity;
  const effectiveThreshold = Math.max(dnThreshold, Number.isFinite(sigmaDn) ? sigmaDn : 0);
  const outliers = withAbs.filter((p) => p.absDelta >= effectiveThreshold);
  const maxAbs = largestAbs[0] || withAbs[0];
  const judgement = outliers.length === 0 ? "PASS" : "FAIL";
  return { mean: meanY, stdDev, min, max, peakToPeak: max.value - min.value, rmsDelta, positivePeaks: sortedPos, negativePeaks: sortedNeg, largestAbs, outliers, outlierIndexSet: new Set(outliers.map((p) => p.index)), maxAbs, dnThreshold, sigmaThreshold, sigmaDn, effectiveThreshold, judgement };
}

function fmtNum(v, digits = 3) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : "";
}


function renderProfileEvaluation(stats) {
  const wrap = els.profileEvalWrap;
  if (!wrap || !stats) return;
  wrap.classList.remove("hidden");
  const maxAbs = stats.maxAbs;
  const maxDeltaText = maxAbs ? `${maxAbs.delta >= 0 ? "+" : ""}${fmtNum(maxAbs.delta)}` : "";
  const reason = stats.judgement === "PASS"
    ? `No outliers: max |Δ| ${maxAbs ? fmtNum(maxAbs.absDelta) : ""} DN < threshold ${fmtNum(stats.effectiveThreshold)} DN`
    : `${stats.outliers.length} outlier(s): max |Δ| ${maxAbs ? fmtNum(maxAbs.absDelta) : ""} DN ≥ threshold ${fmtNum(stats.effectiveThreshold)} DN`;
  wrap.innerHTML = `
    <div class="eval-summary ${stats.judgement === "PASS" ? "pass" : "fail"}">
      <div class="eval-status">
        <span>Overall Evaluation</span>
        <strong>${stats.judgement}</strong>
        <small>${reason}</small>
      </div>
      <div class="eval-metrics">
        <div class="clickable-metric" data-profile-index="${maxAbs ? maxAbs.index : ""}"><span>Max |Δ|</span><strong>${maxAbs ? fmtNum(maxAbs.absDelta) : ""}</strong><small>${maxAbs ? `index ${maxAbs.index} / Δ ${maxDeltaText}` : ""}</small></div>
        <div class="clickable-metric" data-profile-index="${stats.outliers[0] ? stats.outliers[0].index : ""}"><span>Outliers</span><strong>${stats.outliers.length}</strong><small>|Δ| ≥ ${fmtNum(stats.effectiveThreshold)} DN</small></div>
        <div><span>DN threshold</span><input id="profileDnThreshold" type="number" step="0.1" min="0" value="${stats.dnThreshold}" /></div>
        <div><span>Sigma threshold</span><input id="profileSigmaThreshold" type="number" step="0.1" min="0" value="${stats.sigmaThreshold}" /></div>
      </div>
    </div>
  `;
  wrap.querySelectorAll(".clickable-metric[data-profile-index]").forEach((el) => {
    el.addEventListener("click", () => {
      const idx = Number(el.dataset.profileIndex);
      const point = state.profileChart?.points?.find((p) => p.index === idx);
      if (!point) return;
      state.selectedProfilePoint = point;
      drawProfileChart(point);
      showProfileLine(state.profileLine);
      showProfileMarker(point);
      selectCsvRowForProfilePoint(point, true);
    });
  });
  const dn = wrap.querySelector("#profileDnThreshold");
  const sig = wrap.querySelector("#profileSigmaThreshold");
  const update = () => {
    state.profileEval.dnThreshold = Math.max(0, Number(dn.value || 0));
    state.profileEval.sigmaThreshold = Math.max(0, Number(sig.value || 0));
    saveSettings();
    if (state.lastCsvData) renderCsvTable(state.lastCsvData);
  };
  dn.addEventListener("change", update);
  sig.addEventListener("change", update);
}

function renderProfileStats(stats) {
  if (!els.profileStatsWrap || !els.profilePeaksWrap || !stats) return;
  renderProfileEvaluation(stats);
  els.profileStatsWrap.classList.remove("hidden");
  els.profileStatsWrap.innerHTML = `
    <div class="stat-card"><span>Mean</span><strong>${fmtNum(stats.mean)}</strong></div>
    <div class="stat-card"><span>StdDev</span><strong>${fmtNum(stats.stdDev)}</strong></div>
    <div class="stat-card"><span>Min</span><strong>${fmtNum(stats.min.value)}</strong><small>index ${stats.min.index}</small></div>
    <div class="stat-card"><span>Max</span><strong>${fmtNum(stats.max.value)}</strong><small>index ${stats.max.index}</small></div>
    <div class="stat-card"><span>Peak-to-Peak</span><strong>${fmtNum(stats.peakToPeak)}</strong></div>
    <div class="stat-card"><span>RMS delta</span><strong>${fmtNum(stats.rmsDelta)}</strong></div>
  `;

  const rows = (items) => items.map((p) => {
    const d = Number.isFinite(Number(p.delta)) ? Number(p.delta) : p.value - stats.mean;
    return `<tr data-profile-index="${p.index}"><td>${p.index}</td><td>${p.x}</td><td>${p.y}</td><td>${fmtNum(p.value, 0)}</td><td>${d >= 0 ? "+" : ""}${fmtNum(d)}</td></tr>`;
  }).join("");
  els.profilePeaksWrap.classList.remove("hidden");
  els.profilePeaksWrap.innerHTML = `
    <div class="peaks-table peaks-table-wide"><h3>Largest |Δ| Top 10</h3><table><thead><tr><th>index</th><th>x</th><th>y</th><th>value</th><th>delta</th></tr></thead><tbody>${rows(stats.largestAbs)}</tbody></table></div>
    <div class="peaks-table"><h3>Positive peaks Top 5</h3><table><thead><tr><th>index</th><th>x</th><th>y</th><th>value</th><th>delta</th></tr></thead><tbody>${rows(stats.positivePeaks)}</tbody></table></div>
    <div class="peaks-table"><h3>Negative peaks Top 5</h3><table><thead><tr><th>index</th><th>x</th><th>y</th><th>value</th><th>delta</th></tr></thead><tbody>${rows(stats.negativePeaks)}</tbody></table></div>
  `;
  els.profilePeaksWrap.querySelectorAll("tr[data-profile-index]").forEach((tr) => {
    tr.addEventListener("mouseenter", () => {
      const idx = Number(tr.dataset.profileIndex);
      const point = state.profileChart?.points?.find((p) => p.index === idx);
      if (point) { drawProfileChart(point); showProfileMarker(point); }
    });
    tr.addEventListener("mouseleave", () => {
      drawProfileChart(state.selectedProfilePoint);
      showProfileLine(state.profileLine);
      showProfileLine(state.profileLine);
    if (state.selectedProfilePoint) showProfileMarker(state.selectedProfilePoint); else hideProfileMarker();
    });
    tr.addEventListener("click", () => {
      const idx = Number(tr.dataset.profileIndex);
      const point = state.profileChart?.points?.find((p) => p.index === idx);
      if (!point) return;
      state.selectedProfilePoint = point;
      drawProfileChart(point);
      showProfileMarker(point);
      selectCsvRowForProfilePoint(point, true);
    });
  });
}

function renderProfileChart(csv) {
  const wrap = els.profileChartWrap;
  const canvas = els.profileChart;
  const info = els.profileChartInfo;
  wrap.classList.add("hidden");
  state.profileChart = null;
  state.selectedProfilePoint = null;
  clearSelectedCsvRow();
  if (els.profileChartHover) els.profileChartHover.classList.add("hidden");
  if (els.profileStatsWrap) els.profileStatsWrap.classList.add("hidden");
  if (els.profilePeaksWrap) els.profilePeaksWrap.classList.add("hidden");
  if (els.profileEvalWrap) els.profileEvalWrap.classList.add("hidden");
  hideProfileMarker();
  hideProfileLine();
  state.profileLine = null;
  if (!csv || !csv.headers || !csv.rows) return;

  const indexCol = numericColumnIndex(csv.headers, "index");
  const valueCol = numericColumnIndex(csv.headers, "value");
  const xCol = numericColumnIndex(csv.headers, "x");
  const yCol = numericColumnIndex(csv.headers, "y");
  const deltaCol = numericColumnIndex(csv.headers, "value_minus_mean");
  if (indexCol < 0 || valueCol < 0) return;

  const points = [];
  for (const row of csv.rows) {
    const index = Number(row[indexCol]);
    const value = Number(row[valueCol]);
    if (!Number.isFinite(index) || !Number.isFinite(value)) continue;
    const px = xCol >= 0 ? Number(row[xCol]) : NaN;
    const py = yCol >= 0 ? Number(row[yCol]) : NaN;
    const delta = deltaCol >= 0 ? Number(row[deltaCol]) : NaN;
    points.push({
      index,
      value,
      x: Number.isFinite(px) ? px : "",
      y: Number.isFinite(py) ? py : "",
      delta: Number.isFinite(delta) ? delta : null,
    });
  }
  if (points.length < 2) return;

  let sumY = 0;
  for (const p of points) sumY += p.value;
  const meanY = sumY / points.length;
  for (const p of points) {
    if (p.delta === null) p.delta = p.value - meanY;
  }

  wrap.classList.remove("hidden");
  const stats = profileStats(points, meanY);
  for (const p of points) p.isOutlier = stats.outlierIndexSet.has(p.index);
  renderProfileStats(stats);
  info.textContent = `${points.length} points / x: index, y: value / mean: ${meanY.toFixed(3)} / σ: ${stats.stdDev.toFixed(3)} / P-P: ${stats.peakToPeak.toFixed(3)} / hover・clickで画像対応表示`;

  const parentWidth = Math.max(720, Math.floor(wrap.clientWidth - 24));
  const cssHeight = 340;
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${parentWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.width = Math.floor(parentWidth * dpr);
  canvas.height = Math.floor(cssHeight * dpr);

  const pad = { left: 70, right: 28, top: 18, bottom: 50 };
  const plotW = parentWidth - pad.left - pad.right;
  const plotH = cssHeight - pad.top - pad.bottom;

  let minX = points[0].index, maxX = points[0].index, minY = points[0].value, maxY = points[0].value;
  for (const p of points) {
    if (p.index < minX) minX = p.index;
    if (p.index > maxX) maxX = p.index;
    if (p.value < minY) minY = p.value;
    if (p.value > maxY) maxY = p.value;
  }
  if (minY === maxY) { minY -= 1; maxY += 1; }
  if (minX === maxX) { minX -= 1; maxX += 1; }

  const yMargin = Math.max((maxY - minY) * 0.08, 1);
  minY -= yMargin;
  maxY += yMargin;

  const sx = (x) => pad.left + ((x - minX) / (maxX - minX)) * plotW;
  const sy = (y) => pad.top + (1 - (y - minY) / (maxY - minY)) * plotH;

  state.profileChart = { points, meanY, stats, parentWidth, cssHeight, pad, plotW, plotH, minX, maxX, minY, maxY, sx, sy };
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  state.profileLine = { x1: firstPoint.x, y1: firstPoint.y, x2: lastPoint.x, y2: lastPoint.y };
  showProfileLine(state.profileLine);
  drawProfileChart();
}

function drawProfileChart(hoverPoint = null) {
  const chart = state.profileChart;
  const canvas = els.profileChart;
  if (!chart || !canvas) return;

  const { points, meanY, parentWidth, cssHeight, pad, plotW, plotH, minX, maxX, minY, maxY, sx, sy } = chart;
  const dpr = window.devicePixelRatio || 1;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, parentWidth, cssHeight);

  if (chart.stats && Number.isFinite(chart.stats.stdDev)) {
    const top = Math.max(pad.top, sy(meanY + 3 * chart.stats.stdDev));
    const bottom = Math.min(pad.top + plotH, sy(meanY - 3 * chart.stats.stdDev));
    if (bottom > top) {
      ctx.fillStyle = "rgba(22, 163, 74, 0.055)";
      ctx.fillRect(pad.left, top, plotW, bottom - top);
    }
  }

  ctx.font = "12px Segoe UI, Noto Sans JP, sans-serif";
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#e2e8f0";
  ctx.fillStyle = "#475569";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const t = i / yTicks;
    const y = pad.top + t * plotH;
    const v = maxY - t * (maxY - minY);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(parentWidth - pad.right, y);
    ctx.stroke();
    ctx.fillText(Number(v.toFixed(2)).toString(), pad.left - 10, y);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const xTicks = 6;
  for (let i = 0; i <= xTicks; i++) {
    const t = i / xTicks;
    const x = pad.left + t * plotW;
    const v = minX + t * (maxX - minX);
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top + plotH);
    ctx.stroke();
    ctx.fillText(Math.round(v).toString(), x, pad.top + plotH + 12);
  }

  ctx.strokeStyle = "#94a3b8";
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + plotH);
  ctx.lineTo(parentWidth - pad.right, pad.top + plotH);
  ctx.stroke();

  const meanYPos = sy(meanY);
  ctx.save();
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = "#64748b";
  ctx.beginPath();
  ctx.moveTo(pad.left, meanYPos);
  ctx.lineTo(parentWidth - pad.right, meanYPos);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = "#64748b";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText(`mean ${meanY.toFixed(3)}`, pad.left + 8, meanYPos - 4);

  if (chart.stats && Number.isFinite(chart.stats.stdDev)) {
    ctx.save();
    ctx.setLineDash([3, 5]);
    ctx.strokeStyle = "#f59e0b";
    for (const sigma of [3, -3]) {
      const yy = sy(meanY + sigma * chart.stats.stdDev);
      if (yy >= pad.top && yy <= pad.top + plotH) {
        ctx.beginPath();
        ctx.moveTo(pad.left, yy);
        ctx.lineTo(parentWidth - pad.right, yy);
        ctx.stroke();
        ctx.fillStyle = "#b45309";
        ctx.textAlign = "left";
        ctx.textBaseline = sigma > 0 ? "bottom" : "top";
        ctx.fillText(`${sigma > 0 ? "+" : "-"}3σ`, parentWidth - pad.right - 34, yy + (sigma > 0 ? -3 : 3));
      }
    }
    ctx.restore();
  }

  const maxDrawPoints = Math.min(points.length, Math.max(2, Math.floor(plotW * 2)));
  const step = Math.max(1, Math.floor(points.length / maxDrawPoints));
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < points.length; i += step) {
    const x = sx(points[i].index);
    const y = sy(points[i].value);
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  }
  const last = points[points.length - 1];
  ctx.lineTo(sx(last.index), sy(last.value));
  ctx.stroke();

  if (chart.stats?.outliers?.length) {
    ctx.fillStyle = "#dc2626";
    const maxMarkers = 2000;
    const outliers = chart.stats.outliers;
    const markerStep = Math.max(1, Math.ceil(outliers.length / maxMarkers));
    for (let i = 0; i < outliers.length; i += markerStep) {
      const p = outliers[i];
      const ox = sx(p.index);
      const oy = sy(p.value);
      if (ox >= pad.left && ox <= parentWidth - pad.right && oy >= pad.top && oy <= pad.top + plotH) {
        ctx.beginPath();
        ctx.arc(ox, oy, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  if (hoverPoint) {
    const hx = sx(hoverPoint.index);
    const hy = sy(hoverPoint.value);
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hx, pad.top);
    ctx.lineTo(hx, pad.top + plotH);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "#ef4444";
    ctx.beginPath();
    ctx.arc(hx, hy, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#334155";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("index", pad.left + plotW / 2, cssHeight - 22);
  ctx.save();
  ctx.translate(18, pad.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("value", 0, 0);
  ctx.restore();
}


function nearestProfilePointFromEvent(event) {
  const chart = state.profileChart;
  const canvas = els.profileChart;
  if (!chart || !canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const mx = event.clientX - rect.left;
  const my = event.clientY - rect.top;
  const { points, pad, plotW, plotH, minX, maxX } = chart;
  if (mx < pad.left || mx > pad.left + plotW || my < pad.top || my > pad.top + plotH) return null;
  const targetIndex = minX + ((mx - pad.left) / plotW) * (maxX - minX);
  let best = points[0];
  let bestDist = Math.abs(points[0].index - targetIndex);
  for (const p of points) {
    const d = Math.abs(p.index - targetIndex);
    if (d < bestDist) { best = p; bestDist = d; }
  }
  return { point: best, mx, my, rect };
}

function updateProfileChartHover(event) {
  const hit = nearestProfilePointFromEvent(event);
  const hover = els.profileChartHover;
  if (!hit || !hover) {
    if (hover) hover.classList.add("hidden");
    drawProfileChart(state.selectedProfilePoint);
    showProfileLine(state.profileLine);
    if (state.selectedProfilePoint) showProfileMarker(state.selectedProfilePoint); else hideProfileMarker();
    return;
  }

  const best = hit.point;
  drawProfileChart(best);
  showProfileLine(state.profileLine);
  showProfileMarker(best);
  const deltaText = best.delta >= 0 ? `+${best.delta.toFixed(3)}` : best.delta.toFixed(3);
  hover.innerHTML = `
    <div><b>index</b>: ${best.index}</div>
    <div><b>x</b>: ${best.x}</div>
    <div><b>y</b>: ${best.y}</div>
    <div><b>value</b>: ${best.value}</div>
    <div><b>delta</b>: ${deltaText}</div>
    <div><b>status</b>: ${best.isOutlier ? "OUTLIER" : "normal"}</div>
    <div class="hint">clickで固定</div>
  `;

  const tooltipW = 180;
  const tooltipH = 130;
  let left = hit.mx + 14;
  let top = hit.my + 14;
  if (left + tooltipW > hit.rect.width) left = hit.mx - tooltipW - 14;
  if (top + tooltipH > hit.rect.height) top = hit.my - tooltipH - 14;
  hover.style.left = `${Math.max(8, left)}px`;
  hover.style.top = `${Math.max(8, top)}px`;
  hover.classList.remove("hidden");
}

function clearProfileChartHover() {
  if (els.profileChartHover) els.profileChartHover.classList.add("hidden");
  drawProfileChart(state.selectedProfilePoint);
  showProfileLine(state.profileLine);
  if (state.selectedProfilePoint) showProfileMarker(state.selectedProfilePoint); else hideProfileMarker();
}

function selectProfileChartPoint(event) {
  const hit = nearestProfilePointFromEvent(event);
  if (!hit) return;
  state.selectedProfilePoint = hit.point;
  drawProfileChart(hit.point);
  showProfileLine(state.profileLine);
  showProfileMarker(hit.point);
  selectCsvRowForProfilePoint(hit.point, true);
}

function clearSelectedCsvRow() {
  if (state.selectedCsvRow) {
    state.selectedCsvRow.classList.remove("selected-profile-row");
    state.selectedCsvRow = null;
  }
}

function selectCsvRowForProfilePoint(point, shouldScroll = true) {
  if (!point || !els.csvTableWrap) return;
  const idx = Number(point.index);
  if (!Number.isFinite(idx)) return;
  const row = els.csvTableWrap.querySelector(`tr[data-profile-index="${idx}"]`);
  if (!row) return;
  clearSelectedCsvRow();
  row.classList.add("selected-profile-row");
  state.selectedCsvRow = row;
  if (shouldScroll) {
    const rowCenter = row.offsetTop + row.offsetHeight / 2;
    const targetTop = Math.max(0, rowCenter - els.csvTableWrap.clientHeight / 2);
    els.csvTableWrap.scrollTo({ top: targetTop, behavior: "smooth" });
  }
}

function clearFixedProfileSelection() {
  state.selectedProfilePoint = null;
  clearSelectedCsvRow();
  drawProfileChart(null);
  hideProfileMarker();
  showProfileLine(state.profileLine);
}

function withProfileDerivedColumns(csv) {
  if (!csv || !csv.headers || !csv.rows) return csv;
  const valueCol = numericColumnIndex(csv.headers, "value");
  if (valueCol < 0) return csv;
  const hasDelta = numericColumnIndex(csv.headers, "value_minus_mean") >= 0;
  if (hasDelta) return csv;

  const values = [];
  for (const row of csv.rows) {
    const v = Number(row[valueCol]);
    if (Number.isFinite(v)) values.push(v);
  }
  if (!values.length) return csv;

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    ...csv,
    headers: [...csv.headers, "value_minus_mean"],
    rows: csv.rows.map((row) => {
      const v = Number(row[valueCol]);
      const delta = Number.isFinite(v) ? (v - mean).toFixed(3) : "";
      return [...row, delta];
    }),
  };
}

function renderCsvTable(csv) {
  els.csvTableWrap.innerHTML = "";
  csv = withProfileDerivedColumns(csv);
  renderProfileChart(csv);
  if (!csv.headers.length) { els.csvInfo.textContent = "CSV is empty"; return; }
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
  csv.headers.forEach((h) => { const th = document.createElement("th"); th.textContent = h; trh.appendChild(th); });
  thead.appendChild(trh); table.appendChild(thead);
  const indexCol = numericColumnIndex(csv.headers, "index");
  const tbody = document.createElement("tbody");
  csv.rows.forEach((row) => {
    const tr = document.createElement("tr");
    if (indexCol >= 0) {
      const idx = Number(row[indexCol]);
      if (Number.isFinite(idx)) {
        tr.dataset.profileIndex = String(idx);
        const point = state.profileChart?.points?.find((p) => p.index === idx);
        if (point?.isOutlier) tr.classList.add("outlier-profile-row");
      }
    }
    for (let i = 0; i < Math.max(row.length, csv.headers.length); i++) {
      const td = document.createElement("td"); td.textContent = row[i] ?? ""; tr.appendChild(td);
    }
    tr.addEventListener("click", () => {
      const idx = Number(tr.dataset.profileIndex);
      const point = state.profileChart?.points?.find((p) => p.index === idx);
      if (!point) return;
      state.selectedProfilePoint = point;
      drawProfileChart(point);
      showProfileLine(state.profileLine);
      showProfileMarker(point);
      selectCsvRowForProfilePoint(point, false);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody); els.csvTableWrap.appendChild(table);
  clearSelectedCsvRow();
  if (state.selectedProfilePoint) selectCsvRowForProfilePoint(state.selectedProfilePoint, false);
  els.csvInfo.textContent = `${csv.rows.length} rows loaded${csv.truncated ? " (preview truncated at 100000 rows)" : ""}`;
}

async function loadCsv(path = state.lastOutputCsv || state.lastCsvPath) {
  if (!path) { els.csvInfo.textContent = "No CSV loaded"; els.csvTableWrap.innerHTML = ""; els.profileChartWrap.classList.add("hidden"); return; }
  try {
    const csv = await invoke("read_csv_preview", { path, maxRows: 100000 });
    state.lastCsvData = csv;
    renderCsvTable(csv);
    state.lastCsvPath = path;
  } catch (e) {
    els.csvInfo.textContent = String(e);
    els.csvTableWrap.innerHTML = "";
    els.profileChartWrap.classList.add("hidden");
  }
}


function setProfileHorizontalFull() {
  if (!state.imageWidth || !state.imageHeight) { log("画像サイズが未取得です。先に画像プレビューを読み込んでください。", "warn"); return; }
  const y = Math.floor(state.imageHeight / 2);
  els.lineX1.value = 0; els.lineY1.value = y;
  els.lineX2.value = state.imageWidth - 1; els.lineY2.value = y;
  saveSettings();
  updatePreviewProfileLine();
}

function setProfileVerticalFull() {
  if (!state.imageWidth || !state.imageHeight) { log("画像サイズが未取得です。先に画像プレビューを読み込んでください。", "warn"); return; }
  const x = Math.floor(state.imageWidth / 2);
  els.lineX1.value = x; els.lineY1.value = 0;
  els.lineX2.value = x; els.lineY2.value = state.imageHeight - 1;
  saveSettings();
  updatePreviewProfileLine();
}

async function chooseImagej() {
  const path = await open({ multiple: false, directory: false });
  if (path) { els.imagejPath.value = path; saveSettings(); }
}
async function chooseInput() {
  const path = await open({ multiple: false, directory: false, filters: [{ name: "Image", extensions: ["tif", "tiff", "png", "jpg", "jpeg", "bmp", "gif", "webp"] }] });
  if (path) { els.inputImage.value = path; saveSettings(); await loadPreview(path); }
}
async function chooseOutputDir() {
  const path = await open({ multiple: false, directory: true });
  if (path) { els.outputDir.value = path; saveSettings(); }
}

$("#btnImagej").addEventListener("click", chooseImagej);
$("#btnInput").addEventListener("click", chooseInput);
$("#btnOutputDir").addEventListener("click", chooseOutputDir);
$("#btnRefreshPreview").addEventListener("click", () => loadPreview());
$("#btnReloadCsv").addEventListener("click", () => loadCsv());
$("#btnProfileHorizontal")?.addEventListener("click", setProfileHorizontalFull);
$("#btnProfileVertical")?.addEventListener("click", setProfileVerticalFull);
els.profileChart?.addEventListener("mousemove", updateProfileChartHover);
els.profileChart?.addEventListener("mouseleave", clearProfileChartHover);
els.profileChart?.addEventListener("click", selectProfileChartPoint);
window.addEventListener("resize", () => {
  showProfileLine(state.profileLine);
  if (state.selectedProfilePoint) showProfileMarker(state.selectedProfilePoint);
});

$("#btnDetect").addEventListener("click", async () => {
  try {
    const candidates = await invoke("detect_imagej");
    if (candidates.length > 0) { els.imagejPath.value = candidates[0]; saveSettings(); log(`Detected ImageJ: ${candidates[0]}`); }
    else log("ImageJ/Fiji は自動検出できませんでした。手動で選択してください。", "warn");
  } catch (e) { log(String(e), "error"); }
});

els.analysisType.addEventListener("change", () => { updateAnalysisPanels(); saveSettings(); });
for (const el of [els.imagejPath, els.inputImage, els.outputDir, els.baseName, els.threshold, els.minArea, els.maxArea, els.roiX, els.roiY, els.roiW, els.roiH, els.showStderr]) {
  el.addEventListener("change", saveSettings);
}
for (const el of [els.lineX1, els.lineY1, els.lineX2, els.lineY2]) {
  el.addEventListener("input", () => { saveSettings(); updatePreviewProfileLine(); });
  el.addEventListener("change", () => { saveSettings(); updatePreviewProfileLine(); });
}
els.previewLineEnabled.addEventListener("change", () => { saveSettings(); updatePreviewProfileLine(); });
els.inputImage.addEventListener("change", () => { loadPreview(); updatePreviewProfileLine(); });

$("#dropZone").addEventListener("dragover", (e) => { e.preventDefault(); $("#dropZone").classList.add("dragover"); });
$("#dropZone").addEventListener("dragleave", () => $("#dropZone").classList.remove("dragover"));
$("#dropZone").addEventListener("drop", async (e) => {
  e.preventDefault(); $("#dropZone").classList.remove("dragover");
  const file = e.dataTransfer.files?.[0];
  const path = file?.path || file?.webkitRelativePath || "";
  if (!path) { log("ドラッグ&ドロップではファイルパスを取得できませんでした。選択ボタンを使用してください。", "warn"); return; }
  els.inputImage.value = path; saveSettings(); await loadPreview(path);
});

els.btnRun.addEventListener("click", async () => {
  try {
    const request = requestFromUi();
    saveSettings();
    setRunning(true);
    status("Running", "running");
    log(`START ${request.analysis}`);
    state.currentJobId = await invoke("start_analysis", { request });
    log(`Job accepted: ${state.currentJobId}`);
  } catch (e) {
    setRunning(false); status("Error", "error"); log(String(e), "error"); switchTab("log");
  }
});

els.btnCancel.addEventListener("click", async () => {
  try { await invoke("cancel_analysis"); }
  catch (e) { log(String(e), "error"); switchTab("log"); }
});

$("#btnClear").addEventListener("click", () => { els.log.innerHTML = ""; });
$("#btnCopyLog").addEventListener("click", async () => { await navigator.clipboard.writeText(els.log.innerText); });

listen("job-event", async (event) => {
  const { level, message, output_csv } = event.payload;
  if (output_csv) {
    state.lastOutputCsv = output_csv;
    state.lastCsvPath = output_csv;
  }
  log(message, level);
  if (level === "success") {
    setRunning(false); status("Completed", "success"); switchTab("result"); await loadCsv(output_csv || state.lastOutputCsv);
  } else if (level === "error" || String(message).startsWith("FAILED")) {
    setRunning(false); status("Error", "error"); switchTab("log");
  }
});

listen("backend-ready", () => log("Backend ready"));

loadSettings();
log("Ready. Input image を選択し、設定タブで ImageJ/Fiji executable / Output directory / Base name を確認してください。");
if (els.inputImage.value.trim()) loadPreview();
updatePreviewProfileLine();

window.addEventListener("resize", () => redrawPreviewOverlaySoon());
