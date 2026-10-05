// Pure geometry behind the radar plot on the LiDAR card — checked
// with no DOM, no websocket, no canvas. If this is wrong, the plot
// still draws something plausible-looking, just in the wrong place
// or with phantom walls at the sentinel range. Same failure mode as
// estop_capture.py: a confidently wrong number with nothing to catch it.
import fs from 'fs';

// The page's logic is split across js/*.js, loaded by dashboard.html in order.
// Read them the same way so this keeps working if a function moves files.
const html = fs.readFileSync('dashboard.html', 'utf8');
const src = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)]
  .map(m => fs.readFileSync(m[1], 'utf8'))
  .join('\n');

const geoStart = src.indexOf('function isValidRange');
const geo = src.slice(
  geoStart,
  src.indexOf('/* ==========', geoStart));

const env = new Function(`${geo}\nreturn { isValidRange, polarToCanvas, sectorMin, rangeTrend };`)();

const fail = [];
const RMIN = 0.02, RMAX = 30.0;

// Measured on the robot 2026-09-23: no-return beams read ~65.5 m,
// ABOVE range_max — not inf, not NaN, not clipped to range_max.
env.isValidRange(65.533, RMIN, RMAX) === false ||
  fail.push('sentinel return (65.533m, > range_max) accepted as valid');
env.isValidRange(RMAX, RMIN, RMAX) === false ||
  fail.push('exactly range_max accepted as valid');
env.isValidRange(RMIN, RMIN, RMAX) === false ||
  fail.push('exactly range_min accepted as valid');
env.isValidRange(5.0, RMIN, RMAX) === true ||
  fail.push('an ordinary in-range return rejected');
env.isValidRange(NaN, RMIN, RMAX) === false ||
  fail.push('NaN accepted as valid');
env.isValidRange(Infinity, RMIN, RMAX) === false ||
  fail.push('Infinity accepted as valid');

// Chase-cam convention: forward is up, left is screen-left.
const fwd = env.polarToCanvas(0, 5, 10, 100, 100);
(Math.abs(fwd.x - 100) < 1e-9 && Math.abs(fwd.y - 50) < 1e-9) ||
  fail.push('angle 0 (forward) did not plot straight up: ' + JSON.stringify(fwd));

const left = env.polarToCanvas(Math.PI / 2, 5, 10, 100, 100);
(Math.abs(left.x - 50) < 1e-9 && Math.abs(left.y - 100) < 1e-9) ||
  fail.push('angle +90 (left, REP-103) did not plot screen-left: ' + JSON.stringify(left));

const right = env.polarToCanvas(-Math.PI / 2, 5, 10, 100, 100);
(Math.abs(right.x - 150) < 1e-9 && Math.abs(right.y - 100) < 1e-9) ||
  fail.push('angle -90 (right) did not plot screen-right: ' + JSON.stringify(right));

// Sector minimum: only beams inside the bearing window count, and
// sentinel no-returns are never "the closest thing".
{
  // 5 beams at -90, -45, 0, +45, +90 degrees
  const inc = Math.PI / 4, amin = -Math.PI / 2;
  const ranges = [0.5, 3.0, 65.533, 1.2, 2.0];
  const front = env.sectorMin(ranges, amin, inc, RMIN, RMAX, -0.1, 0.1);
  front === null ||
    fail.push('sector holding only a sentinel beam should be null: ' + JSON.stringify(front));
  const leftHalf = env.sectorMin(ranges, amin, inc, RMIN, RMAX, 0.1, Math.PI);
  (leftHalf && leftHalf.range === 1.2 && leftHalf.index === 3) ||
    fail.push('left half should find 1.2 m at index 3: ' + JSON.stringify(leftHalf));
  const all = env.sectorMin(ranges, amin, inc, RMIN, RMAX, -Math.PI, Math.PI);
  (all && all.range === 0.5 && all.index === 0) ||
    fail.push('whole scan should find 0.5 m at index 0 (right): ' + JSON.stringify(all));
}

// Trend arrow has a dead band, so noise does not flicker it.
env.rangeTrend(1.00, 1.05) === 'steady' || fail.push('5 cm change should read steady');
env.rangeTrend(0.80, 1.00) === 'closer' || fail.push('20 cm closer should read closer');
env.rangeTrend(1.30, 1.00) === 'farther' || fail.push('30 cm farther should read farther');
env.rangeTrend(1.00, NaN) === 'steady' || fail.push('missing history should read steady');

if (fail.length) {
  console.error('FAIL:\n  ' + fail.join('\n  '));
  process.exit(1);
}
console.log('OK: radar geometry checks passed');
