#!/usr/bin/env python3
"""Show the Orin's IP addresses on the diagnostics HAT's OLED when a button is pressed.

Display: 0.91" 128x32 SSD1306 OLED module on the HAT's J2 header, I2C7 = header pins
3 (SDA) / 5 (SCL) = /dev/i2c-7, address 0x3C. Four lines of about 21 characters.

Setup on the Orin (once):
    sudo apt install python3-pil
    pip3 install luma.oled
    sudo usermod -aG i2c,gpio $USER           # then log out/in
    i2cdetect -y -r 7                          # the module should show up at 3c

    python3 hat_display.py --self-test         # no hardware needed
    python3 hat_display.py --show-ip           # show the addresses once (10 s)
    python3 hat_display.py --watch             # press SW2 to show them (Ctrl-C to stop)

The screen blanks again after SHOW_SECONDS so the OLED doesn't burn in. If the text comes out
upside down (it depends on which way the module's pins face), add --rotate 2.
"""

import argparse
import socket
import subprocess
import sys
import time

from hat_leds import BUTTON_PINS

I2C_PORT, I2C_ADDRESS = 7, 0x3C
WIDTH, HEIGHT = 128, 32
LINES, COLS = 4, 21                       # luma's default font is 6x8 px
SHOW_SECONDS = 10
IP_BUTTON = 2                             # SW2, header pin 15


def parse_ip_addr(text):
    """`ip -4 -o addr show` output -> [(interface, address)], loopback and docker bridges skipped."""
    out = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) < 4 or parts[2] != "inet":
            continue
        name, addr = parts[1], parts[3].split("/")[0]
        if name == "lo" or name.startswith(("docker", "br-", "veth")):
            continue
        out.append((name, addr))
    return out


def ip_addresses():
    try:
        text = subprocess.run(["ip", "-4", "-o", "addr", "show"], capture_output=True, text=True,
                              timeout=2).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    return parse_ip_addr(text)


def ip_lines(hostname, addrs):
    """Fit the hostname and up to three interfaces into the screen's 4 x 21 characters."""
    lines = [hostname[:COLS]]
    if not addrs:
        lines.append("no IPv4 address")
    for name, addr in addrs[:LINES - 1]:
        room = COLS - len(addr) - 1
        lines.append(("%-*s %s" % (room, name[:room], addr)) if room > 0 else addr[:COLS])
    return lines


class HatDisplay:
    def __init__(self, port=I2C_PORT, address=I2C_ADDRESS, rotate=0):
        from luma.core.interface.serial import i2c   # only needed on the Orin
        from luma.oled.device import ssd1306
        self.device = ssd1306(i2c(port=port, address=address), width=WIDTH, height=HEIGHT, rotate=rotate)
        self.device.clear()

    def show_lines(self, lines):
        from luma.core.render import canvas
        with canvas(self.device) as draw:
            for i, line in enumerate(lines[:LINES]):
                draw.text((0, i * 8), line, fill="white")

    def clear(self):
        self.device.clear()


def show_ip(display, seconds=SHOW_SECONDS):
    display.show_lines(ip_lines(socket.gethostname(), ip_addresses()))
    time.sleep(seconds)
    display.clear()


def watch(display, button=IP_BUTTON):
    """Show the IP addresses each time `button` is pressed. Buttons are active low."""
    import Jetson.GPIO as GPIO
    pin = BUTTON_PINS[button]
    GPIO.setmode(GPIO.BOARD)
    GPIO.setup(pin, GPIO.IN)
    print("press SW%d (header pin %d) to show the IP addresses; Ctrl-C to stop" % (button, pin))
    try:
        while True:
            if GPIO.input(pin) == GPIO.LOW:
                show_ip(display)
                while GPIO.input(pin) == GPIO.LOW:        # wait for release
                    time.sleep(0.02)
            time.sleep(0.05)
    finally:
        display.clear()
        GPIO.cleanup(pin)


def self_test():
    """`python3 hat_display.py --self-test` - no Orin, no display, no luma."""
    sample = ("1: lo    inet 127.0.0.1/8 scope host lo\\       valid_lft forever\n"
              "3: wlan0    inet 192.168.1.42/24 brd 192.168.1.255 scope global dynamic wlan0\n"
              "4: docker0    inet 172.17.0.1/16 brd 172.17.255.255 scope global docker0\n"
              "5: eth0    inet 10.0.0.5/24 brd 10.0.0.255 scope global eth0\n")
    addrs = parse_ip_addr(sample)
    assert addrs == [("wlan0", "192.168.1.42"), ("eth0", "10.0.0.5")], addrs
    lines = ip_lines("roboracer-orin", addrs)
    assert lines[0] == "roboracer-orin" and lines[1].startswith("wlan0") and lines[1].endswith("192.168.1.42")
    assert all(len(line) <= COLS for line in lines), lines
    long = ip_lines("x" * 40, [("enP8p1s0-very-long", "255.255.255.255")] * 5)
    assert len(long) == LINES and all(len(line) <= COLS for line in long), long
    assert ip_lines("orin", []) == ["orin", "no IPv4 address"]
    assert BUTTON_PINS[IP_BUTTON] == 15
    print("display self-test passed")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--self-test", action="store_true")
    mode.add_argument("--show-ip", action="store_true", help="show the IP addresses once")
    mode.add_argument("--watch", action="store_true", help="show the IP addresses when the button is pressed")
    ap.add_argument("--button", type=int, default=IP_BUTTON, choices=sorted(BUTTON_PINS))
    ap.add_argument("--port", type=int, default=I2C_PORT, help="I2C bus (default 7 = header pins 3/5)")
    ap.add_argument("--address", type=lambda v: int(v, 0), default=I2C_ADDRESS)
    ap.add_argument("--rotate", type=int, default=0, choices=(0, 2), help="2 = upside down")
    args = ap.parse_args()
    if args.self_test:
        self_test()
        return 0
    display = HatDisplay(args.port, args.address, args.rotate)
    if args.show_ip:
        show_ip(display)
    else:
        watch(display, args.button)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(0)
