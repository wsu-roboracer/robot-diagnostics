"use strict";

/* Virtual controller: drive the car from the browser. */

/* ==========================================================
   VIRTUAL CONTROLLER

   Publishes ackermann_msgs/AckermannDriveStamped on /drive, the
   ackermann_mux NAVIGATION input, over the same rosbridge socket
   the rest of the page uses. Three properties keep it safe:

   1. Dead-man. Commands go out only while the pad or a drive key
      is physically held. Let go and the page sends a short burst
      of zero-speed commands, then goes silent. That burst is what
      stops the car: ackermann_mux forwards message by message and
      sends no zero of its own when an input goes quiet (see
      tools/estop_capture.py). If the link dies mid-drive, no zero
      arrives and the motor holds the last command until the VESC's
      own command timeout (~1 s, unconfirmed).
   2. Priority. The physical joystick is the mux's higher-priority
      input, so holding its deadman always overrides this page.
   3. Disarm on anything unexpected: STOP / Space / Esc, leaving
      the tab, the window losing focus, the page going to the
      background, the socket closing or being replaced.

   rosbridge has no authentication (see README) — anyone who can
   reach port 9090 can already publish /drive. This page does not
   change that; it just makes the button visible.
========================================================== */

const DRIVE_TOPIC = "/drive";
const DRIVE_TYPE = "ackermann_msgs/msg/AckermannDriveStamped";

const DRIVE_HZ = 20;

/* Speed ramps rather than jumps, so a key press or a flick of
   the pad does not ask the VESC for a step change. Releasing is
   NOT ramped — stop is always immediate. */
const DRIVE_ACCEL = 2.0;        // m/s per second
const STEER_RATE = 2.5;         // rad per second

/* zero-speed commands sent after release, so the last thing the
   mux saw is "stop" rather than whatever was held */
const STOP_BURST = 5;

let driveArmed = false;
let driveSocket = null;
let padHeld = false;
let padVec = { x: 0, y: 0 };
let cmdSpeed = 0;
let cmdSteer = 0;
let stopBurst = 0;
let lastDriveTick = performance.now();

const driveKeys = new Set();
/* fixed 4 m: while driving, what matters is what is close */
const driveRadarScale = { ...newRadarScale(), mode: "fixed", range: 4 };

const KEY_FWD = new Set(["w", "arrowup"]);
const KEY_BACK = new Set(["s", "arrowdown"]);
const KEY_LEFT = new Set(["a", "arrowleft"]);
const KEY_RIGHT = new Set(["d", "arrowright"]);

function socketOpen() {
  return Boolean(ws && ws.readyState === WebSocket.OPEN);
}

function driveTabVisible() {
  return !$("panelDrive").hidden;
}

function limitSpeed() {
  return parseFloat($("maxSpeed").value);
}

function limitSteer() {
  return parseFloat($("maxSteer").value);
}

function publishDrive(speed, steer) {

  const now = Date.now();

  send({
    op: "publish",
    topic: DRIVE_TOPIC,
    msg: {
      header: {
        stamp: {
          sec: Math.floor(now / 1000),
          nanosec: (now % 1000) * 1e6
        },
        frame_id: "base_link"
      },
      drive: {
        steering_angle: steer,
        steering_angle_velocity: 0,
        speed,
        acceleration: 0,
        jerk: 0
      }
    }
  });
}

/* ---------- arm / disarm ---------- */

function armDrive() {

  if (!socketOpen()) {
    setDriveNote("Connect to rosbridge first.");
    return;
  }

  if (!$("driveConfirm").checked) return;

  send({
    op: "advertise",
    topic: DRIVE_TOPIC,
    type: DRIVE_TYPE
  });

  driveArmed = true;
  driveSocket = ws;

  setDriveNote("Armed. Hold the pad or a drive key to move.");
  renderDriveControls();
}

function disarmDrive(reason) {

  const wasLive =
    driveArmed || cmdSpeed !== 0 || cmdSteer !== 0;

  /* stop NOW, don't wait for the next tick */
  if (wasLive && socketOpen()) {
    for (let i = 0; i < 3; i++) publishDrive(0, 0);
  }

  if (driveArmed && socketOpen()) {
    send({ op: "unadvertise", topic: DRIVE_TOPIC });
  }

  driveArmed = false;
  driveSocket = null;
  padHeld = false;
  padVec = { x: 0, y: 0 };
  driveKeys.clear();
  cmdSpeed = 0;
  cmdSteer = 0;
  stopBurst = 0;

  placeKnob(0, 0);

  if (wasLive && reason) {
    setDriveNote("Disarmed — " + reason + ".");
  }

  renderDriveControls();
}

function setDriveNote(text) {
  $("driveNote").textContent = text;
}

/* ---------- the 20 Hz loop ---------- */

function towards(current, target, maxStep) {

  if (Math.abs(target - current) <= maxStep) return target;

  return current + Math.sign(target - current) * maxStep;
}

function keyAxis(positive, negative) {

  const has = set => [...driveKeys].some(key => set.has(key));

  return (has(positive) ? 1 : 0) - (has(negative) ? 1 : 0);
}

function driveTick() {

  const now = performance.now();
  const dt = Math.min(0.2, (now - lastDriveTick) / 1000);

  lastDriveTick = now;

  if (driveArmed && (!socketOpen() || ws !== driveSocket)) {
    disarmDrive("connection lost or replaced");
  }

  let targetSpeed = 0;
  let targetSteer = 0;

  if (padHeld) {

    /* screen y grows downward; forward is up. Left of centre is
       a positive (left) steering angle, per REP-103. */
    targetSpeed = -padVec.y * limitSpeed();
    targetSteer = -padVec.x * limitSteer();

  } else if (driveKeys.size) {

    targetSpeed = keyAxis(KEY_FWD, KEY_BACK) * limitSpeed();
    targetSteer = keyAxis(KEY_LEFT, KEY_RIGHT) * limitSteer();
  }

  const active =
    driveArmed && (padHeld || driveKeys.size > 0);

  if (active) {

    cmdSpeed = towards(cmdSpeed, targetSpeed, DRIVE_ACCEL * dt);
    cmdSteer = towards(cmdSteer, targetSteer, STEER_RATE * dt);

    publishDrive(cmdSpeed, cmdSteer);

    stopBurst = STOP_BURST;

  } else {

    cmdSpeed = 0;
    cmdSteer = 0;

    if (stopBurst > 0 && socketOpen()) {
      publishDrive(0, 0);
      stopBurst--;
    }
  }

  renderDriveReadout(active);
}

/* ---------- rendering ---------- */

function renderDriveControls() {

  const ready =
    $("driveConfirm").checked && socketOpen();

  $("armBtn").disabled = !driveArmed && !ready;
  $("armBtn").textContent = driveArmed ? "Disarm" : "Arm";
  $("armBtn").classList.toggle("armed", driveArmed);

  $("drivePad").classList.toggle("ready", driveArmed);
  $("driveBadge").hidden = !driveArmed;

  if (!driveArmed && !socketOpen()) {
    setDriveNote("Not connected — connect to rosbridge in the top bar.");
  }
}

function renderDriveReadout(active) {

  const state = $("driveState");

  state.textContent =
    active ? "DRIVING" : driveArmed ? "ARMED" : "DISARMED";

  state.className =
    "drive-state" +
    (active ? " driving" : driveArmed ? " armed" : "");

  $("drivePad").classList.toggle("held", padHeld && driveArmed);

  $("cmdSpeed").textContent = cmdSpeed.toFixed(2) + " m/s";
  $("cmdSteer").textContent =
    Math.round(cmdSteer * 180 / Math.PI) + "°" +
    (cmdSteer > 0.01 ? " left" : cmdSteer < -0.01 ? " right" : "");

  /* left is positive, and left is drawn on the left */
  const full = parseFloat($("maxSteer").max);

  $("steerMark").style.left =
    (50 - (cmdSteer / full) * 50) + "%";
}

/* ---------- vitals: what to watch while driving ---------- */

/* Obstacle distance uses the LiDAR card's bands (LIDAR_NEAR /
   LIDAR_CLOSE in metrics.js), so a colour means the same distance
   on the plot and here. */
const BAND_TONE = { near: "bad", close: "warn", far: "ok" };

const GRADE_TONE = { ok: "ok", warn: "warn", bad: "bad" };

function driveVitals() {

  const now = performance.now();
  const rows = [];

  /* battery */

  if (vesc) {

    const pct = batteryEstimate(vesc.voltage);

    rows.push({
      label: "Battery",
      value: vesc.voltage.toFixed(1) + " V",
      note: pct === null ? "" : "~" + Math.round(pct) + "%",
      tone:
        vesc.voltage < BATT_ERR ? "bad"
        : vesc.voltage < BATT_WARN ? "warn"
        : "ok"
    });

  } else {

    rows.push({
      label: "Battery",
      value: "—",
      note: "no /sensors/core",
      tone: ""
    });
  }

  /* link — a frozen page looks exactly like a healthy one */

  const open = socketOpen();
  const quiet = lastAnything ? (now - lastAnything) / 1000 : null;

  rows.push({
    label: "Link",
    value: !open ? "offline" : quiet === null ? "waiting" : quiet.toFixed(1) + " s",
    note: open ? "since last message" : "not connected",
    tone: !open ? "bad" : quiet === null || quiet > 1 ? "warn" : "ok"
  });

  /* nearest obstacle */

  const scanFresh =
    scanStats && now - scanStats.at < 2000;

  rows.push({
    label: "Nearest obstacle",
    value:
      scanFresh && scanStats.min !== null
        ? scanStats.min.toFixed(2) + " m"
        : "—",
    note: scanFresh ? "LiDAR, any direction" : "no LiDAR scan",
    tone:
      !scanFresh || scanStats.min === null
        ? "warn"
        : BAND_TONE[bandOf(scanStats.min)]
  });

  /* who is driving */

  rows.push({
    label: "Driving input",
    value:
      mux === "teleop" ? "Physical controller"
      : mux === "autonomous" ? "This page (/drive)"
      : mux === "idle" ? "Idle"
      : "—",
    note:
      mux === "teleop" ? "has priority over this page"
      : mux === "autonomous" ? "car is taking these commands"
      : mux === "idle" ? "nothing is driving"
      : "no ackermann_mux diagnostics",
    tone: mux === "teleop" ? "warn" : mux ? "ok" : ""
  });

  /* the compute metrics the Overview already grades */

  const tiles = {};

  metricTiles().forEach(tile => {
    tiles[tile.id] = tile;
  });

  [["speed", "Speed"], ["temp", "Temperature"], ["cpu", "CPU"]]
    .forEach(([id, label]) => {

      const tile = tiles[id];

      if (!tile) return;

      rows.push({
        label,
        value: String(tile.value),
        note: tile.note || "",
        tone: GRADE_TONE[tile.grade] || ""
      });
    });

  return rows;
}

/* Slower bits, from the main 2 Hz render loop. */
function renderDrive() {

  renderDriveControls();

  const fresh =
    robotSpeedMps !== null &&
    performance.now() - robotSpeedAt < 2000;

  $("measSpeed").textContent =
    fresh ? robotSpeedMps.toFixed(2) + " m/s" : "—";

  $("hudBattery").textContent =
    "🔋 " + (vesc ? vesc.voltage.toFixed(1) + " V" : "--.- V");

  const rows = driveVitals();

  $("vitals").innerHTML =
    rows.map(row => `
      <li class="vital ${row.tone}">
        <span class="dot ${row.tone}"></span>
        <span class="vital-label">${escapeHtml(row.label)}</span>
        <span class="vital-value">${escapeHtml(row.value)}</span>
        <span class="vital-note">${escapeHtml(row.note)}</span>
      </li>
    `).join("");

  const bad = rows.filter(row => row.tone === "bad").length;
  const warn = rows.filter(row => row.tone === "warn").length;

  $("vitalsSummary").textContent =
    bad ? `${bad} problem${bad === 1 ? "" : "s"}`
    : warn ? `${warn} to watch`
    : "all good";

  $("vitalsSummary").style.color =
    bad ? "var(--bad-ink)" : warn ? "var(--warn-ink)" : "var(--ok-ink)";

  if (driveTabVisible()) {
    redrawDriveRadar();
  }
}

/* ---------- pad input ---------- */

function placeKnob(x, y) {

  /* knob is 26% wide, so its centre travels 37% either way */
  $("padKnob").style.left = (50 + x * 37) + "%";
  $("padKnob").style.top = (50 + y * 37) + "%";
}

function padVector(event) {

  const rect = $("drivePad").getBoundingClientRect();

  let x = (event.clientX - rect.left) / rect.width * 2 - 1;
  let y = (event.clientY - rect.top) / rect.height * 2 - 1;

  /* scale to the knob's travel, then clamp to the unit circle */
  x /= 0.74;
  y /= 0.74;

  const length = Math.hypot(x, y);

  if (length > 1) {
    x /= length;
    y /= length;
  }

  return { x, y };
}

$("drivePad").addEventListener("pointerdown", event => {

  if (!driveArmed) {
    setDriveNote("Tick the safety box and press Arm first.");
    return;
  }

  /* capture keeps the drag alive outside the circle; if the
     browser refuses, the pad still works inside it */
  try {
    $("drivePad").setPointerCapture(event.pointerId);
  } catch (error) {}

  padHeld = true;
  padVec = padVector(event);

  placeKnob(padVec.x, padVec.y);
});

$("drivePad").addEventListener("pointermove", event => {

  if (!padHeld) return;

  padVec = padVector(event);

  placeKnob(padVec.x, padVec.y);
});

["pointerup", "pointercancel", "lostpointercapture"].forEach(type =>
  $("drivePad").addEventListener(type, () => {

    padHeld = false;
    padVec = { x: 0, y: 0 };

    placeKnob(0, 0);
  })
);

/* ---------- keyboard input ---------- */

const DRIVE_KEYS =
  new Set([...KEY_FWD, ...KEY_BACK, ...KEY_LEFT, ...KEY_RIGHT]);

window.addEventListener("keydown", event => {

  if (!driveTabVisible()) return;

  const key = event.key.toLowerCase();

  if (key === " " || key === "escape") {

    if (driveArmed) {
      event.preventDefault();
      disarmDrive("stop pressed");
    }

    return;
  }

  /* typing in a box is not driving */
  if (
    event.target instanceof Element &&
    event.target.closest("input, textarea, select")
  ) return;

  if (driveArmed && DRIVE_KEYS.has(key)) {
    event.preventDefault();
    driveKeys.add(key);
  }
});

window.addEventListener("keyup", event => {
  driveKeys.delete(event.key.toLowerCase());
});

/* ---------- everything that must stop the car ---------- */

window.addEventListener("blur", () => {
  if (driveArmed) disarmDrive("window lost focus");
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && driveArmed) disarmDrive("page hidden");
});

window.addEventListener("pagehide", () => {
  if (driveArmed) disarmDrive("page closed");
});

$("stopBtn").onclick = () => disarmDrive("stop pressed");

$("driveCamConnect").onclick =
  () => connectCamera($("cameraUrl").value.trim());

$("armBtn").onclick = () => {

  if (driveArmed) {
    disarmDrive("disarmed");
  } else {
    armDrive();
  }
};

$("driveConfirm").addEventListener("change", () => {

  if (!$("driveConfirm").checked && driveArmed) {
    disarmDrive("safety box unticked");
  }

  renderDriveControls();
});

/* ---------- limits ---------- */

function renderLimits() {

  $("maxSpeedValue").textContent =
    limitSpeed().toFixed(1) + " m/s";

  $("maxSteerValue").textContent =
    Math.round(limitSteer() * 180 / Math.PI) + "°";
}

$("maxSpeed").addEventListener("input", renderLimits);
$("maxSteer").addEventListener("input", renderLimits);

/* ---------- LiDAR: zoom and big view ---------- */

function renderDriveZoom() {
  $("driveZoomLabel").textContent = radarRangeLabel(driveRadarScale);
  $("driveZoomAuto").setAttribute("aria-pressed", String(driveRadarScale.mode === "auto"));
}

function redrawDriveRadar() {
  drawScanCanvas($("driveRadar"), driveRadarScale, null, null);
  renderDriveZoom();
}

$("driveZoomIn").onclick = () => { zoomRadar(driveRadarScale, -1); redrawDriveRadar(); };
$("driveZoomOut").onclick = () => { zoomRadar(driveRadarScale, 1); redrawDriveRadar(); };
$("driveZoomAuto").onclick = () => { driveRadarScale.mode = "auto"; redrawDriveRadar(); };

attachRadarZoom($("driveRadar"), driveRadarScale, redrawDriveRadar);

/* Big view swaps the LiDAR into the camera's large slot and shrinks
   the camera; the controls never move. Kept per browser. */
function setLidarBig(big) {

  $("driveGrid").dataset.lidar = big ? "big" : "normal";

  $("lidarBigBtn").textContent = big ? "⤡ Shrink" : "⤢ Enlarge";
  $("lidarBigBtn").setAttribute("aria-pressed", String(big));

  try {
    localStorage.setItem("driveLidar", big ? "big" : "normal");
  } catch (error) {}

  /* the canvas changed size; redraw now rather than at the next tick */
  requestAnimationFrame(redrawDriveRadar);
}

$("lidarBigBtn").onclick =
  () => setLidarBig($("driveGrid").dataset.lidar !== "big");

let savedLidar = "normal";

try {
  savedLidar = localStorage.getItem("driveLidar") || "normal";
} catch (error) {}

setLidarBig(savedLidar === "big");

/* ---------- camera size ---------- */

/* Small by default so the controls and vitals get the room; the
   choice is kept per browser. */
function setCamSize(size) {

  $("driveGrid").dataset.cam = size;

  document.querySelectorAll("[data-cam-size]").forEach(button =>
    button.setAttribute("aria-pressed", String(button.dataset.camSize === size))
  );

  try {
    localStorage.setItem("driveCam", size);
  } catch (error) {}
}

document.querySelectorAll("[data-cam-size]").forEach(button => {
  button.onclick = () => setCamSize(button.dataset.camSize);
});

let savedCamSize = "small";

try {
  savedCamSize = localStorage.getItem("driveCam") || "small";
} catch (error) {}

setCamSize(savedCamSize === "large" ? "large" : "small");

renderLimits();
placeKnob(0, 0);

setInterval(driveTick, 1000 / DRIVE_HZ);
