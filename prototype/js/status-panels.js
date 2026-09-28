"use strict";

/* Diagnostics list, battery, uptime and footer panels. */

/* ==========================================================
   RECENT DIAGNOSTICS
========================================================== */

function renderRecentDiagnostics() {

  const entries =
    Object.entries(diag)
      .sort(
        (a, b) =>
          (b[1].receivedAt || 0) -
          (a[1].receivedAt || 0)
      )
      .slice(0, 5);

  if (!entries.length) {

    $("recentDiagnostics").innerHTML = `
      <div style="color:#666;padding:10px">
        No diagnostics received yet.
      </div>
    `;

    return;
  }

  $("recentDiagnostics").innerHTML =
    entries.map(([name, item]) => {

      const color =
        item.level === 0
          ? "var(--healthy)"
          : item.level === 1
          ? "var(--degraded)"
          : item.level === 2
          ? "var(--failed)"
          : "var(--unknown)";

      return `
        <div class="recent-item">

          <span
            class="recent-dot"
            style="background:${color}">
          </span>

          <div>

            <div class="recent-name">
              ${escapeHtml(name)}
            </div>

            <div class="recent-message">
              ${escapeHtml(
                item.message || diagnosticLabel(item.level)
              )}
            </div>

          </div>

          <div class="recent-time">
            ${
              item.receivedAt
                ? new Date(
                    item.receivedAt
                  ).toLocaleTimeString()
                : ""
            }
          </div>

        </div>
      `;
    }).join("");
}

/* ==========================================================
   DIAGNOSTIC COUNTS
========================================================== */

function renderDiagnosticCounts() {

  let ok = 0;
  let warn = 0;
  let error = 0;
  let stale = 0;

  Object.values(diag)
    .forEach(item => {

      if (item.level === 0) ok++;

      else if (item.level === 1) warn++;

      else if (item.level === 2) error++;

      else stale++;
    });

  $("diagOk").textContent = ok;
  $("diagWarn").textContent = warn;
  $("diagError").textContent = error;
  $("diagStale").textContent = stale;
}

/* ==========================================================
   BATTERY
========================================================== */

function renderBattery() {

  if (!vesc) {

    $("batteryVoltage").textContent =
      "--.- V";

    $("batteryNote").textContent =
      "Waiting for /sensors/core";

    $("batteryPercent").textContent =
      "--";

    $("batteryNeedle").style.transform =
      "rotate(-90deg)";

    $("batteryBar").style.width = "0";

    return;
  }

  const voltage =
    vesc.voltage;

  const estimate =
    batteryEstimate(voltage);

  $("batteryVoltage").textContent =
    voltage.toFixed(1) + " V";

  if (voltage < BATT_ERR) {

    $("batteryVoltage").style.color =
      "var(--failed)";

    $("batteryNote").textContent =
      "Critical — stop driving";
  }

  else if (
    voltage < BATT_WARN
  ) {

    $("batteryVoltage").style.color =
      "#e59600";

    $("batteryNote").textContent =
      "Low battery — swap soon";
  }

  else {

    $("batteryVoltage").style.color =
      "var(--orange)";

    $("batteryNote").textContent =
      "3S LiPo voltage";
  }

  if (estimate !== null) {

    $("batteryPercent").textContent =
      "~" +
      Math.round(estimate) +
      "% estimated";

    const angle =
      -90 + estimate * 1.8;

    $("batteryNeedle").style.transform =
      `rotate(${angle}deg)`;

    $("batteryBar").style.width =
      estimate + "%";

    $("batteryBar").style.background =
      voltage < BATT_ERR
        ? "var(--failed)"
        : voltage < BATT_WARN
        ? "var(--degraded)"
        : "var(--healthy)";
  }
}

/* ==========================================================
   UPTIME
========================================================== */

function renderUptime() {

  const power =
    diag["system: Power"];

  if (
    !power ||
    !power.values ||
    !power.values["uptime"]
  ) {

    $("uptime").textContent =
      "--:--:--";

    $("uptimeNote").textContent =
      "Waiting for system diagnostics";

    return;
  }

  const raw =
    String(
      power.values["uptime"]
    );

  const seconds =
    parseFloat(raw);

  $("uptime").textContent =
    formatUptime(seconds);

  $("uptimeNote").textContent =
    "Robot system uptime";
}

/* ==========================================================
   NETWORK FOOTER
========================================================== */

function renderNetwork() {

  const network =
    diag["system: Network"];

  if (!network) {

    $("networkFooter").textContent =
      "unknown";

    return;
  }

  $("networkFooter").textContent =
    network.message || "connected";
}

