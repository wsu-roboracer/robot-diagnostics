# Orin Nano Diagnostics HAT (KiCad 10)

> **DRAFT (rev 0.1).** Don't order boards from these files yet. The schematic and PCB are still being designed: the PCB isn't routed, and its outline, header position and mounting holes haven't been measured against the dev kit. See [Board status and open items](#board-status-and-open-items).

A board that plugs into the Jetson Orin Nano dev kit's 40-pin header (J12). It has 10 status LEDs, an 8×8 LED matrix for showing obstacles, and one user button. A battery voltmeter with a 7-segment display will be added later.

| File | Contents |
|---|---|
| `orin_hat_diag.kicad_sch` | Main sheet: header, button, LED data buffer, status LEDs |
| `led_matrix.kicad_sch` | The 8×8 obstacle matrix |
| `orin_hat_diag.kicad_pcb` | Board, 105 × 70 mm, 2 layers. Parts are placed but **not yet routed** |

Driver code: [`prototype/hat_leds.py`](../../../prototype/hat_leds.py). Battery voltmeter / 7-segment display driver (skeleton, no hardware chosen yet): [`prototype/hat_battery.py`](../../../prototype/hat_battery.py). Obstacle matrix driver, reading `/scan` onto the 8x8 grid (skeleton): [`prototype/hat_obstacle_matrix.py`](../../../prototype/hat_obstacle_matrix.py).

## Header pin assignments

Pin numbers are physical (BOARD) numbers on the Orin's 40-pin header.

| Pin | Orin function | HAT signal | Direction | Used for |
|---|---|---|---|---|
| 19 | SPI0_MOSI (`/dev/spidev0.0`) | `SPI0_MOSI` | Orin → HAT | LED data. Goes through a 74AHCT1G125 3.3 V→5 V buffer to D1 |
| 29 | GPIO01 | `BTN1` | HAT → Orin | User button. Active low, pulled up to 3.3 V, debounced |
| 2, 4 | 5 V | `+5V` | power | LEDs and the buffer |
| 1, 17 | 3.3 V | `+3V3` | power | Button pull-up only |
| 6, 9, 14, 20, 25, 30, 34, 39 | GND | `GND` | — | |
| 3, 5 | I2C7 SDA/SCL | — | reserved | Future link to the battery voltmeter microcontroller |

The other pins are not connected.

## How the LEDs are driven

All 74 LEDs are WS2812B addressable RGB LEDs on **one data line**. They are individually controlled, not multiplexed or scanned:

- Each LED contains its own small driver chip that stores a 24-bit colour.
- The Orin sends the colours for the whole chain as one burst on pin 19. Each LED keeps the first colour it receives and passes the rest to the next LED.
- After the burst, every LED holds its colour until the next update. The Orin doesn't need to refresh them, and any LED can be set to any colour on its own.

So the code needs one SPI pin, and it addresses LEDs by their **position in the chain**:

| Chain index | Parts | What it is |
|---|---|---|
| 0–9 | D1–D10 (5050 size) | Status LEDs, numbered 0–9 on the silkscreen. Each one is free to assign to a system |
| 10–73 | D101–D164 (2020 size) | Obstacle matrix. `index = 10 + row*8 + col`. Row 0 is the row marked **FRONT**, column 0 is on the left |

```
          col 0  1  2  3  4  5  6  7          (FRONT)
row 0        10 11 12 13 14 15 16 17
row 1        18 19 20 21 22 23 24 25
  ...
row 7        66 67 68 69 70 71 72 73
```

```python
from hat_leds import HatLeds, GREEN, RED
leds = HatLeds(brightness=0.25)
leds.set_status(0, GREEN)        # status LED 0
leds.set_matrix(0, 3, RED)       # obstacle ahead, slightly left of centre
leds.show()                      # nothing changes on the board until show()
```

## Orin setup (once)

1. `sudo /opt/nvidia/jetson-io/jetson-io.py`: enable **SPI1** (pins 19/21/23/24/26), then reboot. After the reboot, `/dev/spidev0.0` should exist.
2. `sudo apt install python3-spidev`
3. For the button: `sudo usermod -aG gpio $USER`, then log out and back in. `Jetson.GPIO` is preinstalled on JetPack.
4. `python3 prototype/hat_leds.py --demo`

## Power budget

Full white on all 74 LEDs draws roughly 3 A, which is more than the header's 5 V pins should supply. `hat_leds.py` scales colours down to stay under `CURRENT_LIMIT_MA` (1000 mA, **provisional**) and defaults to 25 % brightness. Confirm the dev kit's 5 V limit on pins 2/4 before raising this. If the board needs to be brighter, it needs its own 5 V input.

## Board status and open items

- [ ] **Measure the dev kit with calipers.** The outline, the J1 position and the M2.5 mounting holes are provisional. Check that the board clears the heatsink fan.
- [ ] J1 is a 2×20 female socket on the **bottom** of the board, with LEDs on top. Confirm pin 1 lines up with the Orin's pin 1 once the outline is measured.
- [ ] Route the board. The bottom layer is a GND pour, so route 5 V and data on top. The data chain runs D1→D10, then from D10 to D101 at the top-left of the matrix.
- [ ] Battery voltmeter and 7-segment display: the boxed area on the `User.Drawings` layer is kept free for them. Pick the ADC/fuel-gauge chip and the display driver chip, then fill in `BATTERY_I2C_ADDR` / `DISPLAY_I2C_ADDR` and the two stub methods in `hat_battery.py`.
- [ ] Hardware bring-up: scope pin 19 and check the line idles low between frames. The driver sends a low byte first in case it doesn't.
- [ ] Confirm the HAT's mounting orientation on the chassis (which way FRONT actually faces once installed). `hat_obstacle_matrix.py` only maps the forward 180 degrees of the LiDAR's 270 degree field for now; it needs this to cover the rest.
