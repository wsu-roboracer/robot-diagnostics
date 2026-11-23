# JLCPCB order files: Orin diagnostics HAT rev 0.1

These files are generated from the KiCad project in the folder above. **If you change the board, regenerate them**; don't edit these by hand.

| File | Upload it to |
|---|---|
| `orin_hat_diag_gerbers.zip` | The PCB order (gerbers and drill files) |
| `orin_hat_diag_bom.csv` | PCB Assembly, "BOM file" |
| `orin_hat_diag_cpl.csv` | PCB Assembly, "CPL file" |

**The CPL has hand-made rotation fixes for the LEDs and U1.** JLCPCB's models for these parts are turned differently from KiCad's footprints, so the CPL sets:

| Parts | KiCad rotation | CPL rotation | Why |
|---|---|---|---|
| D1–D10 (XL-5050, C2843785) | 180° | **90°** | JLCPCB's model was a quarter turn off: VDD sat on the DOUT pad |
| D101–D164 (XL-2020, C5349955) | 180° | **0°** | JLCPCB's model was a half turn off: VDD and GND were swapped |
| U1 (74AHCT1G125GV, C12494) | 0° | **180°** | JLCPCB's model was a half turn off: pin 1 on the wrong end |

If you regenerate the CPL from KiCad, re-apply these rotations. If you change any of these part numbers, check the preview again from scratch.

## PCB settings

- 2 layers, 1.6 mm, 1 oz copper. The board size (86 × 116 mm) is read from the gerbers.
- Lead-free HASL or ENIG, any colour.
- Everything else can stay at the defaults.

## Assembly settings

- **Assemble the top side only.** Every part JLCPCB places is on top (177 parts, 10 part numbers).
- **JLCPCB doesn't place the through-hole parts.** Solder these by hand afterwards:

  | Ref | Part | Notes |
  |---|---|---|
  | J1 | 2×20 female socket, 2.54 mm, dual row | Goes on the **bottom** side. Plugs onto the Orin header through 40-pin stacking risers |
  | J2 | 0.91" 128×32 SSD1306 I2C OLED module | Bought separately. Solder its 4 pins straight into J2 after checking the order is GND VCC SCL SDA |

## Parts that JLCPCB places

| Part | LCSC | Qty | Notes |
|---|---|---|---|
| 100 nF 0603 | C14663 | 81 | Basic part |
| 10 kΩ 0603 | C25804 | 6 | Basic part |
| 1 kΩ 0603 | C21190 | 6 | Basic part |
| 33 Ω 0603 | C23140 | 1 | Basic part |
| Tactile switch, SMD, 5.1 × 5.1 × 1.5 mm (XKB TS-1187A-B-A-B) | C318884 | 6 | Basic part. SW1–SW6 |
| 100 kΩ 0603 | C25803 | 1 | Basic part |
| WS2812B 5050 (XINGLIGHT XL-5050RGBC-WS2812B) | C2843785 | 10 | Extended part. Replaces Worldsemi C114586, which went to pre-order. Same WS2812B pinout: check it against the footprint in the placement preview |
| WS2812B-2020 (XINGLIGHT XL-2020RGBC-WS2812B) | C5349955 | 64 | Extended part, **Standard PCBA only**, MSL 5a (JLCPCB bakes it). Replaces Worldsemi C965555, which JLCPCB has none of. Its datasheet contradicts itself: the outline drawing (page 13) gives 1 DO at the dot corner, 2 GND, 3 DI, 4 VDD, matching the footprint, but the pin table below it lists the 5050 order (1 VDD, 2 DOU, 3 GND, 4 DIN). The drawing is right; see the check below |
| 74AHCT1G125GV (Nexperia, SOT-753) | C12494 | 1 | Extended part. Not the 74**HCT**1G125, C12502 |
| 220 µF 10 V electrolytic, 6.3 × 7.7 mm (Panasonic EEE-FK1A221XP) | C401650 | 1 | Extended part. Replaces C271392, which ran short. Low stock; any 220 µF ≥10 V 6.3 × 7.7 mm SMD cap works |

**Extended parts add a setup fee for each part number. Check stock on each part's page before ordering.**

## Check before paying

- **Rotations in JLCPCB's placement preview.** JLCPCB's part models don't always use KiCad's zero rotation. Check that the pin-1 marks on these parts line up with the silkscreen:
  - all the WS2812B LEDs, both sizes; a rotated LED doesn't light and breaks the chain after it. The CPL already corrects them (see above), so they should come in right. **Don't rotate them again unless the preview shows they're still wrong.** What's right:
    - D1–D10: the magenta notch triangle (GND corner) sits on the cut corner of the white silkscreen outline, and the "+" (VDD) is diagonally opposite it.
    - D101–D164: the "DO" label and arrow end sit on the pad at the silkscreen outline's cut corner, and "4+" (VDD) is on the pad beside it on the same side.
  - U1, which the CPL also corrects (see above);
  - C2's polarity;
  - SW1–SW6. Each switch has two pads of each terminal, and they must line up with the pads on the board (SW1 at 0°, SW2–SW6 at 90°). Off by 180° is fine. **Off by 90° is not:** the switch then shorts its button line to GND and reads as always pressed.

  Fix any wrong part in the preview, not in KiCad.
- **The 2020 LEDs are 2 × 2 mm.** In the preview, the dot on each LED must sit on footprint pad 1 (DO), as in the outline drawing on page 13 of the XL-2020RGBC-WS2812B datasheet. If JLCPCB asks about pin 1, tell them to follow that drawing and not the pin table. A 90° error puts 5 V on a data pin.
