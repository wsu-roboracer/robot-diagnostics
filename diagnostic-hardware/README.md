# Diagnostic hardware

The physical side of the diagnostics system: a small PCB "hat" with LEDs and a display, on the Orin's 40-pin header. Why it is built this way is in [docs/hardware/physical-implementation.md](../docs/hardware/physical-implementation.md); the decision is [ADR 0002](../docs/adr/0002-physical-component-form.md).

| File | What it is |
|---|---|
| [PCB-Hat_Diagnostics.zip](PCB-Hat_Diagnostics.zip) | Gerber files: what you send to a board manufacturer |
| [PCB Hat for Diagnostics_2026-10-14.epro](PCB%20Hat%20for%20Diagnostics_2026-10-14.epro) | The EasyEDA project the Gerbers were made from. Open this to change the board |
| [designs/pcb-hat-recommended-layout.pdf](designs/pcb-hat-recommended-layout.pdf) | The recommended board layout |
| [designs/pcb-hat-designs-enhanced.pdf](designs/pcb-hat-designs-enhanced.pdf) | The design options that were compared |
| [designs/pcb-hat-3d-render.png](designs/pcb-hat-3d-render.png) | 3D render of the board |
| [designs/possible-pcb-boards.png](designs/possible-pcb-boards.png) | Candidate board shapes |
| [images/](images/) | Reference pictures used by the hardware doc: the LED panel, the level shifter and the Orin NX GPIO layout |

When the board changes, export new Gerbers into the zip and keep the `.epro` next to it, so the two always match.
