#!/usr/bin/env python3
"""
Verify rosbridge from the terminal. Pure Python standard library -
no pip, no apt, no browser. Speaks just enough WebSocket to prove the pipe works.

  python3 rosbridge_check.py                 # localhost:9090
  python3 rosbridge_check.py 10.0.0.5 9090
"""
import base64
import json
import os
import select
import socket
import struct
import sys
import time

WATCH = ['/scan', '/odom', '/sensors/core', '/diagnostics']


def handshake(sock, host, port):
    key = base64.b64encode(os.urandom(16)).decode()
    sock.sendall((
        f"GET / HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\n"
        f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
        f"Sec-WebSocket-Version: 13\r\n\r\n").encode())
    buf = b''
    while b'\r\n\r\n' not in buf:
        chunk = sock.recv(4096)
        if not chunk:
            raise RuntimeError('server closed during handshake')
        buf += chunk
    if b'101' not in buf.split(b'\r\n')[0]:
        raise RuntimeError('upgrade refused: ' + buf.split(b'\r\n')[0].decode())
    return buf.split(b'\r\n\r\n', 1)[1]


def send(sock, text):
    data = text.encode()
    hdr, n = bytearray([0x81]), len(data)
    if n < 126:
        hdr.append(0x80 | n)
    elif n < 65536:
        hdr.append(0x80 | 126); hdr += struct.pack('>H', n)
    else:
        hdr.append(0x80 | 127); hdr += struct.pack('>Q', n)
    mask = os.urandom(4)
    hdr += mask
    sock.sendall(bytes(hdr) + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))


class Frames:
    """Reassembles WebSocket frames into complete text messages.

    Poll-based on purpose: an earlier generator version died permanently the
    first time a socket timeout propagated out of it, which looked exactly
    like "the robot stopped sending".
    """
    def __init__(self, sock, initial=b''):
        self.s, self.buf, self.parts = sock, initial, []

    def poll(self, timeout=0.3):
        out = []
        if select.select([self.s], [], [], timeout)[0]:
            try:
                chunk = self.s.recv(1 << 20)
            except (TimeoutError, BlockingIOError):
                chunk = b''
            if chunk:
                self.buf += chunk
        while len(self.buf) >= 2:
            b0, b1 = self.buf[0], self.buf[1]
            fin, opcode, ln = b0 & 0x80, b0 & 0x0F, b1 & 0x7F
            off = 2
            if ln == 126:
                if len(self.buf) < 4: break
                ln = struct.unpack('>H', self.buf[2:4])[0]; off = 4
            elif ln == 127:
                if len(self.buf) < 10: break
                ln = struct.unpack('>Q', self.buf[2:10])[0]; off = 10
            if len(self.buf) < off + ln:
                break
            payload = self.buf[off:off + ln]
            self.buf = self.buf[off + ln:]
            if opcode == 0x8:          # close
                return out
            if opcode == 0x9:          # ping
                continue
            self.parts.append(payload)
            if fin:
                out.append(b''.join(self.parts).decode('utf-8', 'replace'))
                self.parts = []
        return out


def main():
    # parsed here, not at import time, so this file can be imported as a module
    HOST = sys.argv[1] if len(sys.argv) > 1 else 'localhost'
    PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 9090
    print(f'connecting to ws://{HOST}:{PORT} ...')
    try:
        sock = socket.create_connection((HOST, PORT), timeout=10)
    except (TimeoutError, ConnectionRefusedError, OSError) as e:
        print(f'\nCould not connect: {e}')
        print('\nrosbridge is not listening. In another terminal run:')
        print('  ros2 launch rosbridge_server rosbridge_websocket_launch.xml')
        sys.exit(1)
    try:
        rest = handshake(sock, HOST, PORT)
    except Exception as e:  # noqa: BLE001
        print(f'\nSomething is listening on {PORT} but it is not rosbridge: {e}')
        sys.exit(1)
    print('websocket handshake OK\n')

    send(sock, json.dumps({'op': 'call_service', 'service': '/rosapi/nodes', 'id': 'n'}))
    for t in WATCH:
        send(sock, json.dumps({'op': 'subscribe', 'topic': t,
                               'throttle_rate': 500, 'queue_length': 1}))

    seen, samples, deadline = {}, {}, time.time() + 8
    sock.setblocking(False)
    fr = Frames(sock, rest)
    while time.time() < deadline:
        for raw in fr.poll(0.2):
            m = json.loads(raw)
            if m.get('op') == 'service_response':
                print('nodes:', ' '.join(sorted(m['values']['nodes'])), '\n')
            elif m.get('op') == 'publish':
                t = m['topic']
                seen[t] = seen.get(t, 0) + 1
                samples.setdefault(t, m['msg'])

    print(f'{"TOPIC":<20}{"MSGS":>6}   RESULT')
    for t in WATCH:
        n = seen.get(t, 0)
        print(f'  {t:<18}{n:>6}   ' + ('receiving data' if n else 'NOTHING RECEIVED'))

    core = samples.get('/sensors/core')
    if core:
        st = core['state']
        print("\n/sensors/core decoded over the websocket:")
        print(f"   battery {st['voltage_input']} V   fault_code {st['fault_code']}")
    scan = samples.get('/scan')
    if scan:
        print(f"/scan: {len(scan['ranges'])} ranges, frame_id={scan['header']['frame_id']!r}")

    print('\nrosbridge is working.' if seen else
          '\nConnected, but no messages. Is bringup running?')
    sock.close()


if __name__ == '__main__':
    main()
