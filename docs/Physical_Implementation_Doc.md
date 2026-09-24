# Physical Indicator Design

**Put the LEDs and display on a small PCB (a "hat"), and connect that PCB to the Orin's 40-pin header with one cable or stacking header. Don't wire each LED to its own Orin pin.**

### Why not one pin per LED

The 40-pin header has only about 20–25 usable GPIO pins, and many are shared with other functions (I2C, SPI, UART). Wiring each LED directly would use up GPIO pins quickly and would not scale well to a matrix. Also, GPIO pins are 3.3 V and supply only a few mA, so they can't drive many LEDs directly.

> **Design Note:**
> We'll still need to discuss whether the diagnostics should be on at all times or only when the user presses a button.

### Recommended approach: addressable RGB LEDs (WS2812B / "NeoPixel" style)

![LED Panel](../images/LED%20Pane.png)

* Each LED has a tiny driver chip inside. LEDs are **chained in series**: data goes in one end, and each LED passes it to the next.
* The whole chain needs only **3 wires**: 5 V, GND, and 1 data line. This works for 5 LEDs or hundreds of LEDs.
* Each LED can display any color (green/yellow/red) and any pattern. This satisfies the **future matrix** goals without requiring additional GPIO pins.
* **Caveat:** These LEDs expect a 5 V data signal, while the Orin outputs 3.3 V. Add a small **level shifter** (e.g., 74AHCT125) on the PCB. This is inexpensive and requires only one chip.

![Level Shifter](../images/LevelShifter.jpg)

* **Caveat 2:** The Orin's data pin must generate precise timing. A plain GPIO can be unreliable for this on Linux. Two common approaches are:

  * Use the **SPI MOSI pin (pin 19)** to drive the LEDs. This is a commonly used approach for addressable LEDs on Jetson systems.
  * Add a small **microcontroller** (e.g., RP2040, ESP32, or Arduino) on the PCB that drives the LEDs, and communicate with it over USB, I2C, or UART. This also allows the hat to handle LED timing independently from the Orin and provides a good path for expanding to a larger matrix later.

### The 3-digit display

Need more information on the 3-digit display for the voltage, including the **model number, driver/controller, communication interface, operating voltage, and current requirements**.

### Suggested design

| **Part**                      | **Connection to Orin**                     |
| ----------------------------- | ------------------------------------------ |
| 5 RGB LEDs (chained, WS2812B) | 1 data pin (via level shifter) + 5 V + GND |
| 3-digit display (with driver) | I2C (pins 3, 5) + power                    |
| Programmable "user" button    | 1 GPIO input (+ GND)                       |
| Optional microcontroller      | USB or I2C/UART; handles all lights        |

All of it fits on **one PCB** with a single 40-pin connector (or a ribbon cable), plus the hat enclosure above the USB/Ethernet ports.

### Practical notes

* **Power:** The 5 V header pins (2 and 4) have limited current. Five LEDs at full white can draw approximately 300 mA, which is within the expected range for a small LED setup. A larger matrix would require additional consideration for 5 V power distribution, so the PCB could be designed with future expansion in mind.
* **Button use:** The button triggers a student script (e.g., `"green if wall is 0.5 m away"`). The lights then respond to whatever values that script sets, which works well with the addressable LED chain. For example, the LEDs could represent left, front, and right distance measurements.
* **LiDAR index confusion:** A ring or line of addressable LEDs could show the direction of the nearest object. This could help students understand which LED index corresponds to which direction in the LiDAR data.
* **Mounting:** Keep the hat clear of the fan. Use standoffs attached to the board's mounting holes, and take caliper measurements before finalizing the PCB outline.

### Sketch

**Coming soon…**
