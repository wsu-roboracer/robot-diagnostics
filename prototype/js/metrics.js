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
========================================================== */

/* Returns a grade from a value and two thresholds. */
function gradeValue(
  value,
  warn,
  bad,
  higherIsBad = true
) {

  if (!Number.isFinite(value)) {
    return "unknown";
  }

  if (higherIsBad) {
    return value >= bad
      ? "bad"
      : value >= warn
      ? "warn"
      : "ok";
  }

  return value <= bad
    ? "bad"
    : value <= warn
    ? "warn"
    : "ok";
  }

function gradeFromLevel(level) {

  if (level === 0) return "ok";
  if (level === 1) return "warn";
  if (level === 2) return "bad";

  return "unknown";
}

const numberOr = (
  raw,
  fallback = NaN
) => {

  const n = parseFloat(raw);

  return Number.isFinite(n)
    ? n
    : fallback;
};

/* ==========================================================
   SPEED
========================================================== */

/*
   REAL ROBOT SPEED

   Speed comes from the ROS2 /odom topic:

       /odom
          -> twist
             -> twist
                -> linear
                   -> x

   /odom gives physical linear velocity in meters/second.

   Positive value = forward
   Negative value = reverse
   Near zero       = stopped

   connection.js receives /odom and calls:

       updateSpeed(speedMps)
*/

let robotSpeedMps = null;
let robotSpeedAt = 0;

function updateSpeed(speedMps) {

  const value =
    Number(speedMps);

  if (
    !Number.isFinite(value)
  ) {
    return;
  }

  robotSpeedMps =
    value;

  robotSpeedAt =
    performance.now();
}

function getSpeedMetric() {

  const now =
    performance.now();

  /* --------------------------------------------------------
     No /odom message has been received yet.
  -------------------------------------------------------- */

  if (
    robotSpeedMps === null
  ) {

    return {

      id: "speed",

      label: "Speed",

      sub: "UNKNOWN",

      value: "—",

      pct: null,

      note:
        "waiting for /odom",

      grade: "unknown"
    };
  }

  /* --------------------------------------------------------
     /odom stopped arriving.

     Two seconds gives us a little tolerance while still
     making a dead/stale speed reading visible quickly.
  -------------------------------------------------------- */

  const age =
    (
      now -
      robotSpeedAt
    ) / 1000;

  if (
    age > 2
  ) {

    return {

      id: "speed",

      label: "Speed",

      sub: "STALE",

      value: "—",

      pct: null,

      note:
        "/odom last received " +
        age.toFixed(1) +
        "s ago",

      grade: "bad"
    };
  }

  /* --------------------------------------------------------
     Convert meters/second to MPH.
  -------------------------------------------------------- */

  const speedMps =
    robotSpeedMps;

  const speedMph =
    Math.abs(speedMps) *
    2.23694;

  /* --------------------------------------------------------
     Determine direction.
  -------------------------------------------------------- */

  let direction;

  if (
    speedMps > 0.05
  ) {

    direction =
      "FORWARD";

  } else if (
    speedMps < -0.05
  ) {

    direction =
      "REVERSE";

  } else {

    direction =
      "STOPPED";
  }

  /*
     Visual gauge only.

     3 m/s is approximately 6.7 MPH.

     This does NOT determine the robot's actual speed.
  */

  const pct =
    Math.min(
      100,
      Math.abs(speedMps) /
      3 *
      100
    );

  return {

    id: "speed",

    label: "Speed",

    sub: direction,

    value:
      speedMph.toFixed(2) +
      " MPH",

    pct,

    note:
      speedMps.toFixed(2) +
      " m/s · /odom",

    grade: "ok"
  };
}

/* ==========================================================
   METRIC TILES
========================================================== */

function metricTiles() {

  const cpu =
    diag[
      SYS_PREFIX + "CPU"
    ];

  const memory =
    diag[
      SYS_PREFIX + "Memory"
    ];

  const gpu =
    diag[
      SYS_PREFIX + "GPU"
    ];

  const thermal =
    diag[
      SYS_PREFIX + "Thermal"
    ];

  const network =
    diag[
      SYS_PREFIX + "Network"
    ];

  const tiles = [];

  /* ========================================================
     SPEED
  ======================================================== */

  tiles.push(
    getSpeedMetric()
  );

  /* ========================================================
     CPU
  ======================================================== */

  {

    const values =
      (cpu && cpu.values) || {};

    const usage =
      numberOr(
        values["usage %"]
      );

    const load =
      numberOr(
        values["load 1m"]
      );

    const cores =
      numberOr(
        values["cores"],
        0
      );

    if (
      Number.isFinite(
        usage
      )
    ) {

      tiles.push({

        id: "cpu",

        label: "CPU",

        sub:
          cores
            ? cores + " cores"
            : "",

        value:
          Math.round(
            usage
          ) + "%",

        pct: usage,

        note:
          Number.isFinite(
            load
          )
            ? "load " +
              load.toFixed(2)
            : "",

        grade:
          gradeValue(
            usage,
            80,
            95
          )
      });

    } else if (
      Number.isFinite(load) &&
      cores
    ) {

      const ratio =
        100 *
        load /
        cores;

      tiles.push({

        id: "cpu",

        label: "CPU",

        sub:
          cores +
          " cores",

        value:
          load.toFixed(2),

        pct:
          ratio,

        note:
          "load average · " +
          Math.round(
            ratio
          ) +
          "% of cores",

        grade:
          gradeValue(
            ratio,
            100,
            200
          )
      });

    } else {

      tiles.push({

        id: "cpu",

        label: "CPU",

        value: "—",

        note:
          cpu
            ? cpu.message
            : "waiting for system_diagnostics",

        grade: "unknown"
      });
    }
  }

  /* ========================================================
     MEMORY
  ======================================================== */

  {

    const values =
      (memory && memory.values) || {};

    const available =
      numberOr(
        values["available %"]
      );

    tiles.push({

      id: "ram",

      label: "RAM",

      sub:
        values["total"] ||
        "",

      value:
        Number.isFinite(
          available
        )
          ? Math.round(
              100 -
              available
            ) + "%"
          : "—",

      pct:
        Number.isFinite(
          available
        )
          ? 100 -
            available
          : null,

      note:
        Number.isFinite(
          available
        )
          ? (
              values["available"] ||
              Math.round(
                available
              ) + "%"
            ) +
            " free"
          : (
              memory
                ? memory.message
                : "waiting for system_diagnostics"
            ),

      grade:
        gradeValue(
          available,
          20,
          10,
          false
        )
    });
  }

  /* ========================================================
     GPU
  ======================================================== */

  {

    const values =
      (gpu && gpu.values) || {};

    const usage =
      numberOr(
        values["usage %"]
      );

    tiles.push({

      id: "gpu",

      label: "GPU",

      sub:
        values["freq"] ||
        "",

      value:
        Number.isFinite(
          usage
        )
          ? Math.round(
              usage
            ) + "%"
          : "—",

      pct:
        Number.isFinite(
          usage
        )
          ? usage
          : null,

      note:
        gpu
          ? gpu.message
          : "not reported — needs GR3D_FREQ from tegrastats",

      grade:
        gpu
          ? gradeValue(
              usage,
              85,
              97
            )
          : "unknown"
    });
  }

  /* ========================================================
     TEMPERATURE
  ======================================================== */

  {

    const values =
      (thermal && thermal.values) || {};

    const junction =
      numberOr(
        values["tj-thermal"]
      );

    const gpuTemp =
      numberOr(
        values["gpu-thermal"]
      );

    tiles.push({

      id: "temp",

      label: "Temperature",

      sub:
        "junction",

      value:
        Number.isFinite(
          junction
        )
          ? junction.toFixed(1) +
            " °C"
          : "—",

      pct:
        Number.isFinite(
          junction
        )
          ? Math.max(
              0,
              Math.min(
                100,
                (
                  junction -
                  40
                ) /
                45 *
                100
              )
            )
          : null,

      note:
        Number.isFinite(
          gpuTemp
        )
          ? "GPU " +
            gpuTemp.toFixed(1) +
            " °C"
          : (
              thermal
                ? thermal.message
                : "waiting for system_diagnostics"
            ),

      grade:
        thermal
          ? (
              Number.isFinite(
                junction
              )
                ? gradeValue(
                    junction,
                    70,
                    85
                  )
                : gradeFromLevel(
                    thermal.level
                  )
            )
          : "unknown"
    });
  }

  /* ========================================================
     NETWORK
  ======================================================== */

  {

    const values =
      (network && network.values) || {};

    const up =
      Object.keys(values)
        .filter(
          key =>
            /carrier=1/.test(
              values[key]
            )
        )
        .length;

    const signal =
      numberOr(
        values["wifi signal"]
      );

    tiles.push({

      id: "wifi",

      label: "Network",

      sub:
        network
          ? up + " up"
          : "",

      value:
        network
          ? (
              Number.isFinite(
                signal
              )
                ? signal +
                  " dBm"
                : up +
                  " link" +
                  (
                    up === 1
                      ? ""
                      : "s"
                  )
            )
          : "—",

      pct:
        Number.isFinite(
          signal
        )
          ? Math.max(
              0,
              Math.min(
                100,
                (
                  signal +
                  90
                ) /
                60 *
                100
              )
            )
          : null,

      note:
        network
          ? network.message
          : "waiting for system_diagnostics",

      grade:
        network
          ? gradeFromLevel(
              network.level
            )
          : "unknown"
    });
  }

  return tiles;
}

/* ==========================================================
   RENDER METRICS
========================================================== */

function renderMetrics() {

  $("metricTiles").innerHTML =
    metricTiles()
      .map(tile => {

        const value =
          String(
            tile.value
          );

        return `
          <div class="metric g-${tile.grade}">

            <div class="label">

              <span>
                ${escapeHtml(
                  tile.label
                )}
              </span>

              <span class="sub">
                ${escapeHtml(
                  tile.sub || ""
                )}
              </span>

            </div>

            <div class="value${
              value.length > 7
                ? " small"
                : ""
            }">

              ${escapeHtml(
                value
              )}

            </div>

            <div class="bar">

              <i style="width:${
                tile.pct === null ||
                !Number.isFinite(
                  tile.pct
                )
                  ? 0
                  : Math.max(
                      0,
                      Math.min(
                        100,
                        tile.pct
                      )
                    )
              }%"></i>

            </div>

            <div class="note">
              ${escapeHtml(
                tile.note || ""
              )}
            </div>

          </div>
        `;
      })
      .join("");
}

/* ==========================================================
   HARDWARE STRIP
========================================================== */

const STRIP_ORDER = [
  "controller",
  "camera",
  "lidar",
  "vesc",
  "control"
];

function renderHardwareStrip(
  data
) {

  const byId = {};

  data.forEach(item => {
    byId[item.id] = item;
  });

  $("hwStrip").innerHTML =
    STRIP_ORDER
      .filter(
        id => byId[id]
      )
      .map(id => {

        const item =
          byId[id];

        return `
          <div class="hw ${
            item.health
          }">

            <div class="hw-icon">
              ${item.icon}
            </div>

            <div>

              <div class="hw-name">
                ${escapeHtml(
                  item.name
                )}
              </div>

              <div class="hw-state health ${
                item.health
              }">

                <span class="health-dot"></span>

                ${healthLabel(
                  item.health
                )}

              </div>

              <div class="hw-detail">
                ${escapeHtml(
                  item.details
                )}
              </div>

            </div>

          </div>
        `;
      })
      .join("");
}

/* ==========================================================
   LIVE LIDAR READOUT
========================================================== */

function renderLidar() {

  const topic =
    topics.get(
      "/scan"
    );

  const age =
    scanStats
      ? (
          performance.now() -
          scanStats.at
        ) / 1000
      : null;

  const live =
    age !== null &&
    age < 2;

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

    [
      "lidarPoints",
      "lidarMin",
      "lidarMax",
      "lidarFov"
    ].forEach(id => {

      $(id).textContent =
        "—";

    });

    $("lidarHint").innerHTML =
      topic &&
      topic.present

        ? 'Subscribed to <span class="mono">/scan</span>, no message yet.'

        : '<span class="mono">/scan</span> is not in the graph — ' +
          'is <span class="mono">urg_node</span> running?';

    return;
  }

  $("lidarPoints").textContent =
    scanStats.points;

  $("lidarMin").textContent =
    scanStats.min === null
      ? "—"
      : scanStats.min.toFixed(
          2
        ) + " m";

  $("lidarMax").textContent =
    scanStats.max === null
      ? "—"
      : scanStats.max.toFixed(
          2
        ) + " m";

  $("lidarFov").textContent =
    scanStats.fov === null
      ? "—"
      : Math.round(
          scanStats.fov
        ) + "°";

  $("lidarHint").innerHTML =
    `${scanStats.finite} of ${scanStats.points} returns valid · ` +
    `last scan ${age.toFixed(1)}s ago`;
}

/* ==========================================================
   RADAR PLOT
========================================================== */

let radarScale = 6;

function renderRadar() {

  const canvas =
    $("radarCanvas");

  const ctx =
    canvas.getContext(
      "2d"
    );

  const w =
    canvas.width;

  const h =
    canvas.height;

  ctx.fillStyle =
    "#111";

  ctx.fillRect(
    0,
    0,
    w,
    h
  );

  const age =
    lastScan
      ? (
          performance.now() -
          scanStats.at
        ) / 1000
      : null;

  const live =
    age !== null &&
    age < 2;

  if (
    !lastScan ||
    !live
  ) {

    ctx.fillStyle =
      "#555";

    ctx.font =
      "13px monospace";

    ctx.textAlign =
      "center";

    ctx.fillText(
      lastScan
        ? "SCAN STALE"
        : "NO SCAN",
      w / 2,
      h / 2
    );

    return;
  }

  const angleMin =
    Number(
      lastScan.angle_min
    );

  const angleMax =
    Number(
      lastScan.angle_max
    );

  const angleInc =
    Number(
      lastScan.angle_increment
    );

  const rangeMin =
    Number(
      lastScan.range_min
    );

  const rangeMax =
    Number(
      lastScan.range_max
    );

  const ranges =
    lastScan.ranges ||
    [];

  let seenMax = 0;

  for (
    const v of ranges
  ) {

    if (
      isValidRange(
        v,
        rangeMin,
        rangeMax
      ) &&
      v > seenMax
    ) {

      seenMax = v;
    }
  }

  const target =
    Math.min(
      12,
      Math.max(
        2,
        seenMax || 2
      )
    );

  radarScale +=
    (
      target -
      radarScale
    ) * 0.2;

  const originX =
    w / 2;

  const originY =
    h / 2;

  const margin =
    28;

  const pxPerMeter =
    (
      Math.min(
        w,
        h
      ) / 2 -
      margin
    ) /
    radarScale;

  /* RANGE RINGS */

  ctx.strokeStyle =
    "rgba(57,255,136,0.25)";

  ctx.lineWidth = 1;

  ctx.font =
    "10px monospace";

  ctx.fillStyle =
    "rgba(57,255,136,0.55)";

  ctx.textAlign =
    "left";

  const ringCount = 3;

  for (
    let ring = 1;
    ring <= ringCount;
    ring++
  ) {

    const ringRange =
      radarScale *
      ring /
      ringCount;

    ctx.beginPath();

    const steps = 48;

    for (
      let s = 0;
      s <= steps;
      s++
    ) {

      const a =
        angleMin +
        (
          angleMax -
          angleMin
        ) *
        s /
        steps;

      const p =
        polarToCanvas(
          a,
          ringRange,
          pxPerMeter,
          originX,
          originY
        );

      if (s === 0) {

        ctx.moveTo(
          p.x,
          p.y
        );

      } else {

        ctx.lineTo(
          p.x,
          p.y
        );
      }
    }

    ctx.stroke();

    const top =
      polarToCanvas(
        0,
        ringRange,
        pxPerMeter,
        originX,
        originY
      );

    ctx.fillText(
      ringRange.toFixed(0) +
        "m",
      top.x + 3,
      top.y - 2
    );
  }

  /* FOV BOUNDARY */

  ctx.strokeStyle =
    "rgba(57,255,136,0.25)";

  ctx.beginPath();

  const edgeMinPt =
    polarToCanvas(
      angleMin,
      radarScale,
      pxPerMeter,
      originX,
      originY
    );

  const edgeMaxPt =
    polarToCanvas(
      angleMax,
      radarScale,
      pxPerMeter,
      originX,
      originY
    );

  ctx.moveTo(
    originX,
    originY
  );

  ctx.lineTo(
    edgeMinPt.x,
    edgeMinPt.y
  );

  ctx.moveTo(
    originX,
    originY
  );

  ctx.lineTo(
    edgeMaxPt.x,
    edgeMaxPt.y
  );

  ctx.stroke();

  /* LIDAR RETURNS */

  ctx.strokeStyle =
    "#39ff88";

  ctx.fillStyle =
    "#39ff88";

  ctx.lineWidth =
    1.5;

  ctx.beginPath();

  let drawing = false;

  for (
    let i = 0;
    i < ranges.length;
    i++
  ) {

    const v =
      ranges[i];

    if (
      !isValidRange(
        v,
        rangeMin,
        rangeMax
      )
    ) {

      drawing = false;

      continue;
    }

    const angle =
      angleMin +
      i *
      angleInc;

    const p =
      polarToCanvas(
        angle,
        v,
        pxPerMeter,
        originX,
        originY
      );

    if (drawing) {

      ctx.lineTo(
        p.x,
        p.y
      );

    } else {

      ctx.moveTo(
        p.x,
        p.y
      );

      drawing = true;
    }
  }

  ctx.stroke();

  /* ROBOT MARKER */

  ctx.fillStyle =
    "#8ab4ff";

  ctx.beginPath();

  ctx.moveTo(
    originX,
    originY - 8
  );

  ctx.lineTo(
    originX - 6,
    originY + 5
  );

  ctx.lineTo(
    originX + 6,
    originY + 5
  );

  ctx.closePath();

  ctx.fill();
}