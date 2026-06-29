# Image Studio

Cross-platform image analysis platform for Windows and Linux.

Image Studio currently uses ImageJ/Fiji as the analysis engine and adds an application-side evaluation layer: preview, Line Profile graph, statistics, outlier detection, CSV linking, and camera-oriented analysis workflows.

Tauri v2 + Rust で Fiji/ImageJ を headless 実行する画像解析GUIです。

## Phase 3.0 の変更点

- 画面をタブUIへ再構成
  - 解析
  - 結果
  - ログ
  - 設定
- 初期表示では `Input image` と解析条件だけを表示
- `ImageJ/Fiji executable`、`Output directory`、`Base name` は設定タブへ移動
- ログはログタブへ移動
- 成功時は結果タブへ自動遷移
- エラー時はログタブへ自動遷移
- 既存の非同期ジョブ実行、CSV自動生成、画像プレビューは維持

## 出力CSV仕様

出力ファイルは以下の形式で自動生成されます。

```text
<Output directory>/<Base name>_YYYYMMDD_HHMMSS.csv
```

事前にCSVファイルを作成する必要はありません。

## 確認手順

```bat
npm install
npm run build
cargo check --manifest-path src-tauri\Cargo.toml
npm run tauri:dev
```

この生成環境では `npm run build` は確認済みです。`cargo` は利用できないため、Rust/Tauri側の確認は手元で実施してください。

## 推奨初期設定

Windowsでは Fiji の以下を推奨します。

```text
C:\Fiji.app\ImageJ-win64.exe
```

既存の ImageJ1 でも動く可能性はありますが、headless/batch 実行の安定性は Fiji の方が高いです。

## Line Profile fix

Line Profile no longer depends on ImageJ `Plot Profile` output. The generated macro samples pixels explicitly from `(X1,Y1)` to `(X2,Y2)` and writes:

```csv
index,x,y,value
```

For a horizontal full-width line, the row count should be approximately the image width. For a vertical full-height line, the row count should be approximately the image height.

The Analysis tab also provides quick preset buttons:

- `全幅 Horizontal`: center row, `x=0..width-1`
- `全高 Vertical`: center column, `y=0..height-1`

Note: ROI is not used by Line Profile. The line coordinates define the sampled region directly.


## Line Profile result preview fix

CSV result preview now loads up to 100000 data rows instead of 200 rows. The previous 200-row display was a UI preview limit, not a Line Profile sampling limit.

## Line Profile chart/display update

- Line Profileの結果タブに、`index`を横軸、`value`を縦軸にした折れ線グラフを表示します。
- グラフには平均値の基準線を表示します。
- Line Profile CSVには `value_minus_mean` を追加し、各点の値がプロファイル平均からどれだけズレているかを確認できます。
- 結果タブが非表示の状態でCSVを読み込んだ場合でも、タブ表示後に再描画して横幅を正しく使います。

## 2026-06-29 Line Profile hover tooltip

Line Profileの結果グラフに簡易ホバー表示を追加しました。

- グラフ上でマウスを動かすと、近傍点を赤丸で表示
- 同時に縦カーソル線を表示
- ツールチップに `index`, `x`, `y`, `value`, `delta` を表示
- `delta` は `value - mean(value)` です

今回の変更はフロントエンドのみです。

## Phase 3 Line Profile analysis additions

This build adds practical Line Profile review features:

- Graph-to-image linkage: hover/click on a Line Profile chart shows the corresponding point on the image preview.
- Profile statistics: Mean, StdDev, Min, Max, Peak-to-Peak, and RMS delta.
- Peak detection: positive and negative delta Top 5 tables.
- Chart overlays: mean line and +/-3 sigma guide lines.
- Hover tooltip remains available with index, x, y, value, and delta.

Clicking a chart point fixes the image marker until another point is selected.

## Change: Line Profile selection linkage

- Clicking the Line Profile chart now fixes the selected point.
- The fixed point is shown on the chart and image preview.
- The CSV table scrolls to the matching `index` row and highlights it.
- Clicking a CSV row also fixes the corresponding chart/image marker.
- Clicking a peak row also fixes the corresponding chart/image marker and scrolls the CSV table.

## Phase 3.2: Line Profile evaluation

Added Line Profile evaluation features:

- Overall Evaluation card with PASS / FAIL.
- DN threshold and sigma threshold inputs.
- Outlier detection based on `|value_minus_mean| >= max(DN threshold, sigma threshold * StdDev)`.
- Largest `|delta|` Top 10 table.
- Outlier markers on the chart.
- Outlier row highlighting in the CSV table.
- Existing chart hover, click selection, image marker, CSV row sync are preserved.

Default thresholds:

- DN threshold: `5`
- Sigma threshold: `3`

A profile result is PASS when no samples exceed the effective threshold.

## Phase 3.3 update

Line Profileの評価UIを強化しました。

- 画像プレビュー上にLine Profileの対象線を赤線オーバーレイ表示
- グラフhover/click、Peak表クリック、CSV行クリックと画像オーバーレイを同期
- Overall EvaluationにPASS/FAIL理由を表示
- Max |Δ| / Outliersカードクリックで該当行へ移動
- グラフ背景に±3σの正常領域を薄く表示

今回の赤線オーバーレイは表示専用です。プレビュー上で線をドラッグしてX1/Y1/X2/Y2へ反映する操作は次フェーズ候補です。


## Phase 3.3 overlay redraw fix

- Fixed preview line overlay redraw when switching back from the Result tab to the Analysis tab.
- Reworked image-coordinate to preview-coordinate mapping with visible image rectangle.
- Added current Line Profile coordinate text below the preview for debugging.
- Red line overlay is now drawn above the preview image with a stronger stroke.