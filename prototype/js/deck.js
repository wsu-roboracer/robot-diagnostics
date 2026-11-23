"use strict";

/* Steam Deck navigation: scroll and switch tabs without a mouse. */

/* ==========================================================
   STEAM DECK NAVIGATION

   Only when the page was opened with ?deck=1 (open_dashboard.sh;
   isDeck is set in main.js). In Gaming Mode there is no mouse, and
   the page's scroll bar is a poor target for a thumb, so:

     swipe up / down   scrolls the page, like a phone
     D-pad up / down   scrolls
     left stick        scrolls, while the car is NOT armed (armed, it
                       is the speed stick - see drive.js)
     X                 full screen on / off on the Drive tab (not while armed)
     Y                 hide / show the side bar in the driving view
     (all of it pauses while the Controller tab is remapping buttons)
     L1 / R1           previous / next tab, while the car is NOT armed
                       (a bumper bumped mid-drive must not leave the
                       Drive tab, which disarms)

   The gamepad needs the same secure-context allowance as the drive
   sticks (docs/guides/steam-deck-setup.md), and a standard-mapped pad.
========================================================== */

/* Overview, Drive, Controller, LiDAR, Advanced: the order of the tab bar */
const NAV_TABS = ["overview", "drive", "controller", "lidar", "advanced"];

const NAV_DEADZONE = 0.25;
const NAV_STICK_SPEED = 1400;   // px per second at full stick
const NAV_DPAD_SPEED = 700;     // px per second while held

/* standard gamepad mapping */
const NAV_BTN_L1 = 4;
const NAV_BTN_R1 = 5;
const NAV_BTN_X = 2;
const NAV_BTN_Y = 3;
const NAV_BTN_UP = 12;
const NAV_BTN_DOWN = 13;
const NAV_AXIS_STICK_Y = 1;

/* A finger that moves less than this is still a tap */
const SWIPE_START_PX = 10;

/* Things that use touch themselves: a drag on them is not a scroll.
   Buttons and toggles are not on the list: a swipe that starts on one
   still scrolls, and the click at its end is swallowed. */
const SWIPE_SKIP =
  "input:not([type=checkbox]):not([type=radio]), select, textarea, canvas, " +
  "#drivePad, #cockpitPad, #stickSteer, #stickThrottle, [data-movable], [data-no-swipe]";

/* In the full-screen driving view the page itself does not scroll and
   a drag moves panes and dividers, but these two panels scroll on
   their own, so a swipe on them is a scroll */
const COCKPIT_SCROLLERS = ["cockpitSettings", "cockpitPanel"];

/* a text box you type in is the only thing that may be selected */
const EDITABLE =
  "input:not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable]";

/* ---------- swipe to scroll ---------- */

let swipe = null;
let swallowClick = false;

/* the nearest thing that scrolls itself, else the page */
function scrollParent(node) {

  for (let el = node; el && el !== document.body; el = el.parentElement) {

    const overflow = getComputedStyle(el).overflowY;

    if ((overflow === "auto" || overflow === "scroll") &&
        el.scrollHeight > el.clientHeight + 1) {
      return el;
    }
  }

  return document.scrollingElement;
}

function swipeEnd() {

  if (swipe && swipe.scrolling) {

    /* the finger lifting after a drag is not a tap on whatever is under it */
    swallowClick = true;
    setTimeout(() => { swallowClick = false; }, 50);
  }

  swipe = null;
}

/* ---------- gamepad: scroll and tabs ---------- */

let navLast = performance.now();
let navL1 = false;
let navR1 = false;
let navY = false;
let navX = false;

/* after disarming, a stick still held over would scroll the page at
   once; wait until it has been centred */
let navStickLocked = false;

function navPad() {

  return navigator.getGamepads &&
    [...navigator.getGamepads()].find(p =>
      p && p.connected && p.mapping === "standard");
}

function navPressed(pad, index) {
  return Boolean(pad.buttons[index] && pad.buttons[index].pressed);
}

function navArmed() {
  return typeof driveArmed !== "undefined" && driveArmed;
}

function navCockpitFull() {
  return Boolean(document.querySelector(".cockpit.full:not([hidden])"));
}

/* What the D-pad and stick scroll: the page, or in the full-screen
   driving view the open panel that has more below it (null if none) */
function navScroller() {

  if (!navCockpitFull()) return document.scrollingElement;

  for (const id of COCKPIT_SCROLLERS) {

    const panel = document.getElementById(id);

    if (panel && !panel.hidden && panel.getClientRects().length &&
        panel.scrollHeight > panel.clientHeight + 1) {
      return panel;
    }
  }

  return null;
}

function navStepTab(direction) {

  const selected = document.querySelector('[role="tab"][aria-selected="true"]');
  const current = NAV_TABS.indexOf(selected && selected.dataset.tab);
  const next = (current + direction + NAV_TABS.length) % NAV_TABS.length;

  showTab(NAV_TABS[next]);
  window.scrollTo(0, 0);
}

function navTick(now) {

  requestAnimationFrame(navTick);

  const dt = Math.min(0.1, (now - navLast) / 1000);

  navLast = now;

  const pad = navPad();

  if (!pad) {
    navL1 = false;
    navR1 = false;
    navY = false;
    navX = false;
    return;
  }

  /* Remapping the controller (Controller tab, Map buttons / Remap one): the
     buttons and sticks are the answers it is waiting for, so for now they do
     nothing here - no tab change, no scrolling, no Y. What is held when it
     finishes is remembered as already down, so letting go of it later is not
     a press, and a stick held over stays locked until it is centred. */
  if (typeof jpWizard !== "undefined" && jpWizard) {
    navStickLocked = true;
    navL1 = navPressed(pad, NAV_BTN_L1);
    navR1 = navPressed(pad, NAV_BTN_R1);
    navY = navPressed(pad, NAV_BTN_Y);
    navX = navPressed(pad, NAV_BTN_X);
    return;
  }

  const armed = navArmed();
  const stick = pad.axes[NAV_AXIS_STICK_Y] || 0;

  if (armed) navStickLocked = true;
  else if (Math.abs(stick) < NAV_DEADZONE) navStickLocked = false;

  let delta = 0;

  delta +=
    ((navPressed(pad, NAV_BTN_DOWN) ? 1 : 0) -
     (navPressed(pad, NAV_BTN_UP) ? 1 : 0)) * NAV_DPAD_SPEED * dt;

  if (!armed && !navStickLocked && Math.abs(stick) >= NAV_DEADZONE) {

    delta += Math.sign(stick) *
      (Math.abs(stick) - NAV_DEADZONE) / (1 - NAV_DEADZONE) *
      NAV_STICK_SPEED * dt;
  }

  if (delta) {

    const scroller = navScroller();

    if (scroller) scroller.scrollBy(0, delta);
  }

  /* a press, not a hold; tracked while armed too, so a bumper already
     down when the car disarms does not count as a press */
  const l1 = navPressed(pad, NAV_BTN_L1);
  const r1 = navPressed(pad, NAV_BTN_R1);

  if (!armed && !navCockpitFull()) {
    if (r1 && !navR1) navStepTab(1);
    if (l1 && !navL1) navStepTab(-1);
  }

  navL1 = l1;
  navR1 = r1;

  /* Y: hide or show the side rail, while the driving view is on screen
     (any time, armed or not: it only changes the view) */
  const y = navPressed(pad, NAV_BTN_Y);

  if (y && !navY && document.querySelector(".cockpit:not([hidden]) .cockpit-rail")) {

    const away = document.documentElement.classList.toggle("rail-away");

    if (typeof toast === "function") {
      toast(away ? "Side bar hidden. Press Y to show it." : "Side bar shown.", "ok");
    }

    /* the picture changed size */
    window.dispatchEvent(new Event("resize"));
  }

  navY = y;

  /* X: full screen on / off from the Drive tab, so the side bar's button is
     never a scroll away. Only while the car is NOT armed: leaving full screen
     disarms, so a stray press must not do that mid-drive. */
  const x = navPressed(pad, NAV_BTN_X);

  if (x && !navX && !armed &&
      (cockpitFull || (typeof driveTabVisible === "function" && driveTabVisible()))) {

    if (cockpitFull) closeCockpit();
    else openCockpit();
  }

  navX = x;
}

/* ---------- start ---------- */

function elementOf(node) {
  return node instanceof Element ? node : node && node.parentElement;
}

function editable(node) {

  const el = elementOf(node);

  return Boolean(el && el.closest(EDITABLE));
}

/* No text selection on the Deck: a drag scrolls, a press-and-hold is
   not a copy, and a selected, dragged bit of text broke the page. The
   rule is added here, not in a stylesheet, because Firefox keeps an
   old cached stylesheet until a hard reload but always loads a new
   script. */
function noSelection() {

  const style = document.createElement("style");

  style.textContent =
    "html.deck, html.deck * {" +
    "  user-select: none; -moz-user-select: none;" +
    "  -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }" +
    "html.deck input:not([type=checkbox]):not([type=radio]), html.deck textarea {" +
    "  user-select: text; -moz-user-select: text; }";

  document.head.appendChild(style);

  document.addEventListener("selectstart", event => {
    if (!editable(event.target)) event.preventDefault();
  }, true);

  /* anything that still got selected is un-selected at once */
  document.addEventListener("selectionchange", () => {

    const selection = getSelection();

    if (selection && !selection.isCollapsed && !editable(document.activeElement)) {
      selection.removeAllRanges();
    }
  });

  /* nothing here is meant to be dragged out, and a long press on a
     touch screen is a right click, which opens a menu over the page */
  document.addEventListener("dragstart", event => event.preventDefault(), true);
  document.addEventListener("contextmenu", event => event.preventDefault(), true);
}

/* The Drive tab on the Deck is driven with the Deck's own sticks, so the
   on-screen drive pad, thumb sticks, key hint, PS4 top speed controls and
   the top bar's and side rail's E-stop are taken away; the LiDAR's
   controls go under the map.
   STOP stays. Only under html.deck, so a computer or a phone is unchanged.
   Added here (like noSelection) so it always loads fresh. */
function deckDriveLayout() {

  const style = document.createElement("style");

  style.textContent =
    "html.deck .stick," +
    "html.deck .cockpit-pad-wrap .drive-pad," +
    "html.deck .cockpit-keys," +
    "html.deck .cockpit .cspeed-bar," +
    "html.deck .cockpit .cspeed-side," +
    "html.deck #cockpitEstop," +
    "html.deck #railEstop," +
    "html.deck #railShow," +
    "html.deck #cockpitBarShow," +
    "html.deck #cockpitBarHideBtn," +
    "html.deck .cockpit-sep { display: none !important; }" +
    /* the LiDAR's controls sit under the map, even when it floats */
    /* the speedometer rides on the camera, bottom left (deckSpeedo) */
    "html.deck #cockpitCam > #cockpitSpeedo { position: absolute; left: 14px; bottom: 24px;" +
    "  z-index: 4; pointer-events: none; filter: drop-shadow(0 2px 6px rgba(0,0,0,.6));" +
    "  transform: scale(1.5); transform-origin: left bottom; }" +
    /* Settings, trimmed to fit without a scroll bar: the one-line notes under
       each switch go, and the groups sit closer */
    "html.deck #cockpitSettings .cockpit-switch-text > span { display: none !important; }" +
    "html.deck #cockpitSettings .cs-group { gap: 6px; }" +
    "html.deck #cockpitSettings .cs-group + .cs-group { padding-top: 8px; }" +
    /* a wider side rail with thumb-sized buttons; Arm and Area clear most */
    "html.deck .cockpit.rail { --rail-w: 150px; }" +
    "html.deck .cockpit-rail .rail-check { min-height: 58px; padding: 10px 12px; gap: 10px;" +
    "  font-size: 15px; border-radius: 12px; }" +
    "html.deck .cockpit-rail .rail-check input { width: 26px; height: 26px; }" +
    "html.deck .cockpit .rail-arm { min-height: 68px; font-size: 22px; border-radius: 12px; }" +
    "html.deck .cockpit .rail-stop { min-height: 60px; font-size: 22px; }" +
    "html.deck .cockpit .rail-btn { min-height: 46px; font-size: 13px; }" +
    "html.deck .cockpit .rail-btn .ic { width: 22px; height: 22px; }" +
    "html.deck .cockpit-rail .drive-state, html.deck .cockpit-rail .viewer-health { font-size: 13px; }" +
    "html.deck .cockpit-rail .rail-battery { font-size: 15px; }" +
    /* Y hides the side rail (navTick) */
    "html.deck.rail-away .cockpit-rail { display: none !important; }" +
    "html.deck #railSpeedoSlot:empty { display: none; }" +
    /* the yellow "This drives the real car" notice on the Drive tab */
    "html.deck #driveWarning { display: none !important; }" +
    /* the Full screen button on the camera, top left; gone in full screen */
    "html.deck #deckFullBtn { position: absolute; top: 12px; left: 12px; z-index: 4;" +
    "  display: inline-flex; align-items: center; gap: 8px; min-height: 52px; padding: 0 18px;" +
    "  border: 1px solid rgba(255,255,255,.28); border-radius: 12px; font-size: 16px; font-weight: 800;" +
    "  color: #fff; background: rgba(11,13,16,.72); backdrop-filter: blur(4px); }" +
    "html.deck #deckFullBtn:active { background: rgba(255,121,0,.55); }" +
    "html.deck #deckFullBtn .ic { width: 22px; height: 22px; }" +
    "html.deck .cockpit.full #deckFullBtn { display: none !important; }" +
    "html.deck .viewer-radar-tools { order: 2; }" +
    /* thumb-sized LiDAR buttons. The button groups have a fixed height
       (--btn-h) that clips anything taller, so it is the height that grows */
    "html.deck .viewer-radar { padding: 4px 6px; gap: 6px; }" +
    "html.deck .viewer-radar-tools { --btn-h: 60px; gap: 8px 10px; }" +
    "html.deck .viewer-radar-tools .range-switch button { padding: 0 16px; min-width: 60px; font-size: 18px; }" +
    "html.deck .viewer-radar-tools .select-toggle { height: 60px; padding: 0 18px; font-size: 18px;" +
    "  display: inline-flex; align-items: center; justify-content: center; gap: 8px; }" +
    "html.deck .viewer-radar-tools .ic { width: 26px; height: 26px; }" +
    "html.deck .viewer-radar-tools .viewer-range-label { font-size: 14px; }" +
    /* Select beams and Sweep go; Nearest / Farthest / Average take their place */
    "html.deck .viewer-radar-tools [data-beam-select], html.deck .viewer-radar-tools [data-sweep-toggle]" +
    "  { display: none !important; }" +
    "html.deck #deckLidarStats { display: flex; gap: 8px; }" +
    "html.deck #deckLidarStats > div { min-width: 104px; height: 60px; padding: 4px 12px; border-radius: 10px;" +
    "  border: 1px solid rgba(255,255,255,.3); background: rgba(0,0,0,.55); text-align: center;" +
    "  display: flex; flex-direction: column; justify-content: center; line-height: 1.15; }" +
    "html.deck #deckLidarStats .k { font-size: 12px; font-weight: 800; letter-spacing: .05em;" +
    "  text-transform: uppercase; color: rgba(255,255,255,.65); }" +
    "html.deck #deckLidarStats .v { font-size: 18px; font-weight: 800; color: #fff; font-variant-numeric: tabular-nums; }" +
    "html.deck #deckLidarStats .a { font-size: 13px; font-weight: 700; color: rgba(255,255,255,.75); }" +
    /* the map is as wide as its pane: give the LiDAR pane more of the row */
    "html.deck .pane[data-pane=lidar]:not(.floating) { flex-grow: 40 !important; }" +
    "html.deck .cockpit.lidar-float .pane[data-pane=lidar] .viewer-radar-tools { display: flex !important; }";

  document.head.appendChild(style);
}

/* The speedometer: on the Deck it overlays the camera, bottom left, instead
   of sitting in the side rail. If the camera pane is closed it goes back
   to the rail so the speed is never lost. cockpit.js puts it in the rail
   (applyRail), so look again after that and every half second. */
function deckSpeedo() {

  const speedo = document.getElementById("cockpitSpeedo");
  const cam = document.getElementById("cockpitCam");
  const slot = document.getElementById("railSpeedoSlot");

  if (!speedo || !cam || !slot) return;

  const onCamera = typeof cockpitPaneShown !== "function" || cockpitPaneShown("camera");

  if (onCamera && speedo.parentElement !== cam) cam.appendChild(speedo);
  else if (!onCamera && speedo.parentElement === cam) slot.appendChild(speedo);
}

/* The side bar's battery as a percentage (the volts are in the tooltip).
   It is an estimate from the pack voltage, like the Overview's. cockpit.js
   copies the volts into the rail every render, so this runs right after. */
function deckBattery() {

  const box = document.getElementById("railBattery");

  if (!box || typeof vesc === "undefined" || typeof batteryEstimate !== "function") return;

  const estimate = vesc ? batteryEstimate(vesc.voltage) : null;

  box.innerHTML = icon("battery") + " " +
    (estimate === null ? "--%" : Math.round(estimate) + "%");

  box.title = vesc
    ? vesc.voltage.toFixed(1) + " V (percentage is an estimate)"
    : "Waiting for the battery reading";
}

/* Full screen, as a button on the camera's top left corner (not full screen
   only: it hides itself there, by the rule above), so it is never a scroll
   away in the side bar. */
function deckFullButton() {

  const cam = document.getElementById("cockpitCam");

  if (!cam || document.getElementById("deckFullBtn")) return;

  const button = document.createElement("button");

  button.type = "button";
  button.id = "deckFullBtn";
  button.title = "Full screen (X on the Deck)";
  button.innerHTML = icon("maximize") + " <span>Full screen</span>";
  button.onclick = () => openCockpit();

  cam.appendChild(button);
}

/* Nearest, Farthest and Average, in the LiDAR pane where Select beams and
   Sweep were: each with its distance and, for the first two, the direction
   it is in (degrees from straight ahead, + is left as in /scan). Worked out
   from the latest scan twice a second, while the pane shows. */
function deckLidarStats() {

  const tools = document.querySelector(".viewer-radar-tools");

  if (!tools) return;

  let box = document.getElementById("deckLidarStats");

  if (!box) {
    box = document.createElement("div");
    box.id = "deckLidarStats";
    box.innerHTML = ["Nearest", "Farthest", "Average"].map(name =>
      `<div data-stat="${name}"><span class="k">${name}</span><span class="v">--</span><span class="a"></span></div>`
    ).join("");
    const view = tools.querySelector(".view-switch");
    if (view) view.after(box); else tools.prepend(box);
  }

  const set = (name, value, angle) => {
    const cell = box.querySelector(`[data-stat="${name}"]`);
    cell.querySelector(".v").textContent = value;
    cell.querySelector(".a").textContent = angle || " ";
  };

  const fresh = typeof scanStats !== "undefined" && scanStats &&
    performance.now() - scanStats.at < 2000 && lastScan;

  if (!fresh) {
    ["Nearest", "Farthest", "Average"].forEach(name => set(name, "--", ""));
    return;
  }

  const ranges = lastScan.ranges || [];
  const aMin = Number(lastScan.angle_min);
  const aInc = Number(lastScan.angle_increment);
  const rMin = Number(lastScan.range_min);
  const rMax = Number(lastScan.range_max);

  let near = null, far = null, sum = 0, count = 0;

  for (let i = 0; i < ranges.length; i++) {

    const v = ranges[i];

    if (!isValidRange(v, rMin, rMax)) continue;

    count++;
    sum += v;

    if (!near || v < near.v) near = { v, a: aMin + i * aInc };
    if (!far || v > far.v) far = { v, a: aMin + i * aInc };
  }

  const side = a => {
    const deg = a * 180 / Math.PI;
    return Math.abs(deg) < 1 ? "ahead" : Math.abs(deg).toFixed(0) + "° " + (deg > 0 ? "left" : "right");
  };

  if (!count) {
    ["Nearest", "Farthest", "Average"].forEach(name => set(name, "no return", ""));
    return;
  }

  set("Nearest", near.v.toFixed(2) + " m", side(near.a));
  set("Farthest", far.v.toFixed(2) + " m", side(far.a));
  set("Average", (sum / count).toFixed(2) + " m", "");
}

/* Deck settings: three switches are fixed and their rows removed - Big
   controls on, Keep the screen awake on, Hide the top bar on (the side
   rail carries the essentials) - and the Keyboard help goes, since the
   Deck drives with its sticks. Forced here, not saved, so nothing a past
   session stored can turn them off; a computer is untouched. */
function deckSettings() {

  ["bigToggle", "wakeToggle", "barHiddenToggle"].forEach(id => {
    const input = document.getElementById(id);
    const row = input && input.closest(".cockpit-switch");
    if (row) row.style.setProperty("display", "none", "important");
  });

  /* the LiDAR group (view, range, sweep): those controls are under the map */
  const lidarRange = document.querySelector('#cockpitSettings [data-range-for="pane"]');
  const lidarGroup = lidarRange && lidarRange.closest(".cs-group");
  if (lidarGroup) lidarGroup.style.setProperty("display", "none", "important");

  /* the Screen group: its switches are fixed above, and what is left is for phones */
  const screenGroup = document.getElementById("bigToggle") &&
    document.getElementById("bigToggle").closest(".cs-group");
  if (screenGroup) screenGroup.style.setProperty("display", "none", "important");

  const keys = document.querySelector(".cs-keys");
  const group = keys && keys.closest(".cs-group");
  if (group) group.style.setProperty("display", "none", "important");

  if (typeof applyBigControls === "function") {
    $("bigToggle").checked = true;
    applyBigControls();
  }

  if (typeof updateWakeLock === "function") {
    $("wakeToggle").checked = true;
    updateWakeLock();
  }

  /* cockpit.js reads this everywhere it decides about the bar */
  if (typeof barHidden === "function" && typeof applyBarHidden === "function") {
    barHidden = () => true;
    applyBarHidden();
  }
}

function startDeckNavigation() {

  document.documentElement.classList.add("deck");

  noSelection();
  deckDriveLayout();
  deckSettings();

  if (typeof applyRail === "function") {
    const placeInRail = applyRail;
    applyRail = function () {
      placeInRail();
      deckSpeedo();
    };
    applyRail();
  }
  setInterval(deckSpeedo, 500);
  setInterval(deckLidarStats, 500);
  deckFullButton();

  if (typeof renderCockpit === "function") {
    const original = renderCockpit;
    renderCockpit = function () {
      original();
      if (cockpitOpen) deckBattery();
    };
  }

  window.addEventListener("pointerdown", event => {

    const target = event.target;

    if (event.button > 0 || !(target instanceof Element) ||
        target.closest(SWIPE_SKIP)) {
      return;
    }

    const scroller = scrollParent(target);

    /* in the full-screen driving view only its own panels scroll */
    if (target.closest(".cockpit.full") &&
        (!target.closest(COCKPIT_SCROLLERS.map(id => "#" + id).join(", ")) ||
         scroller === document.scrollingElement)) {
      return;
    }

    swipe = {
      id: event.pointerId,
      y: event.clientY,
      scroller,
      scrolling: false
    };
  }, true);

  window.addEventListener("pointermove", event => {

    if (!swipe || event.pointerId !== swipe.id) return;

    const delta = swipe.y - event.clientY;

    if (!swipe.scrolling && Math.abs(delta) < SWIPE_START_PX) return;

    swipe.scrolling = true;
    swipe.y = event.clientY;
    swipe.scroller.scrollBy(0, delta);
  }, true);

  /* if the browser scrolls natively it sends pointercancel and this
     handler stands down, so the two never both scroll */
  ["pointerup", "pointercancel"].forEach(type =>
    window.addEventListener(type, swipeEnd, true));

  window.addEventListener("click", event => {

    if (swallowClick) {
      event.stopPropagation();
      event.preventDefault();
      swallowClick = false;
    }
  }, true);

  /* press and hold on a touch screen opens the browser's menu, and a
     drag picks up the camera picture: neither belongs in a controller
     screen. Text boxes keep their menu (paste an address). */
  const keepNative = target =>
    target instanceof Element && target.closest("input, textarea, select");

  window.addEventListener("contextmenu", event => {
    if (!keepNative(event.target)) event.preventDefault();
  }, true);

  window.addEventListener("dragstart", event => {
    if (!keepNative(event.target)) event.preventDefault();
  }, true);

  requestAnimationFrame(navTick);
}

if (isDeck) startDeckNavigation();
