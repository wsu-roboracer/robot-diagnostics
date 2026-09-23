"use strict";

/* Advanced diagnostics, priority metrics, hardware strip and lidar readout. */

/* ==========================================================
   ADVANCED DIAGNOSTICS
========================================================== */

function renderAdvancedDiagnostics() {

  const system =
    Object.entries(diag)
      .filter(
        ([name]) =>
          name.startsWith("system: ")
      );

  const ros =
    Object.entries(diag)
      .filter(
        ([name]) =>
          !name.startsWith("system: ")
      );

  const rows = entries =>
    entries.map(([name, item]) => {

      const color =
        item.level === 0
          ? "var(--healthy)"
          : item.level === 1
          ? "#c59600"
          : item.level === 2
          ? "var(--failed)"
          : "var(--unknown)";

      return `
        <tr>

          <td class="mono">
            ${escapeHtml(name)}
          </td>

          <td style="font-weight:700;color:${color}">
            ${diagnosticLabel(item.level)}
          </td>

          <td>
            ${escapeHtml(item.message)}
          </td>

        </tr>
      `;
    }).join("");

  $("systemRows").innerHTML =
    rows(system);

  $("rosDiagRows").innerHTML =
    rows(ros);
}

/* ==========================================================
   NODE / TOPIC COUNTS
========================================================== */

function renderCounts() {

  let runningExpected = 0;

  EXPECTED_NODES.forEach(name => {

    if (runningNodes.has(name)) {
      runningExpected++;
    }
  });

  $("onlineNodes").textContent =
    runningNodes.size;

  $("nodeExpected").textContent =
    `${runningExpected} of ${EXPECTED_NODES.length} expected`;

  $("activeTopics").textContent =
    totalGraphTopics;

  $("topicExpected").textContent =
    totalGraphTopics
      ? "ROS topics discovered"
      : "waiting for ROS graph";
}

/* ==========================================================
   PRIORITY METRICS

   The band at the top of the page. These are the numbers that
   answer "the board started dropping data, why" — which is the
   question this dashboard exists for. Thresholds mirror
   system_diagnostics.py so the page and the node never disagree
   about what counts as bad.
========================================================== */

/* Returns a grade from a value and two thresholds. `higherIsBad`
   covers load and temperature; the inverse covers headroom
   figures like available memory. */
function gradeValue(value, warn, bad, higherIsBad = true) {

  if (!Number.isFinite(value)) return "unknown";

  if (higherIsBad) {
    return value >= bad ? "bad" : value >= warn ? "warn" : "ok";
  }

  return value <= bad ? "bad" : value <= warn ? "warn" : "ok";
}

function gradeFromLevel(level) {

  if (level === 0) return "ok";
  if (level === 1) return "warn";
  if (level === 2) return "bad";

  return "unknown";
}

const numberOr = (raw, fallback = NaN) => {
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
};

function metricTiles() {

  const cpu     = diag[SYS_PREFIX + "CPU"];
  const memory  = diag[SYS_PREFIX + "Memory"];
  const gpu     = diag[SYS_PREFIX + "GPU"];
  const thermal = diag[SYS_PREFIX + "Thermal"];
  const network = diag[SYS_PREFIX + "Network"];

  const tiles = [];

  /* ---- CPU ---------------------------------------------- */
  {
    const values = (cpu && cpu.values) || {};

    /* A true utilisation percentage is the number worth showing,
       but system_diagnostics.py currently publishes load average
       only. Load is not utilisation — 6.0 on 6 cores is 100%
       busy, and on a Jetson it is also what a thermally capped
       board looks like. Show load honestly until `usage %`
       appears, rather than relabelling it. */
    const usage = numberOr(values["usage %"]);
    const load = numberOr(values["load 1m"]);
    const cores = numberOr(values["cores"], 0);

    if (Number.isFinite(usage)) {

      tiles.push({
        id: "cpu",
        label: "CPU",
        sub: cores ? cores + " cores" : "",
        value: Math.round(usage) + "%",
        pct: usage,
        note: Number.isFinite(load) ? "load " + load.toFixed(2) : "",
        grade: gradeValue(usage, 80, 95)
      });

    } else if (Number.isFinite(load) && cores) {

      /* load / cores is the closest honest proxy, and it is the
         same ratio the node grades on. */
      const ratio = 100 * load / cores;

      tiles.push({
        id: "cpu",
        label: "CPU",
        sub: cores + " cores",
        value: load.toFixed(2),
        pct: ratio,
        note: "load average · " + Math.round(ratio) + "% of cores",
        grade: gradeValue(ratio, 100, 200)
      });

    } else {

      tiles.push({
        id: "cpu",
        label: "CPU",
        value: "—",
        note: cpu ? cpu.message : "waiting for system_diagnostics",
        grade: "unknown"
      });
    }
  }

  /* ---- Memory ------------------------------------------- */
  {
    const values = (memory && memory.values) || {};
    const available = numberOr(values["available %"]);

    tiles.push({
      id: "ram",
      label: "RAM",
      sub: values["total"] || "",
      value: Number.isFinite(available)
        ? Math.round(100 - available) + "%"
        : "—",
      pct: Number.isFinite(available) ? 100 - available : null,
      note: Number.isFinite(available)
        ? (values["available"] || Math.round(available) + "%") + " free"
        : (memory ? memory.message : "waiting for system_diagnostics"),
      /* MEM_WARN / MEM_ERR in system_diagnostics.py are headroom
         figures, so they invert when shown as "used". */
      grade: gradeValue(available, 20, 10, false)
    });
  }

  /* ---- GPU ---------------------------------------------- */
  {
    const values = (gpu && gpu.values) || {};
    const usage = numberOr(values["usage %"]);

    tiles.push({
      id: "gpu",
      label: "GPU",
      sub: values["freq"] || "",
      value: Number.isFinite(usage) ? Math.round(usage) + "%" : "—",
      pct: Number.isFinite(usage) ? usage : null,
      /* Nothing publishes this yet. Say so plainly — an
         unmeasured subsystem is `unknown`, never a healthy 0%. */
      note: gpu
        ? gpu.message
        : "not reported — needs GR3D_FREQ from tegrastats",
      grade: gpu ? gradeValue(usage, 85, 97) : "unknown"
    });
  }

  /* ---- Temperature -------------------------------------- */
  {
    const values = (thermal && thermal.values) || {};

    /* tj-thermal is the Jetson's junction temperature and the
       one the spec asks for; on any other board it is absent and
       naming another zone "junction" would be a confident wrong
       label. */
    const junction = numberOr(values["tj-thermal"]);
    const gpuTemp = numberOr(values["gpu-thermal"]);

    tiles.push({
      id: "temp",
      label: "Temperature",
      sub: "junction",
      value: Number.isFinite(junction)
        ? junction.toFixed(1) + " °C"
        : "—",
      /* 40 °C to the 85 °C error line is the range worth seeing;
         below 40 the bar would always read empty. */
      pct: Number.isFinite(junction)
        ? Math.max(0, Math.min(100, (junction - 40) / 45 * 100))
        : null,
      note: Number.isFinite(gpuTemp)
        ? "GPU " + gpuTemp.toFixed(1) + " °C"
        : (thermal ? thermal.message : "waiting for system_diagnostics"),
      grade: thermal
        ? (Number.isFinite(junction)
            ? gradeValue(junction, 70, 85)
            : gradeFromLevel(thermal.level))
        : "unknown"
    });
  }

  /* ---- Network ------------------------------------------ */
  {
    const values = (network && network.values) || {};

    const up =
      Object.keys(values).filter(
        key => /carrier=1/.test(values[key])
      ).length;

    const signal = numberOr(values["wifi signal"]);

    tiles.push({
      id: "wifi",
      label: "Network",
      sub: network ? up + " up" : "",
      value: network
        ? (Number.isFinite(signal)
            ? signal + " dBm"
            : up + " link" + (up === 1 ? "" : "s"))
        : "—",
      pct: Number.isFinite(signal)
        /* -30 dBm is excellent, -90 unusable. */
        ? Math.max(0, Math.min(100, (signal + 90) / 60 * 100))
        : null,
      note: network
        ? network.message
        : "waiting for system_diagnostics",
      grade: network ? gradeFromLevel(network.level) : "unknown"
    });
  }

  return tiles;
}

function renderMetrics() {

  $("metricTiles").innerHTML =
    metricTiles().map(tile => {

      const value = String(tile.value);

      return `
        <div class="metric g-${tile.grade}">

          <div class="label">
            <span>${escapeHtml(tile.label)}</span>
            <span class="sub">${escapeHtml(tile.sub || "")}</span>
          </div>

          <div class="value${value.length > 7 ? " small" : ""}">
            ${escapeHtml(value)}
          </div>

          <div class="bar">
            <i style="width:${
              tile.pct === null || !Number.isFinite(tile.pct)
                ? 0
                : Math.max(0, Math.min(100, tile.pct))
            }%"></i>
          </div>

          <div class="note">${escapeHtml(tile.note || "")}</div>

        </div>
      `;
    }).join("");
}

/* ==========================================================
   HARDWARE STRIP

   The same verdicts as the subsystem table below, at a glance.
   One source of truth — subsystemData() — so the strip and the
   table can never disagree.
========================================================== */

const STRIP_ORDER = ["controller", "camera", "lidar", "vesc", "control"];

function renderHardwareStrip(data) {

  const byId = {};

  data.forEach(item => { byId[item.id] = item; });

  $("hwStrip").innerHTML =
    STRIP_ORDER.filter(id => byId[id]).map(id => {

      const item = byId[id];

      return `
        <div class="hw ${item.health}">

          <div class="hw-icon">${item.icon}</div>

          <div>
            <div class="hw-name">${escapeHtml(item.name)}</div>

            <div class="hw-state health ${item.health}">
              <span class="health-dot"></span>
              ${healthLabel(item.health)}
            </div>

            <div class="hw-detail">${escapeHtml(item.details)}</div>
          </div>

        </div>
      `;
    }).join("");
}

/* ==========================================================
   LIVE LIDAR READOUT
========================================================== */

function renderLidar() {

  const topic = topics.get("/scan");

  const age =
    scanStats
      ? (performance.now() - scanStats.at) / 1000
      : null;

  /* A scan older than the liveness window is a stopped lidar,
     not a slow one, and the numbers on screen are history. */
  const live = age !== null && age < 2;

  $("lidarTag").textContent =
    !scanStats
      ? "waiting"
      : live
      ? "live"
      : "stale";

  $("lidarTag").style.color =
    !scanStats
      ? "#777"
      : live
      ? "var(--healthy)"
      : "var(--failed)";

  if (!scanStats) {

    ["lidarPoints", "lidarMin", "lidarMax", "lidarFov"]
      .forEach(id => { $(id).textContent = "—"; });

    $("lidarHint").innerHTML =
      topic && topic.present
        ? 'Subscribed to <span class="mono">/scan</span>, no message yet.'
        : '<span class="mono">/scan</span> is not in the graph — ' +
          'is <span class="mono">urg_node</span> running?';

    return;
  }

  $("lidarPoints").textContent = scanStats.points;

  $("lidarMin").textContent =
    scanStats.min === null ? "—" : scanStats.min.toFixed(2) + " m";

  $("lidarMax").textContent =
    scanStats.max === null ? "—" : scanStats.max.toFixed(2) + " m";

  $("lidarFov").textContent =
    scanStats.fov === null ? "—" : Math.round(scanStats.fov) + "°";

  $("lidarHint").innerHTML =
    `${scanStats.finite} of ${scanStats.points} returns valid · ` +
    `last scan ${age.toFixed(1)}s ago`;
}

