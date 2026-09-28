"use strict";

/* Robot system (OS-level) list. */

/* ==========================================================
   ROBOT SYSTEM LIST

   These values come from system_diagnostics.py, which reads the
   OS-level things ROS does not publish (temperatures, disk,
   network, USB devices) and republishes them as a standard
   DiagnosticArray. No extra transport, no second port, and
   rqt_robot_monitor sees exactly the same data.

   Overview already shows the headline numbers (CPU, RAM, GPU,
   temperature), so this is the detail behind them: one row per
   probe, its verdict, and every key/value it reported.
========================================================== */

const SYS_LEVEL_DOT = {
  0: "ok",
  1: "warn",
  2: "bad"
};

const SYS_LEVEL_CLASS = {
  0: "lvl-ok",
  1: "lvl-warn",
  2: "lvl-bad",
  3: "lvl-unk"
};

function systemShortNames() {

  const byShort = {};

  Object.keys(diag)
    .filter(
      name => name.indexOf(SYS_PREFIX) === 0
    )
    .forEach(name => {
      byShort[name.slice(SYS_PREFIX.length)] = diag[name];
    });

  /* problems first (error, warn), then the usual order; STALE
     (3) is "not probed yet" and sorts with the healthy ones */
  const severity = short =>
    byShort[short].level === 2 ? 2 : byShort[short].level === 1 ? 1 : 0;

  const shorts =
    SYS_ORDER.filter(short => byShort[short])
      .concat(
        Object.keys(byShort)
          .filter(
            short => SYS_ORDER.indexOf(short) < 0
          )
          .sort()
      )
      .sort((a, b) => severity(b) - severity(a));

  return { byShort, shorts };
}

function renderSystemList() {

  const { byShort, shorts } = systemShortNames();

  $("sysHint").style.display =
    shorts.length ? "none" : "block";

  if (!shorts.length) {

    $("sysList").innerHTML = "";

    $("sysSummary").textContent = "not reporting";
    $("sysSummary").style.color = "#777";

    return;
  }

  /* STALE (3) means "not probed yet", which is the fourth state
     — unknown. It must not be allowed to masquerade as the
     worst level. */
  let worst = 0;

  $("sysList").innerHTML =
    shorts.map(short => {

      const item = byShort[short];
      const values = item.values || {};

      if (item.level > worst && item.level !== 3) {
        worst = item.level;
      }

      return `
        <li class="sys-row">

          <span class="dot ${SYS_LEVEL_DOT[item.level] || ""}"></span>

          <span class="sys-name">${escapeHtml(short)}</span>

          <span class="sys-msg">
            <span class="${SYS_LEVEL_CLASS[item.level] || "lvl-unk"}">${
              diagnosticLabel(item.level)
            }</span>
            · ${escapeHtml(item.message || "")}
          </span>

          <div class="sys-values">${
            Object.keys(values).map(key =>
              `<span><b>${escapeHtml(key)}</b> ${
                escapeHtml(String(values[key]))
              }</span>`
            ).join("")
          }</div>

        </li>
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
      ? "var(--bad-ink)"
      : worst === 1
      ? "var(--warn-ink)"
      : "#777";
}
