#!/usr/bin/env python3
"""Drive the diagnostics HAT's LEDs from the Orin Nano.

The HAT has 74 WS2812B addressable RGB LEDs on ONE data line. They are not
multiplexed and need no row/column scanning: every LED has its own driver chip
that latches a 24-bit colour and holds it until the next update. The Orin sends
the whole chain's colours as one burst on SPI0 MOSI (header pin 19); each LED
keeps the first 24 bits it sees and passes the rest down the chain.

    chain index 0-9    status LEDs D1-D10 ("system live" lights). The first row
                       is named on the silkscreen (issue #64): 0 LiDAR, 1 Camera,
                       2 Network, 3 VESC, 4 Gamepad. 5-9 are still user-defined.
    chain index 10-73  8x8 obstacle matrix D101-D164, raster order:
                       index = 10 + row*8 + col, row 0 = the row marked FRONT

Six user buttons, all active low (pulled up to 3.3 V on the HAT, RC debounced):
SW1 pin 29 (on the arm), SW2-SW6 pins 15, 13, 12, 11, 7 (the row on the strip, left to right).

Setup on the Orin (once):
    sudo /opt/nvidia/jetson-io/jetson-io.py   # enable SPI1 on pins 19,21,23,24,26, reboot
    ls /dev/spidev0.0                          # must exist after the reboot
    sudo apt install python3-spidev            # or: pip3 install spidev
    sudo usermod -aG gpio $USER                # for the buttons, then log out/in

    python3 hat_leds.py --self-test            # no hardware needed
    python3 hat_leds.py --demo                 # status chase + matrix sweep
    python3 hat_leds.py --off
"""

import sys
import time

N_STATUS = 10
MATRIX_ROWS = MATRIX_COLS = 8
N_LEDS = N_STATUS + MATRIX_ROWS * MATRIX_COLS
SPI_BUS, SPI_DEV = 0, 0                 # /dev/spidev0.0 = header pins 19/21/23/24/26
# User buttons -> header pin (BOARD numbering). In jetson-io, leave the second SPI bus
# (pins 13/16/18/22/37) and I2S (pins 12/35/38/40) off, or pins 13 and 12 stop being GPIOs.
BUTTON_PINS = {1: 29, 2: 15, 3: 13, 4: 12, 5: 11, 6: 7}
BUTTON_PIN = BUTTON_PINS[1]             # GPIO01, kept for older callers

# One WS2812 bit per SPI byte at 6.4 MHz (156 ns per SPI bit). Every pattern
# ends low, so a gap the Tegra SPI controller inserts between bytes only
# stretches a low period, which the LEDs tolerate. A 3-bits-per-bit encoding
# packs tighter but lets a gap land mid-pulse and flip a 0 into a 1.
SPI_HZ = 6_400_000
BIT0 = 0b11000000                       # 312 ns high  (spec 250-550 ns)
BIT1 = 0b11111000                       # 781 ns high  (spec 650-950 ns)
RESET_BYTES = 240                       # 300 us low latches the colours (WS2812B-V5 needs >280 us)

# Header 5 V budget. PROVISIONAL until the Orin Nano carrier's 5 V limit on
# pins 2/4 is confirmed; full white on all 74 LEDs would be roughly 3 A.
CURRENT_LIMIT_MA = 1000
MA_PER_CHANNEL = [20.0] * N_STATUS + [12.0] * (N_LEDS - N_STATUS)   # 5050 vs 2020 parts
IDLE_MA_PER_LED = 1.0

# First row of status LEDs, as printed on the silkscreen (names from issue #64).
#   LiDAR    urg_node's own diagnostics (names starting "urg_node")
#   Camera   "system: Camera"
#   Network  "system: Network"  (the Orin's own link, not rosbridge clients)
#   VESC     "system: VESC device"
#   Gamepad  "system: Gamepad"
STATUS_NAMES = {"LiDAR": 0, "Camera": 1, "Network": 2, "VESC": 3, "Gamepad": 4}

OFF = (0, 0, 0)
GREEN, YELLOW, RED, BLUE = (0, 255, 0), (255, 160, 0), (255, 0, 0), (0, 0, 255)


def status_index(i):
    """Chain index of status LED `i`: a number 0-9 or a name from STATUS_NAMES (any case)."""
    if isinstance(i, str):
        names = {k.lower(): v for k, v in STATUS_NAMES.items()}
        if i.lower() not in names:
            raise KeyError(f"unknown status LED {i!r}; named ones are {', '.join(STATUS_NAMES)}")
        return names[i.lower()]
    if not 0 <= i < N_STATUS:
        raise IndexError(f"status LED {i} out of range 0-{N_STATUS - 1}")
    return i


def matrix_index(row, col):
    if not (0 <= row < MATRIX_ROWS and 0 <= col < MATRIX_COLS):
        raise IndexError(f"matrix cell ({row}, {col}) out of range")
    return N_STATUS + row * MATRIX_COLS + col


def estimate_ma(pixels):
    total = IDLE_MA_PER_LED * len(pixels)
    for (r, g, b), ma in zip(pixels, MA_PER_CHANNEL):
        total += (r + g + b) / 255.0 * ma
    return total


def limit_current(pixels, limit_ma=CURRENT_LIMIT_MA):
    """Scale every colour down together until the estimate fits the 5 V budget."""
    idle = IDLE_MA_PER_LED * len(pixels)
    drawn = estimate_ma(pixels) - idle
    if drawn <= 0 or drawn + idle <= limit_ma:
        return list(pixels)
    k = max(0.0, (limit_ma - idle) / drawn)
    return [(int(r * k), int(g * k), int(b * k)) for r, g, b in pixels]


def encode(pixels):
    """RGB tuples -> SPI byte stream. WS2812 wants green, red, blue, MSB first."""
    out = bytearray([0])                # leading low byte: line settles before bit 1
    for r, g, b in pixels:
        for byte in (g, r, b):
            for bit in range(7, -1, -1):
                out.append(BIT1 if byte >> bit & 1 else BIT0)
    out.extend(bytes(RESET_BYTES))
    return bytes(out)


class HatLeds:
    def __init__(self, brightness=0.25):
        import spidev                   # only needed on the Orin
        self.spi = spidev.SpiDev()
        self.spi.open(SPI_BUS, SPI_DEV)
        self.spi.max_speed_hz = SPI_HZ
        self.spi.mode = 0
        self.brightness = brightness
        self.pixels = [OFF] * N_LEDS

    def set_status(self, i, rgb):
        self.pixels[status_index(i)] = rgb

    def set_matrix(self, row, col, rgb):
        self.pixels[matrix_index(row, col)] = rgb

    def fill(self, rgb):
        self.pixels = [rgb] * N_LEDS

    def show(self):
        k = self.brightness
        scaled = [(int(r * k), int(g * k), int(b * k)) for r, g, b in self.pixels]
        self.spi.writebytes2(encode(limit_current(scaled)))

    def close(self):
        self.fill(OFF)
        self.show()
        self.spi.close()


def button_pressed(n=1):
    """True while user button SWn (1-6) is held. Needs Jetson.GPIO."""
    import Jetson.GPIO as GPIO
    GPIO.setmode(GPIO.BOARD)
    pin = BUTTON_PINS[n]
    GPIO.setup(pin, GPIO.IN)            # pulled up on the HAT, pressed = low
    return GPIO.input(pin) == GPIO.LOW


def demo():
    leds = HatLeds()
    try:
        for i in range(N_STATUS):
            leds.set_status(i, (GREEN, YELLOW, RED)[i % 3])
            leds.show()
            time.sleep(0.1)
        for row in range(MATRIX_ROWS):
            for col in range(MATRIX_COLS):
                leds.set_matrix(row, col, BLUE)
            leds.show()
            time.sleep(0.15)
        time.sleep(1.0)
    finally:
        leds.close()


def self_test():
    """`python3 hat_leds.py --self-test` - no Orin, no HAT, no spidev."""
    assert status_index(0) == 0 and status_index(9) == 9
    assert [status_index(n) for n in ("LiDAR", "Camera", "Network", "VESC", "Gamepad")] == [0, 1, 2, 3, 4]
    assert status_index("vesc") == 3
    try:
        status_index("Radar")
        raise AssertionError("unknown name accepted")
    except KeyError:
        pass
    assert matrix_index(0, 0) == 10, "matrix must start right after the 10 status LEDs"
    assert matrix_index(0, 7) == 17 and matrix_index(1, 0) == 18
    assert matrix_index(7, 7) == N_LEDS - 1 == 73
    for bad in ((-1, 0), (8, 0), (0, 8)):
        try:
            matrix_index(*bad)
        except IndexError:
            pass
        else:
            raise AssertionError(f"matrix_index{bad} should raise")
    print("index map self-test passed")

    data = encode([(255, 0, 0x81)])     # red full, green off, blue 1000 0001
    assert data[0] == 0 and len(data) == 1 + 24 + RESET_BYTES
    assert list(data[1:9]) == [BIT0] * 8, "green comes first and is 0"
    assert list(data[9:17]) == [BIT1] * 8, "red second, all ones"
    assert list(data[17:25]) == [BIT1] + [BIT0] * 6 + [BIT1], "blue last, MSB first"
    assert not any(data[25:]), "the reset tail must be all low"
    assert all(b & 0x07 == 0 for b in data), "every byte must end low (gap tolerance)"
    assert len(encode([OFF] * N_LEDS)) < 4096, "must fit one default spidev transfer"
    print("ws2812 encoding self-test passed")

    white = [(255, 255, 255)] * N_LEDS
    assert estimate_ma(white) > 2500
    capped = limit_current(white)
    assert estimate_ma(capped) <= CURRENT_LIMIT_MA, estimate_ma(capped)
    dim = [(10, 0, 0)] * N_LEDS
    assert limit_current(dim) == dim, "colours already inside the budget must not change"
    print("current limit self-test passed")


def main():
    if "--self-test" in sys.argv:
        return self_test()
    if "--off" in sys.argv:
        return HatLeds().close()
    if "--demo" in sys.argv:
        return demo()
    print(__doc__)


if __name__ == "__main__":
    main()
