# Spike: reading live status from ROS

Issue #2. Builds on #1 (subsystem inventory) and feeds #3 (form factor ADR), #8 (health schema) and #4 (interface mockup).

Everything here was measured on robot #2 (`f1-wsu-2`) over three sessions: 2026-08-31, 2026-09-02 and 2026-09-09. This page is a summary.

Full notes on everything, with every command, measurement and dead end, are in [ros-status-spike-notes.md](ros-status-spike-notes.md). Go there for anything this page leaves out.

## Picking this up

- **Getting on the robot.** Robot #2 is user `f1-wsu-2` at 192.168.1.202 on the lab WiFi. You have to be on that network, so in practice you have to be in the lab. SSH works, and NoMachine gives you its desktop.
- **Where the files are.** The prototype runs from `~/diag/` on robot #2. The same files are in [`prototype/`](../prototype/), and its README covers copying and starting them.
- **Checking a car.** With bringup running, `bash tools/baseline_capture.sh | tee baseline.txt` saves a full health snapshot, and `python3 tools/rosbridge_check.py` confirms rosbridge is passing data. Both are in `prototype/tools/`; copy that folder to `~/diag/` if the robot doesn't have it.
- **Only robot #2 has been measured**, and only robot #2 has the VESC temperature patch below. Expect other cars to differ until someone checks.
- **What to do next.** Block F in Section 5 of the notes: a 20-minute drive with two loggers running, which sets real temperature thresholds. It needs one person.

## Short version

We can read almost everything #1 asks for and show it live in a web page on any laptop, with nothing installed on the laptop. A working prototype runs on robot #2 today.

ROS already has a standard format for health reports (`diagnostic_msgs`), and two nodes we already run, the lidar driver and the command mux, publish it. We should display that rather than invent our own format.

About half of #1 (CPU temperature, disk, memory, Bluetooth, camera USB speed) is not in ROS at all. A small Python node reads those from the operating system and publishes them in the same standard format, so the page gets everything through one connection.

Getting the data turned out to be easy. The hard part is avoiding false alarms: a simple "is this topic stale" rule flagged 16 of 23 topics as broken on a healthy car.

## How the prototype works

The prototype is a proof of concept and is scrappy on purpose. The spike's job was to prove that a web page can show live robot health, not to ship the final tool. Three files in [`prototype/`](../prototype/) run on the robot:

| File | What it does |
|---|---|
| `start_diagnostics.sh` | Starts four things: bringup, `system_diagnostics.py`, rosbridge, and a small web server for the page. Ctrl+C stops all of them, and `--status` / `--stop` work over SSH |
| `system_diagnostics.py` | A ROS node that checks the operating system once a second and publishes ten statuses to `/diagnostics`: Thermal, Power, CPU, Memory, Storage, Network (including a ping to the lidar), VESC device, Camera, Gamepad and Clock |
| `dashboard.html` | The whole page in one file, with no dependencies. Shows running nodes, topic health, battery, lidar health and the system panel |

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
| Subscribing to everything unthrottled wedged rosbridge | Throttle every subscription. How many open dashboards rosbridge can handle is untested |

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

Open questions from #1 that are now answered: the lidar is at 192.168.0.10 on its own Ethernet link; L1 is `buttons[4]` and R1 is `buttons[5]`; `/sensors/core` publishes at 50 Hz; the mux drops an input after 0.2 s of silence; the DS4 charge is not under `/sys/class/power_supply/`; and S-19's domain ID risk (2026-09-14) - robot #2 is `ROS_DOMAIN_ID=202` and robot #6 is `206`, confirmed on hardware with both cars up at once, dashboards open in separate tabs, and no node/topic bleed-through between them (only 2 of the fleet checked so far).

## What this means for the other issues

**#3, form factor.** A web page is viable, and most of it is already built. A separate "status server" is not really a separate option, because rosbridge already is one. Two things still need deciding: whether rosbridge should be reachable from the whole lab network, given it can drive the car, and whether a physical indicator should show the deadman and controller link, since the wireless failure that loses the deadman can also lose the page.

**#8, health schema.** Adopt `diagnostic_msgs` instead of a custom format. Add a topic class, a `depends_on` field (when the VESC link fails, battery, motor and odometry fail with it), and keep "could not check" separate from "passed".

**#4, mockup.** Leave room for a last-updated time, which car is being shown (the lidar serial `B2232377` works as an ID), the output of a button-triggered check, and the worst problem visible without scrolling.

## Still open from #1

- **E-stop timing (S-03, S-23).** How long the car takes to stop after the controller link drops. The mux cuts at 0.2 s, but the VESC's own timeout is unknown. Needs two people and the car on blocks.
- **Temperatures under load (S-05, S-10).** A 20-minute drive to find where CPU and VESC temperatures level off, so thresholds are based on real numbers. Runs unattended.
- **Controller battery (S-18).** A few routes are untried. Drop the check if none work.
- **The `/ackermann_drive` remap (S-22, S-23).** Why the mux output shows up as `/ackermann_cmd`. No hardware needed.

Step-by-step procedures for each are in [Section 5 of the notes](ros-status-spike-notes.md#5-closing-the-rest-the-on-robot-session-plan).

## Not tested yet

- **rosbridge client limit.** How many open dashboards it can serve.
- **Buttons.** The page already sends requests to the robot and gets answers (it calls `/rosapi/nodes` to build the node list), but no button that runs a check on the robot has been built or tested.
