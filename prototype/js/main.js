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

  $("refreshBtn").disabled = true;

  try {
    await scan();
  } finally {

    setTimeout(() => {
      $("refreshBtn").disabled = false;
    }, 300);
  }

  render();
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

/* The input carries the working URL as its value in the HTML.
   ?video=<url> overrides it, the same way ?url= overrides
   rosbridge, for a different robot or a different port. */
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

