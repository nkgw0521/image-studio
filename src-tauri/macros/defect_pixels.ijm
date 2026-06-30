setBatchMode(true);
input = "${INPUT}";
output = "${OUTPUT}";
whiteThreshold = ${WHITE_THRESHOLD};
blackThreshold = ${BLACK_THRESHOLD};

open(input);
${ROI_BOUNDS_CODE}

w = getWidth();
h = getHeight();

// Clamp ROI to the image area.
if (rx < 0) rx = 0;
if (ry < 0) ry = 0;
if (rw < 1) rw = 1;
if (rh < 1) rh = 1;
if (rx >= w) rx = w - 1;
if (ry >= h) ry = h - 1;
if (rx + rw > w) rw = w - rx;
if (ry + rh > h) rh = h - ry;

whiteCount = 0;
blackCount = 0;
text = "type,x,y,value,threshold,delta\n";

for (yy = ry; yy < ry + rh; yy++) {
    for (xx = rx; xx < rx + rw; xx++) {
        value = getPixel(xx, yy);
        if (value >= whiteThreshold) {
            delta = value - whiteThreshold;
            text = text + "white," + xx + "," + yy + "," + value + "," + whiteThreshold + "," + delta + "\n";
            whiteCount = whiteCount + 1;
        } else if (value <= blackThreshold) {
            delta = blackThreshold - value;
            text = text + "black," + xx + "," + yy + "," + value + "," + blackThreshold + "," + delta + "\n";
            blackCount = blackCount + 1;
        }
    }
}

File.saveString(text, output);
print("Defect Pixel Analysis: white=" + whiteCount + ", black=" + blackCount + ", total=" + (whiteCount + blackCount));
close();
setBatchMode(false);
exit();
