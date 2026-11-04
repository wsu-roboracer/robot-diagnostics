#!/usr/bin/env python3
"""Battery voltmeter + 7-segment display for the diagnostics HAT (SKELETON).

Not built yet. The PCB only reserves a boxed area on the User.Drawings layer
for this (see diagnostic-hardware/pcb/orin_hat_diag/README.md), and no pins
are assigned: I2C7 (header pins 3/5 SDA/SCL) is reserved for it but which chip
reads the battery and which drives the display is still undecided. This file
exists so the display math (what digits a voltage turns into) can be written
and tested now, before the hardware is chosen, and so the real driver has a
known shape to fill in.

Planned flow once hardware is picked:
    1. Read the battery voltage over I2C7 (an ADC, or a fuel-gauge chip -
       whichever is chosen determines READ_FN in BatteryDisplay.read_volts).
    2. format_volts() turns that into four 7-segment digit patterns.
    3. A display driver (likely an HT16K33-style I2C backpack) writes those
       patterns to the digits - that write is WRITE_FN, also a TODO.
"""

I2C_BUS = 7                   # I2C7: header pins 3 (SDA) / 5 (SCL) - TODO confirm once wired
BATTERY_I2C_ADDR = None       # TODO: set once the ADC/fuel-gauge chip is chosen
DISPLAY_I2C_ADDR = None       # TODO: set once the 7-seg driver chip is chosen

MIN_VOLTS = 0.0
MAX_VOLTS = 99.99              # four digits, two past the decimal point: D D . D D

# Classic 7-segment bit order: bit0=A (top), bit1=B, bit2=C, bit3=D (bottom),
# bit4=E, bit5=F, bit6=G (middle), bit7=decimal point. Matches HT16K33-style
# backpacks, the common case for an I2C 7-segment display.
_DIGIT_SEGMENTS = {
    0: 0b00111111, 1: 0b00000110, 2: 0b01011011, 3: 0b01001111,
    4: 0b01100110, 5: 0b01101101, 6: 0b01111101, 7: 0b00000111,
    8: 0b01111111, 9: 0b01101111,
}
DP = 0b10000000


def format_volts(volts):
    """Battery volts -> four segment-pattern bytes, e.g. 12.34 V -> "12.34".

    Raises ValueError outside MIN_VOLTS..MAX_VOLTS rather than drawing a
    silently wrong number on the HAT.
    """
    if not MIN_VOLTS <= volts <= MAX_VOLTS:
        raise ValueError(f"{volts} V out of display range {MIN_VOLTS}-{MAX_VOLTS}")
    hundredths = round(volts * 100)
    digits = [hundredths // 1000 % 10, hundredths // 100 % 10,
              hundredths // 10 % 10, hundredths % 10]
    patterns = [_DIGIT_SEGMENTS[d] for d in digits]
    patterns[1] |= DP                 # decimal point after the second digit
    return patterns


class BatteryDisplay:
    """Reads the battery voltage and shows it on the 7-segment display.

    Both the read and the write are stubs until the hardware is chosen -
    calling them raises NotImplementedError rather than guessing a protocol.
    """

    def __init__(self):
        if BATTERY_I2C_ADDR is None or DISPLAY_I2C_ADDR is None:
            raise NotImplementedError(
                "hat_battery: no hardware chosen yet - set BATTERY_I2C_ADDR "
                "and DISPLAY_I2C_ADDR once the voltmeter/display chips are picked"
            )
        import smbus2                 # only needed once real hardware exists
        self.bus = smbus2.SMBus(I2C_BUS)

    def read_volts(self):
        raise NotImplementedError("read_volts: depends on which ADC/fuel-gauge chip is chosen")

    def show(self, volts):
        self.write_patterns(format_volts(volts))

    def write_patterns(self, patterns):
        raise NotImplementedError("write_patterns: depends on which display driver chip is chosen")

    def close(self):
        self.bus.close()


def main():
    print(__doc__)


if __name__ == "__main__":
    main()
