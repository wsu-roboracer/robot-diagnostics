#!/usr/bin/env python3
"""Show live /diagnostics health on the HAT's 10 status LEDs (SKELETON).

Needs a sourced ROS 2 install and hat_leds.py's hardware (SPI) to run for
real; neither is needed for --self-test, which only checks the pure mapping
from diagnostic statuses to LED colours.

/diagnostics already carries everything this needs - system_diagnostics.py
publishes "system: Camera", "system: Network", "system: VESC device",
"system: Power" and "system: Gamepad" once a second, and urg_node publishes
its own LiDAR entries into the same array. This just reads that array and
lights a fixed LED per subsystem; it adds no new sensing of its own.

LED assignment (D1-D10 on the silkscreen = chain index 0-9):

    0  LiDAR        urg_node's own diagnostics (name starts "urg_node")
    1  Camera       "system: Camera"
    2  Network      "system: Network"  (the Orin's own link, not rosbridge clients)
    3  VESC         "system: VESC device"
    4  Battery      "system: Power"
    5  Gamepad      "system: Gamepad"
    6-9 free        left alone here - for whatever a future student wires up next

Colour per DiagnosticStatus.level: OK green, WARN amber, ERROR and STALE red
(the dashboard's reading-the-page table calls STALE a real problem, same as
ERROR). A subsystem with no entry yet in the array stays off rather than
guessing a colour.

    python3 hat_status_leds.py --self-test   # no ROS, no hardware
    python3 hat_status_leds.py                # subscribes to /diagnostics, needs both
"""

import sys

try:
    import rclpy
    from diagnostic_msgs.msg import DiagnosticArray
    from rclpy.node import Node
except ImportError:
    # --self-test only exercises diagnostics_to_colours(), the pure part worth
    # checking without a sourced ROS install (see system_diagnostics.py for the same pattern).
    if "--self-test" not in sys.argv:
        raise
    Node = object

from hat_leds import GREEN, OFF, RED, YELLOW

OK, WARN, ERROR, STALE = 0, 1, 2, 3        # diagnostic_msgs/DiagnosticStatus levels

LEVEL_COLOUR = {OK: GREEN, WARN: YELLOW, ERROR: RED, STALE: RED}

PROGRAMMABLE_LEDS = range(6, 10)           # not touched by this module - left for later use

# (LED index, exact name) for the fixed assignments, except LiDAR which matches
# by prefix since urg_node publishes several differently-named entries.
FIXED_NAMES = {
    1: "system: Camera",
    2: "system: Network",
    3: "system: VESC device",
    4: "system: Power",
    5: "system: Gamepad",
}
LIDAR_LED = 0
LIDAR_NAME_PREFIX = "urg_node"


def _level_int(level):
    """DiagnosticStatus.level arrives as a 1-byte `bytes` over rclpy, not an int."""
    if isinstance(level, bytes):
        return level[0]
    return int(level)


def diagnostics_to_colours(statuses):
    """[{"name": str, "level": int|bytes}, ...] -> {led_index: (r, g, b)}.

    Pure function so it can be checked with plain dicts, no DiagnosticArray
    message type and no hardware - same reasoning scan_to_grid() uses in
    hat_obstacle_matrix.py. Only returns entries for subsystems actually seen
    in `statuses`; a missing subsystem is left for the caller to leave off.
    """
    colours = {}
    for entry in statuses:
        name = entry["name"]
        level = _level_int(entry["level"])

        if name.startswith(LIDAR_NAME_PREFIX):
            colours[LIDAR_LED] = LEVEL_COLOUR.get(level, OFF)
            continue

        for led, wanted_name in FIXED_NAMES.items():
            if name == wanted_name:
                colours[led] = LEVEL_COLOUR.get(level, OFF)
                break

    return colours


class StatusLedsNode(Node):
    def __init__(self, leds):
        super().__init__("hat_status_leds")
        self.leds = leds
        self.create_subscription(DiagnosticArray, "/diagnostics", self.on_diagnostics, 10)

    def on_diagnostics(self, msg):
        statuses = [{"name": s.name, "level": s.level} for s in msg.status]
        for led, colour in diagnostics_to_colours(statuses).items():
            self.leds.set_status(led, colour)
        self.leds.show()


def self_test():
    """`python3 hat_status_leds.py --self-test` - no ROS, no hardware."""
    colours = diagnostics_to_colours([
        {"name": "urg_node: Laser Scan topic status", "level": bytes([OK])},
        {"name": "system: Camera", "level": bytes([WARN])},
        {"name": "system: Network", "level": bytes([ERROR])},
        {"name": "system: VESC device", "level": bytes([STALE])},
        {"name": "system: Power", "level": OK},             # plain int is also accepted
        {"name": "system: Thermal", "level": ERROR},         # not one of the six - ignored
    ])
    assert colours[LIDAR_LED] == GREEN
    assert colours[1] == YELLOW, "Camera WARN should be amber"
    assert colours[2] == RED, "Network ERROR should be red"
    assert colours[3] == RED, "VESC STALE counts as a real problem, same as ERROR"
    assert colours[4] == GREEN
    assert 5 not in colours, "Gamepad never reported - must stay off, not guessed"
    assert "system: Thermal" not in FIXED_NAMES.values(), "Thermal has no LED assigned"
    print("diagnostics-to-colour mapping self-test passed")

    assert not (set(colours) & set(PROGRAMMABLE_LEDS)), "must never touch the 4 free LEDs"
    print("programmable-LED isolation self-test passed")

    assert diagnostics_to_colours([]) == {}, "no diagnostics yet -> nothing lit"
    print("empty-diagnostics self-test passed")


def main():
    if "--self-test" in sys.argv:
        return self_test()
    from hat_leds import HatLeds
    rclpy.init()
    leds = HatLeds()
    node = StatusLedsNode(leds)
    try:
        rclpy.spin(node)
    finally:
        leds.close()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
