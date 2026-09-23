#!/usr/bin/env python3
# MJPEG proxy in front of the GStreamer tcpserversink started by
# start_diagnostics.sh. Browsers can't speak the raw multipart TCP
# stream directly; this just relays it as a proper HTTP response.
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

GSTREAMER_HOST = "127.0.0.1"
GSTREAMER_PORT = 8081
HTTP_PORT = 8082


class CameraHandler(BaseHTTPRequestHandler):

    def do_GET(self):
        if self.path != "/camera.mjpg":
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

            while True:
                data = stream.recv(65536)
                if not data:
                    break
                self.wfile.write(data)
                self.wfile.flush()

            stream.close()

        except (ConnectionError, BrokenPipeError, OSError):
            pass

    def log_message(self, format, *args):
        print(f"[HTTP] {args[0]}")


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", HTTP_PORT), CameraHandler)
    print(f"Camera HTTP server running on port {HTTP_PORT}")
    print(f"Open: http://<robot-ip>:{HTTP_PORT}/camera.mjpg")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping camera server...")
        server.server_close()
