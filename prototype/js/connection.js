"use strict";

/* rosbridge connection, service calls and subscriptions. */

/* ==========================================================
   ROS SERVICE CALL
========================================================== */

function call(service, args = {}) {

  return new Promise((resolve, reject) => {

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error("not connected"));
      return;
    }

    const id = "call_" + (++sequence);

    pending.set(id, { resolve, reject });

    /* 12s, not 8: the joystick check shells out to `ros2 run`
       on the robot and is allowed 8s there, so a shorter
       deadline would time out a call that is about to answer.
       rosapi calls are unaffected — scan() retries every 5s. */
    setTimeout(() => {

      if (pending.delete(id)) {
        reject(new Error("timeout " + service));
      }

    }, 12000);

    send({
      op: "call_service",
      service,
      args,
      id
    });
  });
}

/* ==========================================================
   CONNECTION
========================================================== */

function setConnectionState(text, connected) {

  $("connectionFooter").textContent =
    text.toUpperCase();

  $("footerConnected").textContent =
    text.toUpperCase();

  $("footerDot").className =
    "connection-dot " +
    (connected ? "connected" : "disconnected");
}

function connect(url) {

  if (ws) {

    try {
      ws.onclose = null;
      ws.close();
    } catch (error) {}
  }

  topics.clear();
  subscribed.clear();

  runningNodes = new Set();

  diag = {};
  vesc = null;
  mux = null;
  scanStats = null;
  lastScan = null;

  expanded.clear();
  latestMsg.clear();

  lastAnything = 0;
  lastPublish = 0;
  connectedAt = 0;
  clients = null;

  totalGraphTopics = 0;

  setConnectionState("connecting", false);

  try {

    ws = new WebSocket(url);

  } catch (error) {

    setConnectionState("bad url", false);
    return;
  }

  ws.onopen = () => {

    connectedAt = performance.now();

    setConnectionState("connected", true);

    $("connHint").textContent = "";

    subscribeFixed();

    scan();
  };

  ws.onclose = () => {

    setConnectionState("disconnected", false);
  };

  ws.onerror = () => {

    setConnectionState("connection failed", false);

    $("connHint").textContent =
      "Cannot reach rosbridge. On the robot: " +
      "ros2 launch rosbridge_server rosbridge_websocket_launch.xml";
  };

  ws.onmessage = event => {

    lastAnything = performance.now();

    let message;

    try {

      message = JSON.parse(event.data);

    } catch (error) {

      return;
    }

    /* Never let one bad message kill the loop. */
    try {

      handleMessage(message);

    } catch (error) {

      console.error("handler", error);
    }
  };
}

/* ==========================================================
   ROS MESSAGE HANDLER
========================================================== */

function handleMessage(message) {

  if (message.op === "service_response") {

    const callback =
      pending.get(message.id);

    if (callback) {

      pending.delete(message.id);

      /* rosbridge answers a failed call with result:false and an
         error STRING in values. Resolving that like a normal
         reply hands the caller an object whose every field is
         undefined — a missing service then renders as an empty
         result instead of an error. */
      if (message.result === false) {

        callback.reject(
          new Error(
            String(
              message.values || "service call failed"
            )
          )
        );

      } else {

        callback.resolve(message.values);
      }
    }

    return;
  }

  if (message.op !== "publish") return;

  const topicName = message.topic;
  const now = performance.now();

  lastPublish = now;

  if (topicName === "/client_count") {

    clients = message.msg.data;
    return;
  }

  const topic = topics.get(topicName);

  if (topic) {

    topic.count++;
    topic.last = now;

    if (topic.first === null) {
      topic.first = now;
    }
  }

  if (expanded.has(topicName)) {
    latestMsg.set(topicName, message.msg);
  }

  if (topicName === "/diagnostics") {
    onDiagnostics(message.msg);
  }

  else if (topicName === "/rosout") {
    onLog(message.msg);
  }

  else if (topicName === "/sensors/core") {
    onVesc(message.msg);
  }

  else if (topicName === "/scan") {
    onScan(message.msg);
  }
}

/* "Is the LiDAR connected" is a much weaker question than "what
   is it seeing". These are the cheap summary statistics of the
   scan we already receive — a full radar plot draws from the
   same message. ~1081 ranges at the 5 Hz liveness throttle is
   nothing, but never do this work unthrottled. */
function onScan(message) {

  const ranges = message.ranges || [];
  const rangeMin = Number(message.range_min);
  const rangeMax = Number(message.range_max);

  let min = Infinity;
  let max = -Infinity;
  let finite = 0;

  for (const value of ranges) {

    if (isValidRange(value, rangeMin, rangeMax)) {

      finite++;

      if (value < min) min = value;
      if (value > max) max = value;
    }
  }

  const span =
    Number(message.angle_max) - Number(message.angle_min);

  scanStats = {
    points: ranges.length,
    finite,
    min: finite ? min : null,
    max: finite ? max : null,
    fov: Number.isFinite(span) ? span * 180 / Math.PI : null,
    at: performance.now()
  };

  lastScan = message;
}

/* ---- radar geometry ----
   Pure, so verify_radar.mjs can check it with no DOM/websocket.

   A "no return" beam does NOT come back as inf/NaN on this
   Hokuyo — measured on the robot, it reports ~65.5 m (the raw
   SCIP sentinel 65535 mm passed straight through), well above
   range_max (30 m). Anything at or past range_max is that
   sentinel, not a real wall. */
function isValidRange(value, rangeMin, rangeMax) {
  return typeof value === "number" &&
    isFinite(value) &&
    value > rangeMin &&
    value < rangeMax;
}

/* angle 0 = straight ahead (REP-103: x forward, y left, angle
   grows counter-clockwise). Mapped so the canvas reads like a
   chase-cam behind the robot: forward is up, left is left. */
function polarToCanvas(angle, range, pxPerMeter, originX, originY) {
  return {
    x: originX - range * pxPerMeter * Math.sin(angle),
    y: originY - range * pxPerMeter * Math.cos(angle)
  };
}

/* ==========================================================
   SUBSCRIPTIONS
========================================================== */

function subscribeFixed() {

  send({
    op: "subscribe",
    topic: "/rosout",
    throttle_rate: 0,
    queue_length: 10
  });

  /* rosbridge's own count of connected clients. It publishes on
     change only, so this reads "—" until someone connects or
     disconnects — including, usually, our own arrival, which
     lands before this subscription is registered. */
  send({
    op: "subscribe",
    topic: "/client_count",
    throttle_rate: 0,
    queue_length: 1
  });
}

/* Expanding a row makes it resubscribe faster, so the values
   actually move while you are watching them. */
function toggleTopic(name) {

  if (expanded.has(name)) {

    expanded.delete(name);
    latestMsg.delete(name);

    send({ op: "unsubscribe", topic: name });

    send({
      op: "subscribe",
      topic: name,
      throttle_rate: LIVENESS_THROTTLE,
      queue_length: 1
    });

  } else {

    expanded.add(name);

    send({ op: "unsubscribe", topic: name });

    send({
      op: "subscribe",
      topic: name,
      throttle_rate: DETAIL_THROTTLE,
      queue_length: 1
    });
  }

  const row = rowEls.get(name);

  if (!row) return;

  const open = expanded.has(name);

  row.tr.classList.toggle("open", open);

  row.detail.style.display = open ? "" : "none";

  if (open) {
    row.pre.textContent = "waiting for a message…";
  }
}

/* Big arrays (LaserScan has 1081 ranges) are summarised, not
   dumped. */
function summarize(value) {

  if (Array.isArray(value)) {

    if (value.length > 12) {

      const numbers =
        value.filter(
          item =>
            typeof item === "number" &&
            isFinite(item)
        );

      const head =
        value.slice(0, 6).map(
          item =>
            typeof item === "number"
              ? +item.toFixed(3)
              : item
        );

      let stat = "";

      if (numbers.length) {

        stat =
          `, finite ${numbers.length}` +
          `, min ${Math.min(...numbers).toFixed(2)}` +
          `, max ${Math.max(...numbers).toFixed(2)}`;
      }

      return (
        `[${value.length} items${stat}] ` +
        `first 6: ${JSON.stringify(head)}`
      );
    }

    return value.map(summarize);
  }

  if (value && typeof value === "object") {

    const out = {};

    for (const key of Object.keys(value)) {
      out[key] = summarize(value[key]);
    }

    return out;
  }

  return value;
}

