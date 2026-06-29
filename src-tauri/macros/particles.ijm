setBatchMode(true);
input = "${INPUT}";
output = "${OUTPUT}";
open(input);
${ROI_CODE}
run("8-bit");
setAutoThreshold("${THRESHOLD}");
run("Convert to Mask");
run("Set Measurements...", "area mean min centroid perimeter shape redirect=None decimal=6");
run("Analyze Particles...", "size=${SIZE} display clear summarize");
saveAs("Results", output);
if (!File.exists(output)) {
    Table.save(output);
}
close();
setBatchMode(false);
exit();
