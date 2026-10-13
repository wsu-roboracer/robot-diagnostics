# Instructor Interview: What Actually Breaks

Track 2 - robot-diagnostics. Work for issue #6.

> **Status.** One interview, written up from notes taken during the conversation. It gives
> us what the professor wants shown, what he considers most important, and two **new feature
> requests**. It does **not** give frequency or time-to-diagnose figures, because nobody has
> been measuring them: there is no diagnostics dashboard today. It also gave **no numbers**
> for green, yellow and red, so the team proposed them, and **he has signed off on them**. He
> also asked for the data sources to be documented so the ranges can be changed later. That is
> [the last section](#where-the-data-comes-from-and-where-each-range-lives). Nothing else is
> open.
>
> Measurements from the robot and the detail behind the proposals live in the
> [spike notes](ros-status-spike-notes.md) and [summary](ros-status-spike-summary.md). This
> document keeps to what he said and what we decided from it.

> **Key ranges**, signed off by the professor. The full table, with a basis for every number,
> is under [Ranges](#ranges-signed-off-by-the-professor).
>
> | Item | Green | Yellow | Red |
> |---|---|---|---|
> | **Battery** | 11.6 V or more | 11.1 to 11.6 V | **below 11.1 V** |
> | **Board temperature** | below 70 C | 70 to 85 C | **85 C or more** |
> | **VESC FET temperature** | below 65 C | 65 to 80 C | **80 C or more** |
>
> **Battery yellow is a buffer**: the pack still runs fine, and it is time to get a replacement
> ready. **Red means replace the pack soon.** Red moved up from #1's 10.5 V, because a run-down
> test showed the pack falls off a cliff below about 10 V. Temperature red leaves about 14 C
> before the board throttles at 99 C.

---

## Why this matters

The value of the dashboard depends on whether it surfaces the failures people really hit.
This is the first time we have that from someone who has run the course, so it is the input
that orders the build.

---

## The average use case

> Students run heavy algorithms, do not know what is causing the problem, and the NVIDIA
> board drops data. They need to find out why: is the board too hot, is CPU usage too high,
> and so on.

This is a **diagnosis** tool, not just a status light. The question the page has to answer
is "why did it stop working", and for the most common case the answer is a compute resource
running out: heat, CPU, RAM or GPU.

---

## How people diagnose it today

There is no diagnostics dashboard, so the robot can be on and look fine while nobody knows
what is running. The tools available are the manual checks below, which are the aliases in
the robot's `~/.bashrc`, plus driving the car with the controller and reading what
`bringup_launch.py` prints.

| Check today | What it tells you | What it misses |
|---|---|---|
| Drive with the controller | The whole chain works, end to end | Why it does not, or which part failed |
| Read the `bringup` output | What nodes chose to print | Not the state of anything. Battery, ranges and commands never appear there |
| `r2t` (`ros2 topic list`) | Which topics exist | Whether messages are flowing. A dead node's topic lingers for about 18 s |
| `joy` (`ros2 topic echo /joy`) | Controller input reaching ROS | Silent both with no controller and when ROS cannot open the pad |
| `joystick_test` (`jstest /dev/input/js0`) | The pad works at the OS level | It passes when ROS still cannot read the pad |
| `lidar` (`ping 192.168.0.10`) | The lidar answers on its Ethernet link | Whether it is scanning, or scanning sensibly. It passes while the lidar driver cannot connect, see [the notes](ros-status-spike-notes.md#robot-2-the-lidars-single-connection-and-orphaned-nodes-2026-09-21) |
| `cam` | Starts the camera | Nothing checks it once started |
| Nothing set up | | **Battery, WiFi, CPU, GPU and temperatures have no alias or documented check** |

The last row is the point. The items he put at the top of his list are exactly the ones with
nothing set up today, and every other row is either an end-to-end guess or passes while the
thing it covers is broken.

---

## What the professor wants shown

### Priority order

**Battery is the most important and the biggest problem.** Everything else he named is
"most important" too, and all of it goes **at the top of the page**:

1. **Battery.**
2. **Joysticks not working.**
3. **Camera issues.**
4. **Lidar.**
5. **WiFi status**, whether it is working or not, including its speed, packet loss, and what
   it is sending and receiving.
6. **CPU, RAM, GPU and their temperatures, with usage.** He listed these after the others,
   but they are also the whole average use case above, so they sit in the same top band.

Only battery has a rank from him. The order of 2 to 6 above is the order he said them in,
not a ranking.

### How it should look

- Each item shows **green for good, yellow for "eh", red for bad**. This is the same
  Healthy / Degraded / Failed vocabulary as the
  [subsystem inventory](subsystem-inventory.md).
- All of the items above sit **at the top**. Deeper subsystem detail stays available for
  anyone who wants to go further, but is not the first thing on the page.

### Added by the team (not from the interview)

Two more things belong in the top band, agreed after the interview:

- **Whether all 8 nodes started.** The roll call from bringup (S-19). A car where bringup
  half-started is the first thing anyone needs to know.
- **Which topics are publishing, and their state**: OK, idle, degraded and so on. Idle is not
  a fault for every topic (`/joy` is quiet with no controller attached), which is why topics
  need a declared class, as the spike notes describe.

The prototype already shows both: the node count and per-topic state.

---

## Failure modes, one per line

The professor's words on the left, where it lands in our inventory on the right, and what
the prototype does about it today.

| # | Failure mode (professor's words) | Inventory | Prototype today |
|---|---|---|---|
| 1 | Battery | S-01 | Live voltage from `/sensors/core`, sag-tolerant window, top slot on the page. Thresholds were checked against a run-down test, which moved red up: see the ranges below. |
| 2 | Joysticks not working | S-18, S-03 | Two-channel check (`/joy` plus Bluetooth and `js0`), and a **Run joystick check** button that names the cause. The `input` group trap is documented in the spike notes. |
| 3 | Camera issues | S-14 | Detected on USB at the right link speed, and the page now has a live view and a **Take Picture** button (PR #35, 2026-09-21). No rate or content check yet. |
| 4 | Lidar | S-12, S-17 | `urg_node` already publishes rate, device status and error counts. Ethernet carrier and ping covered, but a ping cannot tell "connected" from "driver cannot connect". |
| 5 | WiFi status, including speed, packet loss, sending and receiving | none (S-16 was dropped) | The Network tile shows a count of links that are up. It already reads a `wifi signal` value to draw dBm, but the robot does not publish one yet. No speed, loss or traffic. See [WiFi](#wifi-s-16-needs-reopening). |
| 6 | CPU usage too high | S-04 | Load average published. GPU utilisation is not. |
| 7 | RAM | S-07 | Published. |
| 8 | GPU | S-04 | Thermal zone only. No utilisation. `tegrastats` is already run for power rails and reports GPU load as `GR3D_FREQ` (confirmed on robot #2). |
| 9 | Temperatures (board too hot) | S-05 | All readable thermal zones published. Thresholds are the provisional ones from #1. |

---

## New feature requests

Both come from one statement: **we need to stream data from the camera and lidar, not just
check that they are connected.**

### Camera picture on the dashboard

Take a picture and see it on the dashboard. **Live video would be a bonus.**

- **A snapshot is realistic**: compressed transport or a smaller profile, on a button like the
  joystick check. Raw colour frames are 2.76 MB each, about 83 MB/s, and cannot go over
  rosbridge.
- **Live video is a larger piece of work**, with a decision about who is allowed to hold the
  camera, since only one process can open a RealSense at a time.
- **Both are now built** (PR #35, merged 2026-09-21). The page shows a live MJPEG stream
  served from port 8082 on the robot, with **Connect Camera** and **Take Picture** buttons. It
  looks like 10 to 20 fps by eye, not measured. It skips ROS image topics and rosbridge, which
  is why the raw-frame limits above do not apply. The video server is a temporary setup on the
  robot, described in [Camera Streaming Research](Camera%20Streaming%20Research.pdf), and it is
  not saved anywhere shared. See
  [the notes](ros-status-spike-notes.md#camera-feature-as-merged-pr-35-2026-09-21).

### Lidar radar view

Show the lidar scan as a radar (polar) view, so a student can see what the robot sees. This is
cheap by comparison: `/scan` is about 19 KB per message, and a polar plot is a canvas draw with
no new backend. It also turns "lidar connected" into "lidar producing sensible data", which is
the shift the professor asked for.

---

## What this changes

- **Battery stays first.** It already was S-01 and tier 1. Nothing to reorder, but it now has
  the professor's weight behind it, so its thresholds were checked against a run-down test, which
  moved red up (see the ranges below).
- **The top band is bigger than tier 1.** Battery, joysticks, camera, lidar, WiFi and the
  compute group all go at the top, plus the node roll call and topic state.
- **Compute needs more than it has.** The average use case is a compute drop, and GPU
  utilisation is the one item on his list we do not publish at all.
- **No 20-minute temperature run.** He said it is not needed to measure temperatures, so
  block F is dropped and the provisional temperature thresholds stand.
- **Two new items are not in the inventory.** Camera image and lidar radar view are
  features, not health checks, so they need a home in the schema (#8) or the interface
  (#4) work rather than an S-number.

### WiFi (S-16) needs reopening

S-16 was dropped from the inventory because a UI delivered over the network cannot report
its own transport failing. That reasoning still holds for "WiFi is down", but the professor
still wants WiFi status, and he asked for more than up or down: the **speed**, whether there
is **packet loss**, and what the link is **sending and receiving**.

The team reads "speed" as: the network is up, without packet loss or high ping. That is the
same set the Omarchy WiFi panel shows on a laptop (ping, packet loss, receiving, sending), and
it is how a bad network has been spotted in the past. So the page should show, from the robot,
the signal, round trip and packet loss to the gateway, and the send and receive rates, and
colour on signal, loss and round trip. When the robot cannot be reached at all, the page should
say what to check: that the viewer is on the same WiFi as the robot, and that the robot is
powered.

Every source for this works without sudo on robot #2, and the readings there were clean (0%
packet loss, 1.4 to 3.2 ms round trip, -41 to -43 dBm). The sources, the measurements, and the
design notes are in
[the spike notes](ros-status-spike-notes.md#robot-2-wifi-thermal-trip-points-and-cpu-power-mode-2026-09-21).

Recommend replacing the dropped S-16 with a WiFi check covering signal, round trip, packet
loss and the send and receive rates, rather than reviving the old reachability wording. Needs
a decision from the team, since IDs are not renumbered.

---

## Answers to the questions #6 asked

- **How often does each failure happen, and how long does it take to diagnose?** He did not
  give figures, and there are none to give: with no diagnostics dashboard, finding the cause
  depends on who knows the system and what to look for, so diagnosis time varies a lot from
  person to person. What he did say is that the items in his "most important" list are the
  most likely causes. Because of that, this document ranks by his stated priority, not by
  measured frequency and diagnosis time. **#6's "ranked by how often and how long" cannot be
  met with data**, and the reviewer should confirm his priority order is an acceptable
  substitute.
- **Has anything looked fine but was not?** Yes, and it is the average use case above. The
  robot is powered on and looks fine, but nobody can tell what is actually running: whether
  all the nodes started, whether the controller is really connected, whether the sensors are
  producing data. The causes are the items in his top list: WiFi, battery, CPU, GPU,
  temperatures, and the joystick, camera and lidar. With no dashboard the only way to know is
  to drive the robot and see, and to read the bringup output. See
  [How people diagnose it today](#how-people-diagnose-it-today). The spike found examples of
  the same thing: a pad that is paired and connected while ROS cannot read it, a temperature
  that read `0.0` because nothing wrote the field, and a lidar that answered ping while an
  orphaned driver from an earlier run held its only connection.
- **Why is the 20-minute temperature run not needed?** He does not need average temperatures
  measured. He wants **ranges for what counts as green, yellow and red**. That is the
  reason, and it replaces the run with a different job: propose the ranges.
- **What does yellow mean, in numbers?** He gave none. He wants ranges, not measurements, so
  the team proposed them from what the hardware and the earlier work say, and he signed off.
  They are below.

## Ranges, signed off by the professor

The professor signed off on every row. **Basis** says where the numbers come from, and rows
marked *convention* have no measurement behind them, so they are the first to revisit if real
use disagrees. The measurements are in [the spike notes](ros-status-spike-notes.md).

| Item | Green | Yellow | Red | Basis |
|---|---|---|---|---|
| **Battery** (rolling window, not per sample) | 11.6 V or more | 11.1 to 11.6 V | below 11.1 V, or a VESC fault code | Yellow is a buffer: the pack still runs fine, so get a replacement ready. Red means replace the pack soon. Red is #1's own healthy floor (3.7 V per cell). A run-down test on 2026-09-21 showed the pack falls off a cliff below about 10 V, so #1's red at 10.5 V leaves too little time, and less when driving. The 11.6 V line is a *convention*. Pack is 3S LiPo, sags 0.1 to 0.2 V under load |
| **Board temperature** (`tj-thermal` and the other zones) | below 70 C | 70 to 85 C | 85 C or more | Trip points read from robot #2: throttling at 70 and 99 C, fan steps at 35, 74 and 95 C, shutdown at 104.5 C. Idle about 50 C. Red leaves about 14 C before throttling |
| **VESC FET temperature** | below 65 C | 65 to 80 C | 80 C or more | Provisional. The VESC's own over-temperature fault trips near 85 C |
| **CPU load** (1 minute average, 6 cores) | 6 or less | above 6 | above 12 | The prototype. The CPU is capped at 1.51 GHz in 15 W power mode |
| **RAM available** | 20% or more | 10 to 20% | below 10% | The prototype. Idle baselines read 63 to 80% available |
| **GPU load** | below 95% | 95% or more, sustained | none from load alone | *Convention.* A busy GPU is a heavy job, not a fault. Red comes from temperature. Idle is 0% |
| **WiFi signal** | -67 dBm or better | -67 to -75 dBm | worse than -75, or not connected | *Convention.* Measured -41 to -43 dBm |
| **WiFi packet loss** (to the gateway) | below 1% | 1 to 5% | 5% or more, or no reply | *Convention.* Measured 0%. Past problems were 90 to 100% |
| **WiFi round trip** | below 30 ms | 30 to 100 ms | above 100 ms | *Convention.* Measured 1.4 to 3.2 ms |
| **WiFi link rate, sending and receiving rate** | shown, not coloured | | | Link rate adapts on its own, and the sending rate includes the dashboard's traffic |
| **Nodes** | 8 of 8 | - | any missing | Bringup starts exactly 8. A missing node is a failed bringup, so there is no yellow |
| **Topics** | OK | SLOW (below half the expected rate) | STALE, SILENT, NOT_ADVERTISED or NODE_DOWN | The spike's states. IDLE is neutral, not a fault: event topics such as `/joy` are quiet at rest |
| **Lidar** | 38 to 42 Hz | flowing, outside that range | no scans, a device error, or the driver cannot connect while the lidar still answers ping | `urg_node`'s own bounds, 40 Hz within 5% |
| **Camera** | on USB at 5000M, about 30 Hz | USB 2 speed (480M), or below half the rate | not on USB, or launched with no frames | The spike. Not started is idle, since the camera is not part of bringup |
| **Joystick** | connected, and ROS can read it | - | connected but ROS cannot read it, or dropped mid-run | The spike's two-channel check. No controller is idle, not a fault |

**Throttling is not a separate check.** CPU load and board temperature are both shown, and
those are what a student needs to work out why the board dropped data. One thing to know when
reading them: the board runs in 15 W power mode, which caps the CPU at 1.51 GHz, so it can be
slower than expected without being hot. Full CPU load with a normal temperature means the
board is running as fast as it is allowed to, not that something is broken.

**Battery is his top item, so it was tested, and the test moved red up.** A run-down test on
2026-09-21, with the car idle and not driving, started at 10.4 V, and the robot lost power about
five minutes later at 8.8 V or below (about 2.9 V per cell). The pack fell about 0.25 V per
minute from 10.4 V to 9.3 V and about 1 V per minute below that, a cliff below roughly 10 V.
Driving draws far more current than idle, so with the car moving, red at #1's 10.5 V would
leave much less than those five minutes. The car also kept running below the roughly 9.9 V where
#1 says LiPo damage starts, so nothing on the car protects the pack, and the dashboard's red is
the only warning a student gets. Red therefore moves up to #1's own 11.1 V floor. The
2026-09-09 dropout at 10.9 V was most likely not the pack. Details and caveats are in
[the notes](ros-status-spike-notes.md#robot-2-battery-run-down-test-2026-09-21).

## Where the data comes from, and where each range lives

The table below describes the code at the time of the interview, and most of the gaps it lists have
since been closed. The current version, with every file and constant, is in
[system-overview.md](system-overview.md#what-changes-what).

The professor asked for this so the ranges can be changed later without digging through code.
Each item below says where its data comes from and where its range is defined.

Three things to know first:

- **Ranges are judged in three places.** Temperature, CPU and RAM are judged on the robot by
  `prototype/system_diagnostics.py` and reach the page already graded. Battery, VESC
  temperature, nodes and topics are judged in the page, `prototype/dashboard.html`. The lidar's
  rate is judged by the lidar driver itself, from `f1tenth_stack/config/sensors.yaml` in the
  robot's `f1tenth_system` repo.
- **The signed-off numbers are not all in the code yet.** The last column says which are, and
  the gaps are listed after the table.
- **The files on the robot are hand-copied from `prototype/` into `~/diag/`**, so a change has to
  be copied across before it takes effect there.

| Item | Where the data comes from | Where the range is defined | In the code today |
|---|---|---|---|
| **Battery** | The VESC, over ROS: topic `/sensors/core`, field `state.voltage_input`, about 50 Hz | `BATT_WARN` (yellow line) and `BATT_ERR` (red line) in `dashboard.html`. `BATT_ERR` is also the bottom of the battery gauge, which scales from `BATT_ERR` to `BATT_FULL` | **No.** The code has 11.1 and 10.5. Signed off is `BATT_WARN = 11.6` and `BATT_ERR = 11.1` |
| **Board temperature** | Sysfs, `/sys/devices/virtual/thermal/thermal_zone*/temp`. It uses the `tj-thermal` zone, or the hottest zone if that is missing. Published as `system: Thermal` | `TJ_WARN, TJ_ERR = 70.0, 85.0` near the top of `system_diagnostics.py` | Yes |
| **VESC FET temperature** | The VESC, `/sensors/core`, field `state.temp_fet`. Only works on cars with the driver patch, currently robot #2 | `FET_WARN, FET_ERR = 65, 80`, defined in **both** `dashboard.html` and `system_diagnostics.py`, so change both. `MOTOR_ABSENT = -20` marks the motor sensor as not fitted | Yes |
| **CPU load** | `/proc/loadavg`, the 1 minute average, and the core count. Published as `system: CPU` | Inside `cpu()` in `system_diagnostics.py`, with no named constant: yellow above the core count, red above twice it | Yes |
| **RAM** | `MemAvailable` in `/proc/meminfo`. Published as `system: Memory` | `MEM_WARN, MEM_ERR = 20.0, 10.0` (percent available) in `system_diagnostics.py` | Yes |
| **GPU load** | `tegrastats`, the `GR3D_FREQ` field. The node already runs `tegrastats` for the power rails | Not defined | **Not built.** Nothing publishes GPU load yet |
| **WiFi** signal, loss, round trip, traffic | `iw dev wlP1p1s0 link` and `/proc/net/wireless` for signal, `ping` to the default gateway for loss and round trip, and `/sys/class/net/wlP1p1s0/statistics/*` for traffic and errors. Full list in [the notes](ros-status-spike-notes.md#robot-2-wifi-thermal-trip-points-and-cpu-power-mode-2026-09-21) | Not defined | **Not built.** The Network tile already looks for a `wifi signal` value and draws dBm on a bar, but nothing publishes one, so it shows a count of links that are up |
| **Nodes** | `/rosapi/nodes` over rosbridge, compared with the list of nodes bringup starts | `EXPECTED_NODES` in `dashboard.html`. Edit it if bringup changes | The list and the count are there. How a missing node is coloured was not checked |
| **Topics** | rosbridge subscriptions, throttled. Each topic has a class (continuous, event, latched, input) that decides whether silence is a fault | `TOPICS` in `dashboard.html` for the classes, and the page's `classifyTopic()` for the states | Partly. No table of expected rates was found, so "SLOW, below half the expected rate" is not evidently applied. Rates shown come from throttled subscriptions and read low |
| **Lidar** rate | The lidar driver, `urg_node`, which publishes "Laser Scan topic status" (actual, target and acceptable rates) on `/diagnostics` | `diagnostics_tolerance: 0.05` (40 Hz within 5%, so 38 to 42 Hz) and `diagnostics_window_time: 5.0` in `sensors.yaml`. A bringup restart applies a change | **No.** The page does not read those bounds. Its lidar tile uses whether `/urg_node` is running and the `/scan` state |
| **Lidar** link | `ping` to `LIDAR_IP` (192.168.0.10), published as part of `system: Network` | `LIDAR_IP` in `system_diagnostics.py` | Only reachability. Nothing catches "link up but the driver cannot connect" |
| **Camera** | `system: Camera` reads `/sys/bus/usb/devices/*/speed` for an Intel (8086) device. The live picture is a separate MJPEG stream on port 8082 | The `5000` check inside `camera()` in `system_diagnostics.py` | Partly. Not on USB is yellow in the code and red in the ranges. Frame rate is not checked |
| **Joystick** | `system: Gamepad` lists `/dev/input/js*` and asks `bluetoothctl`. The page also watches `/joy`, and the **Run joystick check** button calls a service on the robot | Inside `gamepad()` in `system_diagnostics.py` | Partly. "No controller" is yellow in the code and neutral in the ranges |

### Changing a range

1. Find the item in the table and edit its constant. Put the same change in this document.
2. If it lives in `system_diagnostics.py`, copy the file to `~/diag/` on the robot and restart
   with `./start_diagnostics.sh --stop` then `./start_diagnostics.sh`.
3. If it lives in `dashboard.html`, copy the file to `~/diag/` and reload the page.
4. If it lives in `sensors.yaml`, restart bringup.

Before moving a number, check what the hardware itself says. The board's own limits are in
`/sys/class/thermal/thermal_zone*/trip_point_*_temp`, and the notes have the trip points and
the battery run-down test.

### Gaps between the signed-off ranges and the code

- **Battery.** The constants need the new values. The page's wording also says "stop driving"
  for red and "swap soon" for yellow, where the agreed meaning is that yellow is a buffer and
  red means replace the pack soon. And the page compares each reading on its own. With no
  smoothing, the reading swings by about 0.2 V within a second under throttle, so a pack near
  11.1 V will flicker between colours.
- **GPU and WiFi** are not published or graded yet.
- **Lidar** does not use the driver's rate bounds, and does not tell "link up, driver not
  connected" apart from healthy.
- **Camera and joystick** grade a few states differently from the ranges, as the table says.
- **Topic states** are graded more gently on the lidar tile than in the ranges: `STALE` and
  `SILENT` show yellow there, and red in the ranges.
- The comments in `system_diagnostics.py` still call the temperature thresholds provisional and
  mention the 20-minute run that was dropped.
