setBatchMode(true);
input = "${INPUT}";
output = "${OUTPUT}";
x1 = ${X1};
y1 = ${Y1};
x2 = ${X2};
y2 = ${Y2};

open(input);
w = getWidth();
h = getHeight();

// Clamp line endpoints to the image area.
if (x1 < 0) x1 = 0;
if (y1 < 0) y1 = 0;
if (x2 < 0) x2 = 0;
if (y2 < 0) y2 = 0;
if (x1 >= w) x1 = w - 1;
if (x2 >= w) x2 = w - 1;
if (y1 >= h) y1 = h - 1;
if (y2 >= h) y2 = h - 1;

// Do not use Plot Profile here. It may return display/plot sampled data.
// Sample the pixel line explicitly so the point count is approximately the pixel length.
dx = x2 - x1;
dy = y2 - y1;
steps = round(sqrt(dx * dx + dy * dy));
if (steps < 0) steps = 0;
count = steps + 1;

// First pass: calculate mean value.
sum = 0;
for (i = 0; i < count; i++) {
    if (steps == 0) {
        x = x1;
        y = y1;
    } else {
        x = round(x1 + dx * i / steps);
        y = round(y1 + dy * i / steps);
    }
    value = getPixel(x, y);
    sum = sum + value;
}
mean = sum / count;

// Second pass: output value and deviation from profile mean.
text = "index,x,y,value,value_minus_mean\n";
for (i = 0; i < count; i++) {
    if (steps == 0) {
        x = x1;
        y = y1;
    } else {
        x = round(x1 + dx * i / steps);
        y = round(y1 + dy * i / steps);
    }
    value = getPixel(x, y);
    delta = value - mean;
    text = text + i + "," + x + "," + y + "," + value + "," + d2s(delta, 3) + "\n";
}

File.saveString(text, output);
close();
setBatchMode(false);
exit();
