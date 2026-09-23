# Spike: reading live status from ROS

Issue #2. Builds on #1 (subsystem inventory) and feeds #3 (form factor ADR), #8 (health schema) and #4 (interface mockup).

Everything here was measured on robot #2 (`f1-wsu-2`) over three sessions: 2026-08-31, 2026-09-02 and 2026-09-09. This page is a summary.

Full notes on everything, with every command, measurement and dead end, are in [ros-status-spike-notes.md](ros-status-spike-notes.md). Go there for anything this page leaves out.

## Picking this up

- **Getting on the robot.** Robot #2 is user `f1-wsu-2` at 192.168.1.202 on the lab WiFi. You have to be on that network, so in practice you have to be in the lab. SSH works, and NoMachine gives you its desktop.
- **Where the files are.** The prototype runs from `~/diag/` on robot #2. The same files are in [`prototype/`](../prototype/), and its README covers copying and starting them.
- **Checking a car.** With bringup running, `bash tools/baseline_capture.sh | tee baseline.txt` saves a full health snapshot, and `python3 tools/rosbridge_check.py` confirms rosbridge is passing data. Both are in `prototype/tools/`; copy that folder to `~/diag/` if the robot doesn't have it.
- **Only robot #2 has been measured**, and only robot #2 has the VESC temperature patch below. Expect other cars to differ until someone checks.
- **Measured on robot #2 on 2026-09-21:** WiFi (signal, link rate, loss, error counters), the board's thermal trip points, the CPU power mode (15 W, 1.51 GHz maximum), and a battery run-down (the robot lost power at 8.8 V or below). Every WiFi source works without sudo. Numbers are in the [notes](ros-status-spike-notes.md#robot-2-wifi-thermal-trip-points-and-cpu-power-mode-2026-09-21), and the ranges they support are proposed in [instructor-interview.md](instructor-interview.md).
- **The camera is built** (PR #35, merged 2026-09-21) **and now starts itself, with working downloads** (2026-09-23): the GStreamer pipeline and its Python HTTP proxy, previously hand-run from `/tmp` across two SSH terminals, are `prototype/camera_http.py` plus a step in `start_diagnostics.sh`, so a reboot no longer removes them, and `--stop`/`--status` manage them like everything else. **Take Picture** downloads work now too - the stream was missing `Access-Control-Allow-Origin`, which let the browser show the video but not read its pixels into a PNG. Its ports still have no authentication. Details in the [notes](ros-status-spike-notes.md#camera-stream-now-starts-itself-and-take-picture-downloads-2026-09-23).
- **The lidar radar view is built** (2026-09-23): the LiDAR card draws the actual `/scan` returns as a top-down sweep instead of just summary numbers. Building it found a real bug in those summary numbers: a "no return" beam on this Hokuyo reads back as ~65.5 m - the raw SCIP sentinel, well *above* `range_max` (30 m), not `inf` - and the old filter let it through as a "farthest reading." Fixed. A published WiFi signal is still to come. Details in the [notes](ros-status-spike-notes.md#lidar-radar-view-and-the-scan-no-return-sentinel-2026-09-23).
- **What to do next.** Nothing left needs measuring. The 20-minute loaded run (block F) was dropped on 2026-09-21 because the professor said it is not needed to measure temperatures. What to build, and in what order, comes from the professor interview in [instructor-interview.md](instructor-interview.md). The radar view has not yet been watched against a live robot in a browser - worth doing before calling it done.

## Short version

We can read almost everything #1 asks for and show it live in a web page on any laptop, with nothing installed on the laptop. A working prototype runs on robot #2 today.

ROS already has a standard format for health reports (`diagnostic_msgs`), and two nodes we already run, the lidar driver and the command mux, publish it. We should display that rather than invent our own format.

About half of #1 (CPU temperature, disk, memory, Bluetooth, camera USB speed) is not in ROS at all. A small Python node reads those from the operating system and publishes them in the same standard format, so the page gets everything through one connection.

Getting the data turned out to be easy. The hard part is avoiding false alarms: a simple "is this topic stale" rule flagged 16 of 23 topics as broken on a healthy car.

## How the prototype works

The prototype is a proof of concept and is scrappy on purpose. The spike's job was to prove that a web page can show live robot health, not to ship the final tool. Four files in [`prototype/`](../prototype/) run on the robot:

| File | What it does |
|---|---|
| `start_diagnostics.sh` | Starts five things: bringup, `system_diagnostics.py`, rosbridge, the camera stream, and a small web server for the page. Ctrl+C stops all of them, and `--status` / `--stop` work over SSH |
| `system_diagnostics.py` | A ROS node that checks the operating system once a second and publishes ten statuses to `/diagnostics`: Thermal, Power, CPU, Memory, Storage, Network (including a ping to the lidar), VESC device, Camera, Gamepad and Clock |
| `camera_http.py` | Wraps the GStreamer MJPEG pipeline's raw TCP output in real HTTP headers so a browser `<img>` can read it, and sends the CORS header the dashboard's snapshot button needs |
| `dashboard.html` | The whole page in one file, with no dependencies. Shows running nodes, topic health, battery, a live lidar radar plot, the camera feed and the system panel |

```
laptop browser ──http :8000──────> web server on the robot ──> dashboard.html
       │
       └──websocket :9090──> rosbridge ──> any ROS topic or service, including /diagnostics
                                                ▲             ▲                 ▲
                                            urg_node    ackermann_mux    system_diagnostics.py
```

The browser loads the page from the robot, then opens a second connection straight to rosbridge on port 9090. rosbridge is a ROS node that converts ROS messages to JSON and back, so the browser never needs ROS. Running `./start_diagnostics.sh` on the robot prints the address to open, for example `http://192.168.1.202:8000/dashboard.html`.

## Answers to the five questions

### 1. How do you list running nodes?

Use `ros2 node list` in a shell, `get_node_names_and_namespaces()` in Python, or the `/rosapi/nodes` service through rosbridge. A healthy robot shows 11 nodes: the 8 started by `bringup_launch.py` plus 3 belonging to rosbridge.

Only `/rosapi/nodes` was correct every time. `ros2 node list` under-reported in different ways across three runs, with and without the daemon, and once showed a single node while every topic was live.

### 2. How do you tell whether a topic is publishing, and how recently?

ROS has no "last published at" query. You subscribe and keep your own clock for each topic.

Rate has to be measured on the robot. From a laptop over WiFi, `/scan` read 30.5 Hz when it was really 40 Hz. The lidar driver already measures its own rate and publishes it to `/diagnostics`, and that is the pattern to copy.

### 3. How do you tell "running but silent" from "not running"?

Check three things: is the node listed, does the topic have a publisher, and did a message arrive.

| Node listed | Publisher | Messages | Meaning |
|---|---|---|---|
| no | no | no | Crashed or never started |
| yes | yes | no | Running but silent, e.g. unplugged sensor or hung driver |
| yes | no | no | Started but could not open its device |
| yes | yes | yes | Healthy |

We tested this by breaking the lidar both ways. Killing `urg_node` left `/scan` with 0 publishers. Keeping it alive but silent left 1 publisher and 0 messages. The publisher count tells the two apart.

There are two catches. A killed node stays listed for about 16 to 18 seconds. After that its topics disappear entirely instead of showing 0 publishers, so the page needs a list of expected topics or a dead node silently drops out of the table.

### 4. Is there an existing ROS diagnostics system?

Yes, and we should use it.

- `diagnostic_msgs` is the standard message. Its levels (OK, WARN, ERROR, STALE) map onto #1's Healthy, Degraded, Failed and unknown.
- `diagnostic_updater` is a library a node uses to report its own health, with ready-made rate checks.
- `diagnostic_aggregator` groups reports into a tree and marks anything expected but silent as Missing.
- `rqt_robot_monitor` is the existing viewer. It needs a full ROS desktop install, and removing that barrier is what our page is for.

`urg_node` already publishes the lidar's measured rate, device status, error counts and IP address. `ackermann_mux` publishes which input (controller or autonomous) is active. The VESC, odometry, joystick and camera nodes report nothing, so the page reads their topics directly.

### 5. What works off the robot, and what only works on it?

A laptop can read the robot in two ways. It can run its own copy of ROS 2 and join the robot's ROS network directly, so commands like `ros2 topic list` work from the laptop. Or it can use our design: a plain browser talking to rosbridge on the robot, with no ROS on the laptop. We tested both.

| Check | On the robot | Laptop running its own ROS 2 | Browser through rosbridge (our design) |
|---|---|---|---|
| Node list, topic list, publisher counts | yes | yes, if set to `ROS_DOMAIN_ID=202` | yes |
| Topic rate | yes | reads low, limited by WiFi | only if the robot computes it |
| Battery and motor data (`/sensors/core`) | yes | no, unless the VESC message package (`vesc_msgs`) is built on the laptop | yes |
| CPU, temperature, disk, Bluetooth, USB | yes | no | only if a node on the robot publishes it |

The browser comes out ahead. Students install nothing, and rosbridge decodes messages on the robot, where every message package is already installed.

## What is not possible, or was harder than expected

| Finding | What it means |
|---|---|
| One staleness rule flagged 16 of 23 topics on a healthy car | Topics need a class. `/scan` should be steady, `/joy` is silent when nobody touches the controller, `/tf_static` is published once, and `/drive` is an input that should have zero publishers. With classes, the false alarms went to 0 |
| `/odom` and `/tf` publish nothing until the car has been driven once | A one-way latch in `vesc_to_odom.cpp`. Before the first command they are unknown, not failed |
| `temp_fet` read 0.0 for three sessions | The hardware was fine. The VESC driver never copied the field into the message. We added two lines to `vesc_driver.cpp` (see [the VESC temperature patch](#the-vesc-temperature-patch)), and it now reads 31.4 C idle and rises under load. The patch only exists on robot #2 |
| `temp_motor` reads -73.6 C | No motor temperature sensor is fitted, and -73.6 C is what the empty sensor input reads. The page should say "no sensor fitted" instead of showing a number |
| Battery voltage swings from 11.0 to 11.2 V within a second under throttle | Checking each sample against the 11.1 V line would make the status flicker. Use a rolling window |
| The controller's battery level is not exposed | Bluetooth connection state is, and that is enough for the deadman check |
| The camera has no compressed image topic and publishes no diagnostics | One raw colour frame is 2.76 MB. A photo button needs compression or a resize on the robot |
| rosbridge has no authentication | Anyone who can reach port 9090 can publish to `/drive` and drive the car |
| The page freezes, instead of turning red, when the robot drops off the network | This happened mid-session. The pack was later found at 10.9 V (low battery and flaky WiFi were both in play). The page had shown the voltage the whole time and nobody noticed. The page has to say "lost contact" on its own, and warnings have to change how the page looks |
| A QoS mismatch gives zero messages from a working sensor | 0 messages against 196 in 5 seconds. Subscribers have to match the publisher's QoS settings |
| Subscribing to everything unthrottled wedged rosbridge | Throttle every subscription. rosbridge serves exactly 10 clients at once (see [Closed on 2026-09-16](#closed-on-2026-09-16)) |
| The lidar takes one connection, and a leftover driver can hold it | `urg_node` looped "could not open ethernet port" while ping passed, because an orphaned driver from an earlier run held the only connection for almost two hours. Killing it fixed it, and scans came back at 39.9 Hz. Details in the [notes](ros-status-spike-notes.md#robot-2-the-lidars-single-connection-and-orphaned-nodes-2026-09-21) |
| A refused second `start_diagnostics.sh` kills the bringup that is already running | The guard refuses, then its exit trap runs the full stop. It kills the launch process but not its nodes, which become orphans: 11 were found on robot #2, including a second control chain. Reproduced with stand-in processes. The fix is deferred |

### The VESC temperature patch

The file is `vesc/vesc_driver/src/vesc_driver.cpp` inside `~/f1tenth_ws/src/f1tenth_system` on the robot. The driver filled in every other field of the VESC state message but never set `temp_fet` or `temp_motor`, so both always went out as 0.0. We added these two lines with the other assignments, just before `voltage_input`:

```cpp
state_msg.state.temp_fet = values->temp_fet();
state_msg.state.temp_motor = values->temp_motor();
```

Then we rebuilt just that package. The plain build fails on the Jetson, because the workspace is already sourced in `.bashrc` and parallel jobs run out of memory, so it needs these flags:

```bash
colcon build --packages-select vesc_driver --allow-overriding vesc_driver --parallel-workers 1
```

The patch is not committed anywhere. It only exists on robot #2, and changing the driver on every car should go past the professor first.

## Corrections for #1

- S-10 reads `state.temperature_pcb`, which does not exist. Use `temp_fet`, which only works on cars with the driver patch above (currently just robot #2). Drop `temp_motor`, since no sensor is fitted, and `ntc_temp_mos1/2/3`, which always read 0.0 because this VESC hardware doesn't have those sensors.
- S-22 and S-23 treat `/drive` as the mux output. It is an input. The output on the robot is `/ackermann_cmd`.
- S-19's expected node list would fail on a healthy robot. It includes nodes bringup does not start (`robot_state_publisher`, `particle_filter`, the RealSense node) and leaves the `_node` suffix off the three VESC nodes.
- S-18 and S-03 must check Bluetooth connection state. A silent `/joy` only means no controller is connected, and "controller set down" looks the same on `/joy` as "controller died while driving".
- S-06: storage is a 915 GB NVMe at 4% used, not a cramped eMMC.
- S-16 (WiFi) was dropped, but the professor asked for WiFi speed, packet loss and traffic. Replace it with a check on signal, round trip to the gateway, packet loss and send and receive rates. Every source works without sudo (2026-09-21).
- S-12 and S-17 need three lidar states, not two: link down, link up with the driver not connected, and connected with scans flowing. A ping-only check reads the middle one as healthy.
- S-01: red should move up from 10.5 V to 11.1 V, with yellow up to about 11.6 V. A run-down test on 2026-09-21, with the car idle, started at 10.4 V and lost power about five minutes later at 8.8 V or below. The pack fell about 0.25 V per minute until 9.3 V and about 1 V per minute after that, a cliff below roughly 10 V, and driving draws far more current, so red at 10.5 V would leave very little time. The car also ran below the roughly 9.9 V where #1 says LiPo damage starts, so the dashboard's red is the only warning. The 2026-09-09 dropout at 10.9 V was most likely not the pack. Yellow is a buffer (still fine, get a replacement ready) and red means replace the pack soon. The 11.6 V line is a convention. The professor signed off on the numbers.
- S-05: the temperature thresholds now have a hardware basis. `tj-thermal` has fan steps at 35, 74 and 95 C, the other zones throttle at 70 and 99 C, and everything shuts down at 104.5 C. The module has a fan, and runs in 15 W power mode with the CPU capped at 1.51 GHz.

Open questions from #1 that are now answered: the lidar is at 192.168.0.10 on its own Ethernet link; L1 is `buttons[4]` and R1 is `buttons[5]`; `/sensors/core` publishes at 50 Hz; the mux drops an input after 0.2 s of silence; the DS4 charge is not under `/sys/class/power_supply/`; and S-19's domain ID risk (2026-09-14) - robot #2 is `ROS_DOMAIN_ID=202` and robot #6 is `206`, confirmed on hardware with both cars up at once, dashboards open in separate tabs, and no node/topic bleed-through between them (only 2 of the fleet checked so far).

## What this means for the other issues

**#3, form factor.** A web page is viable, and most of it is already built. A separate "status server" is not really a separate option, because rosbridge already is one. Two things still need deciding: whether rosbridge should be reachable from the whole lab network, given it can drive the car, and whether a physical indicator should show the deadman and controller link, since the wireless failure that loses the deadman can also lose the page.

**#8, health schema.** Adopt `diagnostic_msgs` instead of a custom format. Add a topic class, a `depends_on` field (when the VESC link fails, battery, motor and odometry fail with it), and keep "could not check" separate from "passed". The professor asked for green, yellow and red on everything in his top list, so [instructor-interview.md](instructor-interview.md) records a signed-off range for each, with where its data comes from and where the range is defined in the code. Give the lidar three states and add a WiFi entry to replace S-16.

**#4, mockup.** Leave room for a last-updated time, which car is being shown (the lidar serial `B2232377` works as an ID), the output of a button-triggered check, and the worst problem visible without scrolling. The professor wants battery, joysticks, camera, lidar, WiFi, CPU, RAM, GPU and temperatures all at the top, plus the node count and topic state, with a camera picture and a lidar radar view - both now built (2026-09-23). See [instructor-interview.md](instructor-interview.md).

## Closed on 2026-09-16

- **The `/ackermann_drive` remap (S-22, S-23).** The remap is a no-op on a topic that does not exist. `ackermann_mux` publishes on the literal name `ackermann_cmd`, while `bringup_launch.py:121` remaps `ackermann_cmd_out` - a name the node never uses. It works anyway because `ackermann_to_vesc` subscribes to `ackermann_cmd` too, so both ends meet on the unremapped default. **S-22 and S-23 watch `/ackermann_cmd`.** The remap line is inherited dead config. **Delete it rather than repair it** - making it match would move the mux output to `/ackermann_drive` while `ackermann_to_vesc` still listens on `ackermann_cmd`, silently breaking the drive chain. **Deferred on purpose:** it is inert, and it belongs with the next round of work in `f1tenth_system`.
- **rosbridge client limit.** **Exactly 10 simultaneous clients.** 5/5, 10/10, 10 of 15, 10 of 25 - the same number every time, independent of machine load. There is no connection cap: `/client_count` counted all 25, so rosbridge registers every client and then feeds only ten. The surplus clients report "connected, but no messages", which on the dashboard is indistinguishable from a dead robot. It recovers on its own within 30 s, and there is no `max_clients` launch argument to raise it. Cause not identified and not worth chasing, since there is no knob either way. **Your own open tab is one of the ten.**
- **E-stop timing (S-03, S-23) - CLOSED.** Three captures on blocks with the link dropped at a known moment. **The software takes 19-22 ms to stop commanding** after the controller link drops - 17-18 ms of that is Bluetooth teardown and about 2 ms is the entire ROS path, and it does not change with speed. **`mux.yaml`'s 0.2 s does not delay the output at all**: `ackermann_mux` forwards message by message, and measured pass-through was 0.2 ms, so there is no stale-command window. Everything else is coast-down: **880 ms and 914 ms from 5.05 m/s** (4% spread), 281 ms from quarter speed, about 5.6 m/s² equivalent. **Caveat: on blocks with the wheels unloaded, so this is drivetrain coast, not a stopping distance - on the ground it will be longer.** Measured with `prototype/tools/estop_capture.py`.
- **Controller battery (S-18) - CLOSED as not worth the cost. Drop it from #1.** All three remaining routes were tried on robot #2. `upower -e` lists only `DisplayDevice`. The pad enumerates as HID `0005:054C:05C4.0003` bound to `hid-generic`, and `hid_sony` - the driver that creates `sony_controller_battery_*` - **is not built for this kernel**: `modprobe: FATAL: Module hid_sony not found in directory /lib/modules/5.15.148-tegra`. `/sys/bus/hid/drivers/` contains no `sony` entry to rebind to. Three independent confirmations: `hid_sony` is not built for `5.15.148-tegra` and `/sys/bus/hid/drivers/` has no `sony` entry to bind to; `upower -e` lists only `DisplayDevice`; and over Bluetooth the pad advertises **only HID (`0x1124`) and PnP Information (`0x1200`) - no Battery Service (`0x180F`)**, so BlueZ has nothing to expose whether or not its experimental battery reporting is enabled. The charge exists only inside the DS4's HID input report, which is what `hid-sony` decodes. The pad itself reports its charge - the limitation is entirely ours. Two routes exist and both cost about a day: build `hid-sony` out-of-tree against the JetPack kernel sources and ship a custom module to every car, or read `/dev/hidraw*` directly, which over Bluetooth means reimplementing the feature-report handshake `hid-sony` performs to switch the DS4 into its extended report - plus a udev rule for permissions. **The hidraw route carries a real risk to teleop**: requesting the extended report changes the pad's report format, and `hid-generic` parsed its descriptor expecting the basic one, so the axis and button mapping `joy_teleop.yaml` depends on could change. Risking the steering to display a battery percentage is a bad trade on a shared car. `ds4drv` and similar userspace drivers are worse - they create their own uinput device, so the car would enumerate two joysticks and `joy` would pick one non-deterministically. Neither is worth it for a nice-to-have number, and the kernel route is a change to shared hardware. The dashboard already says "not exposed by this driver", which stays the honest answer. **S-03's deadman check relies on Bluetooth connection state instead, which works and is enough.**
- **Buttons.** Built and working on the car. The page has a **Run joystick check** button that calls a `std_srvs/Trigger` service on `system_diagnostics.py` over the same websocket - no second port and no custom message package. It runs `joy_enumerate_devices` on the robot and names which of the three causes of a silent `/joy` applies: no controller, a pad SDL can open, or the seat-ACL trap where the pad is paired and connected but ROS cannot open `/dev/input/event*`. That third state is invisible on `/joy` alone and previously cost a session to diagnose by hand.

## Dropped from #1

- **Temperatures under load (S-05, S-10) - DROPPED 2026-09-21.** The plan was a 20-minute drive to find where CPU and VESC temperatures level off. The professor said we do not need to do it to measure temperatures. The provisional thresholds stand as the working ones: S-05 Degraded at 70 C (an Orin-family default), and S-10 Degraded around 65 C and Failed around 80 C, against the VESC's own `OVER_TEMP_FET` fault near 85 C. His reason was not recorded, so nothing here says they were validated against a loaded run. They were not. The procedure is kept in [block F of the notes](ros-status-spike-notes.md#block-f---s-05-the-thermal-baseline-under-load-dropped-2026-09-21) in case anyone wants it later.

That was the last open measurement from #1.

## Before any unattended run

- ~~**The systemd journal is volatile on this robot.**~~ **Done 2026-09-16** on robot #2 (`sudo mkdir -p /var/log/journal && sudo systemctl restart systemd-journald`). Reboots now leave a trace, so `journalctl -b -1` works after an unattended death. Still needs doing on the other cars.
- **Log the battery.** The pack died mid-session on 2026-09-16 and powered the robot off, and once again the dashboard was displaying the voltage while nothing was recording it - the same gap as the brownout on 2026-09-09. Worth having on any unattended run: `stdbuf -oL ros2 topic echo /sensors/core --field state.voltage_input | stdbuf -oL awk 'NR%50==0 {print strftime("%F %T"), $0}' >> ~/diag/batt.log &`
