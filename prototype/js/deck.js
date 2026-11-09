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
     L1 / R1           previous / next tab, while the car is NOT armed
                       (a bumper bumped mid-drive must not leave the
                       Drive tab, which disarms)

   The gamepad needs the same secure-context allowance as the drive
   sticks (docs/guides/steam-deck-setup.md), and a standard-mapped pad.
========================================================== */

/* Overview, Drive, Controller, Advanced: the order of the tab bar */
const NAV_TABS = ["overview", "drive", "controller", "advanced"];

const NAV_DEADZONE = 0.25;
const NAV_STICK_SPEED = 1400;   // px per second at full stick
const NAV_DPAD_SPEED = 700;     // px per second while held

/* standard gamepad mapping */
const NAV_BTN_L1 = 4;
const NAV_BTN_R1 = 5;
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

function startDeckNavigation() {

  document.documentElement.classList.add("deck");

  noSelection();

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

  requestAnimationFrame(navTick);
}

if (isDeck) startDeckNavigation();
