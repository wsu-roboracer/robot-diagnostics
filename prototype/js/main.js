"use strict";

/* Render loop, buttons, connection form and startup. Must load last. */

/* ==========================================================
   MAIN RENDER LOOP
========================================================== */

function render() {

  const now =
    performance.now();

  /* last update */

  if (lastAnything) {

    $("lastUpdated").textContent =
      "last updated " +
      formatTime();

  } else {

    $("lastUpdated").textContent =
      "last updated: never";
  }

  /* stale robot, starved client, crowded rosbridge */

  renderConnectionHealth(now);

  /* main dashboard */

  const subsystems =
    subsystemData();

  /* priority band first — it is what the page is for */

  renderMetrics();
  renderLidar();
  renderRadar();
  renderSelectionReadout();

  renderSubsystems(subsystems);
  renderOverall(subsystems);
  renderStatusFacts(subsystems);
  renderAdvancedBadge();

  renderDiagnosticCounts();

  renderBattery();
  renderUptime();
  renderNetwork();
  renderSystemList();

  renderCounts();
  renderGraph();

  /* advanced */

  renderTopicTable();
  renderNodeTable();
  renderAdvancedDiagnostics();
  renderAttention();

  /* drive */

  renderDrive();
}

/* ==========================================================
   REFRESH BUTTON
========================================================== */

$("refreshBtn").onclick = async () => {

  const button = $("refreshBtn");

  button.disabled = true;
  $("refreshLabel").textContent = "Refreshing...";

  try {

    /* Reconnect to rosbridge */
    connect($("wsUrl").value.trim());

    /* Give the WebSocket a moment to reconnect */
    await new Promise(resolve => {
      setTimeout(resolve, 1000);
    });

    /* Rediscover topics and nodes */
    if (
      ws &&
      ws.readyState === WebSocket.OPEN
    ) {
      await scan();
    }

    /* Immediately update the dashboard */
    render();

  } finally {

    button.disabled = false;
    $("refreshLabel").textContent = "Refresh";
  }
};

/* ==========================================================
   TABS

   The choice lives in the URL hash so a link to #advanced opens
   straight onto it, and a reload keeps you where you were.
========================================================== */

const TABS = ["overview", "drive", "advanced"];

function showTab(name) {

  if (!TABS.includes(name)) name = "overview";

  /* the controller must never keep driving from a tab you
     cannot see */
  if (name !== "drive" && typeof driveArmed !== "undefined" && driveArmed) {
    disarmDrive("left the Drive tab");
  }

  /* the single camera stream follows you: Drive gets the big
     view, everywhere else it lives on the Overview card */
  $(name === "drive" ? "driveCamSlot" : "cameraHome")
    .appendChild($("cameraBox"));

  TABS.forEach(tab => {

    const id = tab[0].toUpperCase() + tab.slice(1);

    $("panel" + id).hidden = tab !== name;
    $("tab" + id).setAttribute("aria-selected", String(tab === name));
  });

  history.replaceState(
    null,
    "",
    name === "overview"
      ? location.pathname + location.search
      : "#" + name
  );
}

document.querySelectorAll("[data-tab]").forEach(button => {
  button.onclick = () => showTab(button.dataset.tab);
});

showTab(location.hash.slice(1) || "overview");

/* Count of things the Overview is not showing in detail, so a
   problem that only the Advanced tab explains is not missed. */
function renderAdvancedBadge() {

  const problems =
    Object.values(diag)
      .filter(item => item.level === 1 || item.level === 2)
      .length;

  const badge = $("advancedBadge");

  badge.hidden = !problems;
  badge.textContent = problems;
  badge.title = problems + " diagnostic warning(s) or error(s)";
}

/* ==========================================================
   THEME

   Light / Dark in the top bar. The choice is kept per browser;
   with none stored the page follows the OS, and the <head>
   script applies a stored one before first paint.
========================================================== */

function currentTheme() {

  return document.documentElement.dataset.theme ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

function renderThemeSwitch() {

  document.querySelectorAll("[data-theme-choice]").forEach(button => {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.themeChoice === currentTheme())
    );
  });
}

document.querySelectorAll("[data-theme-choice]").forEach(button => {

  button.onclick = () => {

    document.documentElement.dataset.theme = button.dataset.themeChoice;

    try {
      localStorage.setItem("theme", button.dataset.themeChoice);
    } catch (error) {}

    renderThemeSwitch();
  };
});

renderThemeSwitch();

/* ==========================================================
   TOPIC FILTER
========================================================== */

$("topicFilter").addEventListener("input", renderTopicTable);
$("topicProblems").addEventListener("change", renderTopicTable);

/* ==========================================================
   PANEL CONTROLS
========================================================== */

$("joyBtn").onclick = runJoyCheck;

$("lidarAdvancedToggle").onclick = () => {

  lidarAdvanced = !lidarAdvanced;

  renderLidarAdvancedToggle();
};

// Selecting is only meaningful with the test controls open — gating
// on lidarAdvanced keeps a stray drag on the basic view from
// silently painting a highlight nobody asked for.
$("radarCanvas").addEventListener("mousedown", event => {

  if (!lidarAdvanced) return;

  const idx = indexFromCanvasEvent(event);
  if (idx === null) return;

  selDragging = true;
  selDragAnchor = idx;
  setSelection(idx, idx);
});

window.addEventListener("mousemove", event => {

  if (!selDragging) return;

  const idx = indexFromCanvasEvent(event);
  if (idx === null) return;

  setSelection(selDragAnchor, idx);
});

window.addEventListener("mouseup", () => {
  selDragging = false;
});

$("presetAbsBtn").onclick = () => presetCentered(0);
$("presetLeftBtn").onclick = () => presetCentered(90);   // REP-103: +90 = left
$("presetRightBtn").onclick = () => presetCentered(-90); // -90 = right
$("presetClearBtn").onclick = clearSelection;

$("rangeApplyBtn").onclick = () => {

  const start = parseInt($("rangeStart").value, 10);
  const end = parseInt($("rangeEnd").value, 10);

  if (Number.isFinite(start) && Number.isFinite(end)) {
    setSelection(start, end);
  }
};

$("cameraConnectBtn").onclick =
  () => connectCamera($("cameraUrl").value.trim());

$("cameraUrl").addEventListener("keydown", event => {

  if (event.key === "Enter") {
    connectCamera($("cameraUrl").value.trim());
  }
});

$("cameraSnapBtn").onclick = takePicture;

$("snapshotClose").onclick =
  () => { $("snapshot").hidden = true; };

/* ==========================================================
   CONNECTION FORM
========================================================== */

const queryUrl =
  new URLSearchParams(
    location.search
  ).get("url");

$("wsUrl").value =
  queryUrl
    ? queryUrl
    : location.protocol.startsWith("http") &&
      location.hostname
    ? `ws://${location.hostname}:9090`
    : "ws://localhost:9090";

$("robotIp").textContent =
  location.hostname || "unknown";

/* Same reasoning as $("wsUrl") above, and the same bug fixed the
   same way: this used to be a hardcoded robot #2 IP
   (192.168.1.202) baked into the HTML, so the camera card was
   broken on every other robot by construction - confirmed on
   robot #6 (192.168.1.206), 2026-09-23. The browser already
   knows which robot it's talking to; it's whatever host served
   this page. ?video=<url> still overrides it, the same way
   ?url= overrides rosbridge, for a different robot or port. */
$("cameraUrl").value =
  location.protocol.startsWith("http") && location.hostname
    ? `http://${location.hostname}:8082/camera.mjpg`
    : "http://localhost:8082/camera.mjpg";

const queryVideo =
  new URLSearchParams(location.search).get("video");

if (queryVideo) {
  $("cameraUrl").value = queryVideo;
}

connectCamera($("cameraUrl").value.trim());

/* A form, so Enter in the address box and the button do the
   same thing. Lives in the top bar: switching robots is one
   edit away from any tab. */
$("connForm").addEventListener("submit", event => {

  event.preventDefault();

  connect(
    $("wsUrl").value.trim()
  );
});

/* ==========================================================
   START
========================================================== */

setInterval(
  render,
  UI_MS
);

setInterval(
  () => {

    if (
      ws &&
      ws.readyState === WebSocket.OPEN
    ) {

      scan();
    }

  },
  GRAPH_POLL_MS
);

connect(
  $("wsUrl").value.trim()
);

