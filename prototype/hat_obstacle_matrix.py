#!/usr/bin/env python3
"""Show /scan obstacles on the diagnostics HAT's 8x8 LED matrix (SKELETON).

The matrix (chain index 10-73 on hat_leds.py's HatLeds) sits flat on the HAT
with row 0 at the edge silkscreened FRONT. This turns it into a tiny top-down
radar: each column is a 22.5 degree slice of the LiDAR's forward view, each
row is a distance band, and a lit cell is the nearest obstacle in that slice -
red under LIDAR_NEAR, amber under LIDAR_CLOSE, green beyond, same bands the
web dashboard's radar plot uses (prototype/js/metrics.js).

    col 0 (left, +90 deg) ... col 7 (right, -90 deg)      REP-103: angle 0 is
    row 0 (nearest) ... row 7 (farthest / no return)       ahead, +left, CCW

This only covers the forward 180 degrees, half the Hokuyo's 270 degree field -
the HAT sits on top of the Orin facing forward, so a rear slice would need a
"which way is the board actually facing" decision this skeleton doesn't make.
Revisit once the HAT's mounting orientation on the chassis is fixed.

Needs a sourced ROS 2 install and hat_leds.py's hardware (SPI) to run:

    python3 hat_obstacle_matrix.py                # subscribes to /scan
"""

import rclpy
from rclpy.node import Node
from sensor_msgs.msg import LaserScan

from hat_leds import HatLeds, MATRIX_COLS, MATRIX_ROWS, OFF

LIDAR_NEAR = 0.5             # m - red, matches prototype/js/metrics.js
LIDAR_CLOSE = 1.0            # m - amber
GRID_MAX_RANGE = 4.0         # m - beyond this, a column shows nothing lit

FOV_RAD = 3.141592653589793  # 180 degrees, front hemisphere only - see module docstring
COL_RED, COL_AMBER, COL_GREEN = (255, 0, 0), (255, 160, 0), (0, 255, 0)

RANGE_SENTINEL_M = 60.0      # this Hokuyo reports ~65.5 m for "no return", well past range_max


def _valid(value, range_min, range_max):
    return isinstance(value, (int, float)) and value == value and range_min < value < range_max


def _column_for_angle(angle):
    """REP-103 angle (0 ahead, +left) -> matrix column, col 0 = left (+90 deg)."""
    half_fov = FOV_RAD / 2
    clamped = max(-half_fov, min(half_fov, angle))
    frac = (half_fov - clamped) / FOV_RAD        # 0 at +90 deg (left) -> col 0
    return min(MATRIX_COLS - 1, int(frac * MATRIX_COLS))


def _row_for_range(range_m):
    """Nearest obstacle distance -> matrix row, row 0 = nearest."""
    frac = max(0.0, min(1.0, range_m / GRID_MAX_RANGE))
    return min(MATRIX_ROWS - 1, int(frac * MATRIX_ROWS))


def _colour_for_range(range_m):
    if range_m < LIDAR_NEAR:
        return COL_RED
    if range_m < LIDAR_CLOSE:
        return COL_AMBER
    return COL_GREEN


def scan_to_grid(ranges, angle_min, angle_increment, range_min, range_max):
    """LaserScan fields -> 8x8 grid of (r, g, b), one nearest-obstacle cell per column."""
    nearest = [None] * MATRIX_COLS            # closest valid range seen per column

    for i, value in enumerate(ranges):
        if value >= RANGE_SENTINEL_M or not _valid(value, range_min, range_max):
            continue
        angle = angle_min + i * angle_increment
        if abs(angle) > FOV_RAD / 2:
            continue                           # behind the board - out of scope, see docstring
        col = _column_for_angle(angle)
        if nearest[col] is None or value < nearest[col]:
            nearest[col] = value

    grid = [[OFF for _ in range(MATRIX_COLS)] for _ in range(MATRIX_ROWS)]
    for col, range_m in enumerate(nearest):
        if range_m is None or range_m > GRID_MAX_RANGE:
            continue
        grid[_row_for_range(range_m)][col] = _colour_for_range(range_m)
    return grid


def show_grid(leds, grid):
    for row in range(MATRIX_ROWS):
        for col in range(MATRIX_COLS):
            leds.set_matrix(row, col, grid[row][col])
    leds.show()


class ObstacleMatrixNode(Node):
    def __init__(self):
        super().__init__("hat_obstacle_matrix")
        self.leds = HatLeds()
        self.create_subscription(LaserScan, "/scan", self.on_scan, 10)

    def on_scan(self, msg):
        grid = scan_to_grid(msg.ranges, msg.angle_min, msg.angle_increment,
                             msg.range_min, msg.range_max)
        show_grid(self.leds, grid)


def main():
    rclpy.init()
    node = ObstacleMatrixNode()
    try:
        rclpy.spin(node)
    finally:
        node.leds.close()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
