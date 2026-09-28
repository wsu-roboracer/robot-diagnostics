"use strict";

/* Robot system (OS-level) tiles. */

/* ==========================================================
   ROBOT SYSTEM TILES

   These values come from system_diagnostics.py, which reads the
   OS-level things ROS does not publish (temperatures, disk,
   network, USB devices) and republishes them as a standard
   DiagnosticArray. No extra transport, no second port, and
   rqt_robot_monitor sees exactly the same data.
========================================================== */

const SYS_LEVEL_COLOR = {
  0: "var(--healthy)",
  1: "#c59600",
  2: "var(--failed)",
  3: "var(--unknown)"
};

/* The headline sits in a fixed slot, so it has to be a VALUE,
   never a sentence. Everything explanatory belongs in
   systemNote() underneath. Level 3 reads `unknown` — the probe
   has not run yet, which is not the same as OK. */
function systemHeadline(short, item) {

  const values = item.values || {};

  if (item.level === 3) return "unknown";

  /* the tick() error handler's shape */
  if (values["probe"]) return "probe failed";

  switch (short) {

    case "Thermal":
      return values["tj-thermal"] || "?";

    case "CPU":
      return values["load 1m"] !== undefined
        ? values["load 1m"]
        : "?";

    case "Memory":
      return values["available %"] !== undefined
        ? values["available %"] + "%"
        : "?";

    case "Storage":
      return values["used %"] !== undefined
        ? values["used %"] + "%"
        : "?";

    case "Power":
      return values["uptime"] || "?";

    case "Camera":
      return values["link speed"] || "absent";

    case "Network":
      return (
        Object.keys(values).filter(
          key => /carrier=1/.test(values[key])
        ).length + " up"
      );

    case "Gamepad":
      return values["bluetooth"] === "connected"
        ? "connected"
        : "none";

    case "VESC device":
      return item.level === 0 ? "present" : "MISSING";

    case "Clock":
      return values["NTPSynchronized"] === "yes"
        ? "synced"
        : "NOT SYNCED";

    default:
      return item.level === 0 ? "ok" : "check";
  }
}

function systemNote(short, item) {

  const values = item.values || {};

  /* problems explain themselves */
  if (item.level !== 0 || values["probe"]) {
    return item.message || "";
  }

  switch (short) {

    case "Thermal":
      return (
        "junction, " +
        Object.keys(values).filter(
          key => key.endsWith("thermal")
        ).length +
        " zones"
      );

    case "CPU":
      return values["cores"]
        ? values["cores"] + " cores"
        : item.message;

    case "Memory":
      return values["available"]
        ? values["available"] + " free"
        : item.message;

    case "Storage":
      return values["free"]
        ? values["free"] + " free"
        : item.message;

    case "Camera":
      return values["product"] || item.message;

    case "Gamepad":
      return values["battery %"]
        ? "battery " + values["battery %"]
        : item.message;

    default:
      return item.message || "";
  }
}

function systemShortNames() {

  const byShort = {};

  Object.keys(diag)
    .filter(
      name => name.indexOf(SYS_PREFIX) === 0
    )
    .forEach(name => {
      byShort[name.slice(SYS_PREFIX.length)] = diag[name];
    });

  const shorts =
    SYS_ORDER.filter(short => byShort[short])
      .concat(
        Object.keys(byShort)
          .filter(
            short => SYS_ORDER.indexOf(short) < 0
          )
          .sort()
      );

  return { byShort, shorts };
}

function renderSystemTiles() {

  const { byShort, shorts } = systemShortNames();

  $("sysHint").style.display =
    shorts.length ? "none" : "block";

  $("sysToggle").style.display =
    shorts.length ? "" : "none";

  if (!shorts.length) {

    $("sysTiles").innerHTML = "";

    $("sysSummary").textContent = "not reporting";
    $("sysSummary").style.color = "#777";

    $("sysReadings").style.display = "none";

    return;
  }

  /* STALE (3) means "not probed yet", which is the fourth state
     — unknown. It must not be allowed to masquerade as the
     worst level. */
  let worst = 0;

  $("sysTiles").innerHTML =
    shorts.map(short => {

      const item = byShort[short];

      if (item.level > worst && item.level !== 3) {
        worst = item.level;
      }

      const head =
        String(systemHeadline(short, item));

      return `
        <div class="sys-tile">

          <span class="k">${escapeHtml(short)}</span>

          <span class="v${
            head.length > HEAD_MAX_CHARS ? " small" : ""
          }" style="color:${
            SYS_LEVEL_COLOR[item.level] || "var(--unknown)"
          }">${escapeHtml(head)}</span>

          <span class="n">${escapeHtml(
            String(systemNote(short, item))
          )}</span>

        </div>
      `;
    }).join("");

  $("sysSummary").textContent =
    worst === 2
      ? "ERROR"
      : worst === 1
      ? "WARN"
      : shorts.length + " checks OK";

  $("sysSummary").style.color =
    worst === 2
      ? "var(--failed)"
      : worst === 1
      ? "#c59600"
      : "#777";

  /* Every raw key/value the probes reported. Folded away by
     default — it is long, and it is only read when a tile has
     already said something is wrong. */
  $("sysReadings").style.display =
    sysOpen ? "" : "none";

  $("sysToggle").textContent =
    sysOpen ? "hide all readings" : "show all readings";

  if (!sysOpen) return;

  $("sysReadings").innerHTML = `
    <table class="raw-table">
      <tbody>
        ${shorts.map(short => {

          const values = byShort[short].values || {};

          return (
            `<tr><td colspan="2" style="color:#777;` +
            `font-weight:700">${escapeHtml(short)}</td></tr>` +
            Object.keys(values).map(key =>
              `<tr><td class="mono">${escapeHtml(key)}</td>` +
              `<td class="mono" style="text-align:right">${
                escapeHtml(String(values[key]))
              }</td></tr>`
            ).join("")
          );
        }).join("")}
      </tbody>
    </table>
  `;
}

