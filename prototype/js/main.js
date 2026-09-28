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
  renderHardwareStrip(subsystems);
  renderLidar();
  renderRadar();

  renderSubsystems(subsystems);
  renderOverall(subsystems);
  renderAlerts(subsystems);

  renderRecentDiagnostics();
  renderDiagnosticCounts();

  renderBattery();
  renderUptime();
  renderNetwork();
  renderSystemTiles();

  renderCounts();

  /* advanced */

  renderTopicTable();
  renderNodeTable();
  renderAdvancedDiagnostics();
}

/* ==========================================================
   REFRESH BUTTON
========================================================== */

$("refreshBtn").onclick = async () => {

  const button = $("refreshBtn");

  button.disabled = true;
  button.textContent = "Refreshing...";

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
    button.textContent = "Refresh";
  }
};

/* ==========================================================
   PANEL CONTROLS
========================================================== */

$("joyBtn").onclick = runJoyCheck;

$("sysToggle").onclick = () => {

  sysOpen = !sysOpen;

  renderSystemTiles();
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

$("connectBtn").onclick = () => {

  connect(
    $("wsUrl").value.trim()
  );
};

$("wsUrl").addEventListener(
  "keydown",
  event => {

    if (event.key === "Enter") {

      connect(
        $("wsUrl").value.trim()
      );
    }
  }
);

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

