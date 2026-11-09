/* ---------- controller top speed: the PS4 on the car ----------
   How fast full stick drives. The robot keeps joy_teleop's speed scale on a
   saved value (system_diagnostics' controller_max_speed, saved on the car so
   it survives restarts) and reports it as "system: Controller speed"; this
   sets it. The same control shows twice: in a popup, opened from a chip in
   the footer (or full screen's bottom-right corner), and on the Controller
   tab. A change takes effect on the controller at once. */

let cspeedPending = null;       // { value, until } while a change is on its way
let cspeedOpener = null;        // the chip the popup was opened from

function cspeedDiag() {
  const item = diag[SYS_PREFIX + "Controller speed"];
  if (!item || !item.values) return null;
  const v = item.values;
  const range = /([\d.]+) to ([\d.]+)/.exec(v["range m/s"] || "");
  return {
    max: v["max m/s"] === "unknown" ? null : parseFloat(v["max m/s"]),
    live: v.live === "yes",
    lo: range ? parseFloat(range[1]) : 0.2,
    hi: range ? parseFloat(range[2]) : 5.0
  };
}

async function setControllerSpeed(value) {

  cspeedPending = { value, until: performance.now() + 4000 };
  renderControllerSpeed();

  try {
    const result = await call(SYSDIAG_PARAMS_SERVICE, { parameters: [
      { name: "controller_max_speed", value: { type: 3, double_value: value } }
    ] });
    const bad = (result.results || []).find(r => !r.successful);
    if (bad) {
      cspeedPending = null;
      toast("The car refused: " + (bad.reason || "no reason given") + ".", "warn");
    } else {
      toast(`Controller top speed: ${value.toFixed(1)} m/s.`, "ok");
    }
  } catch (error) {
    cspeedPending = null;
    toast("Could not set the controller speed (" + error.message + ").", "bad");
  }
  renderControllerSpeed();
}

function renderControllerSpeed() {

  const s = cspeedDiag();

  if (cspeedPending && (performance.now() > cspeedPending.until ||
      (s && s.max !== null && Math.abs(s.max - cspeedPending.value) < 0.005))) {
    cspeedPending = null;
  }

  const shown = cspeedPending ? cspeedPending.value : s ? s.max : null;
  const text = shown === null ? "--" : shown.toFixed(1) + " m/s";

  document.querySelectorAll("[data-cspeed-chip]").forEach(chip => {
    chip.hidden = !s;
    chip.querySelector("[data-cspeed-value]").textContent = text;
  });
  if (!s || (cspeedOpener && !cspeedOpener.offsetParent)) closeControllerSpeed();

  const note =
    !s ? "Needs the new system_diagnostics.py on the car."
    : !s.live ? "This car's joy_teleop reads its speed once, at start. It needs the teleop_tools update before it can be changed here."
    : s.max === null ? "joy_teleop is not answering. Is bringup running?"
    : "Full stick drives at this speed. Saved on the car, so it stays after a restart.";

  document.querySelectorAll("[data-cspeed]").forEach(box => {
    const range = box.querySelector("input");
    range.min = s ? s.lo : 0.2;
    range.max = s ? s.hi : 5.0;
    range.disabled = !s || !s.live || s.max === null || !socketOpen();
    if (!box.dataset.dragging) {
      if (shown !== null) range.value = shown;
      box.querySelector("output").textContent = text;
    }
    box.querySelector(".cspeed-note").textContent = note;
  });
}

document.querySelectorAll("[data-cspeed]").forEach(box => {
  const range = box.querySelector("input");
  range.addEventListener("input", () => {
    box.dataset.dragging = "1";
    box.querySelector("output").textContent = parseFloat(range.value).toFixed(1) + " m/s";
  });
  range.addEventListener("change", () => {
    delete box.dataset.dragging;
    setControllerSpeed(parseFloat(range.value));
  });
});

function closeControllerSpeed() {
  $("cspeedPop").hidden = true;
  if (cspeedOpener) cspeedOpener.setAttribute("aria-expanded", "false");
  cspeedOpener = null;
}

/* beside the chip: below it if it fits, else above. Full screen shows only
   the full-screen element, so the popup moves into it while there. */
function openControllerSpeed(chip) {
  const pop = $("cspeedPop");
  const full = document.fullscreenElement;
  const host = full && full.contains(chip) ? full : document.body;
  if (pop.parentElement !== host) host.appendChild(pop);
  pop.hidden = false;
  cspeedOpener = chip;
  chip.setAttribute("aria-expanded", "true");
  const r = chip.getBoundingClientRect();
  const w = pop.offsetWidth;
  pop.style.left = Math.max(16, Math.min(r.right - w, innerWidth - w - 16)) + "px";
  if (r.bottom + 8 + pop.offsetHeight <= innerHeight - 8) {
    pop.style.bottom = "";
    pop.style.top = (r.bottom + 8) + "px";
  } else {
    pop.style.top = "";
    pop.style.bottom = (innerHeight - r.top + 8) + "px";
  }
}

document.querySelectorAll("[data-cspeed-chip]").forEach(chip => {
  chip.addEventListener("click", () => {
    const again = cspeedOpener === chip;
    closeControllerSpeed();
    if (!again) openControllerSpeed(chip);
  });
});

document.addEventListener("click", e => {
  if (!e.target.closest("#cspeedPop, [data-cspeed-chip]")) closeControllerSpeed();
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape" && cspeedOpener) {
    const chip = cspeedOpener;
    closeControllerSpeed();
    chip.focus();
  }
});

addEventListener("resize", closeControllerSpeed);
document.addEventListener("fullscreenchange", closeControllerSpeed);
addEventListener("scroll", closeControllerSpeed, { passive: true });

setInterval(renderControllerSpeed, 500);
