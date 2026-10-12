"use strict";

/* Full screen viewer: the camera, the LiDAR, or both side by side, with
   battery, speed and the status strip on top so you can tell at a glance
   what is going on. Uses the browser's own fullscreen; if that is refused
   (phones), the viewer still covers the window.

   Everything shown is copied from what the page already worked out - the
   status banner, the E-STOP button, the Drive tab's vitals - so the viewer
   can never disagree with the page underneath it. */

const viewerRadarScale = newRadarScale();

let viewerMode = null;      // "camera" | "split" | "lidar" while open

function viewerShowsCamera() {
  return viewerMode === "camera" || viewerMode === "split";
}

/* The page has one camera stream (one <img>); it is borrowed while the
   viewer shows it, and handed back to whichever tab is showing - the
   same rule showTab uses. */
function returnCamera() {
  $(driveTabVisible() ? "driveCamSlot" : "cameraHome")
    .appendChild($("cameraBox"));
}

function setViewerMode(mode) {

  viewerMode = mode;
  $("viewer").dataset.mode = mode;

  if (viewerShowsCamera()) {
    $("viewerCam").appendChild($("cameraBox"));
  } else {
    returnCamera();
  }

  document.querySelectorAll("[data-viewer-mode]").forEach(button =>
    button.setAttribute("aria-pressed", String(button.dataset.viewerMode === mode))
  );

  /* the beam select panel follows the LiDAR in and out */
  renderBeamSelect();

  /* the plot changed size; draw it at the new size now */
  requestAnimationFrame(redrawViewerRadar);
}

function openViewer(mode) {

  setViewerMode(mode);

  const viewer = $("viewer");

  viewer.hidden = false;

  if (!document.fullscreenElement && viewer.requestFullscreen) {
    viewer.requestFullscreen().catch(() => {});
  }

  renderViewer();
}

function closeViewer() {

  if (!viewerMode) return;

  viewerMode = null;
  $("viewer").hidden = true;
  returnCamera();
  renderBeamSelect();

  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
}

function redrawViewerRadar() {
  if (viewerMode && viewerMode !== "camera") {
    drawScanCanvas($("viewerRadar"), viewerRadarScale, selLo, selHi);
    renderRangeButtons("viewer", viewerRadarScale);
  }
}

function renderViewer() {

  if (!viewerMode) return;

  /* status strip, as the banner shows it */

  $("viewerHealth").textContent = $("overallStatus").textContent;
  $("viewerHealth").dataset.health = $("statusBanner").dataset.health || "unknown";

  $("viewerSubsystems").textContent = $("factSubsystems").textContent;
  $("viewerControl").textContent = $("factControl").textContent;
  $("viewerNodes").textContent = $("factNodes").textContent;
  $("viewerClients").textContent = $("clientsValue").textContent;

  /* the physical controller is the backup stop; say plainly when
     there is none */
  const pad = padLinkState();

  $("viewerPad").textContent =
    pad === null ? "unknown" : pad ? "Connected" : "Not connected";
  $("viewerPad").dataset.tone = pad === false ? "warn" : "";

  /* battery and speed, graded as the Drive tab grades them */

  const vitals = driveVitals();
  const battery = vitals.find(row => row.label === "Battery");
  const speed = vitals.find(row => row.label === "Speed");

  $("viewerBattery").textContent = battery.value;
  $("viewerBattery").dataset.tone = battery.tone;
  $("viewerBatteryNote").textContent = battery.note;
  $("viewerBatteryNote").dataset.tone = battery.tone;

  $("viewerSpeed").textContent = speed ? speed.value : "";
  $("viewerSpeedNote").textContent = speed ? speed.note : "";

  /* the computer, from the same tiles the Overview shows */

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

  $("viewerSys").innerHTML = usage.join("") + (temps.length ? `
      <div class="viewer-small">
        <span class="hud-k">Temperature</span>
        <span class="viewer-temps">${temps.map(row => `
          <span title="${escapeHtml(row.hint || "")}">${escapeHtml(row.label)}
            <b data-tone="${row.grade}">${escapeHtml(row.value)}</b></span>`).join("")}
        </span>
      </div>` : "");

  /* the E-STOP button mirrors the top bar's (label, busy, active) */

  const estop = $("estopBtn");
  const mine = $("viewerEstop");

  mine.innerHTML = estop.innerHTML;
  mine.className = estop.className;
  mine.disabled = estop.disabled;

  /* the two things that must never be missed behind a full screen */

  const alerts = [];

  if (estopActive()) {
    alerts.push("EMERGENCY STOP IS ON - exit full screen to release it");
  }

  if ($("staleBar").classList.contains("show")) {
    alerts.push("NO DATA FROM THE ROBOT - these numbers may be stale");
  }

  $("viewerAlert").hidden = !alerts.length;
  $("viewerAlert").textContent = alerts.join(" · ");

  /* arming state, while someone is driving from this page */

  const armed = typeof driveArmed !== "undefined" && driveArmed;

  $("viewerDrive").hidden = !armed;

  if (armed) {
    $("viewerDrive").textContent = $("driveState").textContent;
    $("viewerDrive").className = $("driveState").className;
  }

  redrawViewerRadar();
}

document.querySelectorAll("[data-viewer-open]").forEach(button => {
  button.onclick = () => openViewer(button.dataset.viewerOpen);
});

document.querySelectorAll("[data-viewer-mode]").forEach(button => {
  button.onclick = () => {
    setViewerMode(button.dataset.viewerMode);
    renderViewer();
  };
});

$("viewerEstop").onclick = triggerEstop;
$("viewerClose").onclick = closeViewer;

/* Esc leaves browser fullscreen on its own; follow it out. Without
   fullscreen (refused, or a phone), Esc closes the viewer directly. */
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) closeViewer();
});

document.addEventListener("keydown", event => {
  /* a half-made beam pick takes Esc first (lidar-select.js) */
  if (event.key === "Escape" && viewerMode && !document.fullscreenElement &&
      pickStart === null) {
    closeViewer();
  }
});

attachRadarZoom($("viewerRadar"), viewerRadarScale, redrawViewerRadar);
attachRadarPointer($("viewerRadar"), viewerRadarScale, redrawViewerRadar,
  beamPicker(viewerRadarScale));
attachRadarCenter($("viewerCenterBtn"), viewerRadarScale, redrawViewerRadar);
