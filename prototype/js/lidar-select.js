"use strict";

/* ==========================================================
   LIDAR INDEX SELECTOR

   Sprint 3: test-specific presets and a way to pick exactly
   which /scan indices a student's own test code should read,
   folded into the existing LiDAR card behind a "show test
   controls" toggle rather than a separate page — the plain
   Points/Nearest/Farthest/FOV view stays the default.
========================================================== */

let lidarAdvanced = false;

function renderLidarAdvancedToggle() {

  $("lidarAdvanced").hidden = !lidarAdvanced;

  $("lidarAdvancedToggle").textContent =
    lidarAdvanced ? "hide test controls" : "show test controls";
}

/* ---- selection geometry ----
   Pure, so verify_testing.mjs checks it with no DOM/websocket —
   same reasoning as the radar geometry in connection.js. */

// Inverse of polarToCanvas's angle term: a cursor offset from the
// origin maps back to a beam angle regardless of distance from the
// origin, since atan2(sin, cos) is scale-invariant.
function canvasOffsetToAngle(dx, dy) {
  return Math.atan2(-dx, -dy);
}

function angleToIndex(angle, angleMin, angleInc, len) {
  const idx = Math.round((angle - angleMin) / angleInc);
  return Math.max(0, Math.min(len - 1, idx));
}

function presetIndexRange(centerRad, halfWidthRad, angleMin, angleInc, len) {
  const lo = angleToIndex(centerRad - halfWidthRad, angleMin, angleInc, len);
  const hi = angleToIndex(centerRad + halfWidthRad, angleMin, angleInc, len);
  return [Math.min(lo, hi), Math.max(lo, hi)];
}

function selectionStats(ranges, rangeMin, rangeMax, loIdx, hiIdx) {
  let count = 0, min = Infinity, max = -Infinity, sum = 0;
  for (let i = loIdx; i <= hiIdx && i < ranges.length; i++) {
    const v = ranges[i];
    if (!isValidRange(v, rangeMin, rangeMax)) continue;
    count++;
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return {
    count,
    min: count ? min : null,
    max: count ? max : null,
    avg: count ? sum / count : null
  };
}

/* ---- selection state + UI ----
   Drawn onto the same #radarCanvas as the always-on status view
   (renderRadar() in metrics.js passes selLo/selHi through to
   drawScanCanvas) — one canvas, one scale, the highlight just
   layers on top when a selection exists. */

const PRESET_HALF_WIDTH_DEG = 7; // narrow cone; widen in your own code
                                  // if a test needs more beams averaged

let selLo = null;
let selHi = null;
let selDragging = false;
let selDragAnchor = null;

function setSelection(lo, hi) {

  if (!lastScan) return;

  const len = (lastScan.ranges || []).length;
  if (!len) return;

  selLo = Math.max(0, Math.min(len - 1, Math.min(lo, hi)));
  selHi = Math.max(0, Math.min(len - 1, Math.max(lo, hi)));

  $("rangeStart").value = selLo;
  $("rangeEnd").value = selHi;
}

function clearSelection() {
  selLo = null;
  selHi = null;
  $("rangeStart").value = "";
  $("rangeEnd").value = "";
}

function indexFromCanvasEvent(event) {

  if (!lastScan) return null;

  const canvas = $("radarCanvas");
  const rect = canvas.getBoundingClientRect();

  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;

  const originX = canvas.width / 2;
  const originY = canvas.height / 2;

  const angle = canvasOffsetToAngle(x - originX, y - originY);

  const angleMin = Number(lastScan.angle_min);
  const angleInc = Number(lastScan.angle_increment);
  const len = (lastScan.ranges || []).length;

  return angleToIndex(angle, angleMin, angleInc, len);
}

function presetCentered(centerDeg) {

  if (!lastScan) return;

  const angleMin = Number(lastScan.angle_min);
  const angleInc = Number(lastScan.angle_increment);
  const len = (lastScan.ranges || []).length;
  if (!len) return;

  const [lo, hi] = presetIndexRange(
    centerDeg * Math.PI / 180,
    PRESET_HALF_WIDTH_DEG * Math.PI / 180,
    angleMin, angleInc, len);

  setSelection(lo, hi);
}

function renderSelectionReadout() {

  if (!lastScan || selLo === null || selHi === null) {

    $("selIdxRange").textContent = "—";
    $("selAngleRange").textContent = "—";
    $("selCount").textContent = "—";
    $("selMin").textContent = "—";
    $("selMax").textContent = "—";
    $("selAvg").textContent = "—";
    return;
  }

  const angleMin = Number(lastScan.angle_min);
  const angleInc = Number(lastScan.angle_increment);
  const rangeMin = Number(lastScan.range_min);
  const rangeMax = Number(lastScan.range_max);
  const ranges = lastScan.ranges || [];

  const startDeg = (angleMin + selLo * angleInc) * 180 / Math.PI;
  const endDeg = (angleMin + selHi * angleInc) * 180 / Math.PI;

  $("selIdxRange").textContent = `${selLo} – ${selHi}`;
  $("selAngleRange").textContent =
    `${startDeg.toFixed(1)}° – ${endDeg.toFixed(1)}°`;

  const stats = selectionStats(ranges, rangeMin, rangeMax, selLo, selHi);

  $("selCount").textContent = `${stats.count} of ${selHi - selLo + 1}`;
  $("selMin").textContent = stats.min === null ? "no return" : stats.min.toFixed(2) + " m";
  $("selMax").textContent = stats.max === null ? "no return" : stats.max.toFixed(2) + " m";
  $("selAvg").textContent = stats.avg === null ? "no return" : stats.avg.toFixed(2) + " m";
}
