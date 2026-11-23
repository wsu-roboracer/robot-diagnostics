# Orin Nano Diagnostics HAT (KiCad 10)

> **DRAFT (rev 0.1).** Don't order boards from these files yet. The board is fully routed and passes KiCad's design rules check, but it still needs a human review, and the standoff holes need checking against the car's chassis plate. See [Board status and open items](#board-status-and-open-items).

A board for the Jetson Orin Nano dev kit. It has 10 status LEDs, an 8×8 LED matrix for showing obstacles, six user buttons that software can assign to anything, and a small OLED screen (by default it shows the Orin's IP addresses when SW2 is pressed).

The board is **L-shaped** so that it plugs straight onto the Orin's 40-pin header (J12) without a ribbon cable, and stays clear of the CPU heatsink and fan. The idea comes from the student's sketch, `Images/PCB_Hat_Designs/Improved Hat Design (recommended layout).pdf`. The dimensions come from NVIDIA's carrier-board layout (see [Fitting it to the Orin](#fitting-it-to-the-orin)).

- **Strip:** 40 × 116 mm at x 46–86, 1 mm clear of the heatsink. It holds the OLED, the user buttons, the LEDs and the matrix. It overhangs the carrier's port edge by 7 mm, high above the plugs.
- **Arm:** 46 × 24.5 mm along the header band. It ends at y = 16.5, before the module starts at y = 17.2. J1 sits under it, over the header.
- **Ends:** both ends extend 8 mm past the carrier, so the standoff holes sit beside the carrier, not over it.
- **Open area:** the heatsink and fan sit in the open space inside the L, so the airflow isn't blocked.

| File | Contents |
|---|---|
| `orin_hat_diag.kicad_sch` | Main sheet: header, buttons, OLED header, LED data buffer, status LEDs |
| `led_matrix.kicad_sch` | The 8×8 obstacle matrix |
| `orin_hat_diag.kicad_pcb` | L-shaped board, 86 × 116 mm overall, 2 layers, fully routed |

Driver code: [`prototype/hat_leds.py`](../../../prototype/hat_leds.py) (LEDs, buttons) and [`prototype/hat_display.py`](../../../prototype/hat_display.py) (OLED). Skeletons: [`hat_status_leds.py`](../../../prototype/hat_status_leds.py) (`/diagnostics` onto the named status LEDs), [`hat_obstacle_matrix.py`](../../../prototype/hat_obstacle_matrix.py) (`/scan` onto the 8x8 matrix).

## Header pin assignments

Pin numbers are physical (BOARD) numbers on the Orin's 40-pin header. J1 plugs straight onto it, so J1 uses the same numbering.

| Pin | Orin function | HAT signal | Direction | Used for |
|---|---|---|---|---|
| 19 | SPI0_MOSI (`/dev/spidev0.0`) | `SPI0_MOSI` | Orin → HAT | LED data. Goes through a 74AHCT1G125 3.3 V→5 V buffer to D1 |
| 29 | GPIO01 | `BTN1` | HAT → Orin | User button SW1 (on the arm) |
| 15 | GPIO12 | `BTN2` | HAT → Orin | User button SW2 (button row, leftmost) |
| 13 | SPI1_SCK | `BTN3` | HAT → Orin | User button SW3 |
| 12 | I2S0_SCLK | `BTN4` | HAT → Orin | User button SW4 |
| 11 | UART1_RTS | `BTN5` | HAT → Orin | User button SW5 |
| 7 | GPIO09 | `BTN6` | HAT → Orin | User button SW6 (button row, rightmost) |
| 3 | I2C7_SDA (`/dev/i2c-7`) | `I2C7_SDA` | both | OLED data (J2 pin 4). The Orin has the pull-ups |
| 5 | I2C7_SCL | `I2C7_SCL` | Orin → HAT | OLED clock (J2 pin 3) |
| 2, 4 | 5 V | `+5V` | power | LEDs and the buffer |
| 1, 17 | 3.3 V | `+3V3` | power | Button pull-ups and the OLED |
| 6, 9, 14, 20, 25, 30, 34, 39 | GND | `GND` | — | |

The other pins are not connected.

Every button works the same way: active low, a 10k pull-up to 3.3 V, then a 1k + 100 nF RC debounce in front of the header pin. Read them with `hat_leds.button_pressed(n)` for n = 1–6 (`BUTTON_PINS` maps buttons to pins). The silkscreen prints each row button's header pin under it. Pins 13 and 12 are only GPIOs while the second SPI bus and I2S are left off in `jetson-io`.

## How the LEDs are driven

All 74 LEDs are WS2812B addressable RGB LEDs on **one data line**. They are individually controlled, not multiplexed or scanned:

- Each LED contains its own small driver chip that stores a 24-bit colour.
- The Orin sends the colours for the whole chain as one burst on pin 19. Each LED keeps the first colour it receives and passes the rest to the next LED.
- After the burst, every LED holds its colour until the next update. The Orin doesn't need to refresh them, and any LED can be set to any colour on its own.

So the code needs one SPI pin, and it addresses LEDs by their **position in the chain**:

| Chain index | Parts | What it is |
|---|---|---|
| 0–4 | D1–D5 (5050 size) | Status LEDs, top row. Named on the silkscreen (see below) |
| 5–9 | D6–D10 (5050 size) | Status LEDs, second row, numbered 5–9 on the silkscreen. Free to assign to a system |
| 10–73 | D101–D164 (2020 size) | Obstacle matrix. `index = 10 + row*8 + col`. Row 0 is the row marked **FRONT**, column 0 is on the left |

The top-row names come from issue #64. `hat_leds.py` accepts each name in place of its number (`STATUS_NAMES`):

| Index | LED | Silkscreen | Shows the state of |
|---|---|---|---|
| 0 | D1 | LiDAR | `urg_node`'s own diagnostics (names starting "urg_node") |
| 1 | D2 | Camera | "system: Camera" |
| 2 | D3 | Network | "system: Network" (the Orin's own link, not rosbridge clients) |
| 3 | D4 | VESC | "system: VESC device" |
| 4 | D5 | Gamepad | "system: Gamepad" |

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
leds.set_status("LiDAR", GREEN)  # same as set_status(0, GREEN)
leds.set_status(7, GREEN)        # second-row LEDs are still numbered
leds.set_matrix(0, 3, RED)       # obstacle ahead, slightly left of centre
leds.show()                      # nothing changes on the board until show()
```

## OLED screen

J2 is a 1×4 header for a **0.91" 128×32 SSD1306 I2C OLED module** (about 38 × 12 mm, a few dollars, address 0x3C). It solders straight onto J2 and lies across the top of the strip, over the space between the header and the button row.

- **Buy it separately; JLCPCB doesn't assemble it.** Any generic 0.91" 128×32 SSD1306 I2C module with a 4-pin 0.1" header works, for example [ProtoSupplies' white 0.91" module](https://protosupplies.com/product/oled-0-91-128x32-i2c-white-display/) or a DSD TECH 2-pack. Avoid versions with a PH2.0 cable socket (Waveshare) or a different board size (DFRobot DFR0648). Buy a spare; the glass cracks easily.
- **Check the module's pin order before soldering.** J2 is GND, VCC, SCL, SDA from the top, as printed next to it. Most modules match, but some swap GND and VCC.
- It draws about 10–20 mA from 3.3 V.
- `python3 prototype/hat_display.py --watch` shows the hostname and IPv4 addresses for 10 s each time SW2 is pressed, then blanks the screen so it doesn't burn in. `--show-ip` shows them once. If the text is upside down, add `--rotate 2`.
- Setup: `pip3 install luma.oled`, add yourself to the `i2c` group, then `i2cdetect -y -r 7` should show the module at `3c`.

## Orin setup (once)

1. `sudo /opt/nvidia/jetson-io/jetson-io.py`: enable **SPI1** (pins 19/21/23/24/26), then reboot. After the reboot, `/dev/spidev0.0` should exist.
2. `sudo apt install python3-spidev`
3. For the buttons: `sudo usermod -aG gpio $USER`, then log out and back in. `Jetson.GPIO` is preinstalled on JetPack.
4. `python3 prototype/hat_leds.py --demo`

## Power budget

Full white on all 74 LEDs draws roughly 3 A, which is more than the header's 5 V pins should supply. `hat_leds.py` scales colours down to stay under `CURRENT_LIMIT_MA` (1000 mA, **provisional**) and defaults to 25 % brightness. Confirm the dev kit's 5 V limit on pins 2/4 before raising this. If the board needs to be brighter, it needs its own 5 V input.

## Layout

**Arm** (over the header band):
- J1 on the underside, a female 2×20 socket.
- On top, below the header pins: user button SW1 with its pull-up and debounce parts (R1, C1, R2), and the LED data buffer U1 with R3, R4 and C3.

**Strip** (beside the fan), from the top:
1. The OLED header J2 at the right edge; the module covers the strip from the header down to the buttons.
2. User buttons SW2–SW6 in one row at 7.6 mm pitch (six don't fit across the 40 mm strip), labelled SW2–SW6 above. All six buttons are 5.1 × 5.1 mm SMD tactile switches (XKB TS-1187A, LCSC C318884), so JLCPCB places them. SW2–SW6 are turned 90° so their pads run up and down, leaving about 2 mm between neighbours. Under each: its series resistor, debounce cap and pull-up (R10–R14, C4–C8, R5–R9), and the header pin it reads on.
3. Status LEDs in two rows of five: LiDAR, Camera, Network, VESC, Gamepad on top, then 5–9.
4. The 8×8 matrix at 4.5 mm pitch, with **FRONT** marked above row 0.
5. The 5 V bulk capacitor C2, below the matrix.

All the surface-mount parts are on top, so the board can be assembled in one pass. J1 is the only part on the underside. The underside silkscreen credits the team: Weber State University 2026, Alex Stapp, Luke Peterson, Saman Chapagain, Darrin Bracken and Scott Hadzik.

## Fitting it to the Orin

All positions here come from NVIDIA's carrier-board layout (`P3768_A04` in the *Jetson Orin Nano Developer Kit Carrier Board Reference Design Files*, A04, 2023-03-20). They're given in the HAT's frame: the origin is the carrier corner at the pin-39/40 end of the header, x runs along the header, and y runs toward the far edge. NVIDIA's own coordinates convert with x = 62 − y_nv and y = 96 − x_nv.

- **Header (J12):** pin 1 is at (57.13, 2.73) mm and pin 40 at (8.87, 5.27) mm. The odd row is on the board edge. J1 is placed on exactly these points, and the underside silkscreen marks pin 1. The student's sketch had pin 1 about 3 mm too far from the edge.
- **Module, heatsink and fan:** the module (69.6 × 45 mm) covers about x 0–45, y 17–87. That's 6 mm wider than the sketch shows, so the strip starts at x = 46 to stay clear of it.
- **Under the strip:** the USB 3 ports, RJ45 and USB connector run along x ≈ 66–79. They're the reason for the >25 mm height.
- **Mounting holes: the carrier has none free for a HAT.** It only has the module's two M2.5 holes at (3.5, 20.2) and (3.5, 83.8), which are under the heatsink, and three M3 nuts for the M.2 cards, on the underside. The one nut under the HAT, MEC3 at (46.5, 13.7), holds the SSD. **So the HAT stands on M2.5 standoffs down to the car's chassis plate, beside the carrier.** There are **three** standoffs. H1 (4, −4.5) and H2 (82, −4.5) are past the header-side edge, and H4 (82, 104.5) is past the far edge, at the bottom of the strip. A 5 mm hex standoff at each hole clears the carrier outline by 1.6–2.5 mm, and the nearest port is 14 mm away. With J1 on the header also holding the top edge, three points support the board. There's no H3: a fourth hole at the bottom-left of the strip didn't fit next to the camera connector J21.
- **Height:** a socket on the Orin's header gives only about 8.5 mm. To reach the >25 mm needed to clear the ports, stack 40-pin GPIO **stacking risers** (Raspberry Pi style extenders) between the Orin header and J1. Size the standoffs so that the HAT sits level at the height the risers set. The standoffs stand on the chassis plate, not on the carrier, so allow for the carrier's own mounting height when choosing them.

The `User.Comments` layer in the PCB draws the carrier underneath: its outline, the module area, the holes and the connectors.

## Routing

2 layers, 0.2 mm signal tracks, 0.3 mm power stubs, 0.6/0.3 mm vias.

- **Top (F.Cu): a +5V copper fill** over the whole board. The header's +5V pins and every +5V pad join it directly. Each LED's VDD pad also has a short track to its decoupling cap.
- **Bottom (B.Cu): a GND copper fill.** Every top-side GND pad has a short track to a via into it. J1 pins 20 and 30 have short bottom tracks, because there's no room for thermal spokes between neighbouring header pins.
- **LED data chain:** each LED connects to the next with a short top-layer track. The long jumps run on the bottom layer so they don't split the +5V fill: each matrix row's end back to the next row's start, D5→D6, and D10→D101. The chain starts at U1 in the arm and runs down the strip's left edge to D1.
- **User buttons SW2–SW6:** each header pin leaves the header on the bottom layer through the gaps in the inner row of pins, runs along the arm at y 9.5–15.5, then drops down the middle of its button to a via at the series resistor. On top, each switch's two pin-1 pads are joined and jog to the pull-up track. Its two GND pads are joined and drop through one via to the bottom fill. Their +3V3 comes from pin 1 along the top edge and down the strip's right edge on top, then along a bottom-layer bus under the pull-ups. J1 pins 6 and 14 get short bottom GND tracks, like pins 20 and 30.
- **I2C7 to the OLED:** pins 3 and 5 drop through the gaps beside pins 2 and 4 on the bottom layer, run right above the button tracks, and hop to the top layer just before J2. The hop keeps the bottom ground fill open down the strip's right edge, which is the only link between the fill over the arm and the rest of it. J2's VCC has a short top track to the +3V3 rail.
- **Arm signals** run on top, between the header pins:
  - SPI0_MOSI from pin 19 to U1 and R4;
  - BTN1 from pin 29 to R2;
  - the button's RC network.
- **+3V3:** pins 1 and 17 are joined on top, above the header. Pin 17 then runs on the bottom layer down through the gap between pins 18 and 20, and on to R1.
- **The status-LED caps (C11–C20) are rotated 180°**, so each cap's +5V pad faces its LED's VDD pad.

**Things to look at in review:**
- **+5V fill:** inside the matrix it reaches the LEDs through about 1 mm bands between rows and along the matrix sides. That's adequate for the 1 A software current limit. If you raise the limit, check those bands.
- **Bottom ground fill:** the long data jumps cut it into strips, which join at the matrix edges.
- **Refill before reviewing:** after editing, press **B** in KiCad to refill both fills before you run the board check.

## Board status and open items

- [ ] **Check H1, H2 and H4 against the chassis plate.** The standoffs go to the plate beside the carrier. Confirm the plate is solid at those three points, and drill or tap it as needed.
- [ ] Measure the USB/Ethernet stack height to fix the riser height.
- [ ] With the dev kit on the car, confirm the arm stays out of the fan area and the board doesn't block the fan's airflow.
- [x] Route the board (see [Routing](#routing)). The board check finds 0 violations and 0 unconnected items, and the board matches the schematic.
- [ ] Review the routing in KiCad before ordering, especially the +5V fill's narrow paths through the matrix (see [Routing](#routing)).
- [ ] Buy a 0.91" OLED module and check its size and pin order against J2 (outline on the `F.Fab` layer).
- [ ] Check the button row's height against whatever sits above the HAT (TS-1187A switches, 1.5 mm tall). The OLED module sits above the button row, not over it, but check that a finger can still reach the low buttons past it.
- [ ] Hardware bring-up: scope pin 19 and check the line idles low between frames. The driver sends a low byte first in case it doesn't.
