#!/usr/bin/env python3
# MJPEG proxy in front of the GStreamer tcpserversink started by
# start_diagnostics.sh or bringup_launch.py. Browsers can't speak the raw
# multipart TCP stream directly; this just relays it as a proper HTTP response.
import collections
import json
import socket
import threading
import time
from urllib.parse import urlsplit
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

GSTREAMER_HOST = "127.0.0.1"
GSTREAMER_PORT = 8081
HTTP_PORT = 8082
BOUNDARY = b"--robotcamera"         # one per JPEG frame in the stream

# Frame times per viewer, for /stats. Each open stream counts the frames it
# relays; the dashboard grades the camera's frame rate from this.
_frames = {}
_frames_lock = threading.Lock()


def camera_stats(now):
    """Frames per second over the last 2 s (the best open stream) and seconds
    since the last frame. None for both while nobody is watching."""
    with _frames_lock:
        viewers = [list(times) for times in _frames.values()]
    fps = max((sum(1 for t in times if now - t <= 2.0) / 2.0 for times in viewers),
              default=None)
    newest = max((times[-1] for times in viewers if times), default=None)
    return {"viewers": len(viewers), "fps": fps,
            "last_frame_s": None if newest is None else round(now - newest, 2)}


class CameraHandler(BaseHTTPRequestHandler):

    def do_GET(self):
        # The dashboard appends ?t=<timestamp> on a reconnect so the
        # browser cannot hand back a cached failure; match on the path
        # alone or that retry is a 404.
        if urlsplit(self.path).path == "/stats":
            body = json.dumps(camera_stats(time.monotonic())).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)
            return

        if urlsplit(self.path).path != "/camera.mjpg":
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"Not found")
            return

        try:
            stream = socket.create_connection(
                (GSTREAMER_HOST, GSTREAMER_PORT)
            )

            self.send_response(200)
            self.send_header(
                "Content-Type",
                "multipart/x-mixed-replace; boundary=robotcamera"
            )
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "close")
            # The dashboard is served on a different port (8000 vs 8082),
            # which browsers treat as a different origin. Without this
            # header the <img> still shows the stream, but any canvas
            # draw of it is "tainted" and toDataURL()/toBlob() throws -
            # the video works, the download button doesn't.
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

            mine = collections.deque(maxlen=120)
            with _frames_lock:
                _frames[threading.get_ident()] = mine
            tail = b""

            while True:
                data = stream.recv(65536)
                if not data:
                    break
                # A boundary split across two reads is caught by carrying
                # the end of the last read; it is too short to hold a whole one.
                frames = (tail + data).count(BOUNDARY)
                tail = data[-(len(BOUNDARY) - 1):]
                if frames:
                    now = time.monotonic()
                    with _frames_lock:
                        mine.extend([now] * frames)
                self.wfile.write(data)
                self.wfile.flush()

            stream.close()

        except (ConnectionError, BrokenPipeError, OSError):
            pass

        finally:
            with _frames_lock:
                _frames.pop(threading.get_ident(), None)

    def log_message(self, format, *args):
        print(f"[HTTP] {args[0]}")


def self_test():
    """The frame counting, with no camera: python3 camera_http.py --self-test"""
    now = time.monotonic()
    assert camera_stats(now) == {"viewers": 0, "fps": None, "last_frame_s": None}
    _frames[1] = collections.deque(now - 1.5 + i / 30 for i in range(45))
    stats = camera_stats(now)
    assert stats["viewers"] == 1 and 22 <= stats["fps"] <= 23, stats
    _frames.clear()
    tail, frames = b"", 0
    for data in (b"xx--robot", b"camera\r\njpeg--robotcamera\r\n"):
        frames += (tail + data).count(BOUNDARY)
        tail = data[-(len(BOUNDARY) - 1):]
    assert frames == 2, "a boundary split across two reads must count once"
    print("camera_http self-test passed")


def main():
    server = ThreadingHTTPServer(("0.0.0.0", HTTP_PORT), CameraHandler)
    print(f"Camera HTTP server running on port {HTTP_PORT}")
    print(f"Open: http://<robot-ip>:{HTTP_PORT}/camera.mjpg")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping camera server...")
        server.server_close()


if __name__ == "__main__":
    import sys
    self_test() if "--self-test" in sys.argv else main()
