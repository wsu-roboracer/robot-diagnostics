"use strict";

/* Camera stream and take-picture. */

/* ==========================================================
   CAMERA STREAM

   A plain MJPEG stream over HTTP. The browser renders it in an
   <img> all by itself, so there is no ROS image topic, no
   rosbridge traffic and no library involved — just a URL.
========================================================== */

function setCameraStatus(text, color) {

  $("camTag").textContent = text;
  $("camTag").style.color = color;
}

function connectCamera(url) {

  const image = $("cameraImage");

  if (!url) {

    setCameraStatus("NO STREAM", "var(--failed)");
    $("camMessage").textContent = "Enter a camera URL first.";
    $("camMessage").hidden = false;
    image.hidden = true;
    return;
  }

  setCameraStatus("CONNECTING", "#777");

  image.hidden = true;

  $("camMessage").textContent = "Connecting…";
  $("camMessage").hidden = false;

  image.onload = () => {
    image.hidden = false;
    $("camMessage").hidden = true;
    setCameraStatus("LIVE", "var(--healthy)");
  };

  image.onerror = () => {
    image.hidden = true;
    $("camMessage").textContent = "No stream at " + url;
    $("camMessage").hidden = false;
    setCameraStatus("NO STREAM", "var(--failed)");
  };

  /* On a reconnect the browser may hand back its cached copy of
     a failed request, so the retry would never leave the page.
     A timestamp makes it a new URL. Skipped on the first connect
     to keep the plain URL intact. */
  image.src =
    image.getAttribute("src")
      ? url + (url.indexOf("?") < 0 ? "?" : "&") + "t=" + Date.now()
      : url;
}

/* ==========================================================
   TAKE PICTURE

   Copies whatever frame is on screen into a canvas and turns it
   into a PNG the browser can save. No library, no round trip to
   the robot — the frame is already here.
========================================================== */

function showCameraHint(text) {

  $("cameraHint").textContent = text;
  $("cameraHint").hidden = !text;
}

function takePicture() {

  const image = $("cameraImage");

  if (image.hidden || !image.naturalWidth) {

    showCameraHint(
      "No live frame to capture — connect the camera first.");
    return;
  }

  const canvas = document.createElement("canvas");

  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  canvas.getContext("2d").drawImage(image, 0, 0);

  let data;

  try {

    data = canvas.toDataURL("image/png");

  } catch (error) {

    /* Drawing an image served by another origin "taints" the
       canvas, and the browser then refuses to let the page read
       the pixels back. The video keeps working — only the
       capture is blocked. The fix is on the camera server:
       send an Access-Control-Allow-Origin header. */
    showCameraHint(
      "The browser blocked reading this frame. The camera server " +
      "does not send an Access-Control-Allow-Origin header, so the " +
      "page can show the video but cannot copy its pixels. The " +
      "stream itself is fine.");
    return;
  }

  const stamp = new Date();

  $("snapshotImage").src = data;
  $("snapshotSave").href = data;

  $("snapshotSave").download =
    "camera-" +
    stamp.toISOString().slice(0, 19).replace(/[:T]/g, "-") +
    ".png";

  $("snapshotTime").textContent =
    canvas.width + "×" + canvas.height + " · " +
    stamp.toLocaleTimeString();

  $("snapshot").hidden = false;

  showCameraHint("");
}

