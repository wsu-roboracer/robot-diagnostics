# Documentation

Start with **[system-overview.md](system-overview.md)**: what the dashboard is, how it works, how to run it, and which file and setting to change for each check.

## Guides: using the dashboard

| Document | What it covers |
|---|---|
| [guides/overview-tab.md](guides/overview-tab.md) | Reading the first page, with screenshots: the status banner, battery and computer tiles, subsystems, ROS graph, camera, LiDAR, what each colour means, and every threshold in one table |
| [guides/drive-tab.md](guides/drive-tab.md) | Driving the car from the dashboard, with screenshots: arming, the controls, what stops the car, full screen, the LiDAR and warnings, arranging the view, recording, autonomous runs (full speed, hold R1 to run), the obstacle stop, limits, and driving on a phone |
| [guides/advanced-tab.md](guides/advanced-tab.md) | Finding out why something is wrong: needs attention, the car's own checks, nodes, topics and their states, the joystick check, and the warning log |
| [guides/controller-tab.md](guides/controller-tab.md) | The PS4 controller live: what is pressed, the sticks and triggers, the deadman buttons, mapping a controller that numbers its buttons differently; and driving with a Steam Deck from its browser |
| [guides/steam-deck-setup.md](guides/steam-deck-setup.md) | Setting up a Steam Deck: the launcher, Firefox and gamepad permissions, the Steam shortcut and layout, and testing it on the Controller tab |

## Design: how parts of the dashboard work

| Document | What it covers |
|---|---|
| [design/dashboard-drive-control.md](design/dashboard-drive-control.md) | Driving the car from the dashboard: the command path from browser to motors, the safety rules, and where each piece lives in the code |
| [design/emergency-stop.md](design/emergency-stop.md) | The Emergency stop button: what it stops, how release works, and the robot-side service behind it |
| [design/subsystem-inventory.md](design/subsystem-inventory.md) | Every subsystem on the car and what "healthy" means for each, confirmed against the lab robots |

## Decisions (ADRs)

| Document | Decision |
|---|---|
| [adr/0001-diagnostics-form.md](adr/0001-diagnostics-form.md) | What form the diagnostics system takes |
| [adr/0002-physical-component-form.md](adr/0002-physical-component-form.md) | The physical indicator design |

## Hardware

| Document | What it covers |
|---|---|
| [hardware/physical-implementation.md](hardware/physical-implementation.md) | The physical indicator: LEDs and a display on a PCB hat on the Orin's 40-pin header |
| [hardware/physical-mount-considerations.pdf](hardware/physical-mount-considerations.pdf) | Where and how to mount it on the car |

The PCB hat's design files (Gerber, EasyEDA project, layouts) are in [`diagnostic-hardware/`](../diagnostic-hardware).

## Research

| Document | What it covers |
|---|---|
| [research/ros-status-spike-summary.md](research/ros-status-spike-summary.md) | Reading live status from ROS: what works, measured on robot #2. Start here |
| [research/ros-status-spike-notes.md](research/ros-status-spike-notes.md) | The full record behind that summary: every measurement, command and correction |
| [research/survey-existing-ros-diagnostics.pdf](research/survey-existing-ros-diagnostics.pdf) | Existing ROS diagnostics tools, and what they do and don't cover |
| [research/health-report-schema.pdf](research/health-report-schema.pdf) | The health report format |
| [research/camera-streaming-research.pdf](research/camera-streaming-research.pdf) | Ways to stream the car's camera to a browser |
| [research/camera-system-research.pdf](research/camera-system-research.pdf) | The camera system as part of diagnostics |

## Sprints and meetings

| Document | What it covers |
|---|---|
| [sprints/sprint-1-review.md](sprints/sprint-1-review.md) | Sprint 1 (Aug 31 – Sep 13) |
| [sprints/sprint-2-review.md](sprints/sprint-2-review.md) | Sprint 2 (Sep 14 – Sep 28) |
| [meetings/instructor-interview.md](meetings/instructor-interview.md) | What actually breaks on the cars, from an instructor interview |

## Adding a document

Put it in the folder that matches what it is. Name it in lowercase with dashes (`camera-latency-test.md`, not `Camera Latency Test.md`), and add a line to the right table above.
