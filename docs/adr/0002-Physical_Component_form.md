# 0001. Choosing the physical indicator design for RoboRacer Diagnostics System

**Status:** **Proposed** | Accepted | Superseded by ADR-NNNN
**Date:** 2026-07-10
**Deciders:** Luke, Alex, Saman, Darrin

## Context

We need to find a form for our physical indicator design for the Diagnostics System

Constraints:
* Must be easily visible on the car
* Must run and show diagnostic data clearly without needing the web app interface
* Must be run on startup of the car
* Must not interfere with other components on the car


## Options considered

### Option A: L-Shaped Hat Over USB ports and 40 pin 40mm x 100mm. 5x5 LED Matrix, 5 LED Row Diagnostics, 3-digit voltage display, Button

- Pro: Doesn't sit above the Orin fan system. Less chance to overheat
- Pro: Connects to the 40 pins, and is raised above the USB ports so it's easy to mount it on the current mounting sections.
- Pro: 40mm x 100mm It's large enough to fit a full diagnostics section, a 3 digit voltage reader, a LED matrix, and a button to turn off and on.
- Con: L-Shape is hard to manufacture and build
- Con: Might be difficult to label the diagnostic LED's with the space that we have.

### Option B: Board over the entire Orin 79mm x 100mm. Min 5x5 LED matrix, up to 9x9. 3-5 Row Diagnostics, 3-digit voltage display, Button

- Pro: 79mm x 100xx huge PCB hat that can display a larger matrix (up to 9x19), a 3 digit voltage reader, diagnostics LEDS, and a multitude of buttons and labels.
- Pro: Easy to mount on all 4 corners up 25mm and 40 pin header.
- Con: Covers Orin fan which could overheat or cause wear and tear.
- Con: A larger matrix would draw more power which could decrease battery life
- Con: Larger PCB weighs more and is more expensive to produce and replace if there is an accident

### Option C: L-Shaped Hat Over USB ports and 40 pin 36-39mm x 100mm. 3x3 LED Matrix, 3-5 LED Row Diagnostics, 3-digit voltage display, Button

- Pro: Smallest option: cheaper. Fits on the board with the most room
- Pro: 3-4 LED diagnostics if you're tight on space and need a smaller PCB
- Pro: Could remove matrix entirely and have a 5 row diagnostics with button and voltage reader.
- Con: LED matrix is less effective with 3x3 rather than the larger 5x5 ones, or no matrix at all
- Con: Less room for desired features

## Decision

We chose Option A.
Option A is the best decision for us because it offers a good balance between size, diagnostic potential, and cost.
It's fits snug over the 40 pin header and USB ports. Its raised around 25 mm, so it doesn't cover the fan.
Gives us a larger 5x5 matrix which works better with the LiDAR information than a small matrix, or no matrix at all.
Approved by Professor Hadzik


## Consequences

**Easier now:**
- Easier to schematic a PCB board with desired shape and additions.

**Harder now:**
- Harder to actually fit the diagnostics on a smaller PCB, and will be harder to mount it with a smaller size.

**We are committed to:**
- 

**We should revisit this if:**
- 
