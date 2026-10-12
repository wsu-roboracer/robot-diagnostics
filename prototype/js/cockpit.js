"use strict";

/* Full screen: camera, LiDAR and controls as panes, any mix of them,
   side by side. Drag a divider to resize, drag a pane's title onto
   another to swap them; ready-made layouts each keep your own sizes.
   On phones one picture shows at a time and the controls are thumb
   sticks, held sideways like a game.

   The controls are only another way to hold the Drive tab's
   controller: they write the same padHeld / padVec that the Drive
   tab's pad does, so arming, the dead-man, ramping, limits and every
   disarm rule stay in drive.js and cannot drift apart. Hiding the
   controls or leaving full screen always disarms. */

/* the game layout: anything touch-first, or too narrow for a side panel */
const COCKPIT_TOUCH_QUERY = "(pointer: coarse), (max-width: 900px)";
const COCKPIT_PORTRAIT_QUERY =
  "(orientation: portrait) and (pointer: coarse), (orientation: portrait) and (max-width: 900px)";

/* wider than the sector readouts, so a glow starts before the
   thing is dead ahead or square to the side */
const COCKPIT_GLOW_SECTORS = {
  Front: [-35, 35],
  Left: [35, 135],
  Right: [-135, -35]
};

const paneRadarScale = newRadarScale();

let cockpitOpen = false;
let cockpitFullscreen = false;   // we put the page into fullscreen
let cockpitNearBefore = false;   // for the one-shot buzz on phones
let cockpitNoteText = "";
let cockpitNoteAt = 0;
let cockpitFrame = 0;
let cockpitLastDriveNote = "";
let cockpitArranging = false;

/* each input remembers the finger (pointer) holding it, so two thumbs
   can steer and throttle at once */
const cockpitSteer = { pointer: null, value: 0 };
const cockpitThrottle = { pointer: null, value: 0 };
const cockpitPad = { pointer: null, x: 0, y: 0 };

function cockpitTouchLayout() {
  return window.matchMedia(COCKPIT_TOUCH_QUERY).matches;
}

function cockpitUpright() {
  return window.matchMedia(COCKPIT_PORTRAIT_QUERY).matches;
}

/* ---------- panes ----------

   A layout is which panes show, their order, and their widths (flex
   weights). Each ready-made layout keeps the user's own changes, per
   browser; Reset puts it back. */

const PANES = ["camera", "lidar", "controls"];

const LAYOUTS = {
  camera:     { order: ["camera", "lidar", "controls"], on: ["camera"],
                w: { camera: 100, lidar: 40, controls: 25 } },
  watch:      { order: ["camera", "lidar", "controls"], on: ["camera", "lidar"],
                w: { camera: 60, lidar: 40, controls: 25 } },
  drive:      { order: ["camera", "lidar", "controls"], on: ["camera", "controls"],
                w: { camera: 75, lidar: 30, controls: 25 } },
  drivelidar: { order: ["camera", "lidar", "controls"], on: ["camera", "lidar", "controls"],
                w: { camera: 50, lidar: 30, controls: 20 } },
  lidar:      { order: ["lidar", "camera", "controls"], on: ["lidar"],
                w: { camera: 60, lidar: 100, controls: 25 } }
};

const LAYOUT_KEY = "cockpitLayouts";

let layoutName = "drive";
let layout = null;               // the working copy of LAYOUTS[layoutName]

function loadLayouts() {
  try {
    return JSON.parse(localStorage.getItem(LAYOUT_KEY) || "{}");
  } catch (error) {
    return {};
  }
}

function saveLayout() {
  try {
    const all = loadLayouts();
    all[layoutName] = layout;
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(all));
  } catch (error) {}
}

function useLayout(name, fresh = false) {

  layoutName = LAYOUTS[name] ? name : "drive";

  const saved = fresh ? null : loadLayouts()[layoutName];
  const base = LAYOUTS[layoutName];

  /* a saved copy from an older page could miss a pane; fill it in */
  layout = {
    order: saved && saved.order && PANES.every(id => saved.order.includes(id))
      ? saved.order : [...base.order],
    on: saved && Array.isArray(saved.on) && saved.on.length ? saved.on : [...base.on],
    w: { ...base.w, ...(saved && saved.w) }
  };

  if (fresh) saveLayout();
}

function cockpitPaneShown(id) {
  return cockpitOpen && layout.on.includes(id) &&
    !(cockpitTouchLayout() && id !== "controls" && touchPicture() !== id);
}

/* phones: one picture at a time, the first shown one in the order */
function touchPicture() {
  return layout.order.find(id => id !== "controls" && layout.on.includes(id)) || "camera";
}

function setPane(id, on) {

  let shown = layout.on.filter(pane => pane !== id);

  if (on) {

    /* phones: Camera and LiDAR take turns; the picked one goes first */
    if (cockpitTouchLayout() && id !== "controls") {
      shown = shown.filter(pane => pane === "controls");
      layout.order = [id, ...layout.order.filter(pane => pane !== id)];
    }

    shown.push(id);

  } else if (!shown.some(pane => pane !== "controls")) {
    return;                    // always a picture to look at
  }

  layout.on = shown;
  saveLayout();
  applyPanes();
}

/* The page has one camera stream (one <img>); it is borrowed while a
   pane shows it, and handed back to whichever tab is showing - the
   same rule showTab uses. */
function returnCamera() {
  $(driveTabVisible() ? "driveCamSlot" : "cameraHome")
    .appendChild($("cameraBox"));
}

function applyPanes() {

  if (!cockpitOpen) return;

  const cockpit = $("cockpit");
  const box = $("cockpitPanes");
  const controls = layout.on.includes("controls");

  /* the controls you were using are about to vanish */
  if (!controls) {
    releaseCockpitInputs();
    if (driveArmed) disarmDrive("controls hidden");
    if (cockpitArranging) setArranging(false);
  }

  /* the controls are the Drive tab's: show that tab underneath, so its
     rules (keys, limits, leaving the tab disarms) all hold */
  if (controls && !driveTabVisible()) showTab("drive");

  cockpit.classList.toggle("has-controls", controls);
  cockpit.dataset.picture = touchPicture();

  /* side by side in the saved order, a divider between neighbours */
  box.querySelectorAll(".pane-divider").forEach(divider => divider.remove());

  let previous = null;

  layout.order.forEach(id => {

    const pane = box.querySelector(`[data-pane="${id}"]`);
    const on = layout.on.includes(id);

    pane.hidden = !on;
    pane.style.flexGrow = layout.w[id];
    box.appendChild(pane);

    if (!on) return;

    if (previous) {
      const divider = document.createElement("div");
      divider.className = "pane-divider";
      divider.title = "Drag to resize";
      box.insertBefore(divider, pane);
      attachDivider(divider, previous, pane);
    }

    previous = pane;
  });

  if (cockpitPaneShown("camera")) {
    $("cockpitCam").appendChild($("cameraBox"));
  } else {
    returnCamera();
  }

  document.querySelectorAll("[data-pane-toggle]").forEach(button =>
    button.setAttribute("aria-pressed", String(cockpitPaneShown(button.dataset.paneToggle))));

  $("cockpitLayout").value = layoutName;

  /* the beam select panel follows the LiDAR in and out */
  renderBeamSelect();

  lockLandscape();
  requestAnimationFrame(() => {
    redrawPaneRadar();
    applyCockpitLayout();
  });
}

/* Drag a divider: the two panes beside it share their room. */
function attachDivider(divider, left, right) {

  divider.addEventListener("pointerdown", event => {

    event.preventDefault();

    const a = left.getBoundingClientRect();
    const b = right.getBoundingClientRect();
    const idA = left.dataset.pane;
    const idB = right.dataset.pane;
    const weight = layout.w[idA] + layout.w[idB];
    const minA = parseFloat(getComputedStyle(left).minWidth) || 0;
    const minB = parseFloat(getComputedStyle(right).minWidth) || 0;

    divider.setPointerCapture(event.pointerId);
    divider.classList.add("dragging");

    const move = moveEvent => {

      const width = Math.max(minA,
        Math.min(a.width + b.width - minB, moveEvent.clientX - a.left));

      layout.w[idA] = weight * width / (a.width + b.width);
      layout.w[idB] = weight - layout.w[idA];

      left.style.flexGrow = layout.w[idA];
      right.style.flexGrow = layout.w[idB];
      redrawPaneRadar();
    };

    const done = () => {
      divider.classList.remove("dragging");
      divider.removeEventListener("pointermove", move);
      saveLayout();
    };

    divider.addEventListener("pointermove", move);
    divider.addEventListener("pointerup", done, { once: true });
    divider.addEventListener("pointercancel", done, { once: true });
  });
}

/* Drag a pane's title onto another pane: they swap places. */
function attachPaneMove(pane) {

  const head = pane.querySelector(".pane-head");

  head.addEventListener("pointerdown", event => {

    event.preventDefault();
    head.setPointerCapture(event.pointerId);
    pane.classList.add("moving");

    let target = null;

    const move = moveEvent => {

      const under = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
      const hit = under && under.closest(".pane");

      if (target) target.classList.remove("drop-target");
      target = hit && hit !== pane ? hit : null;
      if (target) target.classList.add("drop-target");
    };

    const done = () => {

      head.removeEventListener("pointermove", move);
      pane.classList.remove("moving");

      if (target) {
        target.classList.remove("drop-target");

        const order = layout.order;
        const i = order.indexOf(pane.dataset.pane);
        const j = order.indexOf(target.dataset.pane);

        [order[i], order[j]] = [order[j], order[i]];
        saveLayout();
        applyPanes();
      }
    };

    head.addEventListener("pointermove", move);
    head.addEventListener("pointerup", done, { once: true });
    head.addEventListener("pointercancel", done, { once: true });
  });
}

/* phones, while the controls show: sideways like a game. Only allowed
   in fullscreen, and not at all on some browsers - the rotate prompt
   covers those. */
function lockLandscape() {

  if (!cockpitFullscreen || !cockpitTouchLayout() || !screen.orientation) return;

  if (layout.on.includes("controls")) {
    if (screen.orientation.lock) screen.orientation.lock("landscape").catch(() => {});
  } else if (screen.orientation.unlock) {
    try { screen.orientation.unlock(); } catch (error) {}
  }
}

function redrawPaneRadar() {
  if (cockpitPaneShown("lidar")) {
    drawScanCanvas($("paneRadar"), paneRadarScale, selLo, selHi);
    renderRangeButtons("pane", paneRadarScale);
  }
}

/* ---------- open / close ---------- */

function openCockpit(name) {

  useLayout(name || layoutName);

  if (cockpitOpen) {
    applyPanes();
    return;
  }

  cockpitOpen = true;
  $("cockpit").hidden = false;

  syncCockpitSettings();

  /* phones: the thumbs drive and the settings wait behind a button */
  setCockpitPanel(false);

  const cockpit = $("cockpit");

  if (!document.fullscreenElement && cockpit.requestFullscreen) {
    cockpit.requestFullscreen({ navigationUI: "hide" })
      .then(() => {
        cockpitFullscreen = true;
        lockLandscape();
      })
      .catch(() => {});
  }

  applyPanes();
  renderCockpit();
  renderCockpitFast();
}

function closeCockpit() {

  if (!cockpitOpen) return;

  releaseCockpitInputs();
  setArranging(false);

  /* the controls you were using are about to vanish */
  if (driveArmed) disarmDrive("left drive mode");

  cockpitOpen = false;
  $("cockpit").hidden = true;
  returnCamera();
  renderBeamSelect();

  if (screen.orientation && screen.orientation.unlock) {
    try { screen.orientation.unlock(); } catch (error) {}
  }

  if (cockpitFullscreen && document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }

  cockpitFullscreen = false;
}

function setCockpitPanel(open) {

  $("cockpit").classList.toggle("panel-open", open);
  $("cockpitPanelToggle").setAttribute("aria-expanded", String(open));

  /* the phone drawer has the room: limits shown, not folded */
  if (open && cockpitTouchLayout()) $("cockpitMore").open = true;
}

/* ---------- inputs -> the Drive tab's controller ---------- */

function applyCockpitInput() {

  if (!cockpitOpen) return;

  /* disarmed under a held thumb (STOP, E-STOP, link lost): drop the
     hold, so re-arming never drives off a press made before it */
  if (!driveArmed) {
    releaseCockpitInputs();
    return;
  }

  if (cockpitPad.pointer !== null) {

    padHeld = true;
    padVec = { x: cockpitPad.x, y: cockpitPad.y };
    return;
  }

  const steering = cockpitSteer.pointer !== null;
  const throttle = cockpitThrottle.pointer !== null;

  /* either thumb down counts as holding: steering alone turns the
     wheels at zero speed, exactly like the pad held at its centre */
  padHeld = steering || throttle;
  padVec = {
    x: steering ? cockpitSteer.value : 0,
    y: throttle ? cockpitThrottle.value : 0
  };
}

function releaseCockpitInputs() {

  cockpitSteer.pointer = null;
  cockpitSteer.value = 0;
  cockpitThrottle.pointer = null;
  cockpitThrottle.value = 0;
  cockpitPad.pointer = null;
  cockpitPad.x = 0;
  cockpitPad.y = 0;

  padHeld = false;
  padVec = { x: 0, y: 0 };

  placeCockpitKnobs();
}

function cockpitNeedsArm() {

  if (driveArmed) return false;

  setCockpitNote(
    $("driveConfirm").checked
      ? "Press Arm first."
      : "Tick the safety box and press Arm first.");

  if (cockpitTouchLayout()) setCockpitPanel(true);

  return true;
}

/* A one-axis thumb stick: springs back to the middle when let go. */
function attachStick(element, state, axis) {

  const read = event => {

    const rect = element.getBoundingClientRect();

    const along = axis === "x"
      ? (event.clientX - rect.left) / rect.width
      : (event.clientY - rect.top) / rect.height;

    /* the knob travels 40% either way; past that is full deflection */
    return Math.max(-1, Math.min(1, (along * 2 - 1) / 0.8));
  };

  element.addEventListener("pointerdown", event => {

    if (cockpitArranging) return;
    if (state.pointer !== null) return;
    if (cockpitNeedsArm()) return;

    try {
      element.setPointerCapture(event.pointerId);
    } catch (error) {}

    state.pointer = event.pointerId;
    state.value = read(event);

    applyCockpitInput();
  });

  element.addEventListener("pointermove", event => {

    if (event.pointerId !== state.pointer) return;

    state.value = read(event);
    applyCockpitInput();
  });

  ["pointerup", "pointercancel", "lostpointercapture"].forEach(type =>
    element.addEventListener(type, event => {

      if (event.pointerId !== state.pointer) return;

      state.pointer = null;
      state.value = 0;
      applyCockpitInput();
    })
  );
}

/* The desktop panel's round pad: the Drive tab's pad, same feel. */
function attachCockpitPad() {

  const pad = $("cockpitPad");

  const read = event => {

    const rect = pad.getBoundingClientRect();

    let x = ((event.clientX - rect.left) / rect.width * 2 - 1) / 0.74;
    let y = ((event.clientY - rect.top) / rect.height * 2 - 1) / 0.74;

    const length = Math.hypot(x, y);

    if (length > 1) {
      x /= length;
      y /= length;
    }

    cockpitPad.x = x;
    cockpitPad.y = y;
  };

  pad.addEventListener("pointerdown", event => {

    if (cockpitArranging) return;
    if (cockpitNeedsArm()) return;

    try {
      pad.setPointerCapture(event.pointerId);
    } catch (error) {}

    cockpitPad.pointer = event.pointerId;
    read(event);
    applyCockpitInput();
  });

  pad.addEventListener("pointermove", event => {

    if (event.pointerId !== cockpitPad.pointer) return;

    read(event);
    applyCockpitInput();
  });

  ["pointerup", "pointercancel", "lostpointercapture"].forEach(type =>
    pad.addEventListener(type, event => {

      if (event.pointerId !== cockpitPad.pointer) return;

      cockpitPad.pointer = null;
      cockpitPad.x = 0;
      cockpitPad.y = 0;
      applyCockpitInput();
    })
  );
}

function placeCockpitKnobs() {

  $("stickSteerKnob").style.left = (50 + cockpitSteer.value * 40) + "%";
  $("stickThrottleKnob").style.top = (50 + cockpitThrottle.value * 40) + "%";

  $("cockpitKnob").style.left = (50 + cockpitPad.x * 37) + "%";
  $("cockpitKnob").style.top = (50 + cockpitPad.y * 37) + "%";

  $("stickSteer").classList.toggle("held", cockpitSteer.pointer !== null);
  $("stickThrottle").classList.toggle("held", cockpitThrottle.pointer !== null);
  $("cockpitPad").classList.toggle("held", cockpitPad.pointer !== null && driveArmed);
}

/* ---------- settings mirrored from the Drive tab ---------- */

/* The Drive tab's controls stay the source of truth: the sliders and
   the safety box here only forward to them. */
function syncCockpitSettings() {

  [["maxSpeed", "cockpitMaxSpeed"], ["maxSteer", "cockpitMaxSteer"]]
    .forEach(([source, mine]) => {
      $(mine).min = $(source).min;
      $(mine).max = $(source).max;
      $(mine).step = $(source).step;
      $(mine).value = $(source).value;
    });

  $("cockpitMaxSpeedValue").textContent = $("maxSpeedValue").textContent;
  $("cockpitMaxSteerValue").textContent = $("maxSteerValue").textContent;

  /* the folded limits still say what they are */
  $("cockpitMoreSum").textContent =
    $("maxSpeedValue").textContent + " · " + $("maxSteerValue").textContent;

  $("cockpitConfirm").checked = $("driveConfirm").checked;
}

function forwardSlider(mine, source) {

  $(mine).addEventListener("input", () => {

    $(source).value = $(mine).value;
    $(source).dispatchEvent(new Event("input"));

    syncCockpitSettings();
  });
}

forwardSlider("cockpitMaxSpeed", "maxSpeed");
forwardSlider("cockpitMaxSteer", "maxSteer");

/* Edge warning lights on or off, kept per browser. Off hides only
   the glow: the warning line and the map still say what is close. */
function setCockpitGlow(on) {

  $("cockpitGlowToggle").checked = on;
  $("cockpit").classList.toggle("no-glow", !on);

  try {
    localStorage.setItem("cockpitGlow", on ? "on" : "off");
  } catch (error) {}
}

$("cockpitGlowToggle").addEventListener("change", () =>
  setCockpitGlow($("cockpitGlowToggle").checked));

let savedGlow = "on";

try {
  savedGlow = localStorage.getItem("cockpitGlow") || "on";
} catch (error) {}

setCockpitGlow(savedGlow !== "off");

$("cockpitConfirm").addEventListener("change", () => {

  $("driveConfirm").checked = $("cockpitConfirm").checked;
  $("driveConfirm").dispatchEvent(new Event("change"));

  renderCockpitArm();
});

/* ---------- notes ---------- */

function setCockpitNote(text) {
  cockpitNoteText = text;
  cockpitNoteAt = performance.now();
  renderCockpitNote();
}

function renderCockpitNote() {

  /* the Drive tab's own note ("Disarmed - window lost focus") wins
     when it is newer */
  const driveNote = $("driveNote").textContent;

  if (driveNote && driveNote !== cockpitLastDriveNote) {
    cockpitLastDriveNote = driveNote;
    cockpitNoteText = driveNote;
    cockpitNoteAt = performance.now();
  }

  /* "not connected" is already the red alert above */
  const fresh =
    socketOpen() && cockpitNoteText && performance.now() - cockpitNoteAt < 5000;

  $("cockpitNote").hidden = !fresh;
  $("cockpitNote").textContent = fresh ? cockpitNoteText : "";
}

/* ---------- LiDAR: glows and the warning line ---------- */

function cockpitProximity() {

  if (!lastScan || !scanStats || performance.now() - scanStats.at > 2000) {
    return null;
  }

  const g = scanGeometry(lastScan);
  const ranges = lastScan.ranges || [];
  const rad = deg => deg * Math.PI / 180;

  const out = {};

  Object.entries(COCKPIT_GLOW_SECTORS).forEach(([id, [from, to]]) => {
    out[id] = sectorMin(ranges, g.angleMin, g.angleInc, g.rangeMin, g.rangeMax,
                        rad(from), rad(to));
  });

  out.nearest = sectorMin(ranges, g.angleMin, g.angleInc, g.rangeMin, g.rangeMax,
                          -Math.PI, Math.PI);

  return out;
}

function renderCockpitLidar() {

  const near = cockpitProximity();

  Object.keys(COCKPIT_GLOW_SECTORS).forEach(id => {

    const hit = near && near[id];
    const band = hit ? bandOf(hit.range) : "far";

    $("glow" + id).className =
      "cockpit-glow glow-" + id.toLowerCase() +
      (band === "far" ? "" : " glow-" + band);
  });

  /* a short buzz the moment something gets very close, while armed */
  const veryClose =
    Boolean(near && near.nearest && bandOf(near.nearest.range) === "near");

  if (veryClose && !cockpitNearBefore && driveArmed && navigator.vibrate) {
    navigator.vibrate(180);
  }

  cockpitNearBefore = veryClose;
}

/* the same plain-language sentence the Drive tab shows, only when it
   matters: something close, or no LiDAR at all */
function renderCockpitLidarLine() {

  const source = $("driveLidarStatus");
  const tone = (source.className.match(/tone-(\w+)/) || [])[1] || "none";
  const line = $("cockpitLidar");

  line.hidden = tone === "far";
  line.className = "cockpit-lidar tone-" + tone;
  line.innerHTML = source.innerHTML;
}

/* ---------- rendering ---------- */

function renderCockpitArm() {

  const button = $("armBtn");

  ["cockpitArm", "cockpitArmQuick"].forEach(id => {
    $(id).textContent = button.textContent;
    $(id).classList.toggle("armed", driveArmed);
  });

  $("cockpitArm").disabled = button.disabled;

  /* the quick button explains instead of greying out */
  $("cockpitArmQuick").disabled = !driveArmed && !socketOpen();

  $("cockpitPad").classList.toggle("ready", driveArmed);
  $("stickSteer").classList.toggle("ready", driveArmed);
  $("stickThrottle").classList.toggle("ready", driveArmed);

  $("cockpitConfirm").checked = $("driveConfirm").checked;
}

/* Slower bits, from the main 2 Hz render loop. */
function renderCockpit() {

  if (!cockpitOpen) return;

  $("cockpitHealth").textContent = $("overallStatus").textContent;
  $("cockpitHealth").dataset.health = $("statusBanner").dataset.health || "unknown";

  $("cockpitBattery").innerHTML = $("hudBattery").innerHTML;
  $("cockpitSpeedMode").hidden = $("hudSpeedMode").hidden;
  $("cockpitSteerMode").hidden = $("hudSteerMode").hidden;

  $("cockpitMeas").textContent = $("measSpeed").textContent;

  /* the physical controller is the backup stop; say plainly when
     there is none */
  const pad = padLinkState();
  const unreadable = pad && diag["system: Gamepad"].level === 2;

  $("cockpitPadChip").innerHTML = icon("gamepad") + " " + (
    pad === null ? "Controller unknown"
    : unreadable ? "Controller can't be read"
    : pad ? "Controller connected" : "No controller");
  $("cockpitPadChip").dataset.tone = unreadable ? "bad" : pad === false ? "warn" : "";

  renderCockpitSys();

  /* E-STOP mirrors the top bar's (label, busy, active) */
  const estop = $("estopBtn");
  const mine = $("cockpitEstop");

  mine.innerHTML = estop.innerHTML;
  mine.className = estop.className;
  mine.disabled = estop.disabled;

  const alerts = [];

  if (estopActive()) {
    alerts.push("EMERGENCY STOP IS ON - exit drive mode to release it");
  }

  if (!socketOpen()) {
    alerts.push("NOT CONNECTED TO THE ROBOT");
  } else if ($("staleBar").classList.contains("show")) {
    alerts.push("NO DATA FROM THE ROBOT - the picture and numbers may be stale");
  }

  $("cockpitAlert").hidden = !alerts.length;
  $("cockpitAlert").textContent = alerts.join(" · ");

  renderCockpitLidarLine();
  renderCockpitArm();
  syncCockpitSettings();
  redrawPaneRadar();
}

/* CPU, GPU, RAM and temperatures, as the Overview tiles grade them */
function renderCockpitSys() {

  const tiles = {};

  metricTiles().forEach(tile => {
    tiles[tile.id] = tile;
  });

  const usage = [["cpu", "CPU"], ["gpu", "GPU"], ["ram", "RAM"]]
    .filter(([id]) => tiles[id])
    .map(([id, label]) => `
      <div class="viewer-small">
        <span class="hud-k">${label}</span>
        <span class="viewer-small-v" data-tone="${tiles[id].grade}">${escapeHtml(String(tiles[id].value ?? ""))}</span>
      </div>`);

  const temps = (tiles.temp && tiles.temp.rows) || [];

  $("cockpitSys").innerHTML = usage.join("") + (temps.length ? `
      <div class="viewer-small">
        <span class="hud-k">Temperature</span>
        <span class="viewer-temps">${temps.map(row => `
          <span title="${escapeHtml(row.hint || "")}">${escapeHtml(row.label)}
            <b data-tone="${row.grade}">${escapeHtml(row.value)}</b></span>`).join("")}
        </span>
      </div>` : "");
}

/* The live bits, 20 times a second while open. */
function renderCockpitFast() {

  if (!cockpitOpen) return;

  const state = $("driveState");

  $("cockpitState").textContent = state.textContent;
  $("cockpitState").className = state.className;

  $("cockpitCmd").textContent = $("cmdSpeed").textContent;
  $("cockpitSteer").textContent = $("cmdSteer").textContent;
  $("cockpitSteerMark").style.left = $("steerMark").style.left;

  if (!driveArmed && (cockpitSteer.pointer !== null ||
      cockpitThrottle.pointer !== null || cockpitPad.pointer !== null)) {
    releaseCockpitInputs();
  }

  placeCockpitKnobs();
  renderCockpitArm();
  renderCockpitNote();

  /* the glows at 10 Hz */
  if (cockpitFrame++ % 2 === 0) {
    renderCockpitLidar();
  }
}

/* ---------- arranging (phones): move the sticks and STOP ----------

   Positions are kept per browser, separately for the desktop and the
   touch layout, as fractions of the screen so they survive a resize
   or a rotation. While arranging, nothing drives: the car is
   disarmed and the sticks and pad ignore presses, so moving a stick
   can never move the car. */

const COCKPIT_LAYOUT_KEY = "cockpitLayout";

function cockpitLayoutName() {
  return cockpitTouchLayout() ? "touch" : "desk";
}

function loadCockpitLayout() {

  try {
    const all = JSON.parse(localStorage.getItem(COCKPIT_LAYOUT_KEY) || "{}");
    return all[cockpitLayoutName()] || {};
  } catch (error) {
    return {};
  }
}

function saveCockpitLayout(layout) {

  try {
    const all = JSON.parse(localStorage.getItem(COCKPIT_LAYOUT_KEY) || "{}");
    all[cockpitLayoutName()] = layout;
    localStorage.setItem(COCKPIT_LAYOUT_KEY, JSON.stringify(all));
  } catch (error) {}
}

/* the movable parts that this layout shows */
function cockpitMovables() {
  return [...$("cockpit").querySelectorAll("[data-movable]")]
    .filter(element => getComputedStyle(element).display !== "none");
}

/* put an element at (left, top), kept fully on screen */
function placeMovable(element, left, top) {

  const box = $("cockpit").getBoundingClientRect();
  const width = element.offsetWidth;
  const height = element.offsetHeight;

  /* never over the top bar: Emergency stop and Exit stay reachable */
  const floor = $("cockpitClose").getBoundingClientRect().bottom - box.top + 8;

  left = Math.max(0, Math.min(box.width - width, left));
  top = Math.max(floor, Math.min(box.height - height, top));

  element.classList.add("moved");
  element.style.left = left + "px";
  element.style.top = top + "px";

  return { left, top };
}

function applyCockpitLayout() {

  if (!cockpitOpen) return;

  const layout = loadCockpitLayout();
  const box = $("cockpit").getBoundingClientRect();

  $("cockpit").querySelectorAll("[data-movable]").forEach(element => {

    const spot = layout[element.dataset.movable];

    if (spot && getComputedStyle(element).display !== "none") {
      placeMovable(element, spot.x * box.width, spot.y * box.height);
    } else {
      element.classList.remove("moved");
      element.style.left = "";
      element.style.top = "";
    }
  });
}

function setArranging(on) {

  if (on === cockpitArranging) return;

  cockpitArranging = on;

  if (on) {
    releaseCockpitInputs();
    if (driveArmed) disarmDrive("arranging the screen");

    /* the drawer covers the screen */
    setCockpitPanel(false);
  }

  $("cockpit").classList.toggle("arranging", on);
  $("cockpitArrangeBar").hidden = !on;
}

function resetCockpitLayout() {
  saveCockpitLayout({});
  applyCockpitLayout();
}

function attachMovable(element) {

  let drag = null;

  element.addEventListener("pointerdown", event => {

    if (!cockpitArranging) return;

    event.preventDefault();

    const rect = element.getBoundingClientRect();
    const box = $("cockpit").getBoundingClientRect();

    drag = {
      pointer: event.pointerId,
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
      box
    };

    try {
      element.setPointerCapture(event.pointerId);
    } catch (error) {}

    element.classList.add("dragging");
  });

  element.addEventListener("pointermove", event => {

    if (!drag || event.pointerId !== drag.pointer) return;

    placeMovable(element,
      event.clientX - drag.box.left - drag.dx,
      event.clientY - drag.box.top - drag.dy);
  });

  const drop = event => {

    if (!drag || event.pointerId !== drag.pointer) return;

    const box = drag.box;
    const layout = loadCockpitLayout();

    layout[element.dataset.movable] = {
      x: parseFloat(element.style.left) / box.width,
      y: parseFloat(element.style.top) / box.height
    };

    saveCockpitLayout(layout);

    drag = null;
    element.classList.remove("dragging");
  };

  element.addEventListener("pointerup", drop);
  element.addEventListener("pointercancel", drop);

  /* a button being moved is not a button being pressed */
  element.addEventListener("click", event => {
    if (cockpitArranging) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
}

$("cockpit").querySelectorAll("[data-movable]").forEach(attachMovable);

$("cockpitArrangeBtn").onclick = () => setArranging(true);
$("cockpitArrangeDone").onclick = () => setArranging(false);
$("cockpitArrangeReset").onclick = resetCockpitLayout;

/* a resize or a rotation: same places, as a share of the new screen */
window.addEventListener("resize", () => requestAnimationFrame(applyCockpitLayout));

/* ---------- wiring ---------- */

attachStick($("stickSteer"), cockpitSteer, "x");
attachStick($("stickThrottle"), cockpitThrottle, "y");
attachCockpitPad();

document.querySelectorAll("[data-cockpit-open]").forEach(button => {
  button.onclick = () => openCockpit(button.dataset.cockpitOpen);
});

document.querySelectorAll("[data-pane-toggle]").forEach(button => {
  button.onclick = () =>
    setPane(button.dataset.paneToggle, button.getAttribute("aria-pressed") !== "true");
});

$("cockpitLayout").onchange = () => {
  useLayout($("cockpitLayout").value);
  applyPanes();
};

$("cockpitLayoutReset").onclick = () => {
  useLayout(layoutName, true);
  applyPanes();
};

document.querySelectorAll("#cockpitPanes .pane").forEach(attachPaneMove);

attachRadarZoom($("paneRadar"), paneRadarScale, redrawPaneRadar);
attachRadarPointer($("paneRadar"), paneRadarScale, redrawPaneRadar, beamPicker(paneRadarScale));
attachRadarCenter($("paneCenterBtn"), paneRadarScale, redrawPaneRadar);

/* a resize or a rotation: phones and desktops lay out differently */
window.matchMedia(COCKPIT_TOUCH_QUERY).addEventListener("change", applyPanes);

$("cockpitClose").onclick = closeCockpit;
$("cockpitRotateClose").onclick = closeCockpit;
$("cockpitEstop").onclick = triggerEstop;

["cockpitStop", "cockpitStopTouch"].forEach(id => {
  $(id).onclick = () => {
    releaseCockpitInputs();
    disarmDrive("stop pressed");
  };
});

$("cockpitArm").onclick = () => $("armBtn").onclick();

$("cockpitArmQuick").onclick = () => {

  if (driveArmed) {
    disarmDrive("disarmed");
    return;
  }

  if (!$("driveConfirm").checked) {
    setCockpitNote("Tick the safety box, then press Arm.");
    setCockpitPanel(true);
    return;
  }

  armDrive();
};

$("cockpitPanelToggle").onclick = () =>
  setCockpitPanel(!$("cockpit").classList.contains("panel-open"));

$("cockpitPanelClose").onclick = () => setCockpitPanel(false);

$("cockpitCamConnect").onclick = reconnectCamera;

/* leaving browser fullscreen (Esc, the system back gesture) leaves
   drive mode with it */
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && cockpitFullscreen) {
    cockpitFullscreen = false;
    closeCockpit();
  }
});

document.addEventListener("keydown", event => {

  if (event.key !== "Escape" || !cockpitOpen) return;

  if (cockpitArranging) {
    setArranging(false);
    return;
  }

  /* a half-made beam pick takes Esc first (lidar-select.js) */
  if (!document.fullscreenElement && pickStart === null) closeCockpit();
});

/* turned upright mid-drive: the sticks are gone, so stop */
window.matchMedia(COCKPIT_PORTRAIT_QUERY).addEventListener("change", event => {

  if (!cockpitOpen || !event.matches) return;

  releaseCockpitInputs();

  if (driveArmed) disarmDrive("phone turned upright");
});

setInterval(renderCockpitFast, 1000 / DRIVE_HZ);
