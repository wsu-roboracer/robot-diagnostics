"use strict";

/* ==========================================================
   LIDAR TAB

   The LiDAR card itself (map, view, range, sweep, beam select,
   ignore-angles) is the Overview's card, moved in by showTab().
   This file fills the cards beside it: sensor health, what the
   sensor reports about itself, live readings, and the driver's
   own /diagnostics. Only draws while the tab shows.
========================================================== */

function ltRows(rows) {
  return rows.map(([k, v]) =>
    `<tr><td>${escapeHtml(k)}</td><td class="mono">${escapeHtml(v)}</td></tr>`
  ).join("");
}

function ltFloat(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : NaN;
}

function ltNum(value, digits, unit = "") {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) + unit : "—";
}

function renderLidarTab() {

  const panel = $("panelLidar");
  if (!panel || panel.hidden) return;

  const topic = topics.get("/scan");
  const scan = lastScan;
  const rad = 180 / Math.PI;

  /* health, from the same items the Overview grades */
  const checks = [];
  const driver = runningNodes.has("/urg_node");
  checks.push([driver, driver ? "Driver (/urg_node) is running" : "Driver (/urg_node) is not running"]);

  const pubs = topic ? topic.pubs : 0;
  checks.push([
    pubs === 1,
    pubs === 1 ? "One driver publishing /scan"
      : pubs === 0 ? "Nothing is publishing /scan"
      : `${pubs} drivers publish /scan - a left-over urg_node; run pkill -f urg_node_driver`
  ]);

  const age = scanStats ? (performance.now() - scanStats.at) / 1000 : null;
  const fresh = age !== null && age < 2;
  checks.push([fresh, fresh ? "Scans arriving" : "No recent scans"]);

  const rate = diag["urg_node: Laser Scan topic status"];
  const hz = rate ? ltFloat(rate.values["Actual frequency (Hz)"]) : NaN;
  const lo = rate ? ltFloat(rate.values["Minimum acceptable frequency (Hz)"]) : NaN;
  const hi = rate ? ltFloat(rate.values["Maximum acceptable frequency (Hz)"]) : NaN;
  if (Number.isFinite(hz)) {
    const okHz = hz >= lo && hz <= hi;
    checks.push([okHz, `Scan rate ${hz.toFixed(1)} Hz (expected ${lo.toFixed(0)} to ${hi.toFixed(0)})`]);
  }

  const network = diag["system: Network"];
  const pingKey = network && Object.keys(network.values).find(k => k.indexOf("lidar ") === 0);
  if (pingKey) {
    const up = !/NO REPLY/.test(network.values[pingKey]);
    checks.push([up, up ? "LiDAR answers ping" : "LiDAR does not answer ping - check cable and power"]);
  }

  const allOk = checks.every(c => c[0]);
  $("ltHealth").textContent = allOk ? "Healthy" : "Needs attention";
  $("ltHealthNote").textContent = allOk ? "all checks pass" : "see below";
  $("ltChecks").innerHTML = checks.map(([ok, text]) =>
    `<li class="${ok ? "ok" : "bad"}">${ok ? "✔" : "✖"} ${escapeHtml(text)}</li>`).join("");

  /* settings the sensor reports */
  $("ltSettings").innerHTML = scan ? ltRows([
    ["Frame", scan.header && scan.header.frame_id || "—"],
    ["Beams per scan", String((scan.ranges || []).length)],
    ["Field of view", ltNum((Number(scan.angle_max) - Number(scan.angle_min)) * rad, 1, "°")],
    ["Start angle", ltNum(Number(scan.angle_min) * rad, 1, "°")],
    ["End angle", ltNum(Number(scan.angle_max) * rad, 1, "°")],
    ["Angle step", ltNum(Number(scan.angle_increment) * rad, 3, "°")],
    ["Range limits", `${ltNum(scan.range_min, 2)} to ${ltNum(scan.range_max, 1, " m")}`],
    ["Time per scan", ltNum(Number(scan.scan_time) * 1000, 1, " ms")],
    ["Time per beam", ltNum(Number(scan.time_increment) * 1e6, 1, " µs")],
    ["Intensities", (scan.intensities || []).length ? "yes" : "no"]
  ]) : `<tr><td colspan="2">Waiting for /scan.</td></tr>`;

  /* live readings */
  $("ltAge").textContent = age === null ? "" : `${age.toFixed(1)} s ago`;
  $("ltLive").innerHTML = scanStats ? ltRows([
    ["Beams with a return", `${scanStats.finite} of ${scanStats.points}`],
    ["Nearest", scanStats.min === null ? "—" : scanStats.min.toFixed(2) + " m"],
    ["Farthest", scanStats.max === null ? "—" : scanStats.max.toFixed(2) + " m"],
    ["Rate (driver)", Number.isFinite(hz) ? hz.toFixed(1) + " Hz" : "—"],
    ["/scan messages seen", topic ? String(topic.count) : "—"]
  ]) : `<tr><td colspan="2">Waiting for /scan.</td></tr>`;

  /* the driver's own diagnostics */
  const rows = Object.entries(diag).filter(([name]) => /urg_node|scan|laser|lidar/i.test(name));
  $("ltDiagRows").innerHTML = rows.map(([name, item]) => `
    <tr>
      <td class="mono">${escapeHtml(name)}</td>
      <td class="${item.level === 0 ? "lvl-ok" : item.level === 1 ? "lvl-warn" : item.level === 2 ? "lvl-bad" : "lvl-unk"}">${diagnosticLabel(item.level)}</td>
      <td>${escapeHtml(item.message)}</td>
    </tr>`).join("");
}

/* ==========================================================
   FULL SCREEN
   The LiDAR card fills the screen: just the toolbar and the map,
   as big as fits. Works from the Overview and the LiDAR tab. The
   button is made here so the page's html needs no edit. Esc, or the
   same button, leaves. Also asks the browser for real full screen
   (hides its own bars); where that is refused the card still fills
   the window.
========================================================== */

(function () {

  const card = $("lidarCard");
  const toolbar = card && card.querySelector(".lidar-toolbar");
  if (!card || !toolbar) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "select-toggle lidar-full-btn";
  button.setAttribute("aria-pressed", "false");
  button.title = "Fill the screen with the LiDAR map";
  button.innerHTML = '<i data-icon="maximize"></i> <span>Full screen</span>';
  toolbar.appendChild(button);

  /* the icon set paints data-icon elements at load; paint this one too */
  if (typeof hydrateIcons === "function") hydrateIcons(button);

  function setFull(on) {

    card.classList.toggle("lidar-full", on);
    document.body.classList.toggle("lidar-full-open", on);
    button.setAttribute("aria-pressed", String(on));
    button.querySelector("span").textContent = on ? "Exit full screen" : "Full screen";

    if (on && card.requestFullscreen && !document.fullscreenElement) {
      card.requestFullscreen().catch(() => {});
    } else if (!on && document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }

    /* the plot re-measures itself on the next draw */
    window.dispatchEvent(new Event("resize"));
  }

  button.onclick = () => setFull(!card.classList.contains("lidar-full"));

  /* the browser's own Esc leaves real full screen */
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && card.classList.contains("lidar-full")) {
      setFull(false);
    }
  });

  /* ...and where full screen was refused, Esc still leaves ours */
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && card.classList.contains("lidar-full") && pickStart === null) {
      setFull(false);
    }
  });
})();

/* ==========================================================
   WARNINGS TOGGLE
   Shows or hides the warning circles, the red/amber highlights on
   close objects and the object tags (radar.js setRadarWarnings).
   A button in the LiDAR card toolbar and the full screen pane's
   tools; made here so the page's html needs no edit.
========================================================== */

(function () {

  if (typeof setRadarWarnings !== "function") return;

  document.querySelectorAll(".lidar-toolbar, .viewer-radar-tools").forEach(bar => {

    const button = document.createElement("button");
    button.type = "button";
    button.className = "select-toggle";
    button.setAttribute("data-warnings-toggle", "");
    button.setAttribute("aria-pressed", String(radarState.warnings));
    button.title = "Show or hide the warning circles, red/amber highlights and object tags";
    button.innerHTML = "<i data-icon=\"alert\"></i> Warnings";
    button.onclick = () => setRadarWarnings(!radarState.warnings);
    bar.appendChild(button);

    if (typeof hydrateIcons === "function") hydrateIcons(button);
  });
})();
