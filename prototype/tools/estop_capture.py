#!/usr/bin/env python3
"""Measure how long the car takes to stop after the controller link drops (block D).

This is S-23/S-03, the one safety-relevant unknown left in #1. The mux side is
known - `mux.yaml` sets a 0.2 s timeout on both inputs. What is NOT known is the
VESC's own command timeout: once `ackermann_to_vesc_node` stops publishing, does
the motor stop immediately, or does the controller hold the last command for some
period of its own?

Why a script rather than `ros2 topic echo --csv`: that prints the message fields
and NO timestamp, so the CSVs it produces cannot answer a timing question at all.
A stopwatch is worse - the interval being measured is around 200 ms.

    RUN THE CAR ON BLOCKS, WHEELS OFF THE GROUND, WITH A SECOND PERSON PRESENT.

    python3 estop_capture.py --kill-after      # 5 s countdown, then drops the BT link
    python3 estop_capture.py --kill-after 10   # a longer countdown
    python3 estop_capture.py                   # you drop the link yourself
    python3 estop_capture.py --self-test       # no ROS, no robot

Procedure: start it with `--kill-after`, hold the deadman (L1) and bring the
wheels up to a steady speed during the countdown. It disconnects the pad for you at
a known moment. Let the wheels coast to a stop, then Ctrl+C.

Dropping the link by hand is awkward and worse: the DS4 refuses to power off from
the PS button while sticks and buttons are active, and walking out of range adds the
Bluetooth supervision timeout to every number. A `bluetoothctl disconnect` reaches
ROS by the identical path - `joy` stops receiving events and `/joy` stops publishing.
Reconnect afterwards with the PS button or `bluetoothctl connect <mac>`.

It writes a timestamped CSV and prints the intervals. Do it twice; one sample of a
safety number is not a measurement.
"""

import csv
import re
import subprocess
import sys
import threading
import time

try:
    import rclpy
    from ackermann_msgs.msg import AckermannDriveStamped
    from rclpy.node import Node
    from rclpy.qos import QoSProfile, ReliabilityPolicy
    from nav_msgs.msg import Odometry
    from sensor_msgs.msg import Joy
    from std_msgs.msg import Float64
    from vesc_msgs.msg import VescStateStamped
except ImportError:
    if "--self-test" not in sys.argv:
        raise
    Node = object

# eRPM below which the motor counts as stopped. The VESC reports eRPM, which is
# pole-pairs times mechanical RPM, so this is a small fraction of a wheel turn.
STOPPED_ERPM = 100.0


def summarise(events):
    """events: list of (t, channel, value). Returns (lines, {name: interval}).

    Pure, so the arithmetic that produces a safety number can be checked without
    a car: `python3 estop_capture.py --self-test`.
    """
    def last_msg(ch):
        """When the channel last carried ANYTHING.

        Not "last non-zero value", which is what the first version used and which
        was wrong: the final /teleop and /ackermann_cmd of a run carry speed 0.0, so
        filtering them out moved those timestamps earlier than /joy's and made a
        clean link-loss run look like the pad had never disconnected. A trailing
        zero is still the chain being alive.
        """
        ts = [t for t, c, _ in events if c == ch]
        return ts[-1] if ts else None

    def first_event(ch):
        ts = [t for t, c, _ in events if c == ch]
        return ts[0] if ts else None

    t_kill = first_event("link_kill_requested")
    t_joy = last_msg("joy")
    t_teleop = last_msg("teleop")
    t_cmd = last_msg("ackermann_cmd")
    t_motor = last_msg("motor_speed")
    t_end = max((t for t, _, _ in events), default=None)

    t_stop = None
    if t_motor is not None:
        for t, c, v in events:
            if c == "vesc_erpm" and t >= t_motor and abs(v) < STOPPED_ERPM:
                t_stop = t
                break

    lines, intervals = [], {}

    def gap(name, a, b, note):
        if a is None or b is None:
            lines.append(f"  {name:<40} not measured ({note})")
            return
        intervals[name] = b - a
        lines.append(f"  {name:<40} {(b - a) * 1000:8.1f} ms")

    # How the drive ended. --kill-after records the moment it asked bluetoothctl to
    # disconnect, which is unambiguous. Without it, a pad that died leaves /joy
    # silent for the rest of the capture; a pad still publishing at the end means
    # the operator simply let go, which is a different (also real) measurement.
    joy_silent_at_end = (t_joy is not None and t_end is not None and t_end - t_joy > 1.0)
    if t_kill is not None:
        trigger, label = t_kill, "disconnect requested"
        gap("disconnect requested -> /joy stopped", t_kill, t_joy,
            "no /joy at all - was a pad connected?")
    elif joy_silent_at_end:
        trigger, label = t_joy, "link lost"
    else:
        trigger, label = t_teleop, "deadman released"
        lines += [
            "  THE CONTROLLER STAYED CONNECTED.",
            "  /joy was still publishing at the end of the capture, so this run measured",
            "  a DEADMAN RELEASE, not a link loss. The coast-down below is still valid.",
            "  Use --kill-after to drop the Bluetooth link automatically instead.",
            "",
        ]

    gap(f"{label} -> last drive command", trigger, t_cmd, "no /ackermann_cmd seen")
    gap("last drive command -> last motor command", t_cmd, t_motor, "no motor command seen")
    gap("last motor command -> wheels stopped", t_motor, t_stop,
        "wheels never reached zero - did they coast past the end of the capture?")
    gap(f"TOTAL: {label} -> wheels stopped", trigger, t_stop, "see above")

    speeds = [abs(v) for _, c, v in events if c == "odom_speed"]
    if speeds:
        lines.append(f"  {'peak speed during the run':<40} {max(speeds):8.2f} m/s")

    # The command chain is pass-through. mux.yaml's 0.2 s governs when a quiet input
    # is MASKED for priority, not how long the output is held - ackermann_mux
    # forwards message by message. So the whole stopping time is coast-down, and
    # hundreds of ms here would mean something is buffering that should not be.
    chain = intervals.get("last drive command -> last motor command")
    if chain is not None:
        lines.append("")
        lines.append(f"  command chain is pass-through ({chain * 1000:.1f} ms)"
                     if chain < 0.05 else
                     f"  command chain held for {chain * 1000:.0f} ms  <- investigate")
        lines.append("  (mux.yaml's 0.2 s masks a quiet INPUT for priority; it does not delay")
        lines.append("   the output. The stopping time above is coast-down.)")
    return lines, intervals


def connected_pad():
    """(mac, name) of the connected Bluetooth pad, or (None, None)."""
    try:
        out = subprocess.run(["bluetoothctl", "devices"], capture_output=True,
                             text=True, timeout=5, check=False).stdout
        for mac, name in re.findall(r"Device (\S+) (.+)", out):
            info = subprocess.run(["bluetoothctl", "info", mac], capture_output=True,
                                  text=True, timeout=5, check=False).stdout
            if "Connected: yes" in info:
                return mac, name.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        pass
    return None, None


class EstopCapture(Node):
    def __init__(self, kill_after=None):
        super().__init__("estop_capture")
        self.events = []
        # BEST_EFFORT is compatible with both BEST_EFFORT and RELIABLE publishers,
        # so it cannot produce the silent zero-message QoS mismatch that has bitten
        # this project before. We are timing arrivals, not auditing delivery.
        q = QoSProfile(depth=50, reliability=ReliabilityPolicy.BEST_EFFORT)
        self.create_subscription(Joy, "/joy", self._joy, q)
        self.create_subscription(AckermannDriveStamped, "/teleop", self._teleop, q)
        self.create_subscription(AckermannDriveStamped, "/ackermann_cmd", self._cmd, q)
        self.create_subscription(Float64, "/commands/motor/speed", self._motor, q)
        self.create_subscription(VescStateStamped, "/sensors/core", self._vesc, q)
        # /odom is the wheel speed in m/s, which is what a human can sanity-check.
        # /sensors/core's eRPM is the authoritative stop signal but means nothing to
        # anyone reading the report.
        self.create_subscription(Odometry, "/odom", self._odom, q)
        self.create_subscription(Float64, "/commands/servo/position", self._servo, q)
        if kill_after:
            self._kill_later(kill_after)
        else:
            print("recording. hold the deadman, spin the wheels up, then kill the link.")
        print("Ctrl+C once the wheels have stopped.\n")

    def _kill_later(self, delay):
        """Drop the Bluetooth link on a timer.

        Holding the PS button does not work while sticks and buttons are active, and
        walking out of range measures the BT supervision timeout on top of what we
        want. A disconnect reaches ROS by the identical path - joy stops getting
        events, /joy stops publishing - and it happens hands-free at a known moment
        while someone is holding the car.
        """
        mac, name = connected_pad()
        if not mac:
            print("  NO CONNECTED PAD - connect one before using --kill-after.\n")
            return
        print(f"  will disconnect {name} ({mac}) in {delay}s.")
        print("  HOLD L1 AND SPIN THE WHEELS UP NOW.\n")

        def run():
            for left in range(delay, 0, -1):
                print(f"    dropping link in {left}…", flush=True)
                time.sleep(1)
            self._add("link_kill_requested", 1.0)
            subprocess.run(["bluetoothctl", "disconnect", mac],
                           capture_output=True, text=True, timeout=10, check=False)
            print("\n  link dropped. let the wheels stop, then Ctrl+C.")
        threading.Thread(target=run, daemon=True).start()

    def _add(self, channel, value):
        self.events.append((time.time(), channel, float(value)))

    # /joy publishes continuously while a pad is connected, so its LAST message is
    # the moment the link dropped - measured at 17 ms after a bluetoothctl
    # disconnect on robot #2. The value recorded is the deadman (L1 = buttons[4],
    # from joy_teleop.yaml) so the CSV shows whether it was held at the end.
    def _joy(self, m):
        self._add("joy", float(m.buttons[4]) if len(m.buttons) > 4 else 0.0)

    def _teleop(self, m):
        self._add("teleop", m.drive.speed)

    def _cmd(self, m):
        self._add("ackermann_cmd", m.drive.speed)

    def _motor(self, m):
        self._add("motor_speed", m.data)

    def _vesc(self, m):
        self._add("vesc_erpm", m.state.speed)

    def _odom(self, m):
        self._add("odom_speed", m.twist.twist.linear.x)

    def _servo(self, m):
        self._add("servo", m.data)


def self_test():
    # The shape measured on robot #2, 2026-09-16: bluetoothctl disconnect at t=0,
    # /joy gone 17 ms later, the rest of the chain within another 1 ms, wheels
    # coasting for 281 ms. The trailing /teleop and /ackermann_cmd carry speed 0.0,
    # which is what broke the first version.
    ev = [(0.0, "link_kill_requested", 1.0),
          (0.017, "joy", 1.0), (0.017, "teleop", 0.0),
          (0.018, "ackermann_cmd", 0.0), (0.018, "motor_speed", 0.0),
          (0.1, "vesc_erpm", 3000.0), (0.2, "odom_speed", 1.10),
          (0.299, "vesc_erpm", 40.0)]
    lines, iv = summarise(ev)
    body = "\n".join(lines)
    assert "STAYED CONNECTED" not in body, body
    assert abs(iv["disconnect requested -> /joy stopped"] - 0.017) < 1e-6, body
    assert abs(iv["TOTAL: disconnect requested -> wheels stopped"] - 0.299) < 1e-6, body
    assert "pass-through" in body, body
    assert "1.10 m/s" in body, body
    assert all(v >= 0 for v in iv.values()), f"negative interval: {iv}"

    # Same run without --kill-after: the pad died, so /joy is silent to the end.
    died = [(t - 0.017, c, v) for t, c, v in ev[1:]] + [(2.0, "vesc_erpm", 0.0)]
    body = "\n".join(summarise(died)[0])
    assert "STAYED CONNECTED" not in body, body
    assert "link lost -> last drive command" in body, body

    # A pad still publishing at the end means the operator let go. Different
    # measurement, reported as such, and never as a negative interval.
    held = [(0.0, "teleop", 2.0), (0.001, "ackermann_cmd", 2.0),
            (0.0012, "motor_speed", 3000.0), (0.5, "vesc_erpm", 0.0),
            (0.6, "joy", 1.0)]
    lines, iv = summarise(held)
    body = "\n".join(lines)
    assert "STAYED CONNECTED" in body, body
    assert all(v >= 0 for v in iv.values()), f"negative interval: {iv}"

    # Wheels never stop inside the capture: report it, never invent a number.
    lines, iv = summarise(ev[:5])
    assert "wheels never reached zero" in "\n".join(lines)
    assert "TOTAL: disconnect requested -> wheels stopped" not in iv

    # Something buffering the command must be flagged, not quietly accepted.
    slow = [(0.0, "link_kill_requested", 1.0), (0.01, "joy", 1.0),
            (0.02, "ackermann_cmd", 0.0), (2.0, "motor_speed", 0.0),
            (2.1, "vesc_erpm", 0.0)]
    assert "investigate" in "\n".join(summarise(slow)[0])
    print("summarise self-test passed")


def main():
    if "--self-test" in sys.argv:
        return self_test()
    kill_after = None
    if "--kill-after" in sys.argv:
        i = sys.argv.index("--kill-after") + 1
        nxt = sys.argv[i] if i < len(sys.argv) else ""
        kill_after = int(nxt) if nxt.isdigit() else 5

    rclpy.init()
    node = EstopCapture(kill_after)
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass

    events = node.events
    node.destroy_node()
    if rclpy.ok():
        rclpy.shutdown()

    out = f"estop_{time.strftime('%Y%m%d_%H%M%S')}.csv"
    with open(out, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["wall_time", "channel", "value"])
        w.writerows(events)

    print(f"\n{len(events)} events -> {out}\n")
    if not events:
        print("  nothing recorded. Was bringup running?")
        return
    if not any(c == "motor_speed" for _, c, _ in events):
        print("  THE CAR NEVER DROVE. No /commands/motor/speed was published at all, so")
        print("  the deadman was never held and there is nothing to measure. Hold L1 and")
        print("  spin the wheels up, THEN let the link drop.\n")
    for line in summarise(events)[0]:
        print(line)
    print("\n  Run it a second time. One sample of a safety number is not a measurement.")


if __name__ == "__main__":
    main()
