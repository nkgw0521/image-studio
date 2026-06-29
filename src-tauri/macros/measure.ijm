setBatchMode(true);
input = "${INPUT}";
output = "${OUTPUT}";
open(input);
${ROI_CODE}
getStatistics(area, mean, min, max, std);
text = "metric,value\n";
text = text + "area," + area + "\n";
text = text + "mean," + mean + "\n";
text = text + "min," + min + "\n";
text = text + "max," + max + "\n";
text = text + "std," + std + "\n";
File.saveString(text, output);
close();
setBatchMode(false);
exit();
