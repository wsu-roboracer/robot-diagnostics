#!/usr/bin/env python3
"""Drive the diagnostics HAT's LEDs from the Orin Nano.

The HAT has 74 WS2812B addressable RGB LEDs on ONE data line. They are not
multiplexed and need no row/column scanning: every LED has its own driver chip
that latches a 24-bit colour and holds it until the next update. The Orin sends
the whole chain's colours as one burst on SPI0 MOSI (header pin 19); each LED
keeps the first 24 bits it sees and passes the rest down the chain.

    chain index 0-9    status LEDs D1-D10 (user-defined "system live" lights)
    chain index 10-73  8x8 obstacle matrix D101-D164, raster order:
                       index = 10 + row*8 + col, row 0 = the row marked FRONT

The user button is on header pin 29 (GPIO01), active low.

Setup on the Orin (once):
    sudo /opt/nvidia/jetson-io/jetson-io.py   # enable SPI1 on pins 19,21,23,24,26, reboot
    ls /dev/spidev0.0                          # must exist after the reboot
    sudo apt install python3-spidev            # or: pip3 install spidev
    sudo usermod -aG gpio $USER                # for the button, then log out/in

    python3 hat_leds.py --demo                 # status chase + matrix sweep
    python3 hat_leds.py --off
"""

import sys
import time

N_STATUS = 10
MATRIX_ROWS = MATRIX_COLS = 8
N_LEDS = N_STATUS + MATRIX_ROWS * MATRIX_COLS
SPI_BUS, SPI_DEV = 0, 0                 # /dev/spidev0.0 = header pins 19/21/23/24/26
BUTTON_PIN = 29                         # BOARD numbering (GPIO01)

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

OFF = (0, 0, 0)
GREEN, YELLOW, RED, BLUE = (0, 255, 0), (255, 160, 0), (255, 0, 0), (0, 0, 255)


def status_index(i):
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


def button_pressed():
    """True while the HAT's user button is held. Needs Jetson.GPIO."""
    import Jetson.GPIO as GPIO
    GPIO.setmode(GPIO.BOARD)
    GPIO.setup(BUTTON_PIN, GPIO.IN)     # pulled up on the HAT (R1), pressed = low
    return GPIO.input(BUTTON_PIN) == GPIO.LOW


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


def main():
    if "--off" in sys.argv:
        return HatLeds().close()
    if "--demo" in sys.argv:
        return demo()
    print(__doc__)


if __name__ == "__main__":
    main()
