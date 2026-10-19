# Spike notes: reading live status from ROS (full session record)

The summary is in [ros-status-spike-summary.md](ros-status-spike-summary.md). This file keeps every measurement, command and correction from the three robot sessions. It was brought up to date on 2026-09-14: the prototype is in `prototype/` and runs on robot #2 from `~/diag/`, and the check scripts are in `prototype/tools/`.

Track 2 - robot-diagnostics. Closes the work described in issue #2. Reads from **#1 (subsystem inventory)**. Feeds **#3 (ADR: form factor)**, **#8 (health schema)** and **#4 (interface mockup)**.

> **Status.** Conclusive on the question it was asked. Every measurement below was taken on **robot #2 (`f1-wsu-2`)** running `bringup_launch.py` - not inferred from documentation. Anything still unsettled is in [Section 5](#5-closing-the-rest-the-on-robot-session-plan) with the procedure to close it.
>
> **Timebox:** three working sessions (2026-08-31, 2026-09-02, 2026-09-09). One was cut short by WiFi packet loss at roughly 90%. The third ran the session plan in Section 5; its results are folded in throughout and summarised in [Section 5](#block-a---safe-reads-complete-2026-09-09).
>
> **Written for someone who has never used ROS.** Section 0 is the background; skip it if you already know what a topic is.

---

## What we are building

A **single HTML file**. The robot serves it, a student opens it on their own laptop at the robot's address, and sees that robot's health. Nothing to install - no ROS, no Python, no npm, no browser extension. The same file works for every car; the address selects which one.

Three things on that page:

1. **ROS diagnostics, made digestible.** The robot's own nodes already report structured health. Today the only way to read it is a desktop GUI on a full ROS install. We render it as plain green and red rows.
2. **System state.** CPU temperature, disk, memory, Bluetooth, USB link speed, network. None of this is in ROS and none of it is visible anywhere today.
3. **A button that runs a check on the robot** and puts the output back on the student's page.

**This spike does not change that plan. It changes what we have to build to get there.**

The finding that matters: ROS already solved *collection*. Two nodes we run publish structured health right now, and the standard message format, the aggregator, and the transport to a browser all exist and work. What does not exist is **reach** (the only viewer needs a full ROS desktop install), **coverage** (most nodes report nothing), and **the entire system half** (nothing publishes CPU temperature or disk space).

So we are still building the diagnostics system. We are building it as **a readable layer over data that mostly already exists, plus a collector for the half that does not** - rather than re-implementing collection from scratch, which is what a team would do by default and which would take the whole semester.

**Is the page design feasible as described?** Yes for the ROS half, verified end to end on hardware. The system half is built too, as `system_diagnostics.py`. The button is not built yet. [Section 6](#6-does-the-page-design-actually-work) is the full answer.

---

## 0. Background: how the robot's software is put together

Skip if you know ROS. Everything after this assumes it.

**Nodes.** The robot's software is not one program. It is about a dozen small programs called *nodes*, each doing one job: one talks to the lidar, one talks to the motor controller, one reads the gamepad, one converts steering commands into motor commands. `bringup_launch.py` is the script that starts them all at once.

**Topics.** Nodes do not call each other. They post messages onto named channels called *topics*, and any node that cares subscribes to that name. `urg_node` publishes laser scans to `/scan`; anything wanting laser data subscribes to `/scan`. The publisher and the subscriber never know about each other - only about the name. That is why a diagnostics tool can read everything without any existing node being modified to cooperate with it.

**DDS.** Underneath the topics is **DDS - Data Distribution Service**, an industrial publish/subscribe standard that ROS 2 is built on. Think of it as the postal service. It does two jobs:

- **Discovery.** When a node starts, it announces itself over the local network and finds everyone else. There is no central server and nothing to configure. This is why `ros2 node list` can tell you what is currently running, and why our tool can join the network and immediately see the whole robot.
- **Delivery.** It carries each message from publisher to subscriber directly, across machines if needed, without passing through a broker.

Two consequences matter for us. First, **anything on a topic is readable by anyone on the network**, which is what makes this project possible at all. Second, **discovery happens inside a numbered "domain"** set by the `ROS_DOMAIN_ID` environment variable - two machines with the same number on the same network automatically see each other's nodes. That is a feature right up until several robots share a number, which was an open question for S-19 and is now closed for the two cars checked so far (Section 5, block E).

### Where the data actually lives

Two places, and the dashboard reads **both**:

| Source | What lives there | How you read it |
|---|---|---|
| **ROS topics** | anything a node measures: laser scans, wheel odometry, battery voltage, gamepad buttons, and the health those nodes report about themselves | subscribe to the topic |
| **The Jetson's operating system** | CPU temperature, load, disk, memory, whether the Bluetooth controller is connected, what speed the camera enumerated at, whether a network cable has a link | read a file under `/proc` or `/sys`, or run a command like `bluetoothctl`, `ping`, `df` and read its output |

**No ROS node publishes the second column.** Running a command and reading its output is the correct and only way to get those, and it is roughly half of #1's subsystem list. That work is fully in scope.

### The one thing that is not a source

**The log text scrolling in the bringup terminal.** That is only what nodes chose to `print` for a human. Battery voltage, laser ranges and steering commands never appear there - they travel over DDS directly between nodes. So for *robot state*, scraping that scroll gets you almost nothing.

The distinction is between **scraping a log that happens to be on screen** (wrong) and **deliberately running a program that reports a fact** (right, and half the dashboard).

The one specific command to avoid as a data source is `ros2 topic echo`. It is a debugging tool: each call starts a process, waits a second or two for DDS discovery, then hands back YAML text to parse. Perfect by hand, wrong as the spine of a live page. Subscribe instead. Commands like `iw`, `bluetoothctl`, `systemctl` and `df` have no such alternative and are exactly right.

### Worked example: the lidar splits across both

This is typical, and it is why the two-channel split matters.

- **Is it scanning, how fast, is the sensor reporting internal errors?** ROS. `urg_node` already publishes its measured rate, device status, error counts and lockout state to `/diagnostics` (Section 3). That is S-12, and it is mostly already done for us.
- **Is the Ethernet cable plugged in, and does the sensor answer at 192.168.0.10?** Not in ROS at all. `cat /sys/class/net/enP8p1s0/carrier` and `ping`. That is S-17.

Neither alone can tell a student "the cable fell out" versus "the driver crashed". Together they can, which is exactly the kind of thing this project exists to do.

---

## 1. What #1 established, and what it left open

#1 is confirmed on hardware and open on software configuration. Restated only as far as this spike touches it.

**Settled by #1:** the subsystem IDs S-01 to S-23; the states Healthy / Degraded / Failed with `unknown` as a required fourth; the two check patterns (liveness/rate, value-in-range); the tier 1 / tier 2 split; and the finding that the e-stop is a software deadman over a wireless link that **fails open**.

**Left open by #1, and therefore this spike's actual job:**

| #1 left open | Where it lands now |
|---|---|
| 6 explicit open questions (watchdog timeout, VESC command timeout, `/sensors/core` rate, lidar IP, DS4 charge, L1/R1 indices) | 4 answered, 1 answered negative, 1 still open - Section 5 |
| Every `[MEASURE]` threshold | idle baseline captured. The under-load temperature baseline (block F) was dropped 2026-09-21: the professor said the 20-minute run is not needed to measure temperatures, so those thresholds stay provisional |
| Four `[CONFIRM]` tags | 3 confirmed, 1 refuted - Section 3 |
| **The unstated assumption that each check is readable at all** | four checks are not buildable as written - Section 3 |

That last row is the one to flag. #1's own rule is that a definition is not finished until the check can be written. Four of them cannot be, and one of those is tier 1.

---

## 2. What ROS gives us

Four mechanisms. All four were exercised on the robot.

**1. The graph API answers "what is running".** `node.get_node_names_and_namespaces()` in `rclpy`, `ros2 node list` from a shell, or `/rosapi/nodes` over a websocket. All three ask DDS who is announcing themselves, so it reflects the live network rather than a config file. Measured roll call on a healthy robot, **11 nodes**: the 8 from `bringup_launch.py` plus `rosbridge_websocket`, `rosapi`, `rosapi_params`.

**2. Freshness only exists relative to a subscriber.** There is no "when did this topic last publish" query in ROS. The tool keeps its own `last_seen` clock per topic and derives age and rate from it. Types do not have to be known in advance:

```python
for topic, types in self.get_topic_names_and_types():
    msg_cls = get_message(types[0])          # rosidl_runtime_py.utilities
    self.create_subscription(msg_cls, topic, cb, qos, raw=True)   # raw skips deserialization
```

**3. `diagnostic_msgs` is a standard for exactly this, and we already run two publishers of it.** The most consequential finding in the spike.

| Component | What it does | Verdict |
|---|---|---|
| `diagnostic_msgs` | Standard wire format: `DiagnosticArray` of `DiagnosticStatus` (level OK/WARN/ERROR/STALE, name, message, key/value pairs) on `/diagnostics`. | **Adopt as #8's schema** |
| `diagnostic_updater` | Library a node uses to publish its own health. Ships ready-made frequency and timestamp checks. | **Adopt** |
| `diagnostic_aggregator` | Groups `/diagnostics` into a labelled tree, republishes rolled up on `/diagnostics_agg`. Anything listed as `expected` that never reports is marked **Missing**. | **Adopt - this is the dead-node detector** |
| `rqt_robot_monitor` | Desktop GUI for the tree. | **The gap** - needs a full ROS desktop install, which is the barrier we exist to remove |

The level enum maps straight onto #1's states: OK/WARN/ERROR/STALE against Healthy/Degraded/Failed/unknown. **#8 should adopt it rather than invent a parallel format.**

Integration cost is small. A watchdog using only stock `diagnostic_updater` went from `OK / "Desired frequency met" / 39.999 Hz` to `ERROR / "No events recorded"` when the lidar was killed. The whole body of the node:

```python
self.freq = du.HeaderlessTopicDiagnostic(
    'scan', self.updater, du.FrequencyStatusParam({'min': 40.0, 'max': 40.0}, 0.1, 5))

def on_scan(self, _msg):
    self.freq.tick()
```

**4. rosbridge carries all of it to a browser with no ROS install.** `rosbridge_server` is already declared in `f1tenth_stack/package.xml`, is installed on the robot, and starts cleanly. It exposes ROS over a WebSocket on port 9090 and translates to plain JSON in both directions. Because translation happens **on the robot**, the client needs no ROS and no message packages.

Verified from a client with no ROS installed and no `vesc_msgs` anywhere:

```
websocket handshake OK
nodes: /ackermann_mux /joy /rosapi /rosbridge_websocket /urg_node /vesc_driver_node ...
  /scan 16 · /odom 17 · /sensors/core 16 · /diagnostics 15   receiving data
/sensors/core decoded as plain JSON:  battery 12.3 V   fault_code 0
```

It is **not REST - there are no routes.** One socket, JSON messages with an `op` field:

```json
{"op":"subscribe",    "topic":"/scan", "throttle_rate":250}
{"op":"call_service", "service":"/rosapi/nodes", "id":"1"}
{"op":"publish",      "topic":"/drive", "msg":{...}}
```

**Publishing and service calls ride the same socket.** That is the detail that makes the "run a check" button cheap - see Section 6.

### What crosses the network, and what does not

| Check | On robot | Student laptop, same network | Note |
|---|---|---|---|
| Node list, topic list, types, publisher counts | yes | yes | pure graph metadata |
| Rate / freshness of stock message types | yes | **unreliable** | see below |
| Contents of `/sensors/core` | yes | **only via rosbridge** | native ROS needs `vesc_msgs` built locally |
| CPU, temperature, disk, USB, Bluetooth | yes | **no** | nothing publishes these |
| Anything at all, from a browser | yes | yes | **via rosbridge** |

**Custom message types do not travel natively.** A native ROS monitor on a laptop decoded `/sensors/core` fully with `vesc_msgs` present, and reported `cannot subscribe: vesc_msgs/msg/VescStateStamped not installed` without it. You still learn a publisher *exists* - you lose values, not liveness. **rosbridge removes this problem entirely**, because it deserializes on the robot where every message package already exists. This is a large part of why the browser design wins.

**Rate cannot be measured reliably from off-robot.** Subscribed over the network, `/scan` read 30.5 Hz and `/odom` read 30.3 Hz. On the robot the same topics are **40.0** and **50.1 Hz**. The numbers were network-limited, not real. **Rate must be computed on the robot and sent as a number**, never derived in the browser - exactly what `urg_node` already does. This is a requirement on the design, not a nicety.

---

## 3. Subsystem coverage: applying this to #1

For every subsystem in #1, where the signal comes from and how far it got. Status vocabulary:

- **Published** - a node we already run reports it; read it, do not rebuild it
- **Ready** - source verified on hardware, nothing blocking, write the check
- **Needs motion** - only meaningful while driving; must report `unknown` at rest
- **Blocked** - the hardware or firmware does not expose it as #1 specifies
- **Unstarted** - the node is not in bringup, or was never exercised

The last column points at the block in Section 5 that still has work to do.

| ID | Subsystem | Channel | Source, as verified on robot #2 | Status | Close |
|---|---|---|---|---|---|
| S-01 | Drive battery | ROS | `/sensors/core` → `state.voltage_input`. **50.020 Hz** measured. Read 12.7 V, then 12.3 V after running | **Ready** | - |
| S-02 | Compute power rail | system | **`tegrastats` runs with no sudo** and reports `VDD_IN` / `VDD_CPU_GPU_CV` / `VDD_SOC` in mW (4.94-5.18 W idle), plus `/proc/uptime` reset detection | **Ready** | done |
| S-03 | Deadman | both | `/joy` → `buttons[4]` L1, `buttons[5]` R1, confirmed from `joy_teleop.yaml`. **Must gate on Bluetooth connection state** (S-18) | **Ready** | D |
| S-04 | CPU / GPU load | system | `/proc/loadavg`. **6 cores**, 1.95 / 1.37 / 1.10 idle | **Ready** | - |
| S-05 | Thermals | system | **`tj-thermal` is the junction temperature #1 asks for.** 47-51 °C idle across all zones over three sessions. **Read it from `tegrastats`**, not sysfs - see the EAGAIN correction below | **Ready.** Provisional threshold stands; loaded run dropped 2026-09-21 | F (dropped) |
| S-06 | Storage | system | **915 GB NVMe at 4% used**, 837 GB free. Not the cramped eMMC #1 assumes | **Ready**, low risk | - |
| S-07 | Memory | system | `/proc/meminfo`. 7.88 GB, ~63% available, swap unused | **Ready** | - |
| S-08 | Clock sync | system | `timedatectl` → `NTPSynchronized=yes`, TZ America/Denver | **Ready**, healthy | - |
| S-09 | VESC link | both | `/sensors/core` rate **50.020 Hz** (answers #1's `[CONFIRM]`) + `/dev/sensors/vesc -> ttyACM0` present | **Ready** | - |
| S-10 | Brushless motor | ROS | `fault_code`, `speed`, `current_motor`, `current_input`, `duty_cycle` all **confirmed live under load**. `temp_fet` is **live after a two-line driver fix** (31.4 C idle, climbing under load). `temp_motor` has **no thermistor fitted** - it reads -73.6 C and must be rendered as "absent", never as a temperature | **Buildable.** Provisional thresholds stand; loaded run dropped 2026-09-21 | F (dropped) |
| S-11 | Steering servo | ROS | `/commands/servo/position` exists; needs yaw rate from S-13 or S-15 while moving | **Confirmed** under motion (block B); still no position feedback | - |
| S-12 | LiDAR | ROS | **`urg_node` already publishes rate, bounds, device status, error counts, lockout.** `/scan` = 1081 ranges at 40.196 Hz | **Published**; content analysis still ours | - |
| S-13 | IMU | ROS | `/sensors/imu` 50.008 Hz, `/sensors/imu/raw` 50.062 Hz | Rate **ready**; confirmed live under motion (block B). Yaw drifts about 0.1 °/s, so check liveness only | - |
| S-14 | Depth camera | both | **RealSense D435i, serial 317622075395, FW 5.17.0.10, enumerated at 5000M.** Present and healthy. Publishes **no** `/diagnostics` and **no** compressed image topic; raw colour is 2.76 MB/frame | **Buildable**, but needs a `diagnostic_updater` wrapper and a compressed transport | - |
| S-15 | Wheel odometry | ROS | `/odom` 50.022 Hz, but **only after the car has been commanded once** - `vesc_to_odom` latches on the first servo command (see corrections) | Rate **ready** once gated; confirmed under motion at 5.04 m/s (block B) | - |
| S-17 | LiDAR Ethernet | system | `enP8p1s0` up at 192.168.0.15/24, carrier=1. Ping to **192.168.0.10**: 3/3, 0% loss, 0.187 ms. IP also published by `urg_node` | **Ready** | - |
| S-18 | Gamepad | both | `/joy` ~**48 Hz** connected. `bluetoothctl info <mac>` → `Connected: yes`. **Charge level unavailable** by #1's route | **Ready** minus charge | G |
| S-19 | ROS 2 node set | ROS | `/rosapi/nodes` - the only method correct on every attempt. Real list is 8 + 3 | **Ready**; #1's list is wrong | done |
| S-20 | TF tree | ROS | `/tf` 50.014 Hz, gated by the same servo-command latch as S-15; `/tf_static` is transient-local so **age is meaningless**. Bringup only gives `base_link → laser` | Partial - `map → odom` needs a nav stack | - |
| S-21 | Localization | ROS | `particle_filter` is not started by bringup | **Unstarted** | - |
| S-22 | Command mux | ROS | **`ackermann_mux` already publishes which input is live**: `masked`/`unmasked` per input plus `current priority` | **Published**, wrong topic in #1 | H |
| S-23 | Command freshness | ROS | `mux.yaml` sets `timeout: 0.2` on both inputs; mux publishes live `data age in [sec]`. **VESC-side timeout unknown** | Partial - the safety gap | **D** |

### Already built for us

**What is actually on `/diagnostics` right now.** Two publishers, three statuses, all level 0:

```
[OK] urg_node: Laser Scan topic status
       Actual frequency (Hz) 40.217438 · Target 40.000000 · acceptable 38.0-42.0

[OK] urg_node: Hardware Status - "Streaming"
       Device Status "sensor is working normally" · Locked out False
       Scan Retrieve Error Count 0 · Lidar Error Code 0
       IP Address 192.168.0.10 · Product Name UST-10LX · Device ID B2232377

[OK] ackermann_mux: Ackermann mux status - "ok"
       velocity topics.joystick    unmasked (listening to teleop @ 0.200000s, priority #100)
       velocity topics.navigation  masked   (listening to drive  @ 0.200000s, priority #10)
       current priority 0 · loop time in [sec] 0 · data age in [sec] 0
```

That is **most of S-12 and part of S-17 already done**, including lidar hardware health not available from `/scan` at all, and the sensor's IP - which answers one of #1's open questions from the robot itself. The bounds come from `diagnostics_tolerance: 0.05` in `sensors.yaml`. `Device ID B2232377` is a per-unit serial, which is a free way to show *which car* the page is looking at.

The mux line **answers S-22 outright**. `joystick: unmasked` appeared only once a controller was connected; with none attached both inputs read `masked`. It is a live, event-responsive signal today, and it confirms the 0.2 s input timeout S-23 needs.

> **Caveat:** `/diagnostics` interleaves a separate `DiagnosticArray` from *every* publisher, so a single message is never the whole picture. Merge by `status[].name` over a window - which is exactly what `diagnostic_aggregator` does for you.

**What is genuinely missing is coverage and reach.** Only `ackermann_mux` and `urg_node` self-report; the VESC, odometry and joy nodes publish nothing. And the only viewer is a desktop GUI on a matching ROS install. For nodes we cannot modify, a small node that watches topic liveness and publishes its findings as `DiagnosticStatus` closes the coverage gap without touching their source. The system half now lives in `system_diagnostics.py` (Section 6). The liveness-watching node is not built yet.

### Corrections - checks in #1 that cannot be built as written

- **S-10 reads `state.temperature_pcb`. That field does not exist** - it is commented out in `vesc_msgs/VescState.msg`. The real fields are `temp_fet` and `temp_motor`. Both read `0.0`, and **block B found out why: `vesc_driver` never publishes them.** The accessors `VescPacketValues::temp_fet()` and `::temp_motor()` are implemented correctly (`vesc_packet.cpp:167` and `:176`, reading payload bytes 1-4, which is exactly where `COMM_GET_VALUES` puts them), but `vesc_driver.cpp` assigns every *other* field into the message and silently skips those two - `grep -n 'temp_fet\|temp_motor' vesc_driver.cpp` returns nothing. The `0.0` we kept measuring was a default-initialised ROS field, never a sensor reading. **This is a two-line fix, not a dead subsystem** - and the fix was applied and verified the same day. `temp_fet` now reads a real, load-responsive board temperature; `temp_motor` reads -73.6 C, which is an open-circuit reading from a thermistor that was never fitted. See "The `temp_fet` patch" and "Patch result" below. `current_motor`, `current_input` and `duty_cycle` also read `0.0` at rest, and block B confirmed all three move properly under load. `voltage_input` and `fault_code` were usable throughout (`0 NONE`, `1 OVER_VOLTAGE`, `2 UNDER_VOLTAGE`, `3 DRV8302`, `4 ABS_OVER_CURRENT`, `5 OVER_TEMP_FET`, `6 OVER_TEMP_MOTOR`).
- **S-22 and S-23 treat `/drive` as the mux output. It is an input.** `mux.yaml` lists it as the `navigation` source. The output is `ackermann_cmd_out`, remapped in `bringup_launch.py` to `ackermann_drive` - but the topic actually on the robot is **`/ackermann_cmd`**, and `/ackermann_drive` does not exist. That remap appears to be a no-op. S-22/S-23 should watch `/ackermann_cmd`, and `/drive` should be expected to have **zero publishers** unless a nav stack is running.
- **S-19's roll call would fail on a healthy robot.** It lists `robot_state_publisher`, `particle_filter` and the RealSense node - none of which `bringup_launch.py` starts - and drops the `_node` suffix on three VESC nodes. Six false failures out of the box. The measured list is `joy`, `joy_teleop`, `ackermann_to_vesc_node`, `vesc_to_odom_node`, `vesc_driver_node`, `urg_node`, `ackermann_mux`, `static_baselink_to_laser`, plus `rosbridge_websocket`, `rosapi`, `rosapi_params`.
- **S-18's "an untouched gamepad still publishes at a steady rate" is correct only while connected.** Silent `/joy` is the **no-controller** state, not a fault: not connected → idle; connected → publishing; disconnected mid-run → idle again. Since "controller put down" and "controller died holding the deadman" produce an identical `/joy` signal, **S-18 must check Bluetooth connection state on the system side**, and **S-03 must gate on that** before saying anything about the deadman - otherwise it reports the e-stop failed every time someone sets the controller down. `bluetoothctl info <mac>` reporting `Connected: yes` is the signal that works. `/joy` also runs at ~48 Hz, not the configured `autorepeat_rate: 20.0`; the pad's own event rate dominates, helped by `deadzone: 0.01` turning stick noise into events.

- **`/odom` and `/tf` do not publish until the car has been commanded once. Confirmed in source and on hardware, 2026-09-09.** Measured: `/sensors/core` at 49.990 Hz and `vesc_to_odom_node` present in the node list, but **zero messages on `/odom` or `/tf` in 7 s** on a healthy car. Holding L1 and moving the stick started both at 50.00 Hz immediately.

  The cause is `vesc/vesc_ackermann/src/vesc_to_odom.cpp:102`:

  ```cpp
  if (use_servo_cmd_ && !last_servo_cmd_) {
    return;              // early return, before both the /odom publish and the TF broadcast
  }
  ```

  `use_servo_cmd_to_calc_angular_velocity` defaults to `true` and `f1tenth_stack/config/vesc.yaml:36` sets it `true`, so the node discards every VESC state message until a `sensors/servo_position_command` arrives. The chain is **controller → `/teleop` → mux → `ackermann_to_vesc_node` → servo command → odometry unlatches**.

  **It is a one-way latch.** `last_servo_cmd_` is assigned at line 190 and never cleared, so:

  | Situation | `/odom`, `/tf` |
  |---|---|
  | bringup, controller never touched | **silent indefinitely** - and the car is healthy |
  | one servo command, ever | **50 Hz forever after**, even if the controller is then switched off |

  **This is a second false-alarm class like the `/joy` one, and the naive fix is also wrong.** Gating on "is a controller connected right now" would report Failed for a car that was driven earlier and then had its pad powered down. The correct rule is: **`/odom` and `/tf` silence is only diagnostic after the car has been commanded once this session** - before that, S-15 and S-20 are `unknown`, not Failed. That is another concrete argument for #1's fourth state.

  Note the corollary for S-15: once latched, `/odom` keeps publishing off VESC state regardless of what the drivetrain is doing, so **`/odom` liveness proves the VESC is alive (S-09), not that odometry is meaningful.** S-15's real check remains the scale comparison under motion.
- **The thermal-zone EAGAIN is transient and rotates between zones**, so an earlier version of this document was wrong to say "`cv0/1/2` are unreadable, skip them". In one session `baseline_capture.sh` failed on `cv0/1/2` and read `soc1/soc2/tj` fine, while a raw `cat` seconds later did the exact opposite. **Guard every read and retry, or read thermals from `tegrastats`**, which returned all six named zones cleanly on every attempt and needs no sudo.

### One liveness rule is not enough

#1 proposes a general staleness rule: Degraded at 2x the expected period, Failed at 2 s. Applied uniformly to the real topic list it flagged **16 of 23 topics as broken on a completely healthy car.** Topics need a declared class:

| Class | Examples | Rule |
|---|---|---|
| `continuous` | `/scan`, `/odom`, `/sensors/*`, `/tf`, `/diagnostics` | rate + staleness; #1's rule applies |
| `event` | `/teleop`, `/ackermann_cmd`, `/commands/*`, `/joy` | **silence at rest is normal** |
| `latched` | `/tf_static` | published once, transient-local; **age is meaningless** |
| `input` | `/drive`, `/commands/motor/{brake,current,...}`, `/joy/set_feedback` | the stack subscribes; **zero publishers is correct** |

Adding those four classes took the same robot from 16 flagged to **0**. A dashboard that lights up red on a healthy car trains students to ignore it, which is worse than not building one. This is a sharper version of #1's own `unknown` finding and it should shape the schema in #8.

### A fourth signal #1 does not have: running-but-silent

#1's states are defined by observable signal, which is right, but three independent ROS signals split "not producing data" into four causes a student needs told apart:

| Node in graph | Publisher exists | Message arrived | State | Meaning |
|---|---|---|---|---|
| no | no | no | `NODE_DOWN` | process crashed or never started |
| yes | yes | no | `SILENT` | alive but producing nothing - unplugged sensor, hung driver |
| yes | no | no | `NOT_ADVERTISED` | started but failed to open its device |
| yes | yes | yes | `OK` | healthy |

Verified by breaking the lidar two ways. Same symptom to a student, different diagnosis:

```
# urg_node process killed
  urg_node   DOWN        /scan   NODE_DOWN   0 publishers   0 messages
# urg_node alive, stopped publishing
  urg_node   UP          /scan   SILENT      1 publisher    0 messages
```

**The publisher count is the discriminator, and it costs one graph call.**

---

## 4. What this spike already answered

| #1's question | Answer |
|---|---|
| Lidar's configured IP | **192.168.0.10** - in `sensors.yaml`, and published on `/diagnostics` by `urg_node` |
| `joy_teleop` L1/R1 button indices | **L1 = `buttons[4]`, R1 = `buttons[5]`** - from `joy_teleop.yaml` |
| `/sensors/core` publish rate | **50.020 Hz** measured on-robot |
| Is there a stale-command watchdog? | **Partly.** `mux.yaml` sets `timeout: 0.2` on both inputs and the mux publishes `data age in [sec]`. VESC-side timeout still unknown |
| Is the DS4 charge exposed under `/sys/class/power_supply/`? | **No** by that route - four untried alternatives in block G |

**Idle `[MEASURE]` baselines captured:** 6 cores, load 2.28 / 1.29 / 0.96 · `tj-thermal` 51 °C idle on 2026-09-02 (cpu 51, gpu 50, soc 48-50) and 47-50 °C in later sessions · 7.88 GB RAM, ~63% available · NTP synchronised · VESC at `/dev/sensors/vesc -> ttyACM0` · 915 GB NVMe at 4%.

Two surprises worth folding back into #1: **storage is a non-issue**, not the cramped eMMC S-06 assumes; and **the lidar has its own physically separate network**, so S-17 has a dedicated interface to check and lidar traffic never competes with dashboard traffic.

---

## 5. Closing the rest: the on-robot session plan

Blocks A, B and C are done (2026-09-09). Block E is done (2026-09-14). Blocks D, G, H and I were closed on 2026-09-16. Block F was dropped on 2026-09-21, so nothing is open. The procedures are kept so they can be repeated on other cars. **Block D needed the car on blocks with the wheels free.** Blocks B, C and D needed a charged pack, and so would F if anyone ever runs it.

Everything goes into one directory so it can be pasted back into this document:

```bash
mkdir -p ~/session_$(date +%F) && cd ~/session_$(date +%F)
hostname; echo "ROS_DOMAIN_ID=$ROS_DOMAIN_ID"      # confirm which car, first line of every log
```

### Block A - safe reads (COMPLETE, 2026-09-09)

```bash
bash ~/diag/tools/baseline_capture.sh | tee baseline.txt   # prototype/tools/ in the repo
ros2 topic echo /sensors/core --once | tee vesc_rest.txt
ros2 topic echo /diagnostics --once | tee diagnostics_rest.txt
for z in /sys/class/thermal/thermal_zone*; do echo "$(cat $z/type) $(cat $z/temp 2>/dev/null || echo NA)"; done
tegrastats --interval 1000 | head -5 | tee tegrastats.txt
```

**Ran on robot #2, bringup and rosbridge up, no controller attached, pack at 11.3 V.**

| Result | Consequence |
|---|---|
| **`tegrastats` needs no sudo** and prints all six named thermal zones plus `VDD_IN 4.94-5.18 W`, `VDD_CPU_GPU_CV`, `VDD_SOC` | **Closes S-02**, and is the better source for S-05 than sysfs. One parse serves both |
| Idle thermals **47-48 °C** on every zone (`tj@48.031C`) | Lower than the 51 °C first captured. The Healthy floor is ~48 °C, not 51 |
| **`/odom` and `/tf`: no messages in 7 s** while `/sensors/core` ran at 49.990 Hz | New finding, root-caused in source. Both are gated behind a one-way servo-command latch - see the corrections above |
| `/scan` **39.826 Hz** by `ros2 topic hz`, but `urg_node` self-reported **40.067 Hz** in the same window | Reinforces "let the node compute the rate". The external measurement reads low even on-robot |
| Node list: daemon **11 nodes**, `--no-daemon` **7** - missing `urg_node`, `vesc_driver_node`, `vesc_to_odom_node`, `joy_teleop` while `/scan` and `/sensors/core` were demonstrably publishing | **Third contradictory result.** `baseline_capture.sh` labels `--no-daemon` "authoritative" - that label was wrong and has since been fixed in the script |
| Thermal zones: `baseline_capture.sh` could not read `cv0/1/2`; a raw `cat` seconds later could not read `soc1/soc2/tj` | The EAGAIN is transient and rotates. See corrections |
| Battery **11.3 V at rest** | 0.2 V above #1's Degraded line, and the first sample we have taken anywhere near it. Record it as a real threshold data point |
| `controller_id: 77` on the VESC | A second free per-unit serial alongside the lidar's `B2232377`. Either can identify which car the page is showing |
| Memory 6.22 GB of 7.80 GB available (80%), NVMe 31 G of 915 G used, NTP synchronised, lidar ping 3/3 at 0.224 ms, `enP8p1s0` carrier=1 | S-04, S-06, S-07, S-08, S-17 all confirmed Healthy and buildable as specified |

### Block B - S-10, the motor and its temperatures (COMPLETE, 2026-09-09)

**Before you start, if you repeat this on another car.** Charge or swap the pack first. This block holds throttle for 60+ seconds, a sagging pack skews the numbers, and the Orin runs off the same pack, so a brownout also loses the run. Then connect the controller and drive the car once, because `/odom` and `/tf` stay silent until the first servo command (see the corrections in Section 3):

```bash
ros2 param get /vesc_to_odom_node use_servo_cmd_to_calc_angular_velocity   # not `use_servo_cmd`
# connect the pad, hold L1, nudge the stick, then:
ros2 topic hz /odom
ros2 topic hz /tf
```

**Why this block was run.** `temp_fet` and `temp_motor` both read `0.0`, and so do `current_motor`, `current_input` and `duty_cycle`. Every one of those readings was taken with the car stationary and the motor unenergised, which proves nothing. Either the VESC genuinely reports no temperature, or we have simply never looked while it had something to say. That distinction decided whether a tier-1 subsystem exists.

**Step 1 - what firmware the driver is talking to.** The VESC's `COMM_GET_VALUES` reply is a packed byte layout that changes between firmware versions; if `vesc_driver` expects a different version, fields land at the wrong offsets and read as garbage or zero.

```bash
grep -iE 'firmware|version|vesc' bringup.log | tee vesc_firmware.txt
ros2 param dump /vesc_driver_node | tee vesc_params.txt
```

**Step 2 - full field dump at rest**, so there is a before:

```bash
ros2 topic echo /sensors/core --once | tee vesc_rest_full.txt
```

Record `temp_fet`, `temp_motor`, `ntc_temp_mos1/2/3`, `current_motor`, `current_input`, `duty_cycle`, `speed`, `voltage_input`, `fault_code`.

**Step 3 - under load. Car on blocks, wheels free, nothing near them.**

```bash
timeout 90 ros2 topic echo /sensors/core --csv > vesc_load.csv
```

While that runs: hold **L1**, apply throttle, ramp up and hold for a good 60 seconds. A motor that is turning freely draws very little current, so hold a meaningful throttle rather than blipping it.

**Step 4 - read the result.** Use this table if you repeat the block on another car.

| What `vesc_load.csv` shows | What it means | What to do |
|---|---|---|
| `speed`, `current_motor`, `duty_cycle` all move **and** `temp_fet` moves | Everything works | Capture idle and loaded temps as the `[MEASURE]` baseline |
| Current, duty and speed move but **temps stay exactly `0.0`** | The driver is not copying the temperature fields into the message. This is what robot #2 showed | Apply [the `temp_fet` patch](#the-temp_fet-patch) and run it again |
| **Nothing moves**, including `speed` | The motor is not being commanded, or the packet layout is wrong | Check `/commands/motor/speed` is non-zero first (`ros2 topic echo /commands/motor/speed`). If commands are flowing and nothing moves, it is a firmware/driver mismatch - a real finding, and a different issue |

**Step 5 - while the wheels are already turning, bank three more subsystems for free.** These all need motion and are otherwise blocked:

```bash
timeout 60 ros2 topic echo /odom --field twist.twist.linear.x --csv > odom_load.csv    # S-15
timeout 60 ros2 topic echo /sensors/imu --csv > imu_load.csv                           # S-13
timeout 60 ros2 topic echo /commands/servo/position --csv > servo_load.csv             # S-11
```

Steer left and right through the run. S-11 needs commanded steering against observed yaw rate, and this is the only way to get a sample of both.

### Block B results - 2026-09-09

**Firmware, from the bringup banner:**

```
[vesc_driver_node-5] Connected to VESC with firmware version 6.5
[vesc_driver_node-5] -=60_MK4=- hardware paired 0
[urg_node_driver-6] Connected to network device with ID: B2232377
```

VESC firmware **6.5** on **60_MK4** hardware, so the packet layout the driver assumes is the current one. Lidar `B2232377` - this is also the number that identifies **which car** a dashboard is showing (see Section 6), and `controller_id: 77` from the VESC is the second.

**Under load, on blocks, ~60 s of throttle and full left-right steering:**

| Field | At rest | Under load | Verdict |
|---|---|---|---|
| `current_motor` | `0.0` | **peak 51.3 A** | Live |
| `current_input` | `0.0` | **peak 5.7 A** | Live |
| `duty_cycle` | `0.0` | **peak 0.351** | Live |
| `speed` (eRPM) | `0.0` | **peak 22 958** | Live |
| `voltage_input` | 11.5 V | sags to **11.4 V** | Live, and the sag is only 0.1 V |
| `fault_code` | 0 | **0 throughout** | Live |
| `temp_fet` | `0.0` | **`0.0`, every one of ~3 000 samples** | **Never published - driver bug** |
| `temp_motor` | `0.0` | **`0.0`, every sample** | **Never published - driver bug** |
| `ntc_temp_mos1/2/3` | `0.0` | `0.0` | Genuinely zero on the wire - see below |

Everything except the temperatures moved, which rules out "the motor was never commanded". And `voltage_input`, `pid_pos_now` (315.0), `controller_id` (77) and `avg_vd`/`avg_vq` all decoded sensibly, which rules out a packet-layout mismatch: those fields sit at offsets 27, 54, 58 and 65-72, so if the byte alignment were wrong they would be garbage too.

**So why exactly `0.0`?** Two different reasons, and it matters which is which:

- **`temp_fet` and `temp_motor` are a driver omission.** `vesc_driver.cpp` populates `voltage_input`, `current_motor`, ..., `ntc_temp_mos1/2/3`, `avg_vd`, `avg_vq` - and never touches `state_msg.state.temp_fet` or `.temp_motor`. The parsing functions exist and are correct; nothing calls them. The published `0.0` is an unassigned message field.
- **`ntc_temp_mos1/2/3` really are zero on the wire.** These are assigned (`vesc_driver.cpp:185-187`) from payload offsets 59-64, and the neighbouring fields at 54-58 and 65-72 decode correctly, so the read is sound. Most VESC hardware only populates the per-bank MOSFET sensors on multi-bank designs. **Expected. Drop these three from any check.**

#### The `temp_fet` patch

Two lines in `vesc/vesc_driver/src/vesc_driver.cpp`, next to the existing assignments:

```cpp
    state_msg.state.temp_fet = values->temp_fet();
    state_msg.state.temp_motor = values->temp_motor();
```

Then rebuild and restart bringup. On this Jetson the plain build aborts, because the workspace is sourced in `.bashrc` and so `install/` becomes its own underlay, and because six parallel jobs exhaust the ~5 GB of free RAM. This is the command that works:

```bash
colcon build --packages-select vesc_driver --allow-overriding vesc_driver --parallel-workers 1
```

Treat the patch as the actual Block B deliverable. It is a defect in a repo we control, found by instrumenting a subsystem we were about to declare dead.

#### Patch result - measured 2026-09-09

Rebuild finished in 24.2 s. Bringup restarted, then a ~16 s capture under sustained throttle (`vesc_temp_load.csv`, 50 Hz, ~800 samples).

| Field | At rest | Under sustained load | Verdict |
|---|---|---|---|
| `temp_fet` | **31.4 C** | **31.5 -> 33.3 C**, monotonic | **Live sensor**, responds to load |
| `temp_motor` | **-73.6 C** | **-74.1 to -75.4 C**, uncorrelated noise | **No thermistor fitted** |
| `ntc_temp_mos1/2/3` | `0.0` | `0.0` | Unpopulated, exactly as predicted |
| `fault_code` | 0 | **0 throughout** | Clean run |

**`temp_fet` is real, and it is the S-10 signal we wanted.** It rose 1.8 C in 16 s of roughly 10-15 A average draw, and the rise is monotonic sample to sample. A stuck field or a misaligned byte read would not produce a smooth thermal ramp that tracks the throttle.

**`temp_motor: -73.6` is a better outcome than `0.0` would have been.** A large negative number cannot be an unassigned message field, so it is itself the proof that the patch is reading the wire. It is also not a temperature. It is the open-circuit signature of the VESC's TEMP input with nothing connected: the ratiometric NTC conversion runs off the end of its curve. Across the whole loaded capture it wandered about ±0.6 C at random, with no relationship to current, duty cycle or `temp_fet` - ADC noise on a floating pin, not a thermal signal.

**What the dashboard must do with it.** Render "no sensor fitted", not a number. Both obvious checks fail silently: "warn above 60 C" passes forever, and so does "warn if it reads exactly zero". **Guard on `temp_motor < -20` and treat that as absent hardware.** A student who sees `-73.6 C` on a dashboard files a bug; one who sees "not fitted" learns something true about the car they are driving.

**S-10's `[MEASURE]` baseline is started, not finished.** Idle floor **31.4 C**; 16 s of load buys **33.3 C**, nowhere near steady state. The VESC's own `OVER_TEMP_FET` fault trips near 85 C, so Degraded around 65 C and Failed around 80 C is the sane starting shape - but nothing has confirmed the curve actually flattens below it. **The 10-minute loaded run that would have closed this was dropped on 2026-09-21**: the professor said the run is not needed to measure temperatures. These stay the working thresholds, unvalidated under load.

#### The finding this capture produced by accident: voltage cannot be thresholded per sample

`voltage_input` swung **11.0 to 11.2 V inside the same second**, tracking throttle. Peak draw here was **25.3 A motor / 6.46 A input**, and every current spike pulled the rail down. Against #1's Degraded line of 11.1 V, a per-sample threshold on a 50 Hz topic would flip the battery between Healthy and Degraded dozens of times a second while nothing is wrong at all.

**That is a design constraint on the dashboard, not a battery problem, and it generalises to every threshold on a `continuous` topic.** A voltage check has to either evaluate a sag-tolerant window (a rolling minimum or median over several seconds) or qualify the sample by load (`current_input` near zero). Pick one and apply it consistently, or the page will look broken.

Sag is also a real signal in its own right. Earlier in the same session the pack sagged **0.1 V under 51 A**; by this capture it sagged **0.2 V under 25 A**. A pack that sags twice as far for half the current has drained, which makes **sag per amp a better state-of-health indicator than resting voltage** - and it is computable from two fields we already have.

**Also confirmed in the same run:**

| ID | Signal | Evidence | Verdict |
|---|---|---|---|
| S-11 | Commanded steering | `/commands/servo/position` swept **0.1178 - 0.9430**, centre **0.5304** | Confirmed. Still no position feedback, so this proves the *command*, not the servo |
| S-13 | IMU | `/sensors/imu` live; accel z **~1.04 g** at rest, gyro to **±22 °/s** during the maneuver | Confirmed |
| S-15 | Odometry | `twist.twist.linear.x` reached **5.04 m/s** with the wheels free | Confirmed - and it unlatched exactly as the servo-command latch predicts |

**One caution for anyone reaching for IMU yaw.** Fused yaw drifted from **124.12° to 125.19° in the first 10 s while the car sat still** - roughly 0.1 °/s of uncorrected gyro bias, about 6° per minute. Fine for "is the IMU alive", useless as a heading reference. Check S-13 for liveness and plausibility, never for absolute orientation.

### Block C - S-14, the camera (COMPLETE, 2026-09-09)

```bash
lsusb | tee lsusb.txt
lsusb -t | tee lsusb_tree.txt
for d in /sys/bus/usb/devices/*/; do [ -f "$d/speed" ] && echo "$d $(cat $d/speed)"; done | tee usb_speed.txt
ros2 launch realsense2_camera rs_launch.py camera_name:=rs &   # the robot's `cam` alias
ros2 topic list | grep -iE 'camera|color|depth|compress' | tee camera_topics.txt
ros2 topic hz /camera/rs/color/image_raw   # name depends on camera_name, see finding 2 below
```

Two more worth grabbing while the camera is up, both parallel to things we already did for the other subsystems:

```bash
rs-enumerate-devices -s              # serial number + firmware, if librealsense tools are installed
ros2 topic echo /diagnostics --once  # does realsense2_camera contribute here at all?
```

The **serial number** is S-14's identity field, the camera's equivalent of the lidar's `B2232377` and the VESC's `controller_id: 77`. **Two different numbers claim that name on this camera.** `rs-enumerate-devices` reports `317622075395`, while the USB descriptor in sysfs (`/sys/bus/usb/devices/2-2/serial`) reports `327743063048`. Both are real; they are not the same field. Label whichever one you display, because an unlabelled mismatch will have someone concluding the wrong camera is plugged in. A dashboard that names the hardware it is talking to is worth far more than one that says "camera". The **`/diagnostics` question** matters because the whole design leans on that topic: if `realsense2_camera` already publishes there, S-14 is mostly free; if it does not, the camera needs its own `diagnostic_updater` wrapper like `/scan` has.

Two things to establish. **Is it there at all** - if `lsusb` shows no Intel device, S-14 cannot be built and the inventory should say so. **What speed did it enumerate at** - `5000` is USB 3.0 and healthy, `480` is USB 2.0 and is exactly the silent Degraded case #1 exists to catch. A snapshot needs a compressed or downscaled frame, never raw (finding 3 below), and **only one process can open a RealSense at a time**, so the backend must never shell out to `rs-capture` while the node is running.

### Block C results - 2026-09-09

**S-14 exists and it is healthy.** The earlier "USB3 device present but `lsusb` matched no RealSense" was simply an unplugged camera.

| Fact | Value |
|---|---|
| Model | Intel RealSense **D435i** (`8086:0b3a`) |
| Serial | **317622075395** |
| Firmware | 5.17.0.10 |
| librealsense / ROS wrapper | 2.56.4 / 4.56.4 |
| USB link | **5000M** on a 10000M root hub; the node self-reports "USB type: 3.2" |
| Colour stream | 1280x720 @ 30, RGB8 |
| Depth stream | 848x480 @ 30, Z16 |

The camera enumerated at full USB 3 speed, so **the silent-Degraded case #1 exists to catch is not present on this car.** The check is now fully specified anyway: read `speed` from the camera's sysfs node and compare against 5000.

**The USB topology is worth recording, because it is reassuring.** The camera sits alone on bus 002 behind a Realtek USB 3.0 hub, while the **VESC** (`0483:5740`, 12M) and the **Bluetooth radio** (`13d3:3549`, 12M) share bus 001 behind a USB 2.0 hub. Camera bandwidth therefore cannot starve the motor link or the controller. It also means S-09 and S-18 share a failure domain: if bus 001 resets, you lose the VESC and the gamepad together.

#### Five findings that change the design

**1. The launch command in this document was wrong.** `rs_launch.launch.py` does not exist. The file is `rs_launch.py`, and the robot's `cam` alias already has the working invocation. Corrected above.

**2. Camera topic names depend on the launch invocation, so they cannot be hardcoded.** The `cam` alias passes `camera_name:=rs`, which produces `/camera/rs/color/image_raw`. The wrapper's own default would give `/camera/camera/color/image_raw`, and `cam_full` differs again. **An EXPECTED list with a literal camera topic name will report a false `NODE_DOWN` the moment someone launches with a different alias.** Discover camera topics by prefix (`/camera/`) or by owning node, never by literal name. This is the one place in the stack where the topic map is not fixed.

**3. There are no compressed topics, and raw is not transportable.** The only image topics are `color/image_raw` and `depth/image_rect_raw`. At the default profile that is:

| Stream | Per frame | At 30 Hz |
|---|---|---|
| Colour 1280x720 RGB8 | **2.76 MB** | **83 MB/s** |
| Depth 848x480 Z16 | 814 KB | 24 MB/s |

For comparison, `/scan` is 19 KB per message. **A camera snapshot cannot come off `image_raw` over rosbridge** - a single colour frame is 145 times a lidar scan before JSON encoding inflates it further. Three options, in order of preference: install the `image_transport` compressed plugins and subscribe to `/compressed` (~50 KB), launch at a much smaller colour profile, or have the backend grab and downscale a frame on the robot and ship a JPEG. **Do not put the camera on the live dashboard at all** - make it an on-demand button, which is what the page design already proposed.

**4. `realsense2_camera` does not publish to `/diagnostics`.** The array contained only `urg_node`'s two entries. So S-14 gets no free ride: it needs its own `diagnostic_updater` wrapper, exactly like the one demonstrated for `/scan`. That wrapper is about ten lines and is the same code either way, so this is cost, not risk.

**5. `ros2 topic echo /diagnostics --once` is misleading, and this document used it.** Each publisher sends its own `DiagnosticArray`. `--once` returns **one array from one publisher**, not the union. The sample above showed only `urg_node` and therefore looks like `ackermann_mux` stopped reporting, which is not what happened. **The dashboard must accumulate `/diagnostics` over a window keyed by `status[].name`, never render a single message.** A one-shot read of this topic will make live components look missing. It is now listed in Section 7.

**One cosmetic note.** The `cam` alias passes `rgb_camera.power_line_frequency:=2` and the node warns `Could not set param ... with 3 Range: [0, 2]`. The setting is silently not applied, so the colour stream is not doing 60 Hz flicker compensation. Harmless for diagnostics, worth fixing in the alias.

### The session's own brownout - S-02 validated the hard way

**While the camera was running, the robot dropped off the network entirely.** SSH went to `Connection timed out` and stayed there for minutes before recovering. The pack was later found at **10.9 V**, below #1's Degraded line of 11.1 V and heading for its Failed line.

We cannot prove the low pack caused the dropout rather than the known-flaky WiFi, and the honest record is that both were true at once. But the important part is not the root cause:

> **The dashboard was displaying the live battery voltage the whole time, and nobody was looking at it.**

That is the single strongest argument in this document for the page design, and it arrived by accident. A number that is merely *displayed* does not prevent the failure it predicts. #1's Degraded and Failed levels have to **change how the page looks** - colour, ordering, a banner - and the worst subsystem has to be visible without scrolling. Passive telemetry is what we already have; making it impossible to ignore is the actual deliverable.

Two concrete consequences:

- **S-02 stays tier 1 and gets a real threshold.** 10.9 V is the first observed number on the way down. Combined with the sag finding from block B, the battery check should evaluate a sag-tolerant window and escalate visually, not just print a float.
- **Add "robot unreachable" as a first-class dashboard state.** The page is served from the robot it monitors, so when the robot browns out the page does not go red, it goes *blank* or stale. A student sees a frozen page, not an alarm. The client must track its own websocket liveness and say **"lost contact with 192.168.1.202 at 14:25:02"** on its own, with no help from ROS. This is the one check that cannot live on the robot.

### Block D - S-23 and S-03, the actual e-stop (CLOSED, 2026-09-16)

This is the one safety-relevant unknown left in #1, and #1 calls it its highest-priority question. The mux side is confirmed at 200 ms. The VESC's own command timeout is not.

**Correction to the earlier version of this block: `ros2 topic echo --csv` prints the message fields and no timestamp**, so the CSVs it produces cannot answer a timing question at all. Noting the wall-clock second by hand does not work either - the interval being measured is about 200 ms. Use `prototype/tools/estop_capture.py`, which subscribes to all four topics at once, records an arrival time per message, and prints the intervals.

```bash
# on the robot, with bringup running and THE CAR ON BLOCKS
python3 ~/diag/tools/estop_capture.py --kill-after
```

Hold the deadman (L1) and bring the wheels up to a steady speed during the countdown. It disconnects the pad for you at a known moment. Let the wheels coast to a stop, then Ctrl+C.

**Do not try to drop the link by hand.** Measured 2026-09-16: the DS4 will not power off from the PS button while sticks and buttons are active, so the first attempt at this block recorded `/joy` still publishing five seconds after the last command - a run that measured a deadman release, not a link loss. Walking out of range works but adds the Bluetooth supervision timeout to every number. `bluetoothctl disconnect` reaches ROS by the identical path: `joy` stops receiving events and `/joy` stops publishing. Reconnect with the PS button or `bluetoothctl connect <mac>`.

Without `--kill-after` the script still detects this and says so rather than printing a negative interval. It writes `estop_<timestamp>.csv` and prints:

```
  link lost -> mux stopped forwarding    200.0 ms
  mux stopped -> motor cmd stopped         0.4 ms
  motor cmd stopped -> wheels stopped   1200.0 ms
  TOTAL: link lost -> wheels stopped    1400.4 ms
```

- **`link lost -> mux stopped forwarding`** is the 200 ms from `mux.yaml`, measured rather than assumed. The script flags it if it is not in the 100-400 ms band.
- **`mux stopped -> motor cmd stopped`** should be ~0: `ackermann_to_vesc_node` reacts to each message as it arrives and has no timeout of its own.
- **`motor cmd stopped -> wheels stopped`** is the VESC's own command timeout plus mechanical coast-down. **This is the unknown the block exists to measure**, and the total is the number that belongs on the dashboard.

Separating the VESC's timeout from the coast is not possible from these topics alone - if it matters, repeat at two different speeds, since the coast component scales with speed and the timeout does not.

Do this twice. One sample of a safety number is not a measurement. The arithmetic has a no-hardware check: `python3 estop_capture.py --self-test`.

### Block D results - robot #2, 2026-09-16, car on blocks

Three captures. Link dropped with `bluetoothctl disconnect` at a known moment, deadman held throughout.

| | quarter speed | full, run 1 | full, run 2 |
|---|---|---|---|
| disconnect -> `/joy` stopped | 17.0 ms | 16.9 ms | 18.1 ms |
| disconnect -> last drive command | ~18 ms | 19.4 ms | 22.2 ms |
| last drive command -> last motor command | 0.2 ms | 0.2 ms | 0.2 ms |
| **coast to wheels stopped** | 281.3 ms | 879.7 ms | 913.5 ms |
| **TOTAL** | ~300 ms | **899.3 ms** | **935.9 ms** |
| peak speed | not recorded | 5.05 m/s | 5.04 m/s |

**The software is not what stops the car.** The command chain dies **19-22 ms** after the link drops, of which **17-18 ms is Bluetooth teardown** and about 2 ms is the whole ROS path. That latency is the same at quarter speed and full speed, as it should be - it is not a function of how fast the car is going.

**`mux.yaml`'s 0.2 s timeout is irrelevant to stopping, and the earlier assumption that it delays the output was wrong.** `ackermann_mux` forwards message by message; the timeout governs when a quiet input is *masked for priority*, not how long the output is held. Measured pass-through from `/ackermann_cmd` to `/commands/motor/speed` was **0.2 ms** in all three runs. S-23's "stale command watchdog" question is answered: there is no stale-command window to speak of.

**Everything else is coast-down, and it scales with speed.** Two samples at 5.05 m/s gave 880 ms and 914 ms - a spread of 4%, so the number is repeatable. Equivalent deceleration is about **5.6 m/s²**.

**The caveat that must travel with these numbers: the car was on blocks with the wheels unloaded.** This measures drivetrain coast-down, not a stopping distance. On the ground the vehicle's mass keeps the wheels driven for longer, so real stopping takes **more** time and distance, not less. Multiplying 5.05 m/s by 0.9 s gives roughly 2 m, but that figure is optimistic and should not be quoted as a stopping distance without an on-ground measurement.

**What belongs on the dashboard:** the fixed ~20 ms of software latency is worth stating once, in documentation, not as a live tile - it does not vary. What varies is speed, and the useful live statement is that the car coasts for about a second from full speed after losing its controller.

**Two things this block uncovered along the way:**

- **`/joy` goes `IDLE` the instant the link drops** (17 ms), and the GAMEPAD tile agreed - both channels correctly reported the disconnect. This is the S-18 two-channel design working: `/joy` alone reads `IDLE` for "pad set down", "pad died" and "ROS cannot open the device" alike, and only the GAMEPAD tile separates the first two.
- **The GAMEPAD tile lagged by up to a full 10 s probe cycle**, because `bluetoothctl` runs on the slow thread. For a tile S-03 depends on, that was too slow. Fixed 2026-09-16: `system_diagnostics.py` now lists `/dev/input/js*` in the 1 Hz path, which vanishes the moment the pad disconnects, and uses `bluetoothctl` only for the device name. Detection is now sub-second.

### Block E - S-19, the domain ID question (CLOSED, 2026-09-14)

If robots share a `ROS_DOMAIN_ID`, DDS discovery is multicast and each robot enumerates every other robot's nodes, which **breaks the node roll call directly**.

```bash
echo $ROS_DOMAIN_ID          # on robot #2 -> 202
# then the same on any other car
# then, with both powered up on the same network, on one of them:
ros2 node list
```

**Answered on hardware, not just hypothesized.** Robot #2 (`f1-wsu-2`, 192.168.1.202) is `ROS_DOMAIN_ID=202`; robot #6 (`f1-wsu-6`, 192.168.1.206) is `ROS_DOMAIN_ID=206`. Confirms the per-robot convention rather than a shared value.

With both cars powered up and bringup running at the same time on the same lab WiFi, the two dashboards were opened in separate browser tabs (`192.168.1.202:8000/dashboard.html` and `192.168.1.206:8000/dashboard.html`). Each showed only its own 8/8 nodes and its own `/sensors/core` readings, with no bleed-through - DDS discovery stayed within each domain as expected.

S-19's roll call is safe as designed for these two cars. **Still open:** only 2 of the fleet's robots have been checked. Worth a quick `echo $ROS_DOMAIN_ID` pass on the rest to confirm every car has a unique ID before relying on this fleet-wide; if two ever collide, the fix is a unique ID per robot or `ROS_LOCALHOST_ONLY=1`, plus a way for the page to show which car it's looking at.

### Block F - S-05, the thermal baseline under load (DROPPED 2026-09-21)

> **Dropped.** The professor said we do not need to do the 20-minute run to measure temperatures. His reason was not recorded. The procedure below is kept in case anyone wants it, and nothing else in this document depends on it. Without it, the S-05 and S-10 temperature thresholds stay at the provisional values in Section 3.

70 °C is an Orin-family default, not ours; the idle floor is 47-51 °C.

```bash
( while true; do
    printf '%s' "$(date +%s)"
    for z in /sys/class/thermal/thermal_zone*; do
      printf ' %s=%s' "$(cat $z/type)" "$(cat $z/temp 2>/dev/null || echo NA)"
    done; echo
    sleep 5
  done ) > thermal_run.txt &
```

**Log the VESC's own temperature in the same window.** On a car with the `temp_fet` patch (only robot #2 so far), one run closes both S-05 and S-10's thresholds instead of two:

```bash
( timeout 1200 ros2 topic echo /sensors/core --csv > vesc_thermal_run.csv ) &
```

That is 50 Hz for 20 minutes, about 60 000 rows and roughly 10 MB - nothing on a 915 GB NVMe. Downsample afterwards; the point is the plateau, not the samples.

Then leave bringup and the camera running and drive for 20 minutes. Take `tj-thermal`'s plateau as Healthy for S-05 and `temp_fet`'s plateau as Healthy for S-10, and set Degraded above each with real headroom. Blocks B and C are finished, so this needs its own session.

This was the last open measurement from #1. It needed no second car and no second person and would have run unattended, which is why it was ranked first before it was dropped.

### Block G - S-18, one last attempt at the controller charge

Two negatives are not proof it is impossible, and #1 calls this the cheapest safety-relevant number it has.

```bash
lsmod | grep -iE 'hid_sony|hid_playstation|hid_generic'   # which driver is bound?
dmesg | grep -iE 'sony|playstation|hid-' | tail -20
upower -e                       # then: upower -i <path>
ls /sys/class/power_supply/ /sys/bus/hid/devices/*/power_supply 2>/dev/null
```

If all four come up empty, set `Experimental = true` in `/etc/bluetooth/main.conf`, restart `bluetooth.service`, reconnect the pad, and re-run `bluetoothctl info <mac>` - BlueZ hides battery reporting behind that flag. If that also fails, the pad reports charge inside its HID input report and can be read from `/dev/hidraw*`; hacky, well documented, driver-independent. **If none of it works, delete the check from #1** rather than leaving a field nobody can fill.

> **A correction worth recording:** an earlier version of this document inferred that `hid-generic` was bound because `/proc/bus/input/devices` shows `Name="Wireless Controller"`. That reasoning is wrong - **"Wireless Controller" is the DS4's actual product name string**, which Sony ships, so it says nothing about which driver claimed the device.

### Block H - the `/ackermann_drive` remap (CLOSED, 2026-09-16)

**Answered from the repo alone, no robot involved.** The remap is a no-op on a topic
that does not exist.

`ackermann_mux.cpp:91` creates its publisher on the literal name `"ackermann_cmd"`.
`bringup_launch.py:121` remaps `ackermann_cmd_out` to `ackermann_drive` - a name the
node never uses, so nothing is renamed and `/ackermann_drive` was never going to
appear. The chain still works because `ackermann_to_vesc.cpp:68` subscribes to
`"ackermann_cmd"` as well, so both ends meet on the unremapped default.

`ackermann_cmd_out` is the name an older version of `ackermann_mux` published on, and
the upstream README still documents it. The remap is inherited dead config.

- **S-22 and S-23 watch `/ackermann_cmd`.** Confirmed.
- **The fix is to DELETE `bringup_launch.py:121`**, not to repair it. Making the remap
match (`('ackermann_cmd', 'ackermann_drive')`) would move the mux's output to
`/ackermann_drive` while `ackermann_to_vesc` still subscribes to `ackermann_cmd`,
silently breaking the drive chain. That is the trap waiting for whoever tidies this up.
- **Deferred on purpose (2026-09-16).** It is inert, so there is no hurry, and it
touches `f1tenth_system` rather than this repo. Fold it into the next round of work
that goes into that codebase properly. Until then the config asserts a topic that has
never existed, which is a documentation problem, not a behaviour one.

### Block I - the rosbridge ceiling (CLOSED, 2026-09-16)

**rosbridge serves exactly 10 simultaneous clients. Client 11 onward connects,
registers, and receives nothing.**

Measured on robot #2 with `rosbridge_check.py` run N ways at once, each client
subscribing to `/scan`, `/odom`, `/sensors/core` and `/diagnostics` at a 500 ms
throttle for 8 s:

| Clients | Served | Load average |
|---|---|---|
| 5 | 5/5 | 1.95 |
| 10 | **10/10** | 1.78 |
| 15 | **10**/15 | 1.67 |
| 25 | **10**/25 | 1.56 |

Ten, exactly, every time. The number does not move with machine load, which was
idle-ish throughout on 6 cores, so this is not resource exhaustion.

What else the runs established:

- **There is no connection cap.** `/client_count` peaked at 26 during a 25-client run
(25 clients plus one browser tab), so rosbridge registers every client and only then
fails to feed the surplus.
- **The starved clients report "connected, but no messages."** The handshake completes
and the subscribe is accepted. On the dashboard that is indistinguishable from a dead
robot - the page renders, every topic reads SILENT, and nothing says "you are client
number 14".
- **It recovers on its own within 30 s** once the load stops - a single client scored
1/1 immediately after every overload run. **This corrects the earlier note in this
section**: the wedge that needed a restart was a client subscribed *unthrottled*, not
merely too many clients. Throttled clients degrade and recover.
- **Peak rosbridge CPU was 137%**, so it uses more than one core and a single-threaded
event loop is not the whole story.
- **There is no `max_clients` argument.** The full launch argument list is port,
address, ssl, certfile, keyfile, retry_startup_delay, fragment_timeout,
delay_between_messages, max_message_size, unregister_timeout, use_compression,
call_services_in_new_thread, send_action_goals_in_new_thread, and the three globs.
Nothing raises the limit.

**Cause not identified, and deliberately not chased further.** The leading theory was a
default `ThreadPoolExecutor` (6 cores + 4 = 10), but `grep` found no
`ThreadPoolExecutor`, `max_workers`, `num_threads` or `MultiThreadedExecutor` anywhere
in the installed `rosbridge_server` or `rosbridge_library`. Since there is no knob to
turn either way, knowing the cause would not change what we do.

**What this means for the team.** Ten is comfortably more than this project needs, but
the failure mode is bad: silent, and it looks like a broken robot rather than a busy
server. Two consequences:

- **Your own dashboard tab counts as one of the ten.** A demo room with ten laptops
open is exactly at the limit and the eleventh person sees a dead-looking page.
- **The page should subscribe to `/client_count` and show it.** It is already published,
costs nothing, and turns the worst failure mode into a visible number. Ideally the page
says "14 clients connected - rosbridge serves 10" rather than going quiet.

Method note for anyone repeating this: close every dashboard tab first. An open tab is a
heavier client than any test client (about 16 topics at a 200 ms throttle including
`/scan`) and it occupies one of the ten slots, which made the first three attempts at
this measurement unreproducible.

### Robot #2: WiFi, thermal trip points and CPU power mode (2026-09-21)

Taken to support the green, yellow and red ranges proposed in
[instructor-interview.md](../meetings/instructor-interview.md) (#6). All read-only, no sudo except
`nvpmodel`. Robot #2, idle, bringup state not recorded.

**WiFi** (`wlP1p1s0`, `192.168.1.202`, gateway `192.168.1.1`). Every source works without sudo.

Four runs, with the robot about 10 ft from the router. Only the laptop moved between them, and
these commands read the robot's own link, so all four are the same spot.

| | Value |
|---|---|
| Network | `turtlebot_network`, 5 GHz (5765 MHz) |
| Signal | -41, -42, -42, -43 dBm. Link quality 69 on the first run |
| rx bitrate | 780 MBit/s in every run (VHT-MCS 9, 80 MHz, 2 streams) |
| tx bitrate | 468 MBit/s (MCS 5) on the first run, 351 MBit/s (MCS 4) on the other three |
| Ping to gateway | 0% loss in all four: 10 of 10, then three runs of 20 of 20. Round trip min / avg / max between 1.360 and 3.194 ms |
| Errors, drops, discarded, missed beacons | all 0 (read on the first run) |

- This is the good case. A run with a dashboard streaming, and the robot far from the router,
  are not measured.
- `tx_bytes` was 1.03 GB against `rx_bytes` at 166 MB. The robot is the server for every open
  dashboard, so its sending rate includes the dashboard's own traffic.
- The noise column in `/proc/net/wireless` reads -256. It is a placeholder.
- The tx bitrate fell from 468 to 351 MBit/s at the same signal, so the link rate adapts by
  itself and is not a stable number to threshold.
- Ten pings took 9 seconds. A background check needs a short burst with a hard timeout.

**Thermal trip points** (`trip_point_*_type` and `_temp`, identical across the zones of a
given kind):

| Zone | Trips |
|---|---|
| `tj-thermal` | active 35 C, active 74 C, active 95 C, critical 104.5 C |
| `cpu`, `gpu`, `soc0/1/2`, `cv0/1/2` | passive 99 C, critical 104.5 C, passive 70 C |

"Active" is a fan step, "passive" is throttling and "critical" is shutdown. The module has a
heatsink and fan, seen in a photo of robot #2 (an Orin Nano, JetPack 6.2 per the team), even though the
`tegrastats` line shows no fan field. Idle in the same capture:
tj 49.8 C, cpu 49.7 C, gpu 49.8 C, soc 47.2 to 49.4 C.

**Power mode:** `nvpmodel -q` reports **15W** (mode 0). `cpuinfo_max_freq` and
`scaling_max_freq` both read **1 510 400 kHz**, so the governor is not capping below the
hardware limit. The CPUs idled at 729 to 883 MHz. Rest of the `tegrastats` line: RAM 2041 of
7621 MB, swap 0 of 3810 MB, CPU 0 to 3%, **`GR3D_FREQ` 0%** (GPU load is available here),
`VDD_IN` 4859 mW.

Not seen: what the clocks do under a real heavy run. It was decided not to chase that. CPU load
and board temperature are shown instead, with the caveat that the 15 W cap can slow the CPU
without heat.

**WiFi: what to read.** All of it works without sudo on robot #2. The interface is `wlP1p1s0`,
not `wlan0`.

| To show | Source |
|---|---|
| Signal and link rate | `signal`, `rx bitrate` and `tx bitrate` in `iw dev wlP1p1s0 link`, and `/proc/net/wireless` |
| Sending and receiving | The change in `/sys/class/net/wlP1p1s0/statistics/tx_bytes` and `rx_bytes` between samples |
| Packet loss and round trip | `ping` to the default gateway, plus `tx_errors`, `rx_errors`, `tx_dropped` and `rx_dropped` in the same directory and the discarded columns of `/proc/net/wireless` |

Design notes for the WiFi check:

- **Ping the gateway, not the internet.** The robot does not need internet, so an outside outage
  would read as a robot fault.
- **Two vantage points.** The list above is the robot's view of its own link. The person
  watching has their own link to the same router, and a bad router shows up on both. A browser
  cannot send ICMP pings, but it can time a call to the robot and notice gaps in arriving
  messages, which the page's existing websocket-liveness tracking makes a small addition. When
  the robot cannot be reached at all, the page should say what to check: that the viewer is on
  the same WiFi as the robot, and that the robot is powered.
- **Colour on signal, packet loss and round trip.** The transmit link rate is not stable enough
  to colour, and the sending rate includes the dashboard's own traffic.
- **No capacity test.** Link rate is the negotiated rate, and the send and receive rates only
  show what the robot happens to be doing. Measuring how fast the link could go needs an active
  test such as `iperf3`, which loads the link the dashboard is using and would itself look like
  a fault while it runs. The team's reading of "speed" is that the network is up, without
  packet loss or high ping.
- **WiFi and battery can look alike.** On 2026-09-09 the robot vanished from the network with
  the pack at 10.9 V, and the cause was never separated. The Jetson runs off the same pack, so
  a sagging pack can drop the link. Read a red WiFi tile next to a yellow or red battery tile
  together.
- The Omarchy WiFi panel on a laptop shows the same set (ping, packet loss, receiving, sending,
  downloaded, uploaded) and is how a bad network has been spotted in the past.

### Robot #2: the lidar's single connection and orphaned nodes (2026-09-21)

Found while working on #6. Starting instances from different computers while one is already
running, or running `./start_diagnostics.sh`, then `--stop`, then starting it again, makes
`urg_node` repeat this every 2.5 seconds. It stays that way until the machine is turned off and
on:

```
[urg_node]: Error connecting to Hokuyo: Could not open network Hokuyo:
192.168.0.10:10940
could not open ethernet port.
```

The lidar is powered and the network is fine, so the `lidar` ping alias passes, and so does the
prototype's own lidar link check, which is also a ping.

**Cause.** While the error was showing:

- One old `urg_node_driver` (PID 4647) was running with **no bringup launch process above it**.
  Its parent was PID 1 and it had been running for 1 hour 51 minutes, so it was an orphan from
  a run about two hours earlier.
- It held an established connection to the lidar (`ESTAB`, port 10940).
- The new bringup's driver (PID 15378) was stuck in `SYN-SENT`. The lidar never answered its
  connection attempt.
- Ping to the lidar worked (0.14 to 0.23 ms), and a plain connection attempt from bash also got
  no answer.

So the lidar takes one connection at a time, and the orphan was holding it. Killing the orphan
(`kill 4647`) stopped the errors, and `/scan` then ran steadily at 39.9 Hz, so the new driver
reconnects by itself once the connection is free. Turning the robot off and on cleared it
because that killed the orphan.

**Why `start_diagnostics.sh` did not catch it.** It finds processes by name pattern. The
pattern includes the launch process (`bringup_launch.py`) but not the node processes it starts.
When the launch process dies and leaves a node behind, that node is invisible to `--stop`, to
`--status` and to the "a bringup is already running" guard, and `--stop` reports "all stopped"
while it lives. The script's own success check is fooled too: it only looks for `urg_node` in
`ros2 node list`, and the orphan's node is still in the graph.

**How the launch process died.** At about 12:10 someone ran `./start_diagnostics.sh` on a
second connection while a bringup was already running on another. The guard refused, as
intended, but then **killed the bringup it had just detected**. The exit trap that runs the full
stop is installed before the guard, so the guard's `exit 1` fires it. A refused run therefore
runs `stop_all`, which sweeps every process matching the name patterns. That kills the running
launch process but not the nodes it started, and they become orphans.

This was reproduced with stand-in processes and a stubbed `ros2`: the fake bringup was alive
before the refused run and dead after it, its child node survived, and the refused run exited
0. It has not been reproduced on the robot with the real nodes. The robot's copy of
`start_diagnostics.sh` has the same checksum as the one on `main` (`5f82c45f...72c9`), so this is
how the current script behaves. The sweep also matches any `python -m http.server` on the robot,
and `grep -v "\-\-stop"` prints a stray-backslash warning on this grep.

**How many orphans.** A full listing found **11, in two sets**, all with parent PID 1. Five came
from the old run (`joy_teleop`, `ackermann_to_vesc`, `vesc_to_odom`, `ackermann_mux` and the
static transform publisher, besides the lidar driver that was killed). Six came from a run about
16 minutes before that listing: the same five plus a `joy_node`. Next to the current bringup that
is duplicate publishers on the same topics, including a second full control chain from the
joystick to the motor commands. Two `joy_node`s also means two programs reading the controller,
and duplicate publishers make the dashboard's rates read high. The first listing only matched
`/opt/ros`, so the VESC and mux nodes, which live in the workspace, needed a second look:

```bash
ps -eo pid,ppid,etime,cmd | grep -E '/opt/ros/humble/(lib|bin)|f1tenth_ws' | grep -v grep
```

**What the dashboard needs.** The lidar has three states, and the prototype only tells two apart:

| State | What the prototype shows |
|---|---|
| Link down | Red, from the ping check |
| **Link up, this bringup's driver not connected** | **Nothing. Reads as reachable** |
| Connected, scans flowing | Rate check, green |

The middle state should be red, with a message that the lidar answers but the driver cannot
connect, and that a leftover driver from an earlier run may be holding it. Whether an orphaned
driver keeps publishing scans while the new one fails is unknown. This is the node roll call
being green while the lidar is not connected.

**How to tell, on the robot, while the error is showing:**

```bash
pgrep -af 'urg_node|bringup_launch'    # more than one driver, or a driver with no launch?
ss -tan | grep 10940                    # who holds the connection, and who is stuck in SYN-SENT
ps -o pid,ppid,etime,cmd -p <pid>       # how old is the suspect, and what is its parent
```

| Result | Meaning |
|---|---|
| A `urg_node_driver` with no `bringup_launch` process, and a parent PID of 1 | An orphan from an earlier run. This is what was found |
| Two drivers, each under a launch process | Two bringups running at once |
| No driver, but a connection in `ESTAB` or a `WAIT` state | The robot's side of the connection is stuck |
| No driver, no connection, ping works, the lidar still refuses | The lidar itself is holding the slot |

**Still to do.** Make `start_diagnostics.sh` see the node processes, so `--stop`, `--status` and
the bringup guard catch an orphan; keep the guard's refusal from running the full stop; and give
the launch process time to shut its children down before it is killed. That is a change to the
script and needs testing on the robot. It waits on the camera work happening on the robot now.

### Robot #2: battery run-down test (2026-09-21)

Run to find where this car actually loses power, which #1's battery lines and the 2026-09-09 and
2026-09-16 events could not say. Two watchers ran at once.

**Laptop, reachability watcher.** Every 5 seconds it fetches the dashboard page from the robot
with a 2 second timeout and prints UP or DOWN with the time. It only proves the robot's web
server answers, so it would stay UP if bringup died while the server survived. It runs off the
robot, so it survives the robot dying.

```bash
while true; do curl -s -m 2 -o /dev/null http://192.168.1.202:8000/dashboard.html && s=UP || s=DOWN; echo "$(date +%T) $s"; sleep 5; done | tee ~/dash_watch.log
```

**Robot, battery logger.** It subscribes to `/sensors/core` (about 50 Hz) and writes every 50th
`voltage_input` reading with a timestamp, so about one line per second, to `~/diag/batt.log`.
The file is on the robot's disk, so it survives the robot dying and rebooting.

```bash
PYTHONUNBUFFERED=1 ros2 topic echo /sensors/core --field state.voltage_input | awk '$0!="---" && ++n%50==0 {print strftime("%F %T"), $0; fflush()}' >> ~/diag/batt.log &
```

**Result**

| | |
|---|---|
| Laptop watcher | last UP at 14:30:28, first DOWN at 14:30:35, so power was lost between 14:30:28 and 14:30:33 |
| Manual reading | about 10.4 V at 14:25:25, read off the dashboard. Nothing recorded it. The test was meant to start there |
| Robot log | 30 lines, about one per second, from about 14:29:50 (9.3 V) to 14:30:21 (**8.8 V**, the last line written). They carry three burst timestamps (14:30:00, 14:30:10, 14:30:21), so about ten lines share each stamp |
| Fall rate | about 0.25 V per minute from 10.4 V to 9.3 V (1.1 V in about 4.5 minutes), then about 1 V per minute from 9.3 V to 8.8 V (0.5 V in about 30 seconds). Four times faster below 10 V |
| Whole run | about five minutes from the 10.4 V reading to power loss at about 14:30:30 |

**The robot lost power at 8.8 V or below, about 2.9 V per cell on a 3S pack, measured by the
VESC. The car was idle**: bringup and the dashboard were running, but it was not driving. That
is close to the resting voltage, and the car would read a higher voltage at the moment it died
while driving. The log timestamps come from buffered output arriving in bursts about 10 seconds
apart, so the ten lines sharing a stamp are really one line per second. The last few seconds
before power loss were never written, so the true final voltage is a little below 8.8 V. The
10.4 V figure is a single manual reading, so the 10.4 to 9.3 V stretch is approximate.

**What it means for the ranges**

- **Red at #1's 10.5 V is too late.** The pack falls off a cliff below about 10 V (about 3.3 V
  per cell). From 10.4 V the car had about five minutes at idle, and it was falling four times
  faster below 10 V. Driving draws far more current than idle (the spike saw up to 6.5 A of input
  current, against about 5 W for the Jetson alone), so with the car moving there would be much
  less than five minutes between red and power loss. An earlier note here judged the margin in
  volts, 1.7 V, which was the wrong measure. **Red should fire earlier: below 11.1 V, which is
  #1's own healthy floor (3.7 V per cell), with yellow above it up to about 11.6 V.** Yellow is a
  buffer: the pack still runs fine, and it is time to get a replacement ready, while red means
  replace it soon. The 11.6 V line is a convention, and the idle test does not prove either
  number, but the professor has signed off on both.
- **The 2026-09-09 dropout was most likely not the pack running out.** The pack was found at
  10.9 V, and this run shows the car keeps running until 8.8 V or lower. The WiFi was also
  flaky that day, and it is now the likelier cause.
- **Nothing on the car protects the pack.** #1 puts permanent LiPo damage below roughly 9.9 V
  (3.3 V per cell), and the car kept running to 8.8 V or lower. The dashboard's red line is the
  only warning a student gets before the pack is damaged.
- The pack went to about 2.9 V per cell at idle, so check its cell voltages and condition
  before reuse.

**Not established.** Which part gave out first: the VESC's undervoltage cutoff, the minimum
input of the DC-DC converter that feeds the Jetson, or the pack itself. It does not change the
ranges. It is one pack, one run and one car, and the car was idle. The curve above 10.4 V was
not recorded, because the logger only produced real voltages from about 14:29:50, so how long
yellow lasts is unknown. The professor signed off on the ranges without that curve. A driving run
logged from a full pack and stopped around 11 V would give it, using the logger above, if anyone
wants it later.

The dashboard's battery lines are `BATT_WARN = 11.1` and `BATT_ERR = 10.5` in
`prototype/dashboard.html`, and would change to match if these numbers are adopted.

### Camera feature as merged (PR #35, 2026-09-21)

Saman Chapagain's PR #35 added the camera to `prototype/dashboard.html` on `main`. The same day
PR #33 rewrote the dashboard, which is now 5,372 lines, and PR #34 undid a change to
`start_diagnostics.sh`, so the script is unchanged.

- **How it works.** The page shows a plain MJPEG stream from
  `http://192.168.1.202:8082/camera.mjpg` in an `<img>`. There is no ROS image topic and no
  rosbridge traffic. **Connect Camera** takes the URL, and **Take Picture** draws the current
  frame to a canvas and offers it as a PNG.
- **Frame rate.** The pipeline asks for 640x480 at 30 fps, and the stream looks like 10 to 20
  fps by eye. Not measured. The research doc measured the ROS colour topic at 25 to 28 fps.
- **This is not the design the spike recommended** (a compressed topic through rosbridge, see
  block C), and it sidesteps the raw-frame limits: the 2.76 MB frames never touch rosbridge.
- **How the server is built.** [Camera Streaming Research](camera-streaming-research.pdf)
  (PR #36) documents it. `gst-launch-1.0` reads the RealSense colour stream straight from its
  V4L2 device, `/dev/video4`, encodes each frame as JPEG and serves it on TCP port 8081. A small
  Python HTTP server, `/tmp/camera_http.py`, reads that port and serves it as
  `http://192.168.1.202:8082/camera.mjpg`. GStreamer was already installed, `ffmpeg` was not, and
  `image_transport` offers only the raw transport.
- ~~**It is a temporary setup, not part of the repo.** Nothing on `main` starts either piece, and
  `start_diagnostics.sh` does not. The script lives in `/tmp` on the robot, which is cleared on
  reboot, so the camera stream disappears whenever the robot restarts, as it does when the pack
  dies. The build is described in the PDF, but the script itself is not saved anywhere shared.
  That is the same problem as the VESC patch.~~ **Fixed 2026-09-23** - see
  [Camera stream now starts itself](#camera-stream-now-starts-itself-and-take-picture-downloads-2026-09-23)
  below.
- **It bypasses the ROS camera node.** It reads the V4L2 device directly, so it does not need
  the `cam` alias. Whether it can run at the same time as `cam` is untested: the research
  launched the ROS node only to confirm the camera worked, then switched to GStreamer.
- **Ports 8081 and 8082 are both open** with no authentication, reachable by anyone on the
  WiFi. Port 8081 is the raw stream and 8082 is the HTTP one. That is video of the room, and the
  access-control question in Section 6 applies to both.
- ~~**Snapshots need CORS headers.** The page can show the video, but reading a frame back is
  blocked unless the camera server sends `Access-Control-Allow-Origin`. The page says so when
  that happens.~~ **Fixed 2026-09-23** - same section below.
- ~~**The default URL is robot #2's address.** Other cars need it changed in the box.~~ **Fixed
  2026-09-23** - this was not hypothetical, it broke the camera on robot #6
  (192.168.1.206) the first time it was deployed there. See
  [Camera stream now starts itself](#camera-stream-now-starts-itself-and-take-picture-downloads-2026-09-23)
  below.
- ~~**Not built yet:** the lidar radar view. The page computes summary statistics from `/scan`
  (minimum, maximum, count of finite returns), and a comment notes a plot could draw from the
  same message.~~ **Built 2026-09-23** - see
  [Lidar radar view](#lidar-radar-view-and-the-scan-no-return-sentinel-2026-09-23) below. The
  Network tile still reads a `wifi signal` value that `system_diagnostics.py` does not publish,
  so it falls back to counting links that are up - that part is unchanged.
- A `.DS_Store` file was committed in the same merge. It should be removed and ignored.

### Camera stream now starts itself, and Take Picture downloads (2026-09-23)

- **The manual two-terminal setup is gone.** `gst-launch-1.0 ... tcpserversink port=8081`
  and the Python proxy behind it are now a step in `start_diagnostics.sh` (step 4, after the
  static web server), and the proxy script is `prototype/camera_http.py` - a repo file, not a
  hand-pasted `/tmp` one. `--no-camera` skips the step, `--camera-device` overrides
  `/dev/video4` if the device number shifts. Both processes are in the script's `PATTERNS`
  kill-list now, so `--stop` / `--status` / Ctrl+C manage them the same as bringup and
  rosbridge, instead of surviving a stop and fighting the next run over the device.
- **The gap this closes is exactly the one flagged above:** a reboot (or a dead pack, which
  causes one) used to silently remove the camera stream with nothing to say so. Now it comes
  back with everything else `start_diagnostics.sh` starts, and reports pass/fail the same way
  bringup and rosbridge do.
- **Snapshots ("Take Picture") were blocked by CORS, and now aren't.** The dashboard is served
  from port 8000 and the camera stream from 8082 - different ports means different origins to
  the browser, even on the same host. An `<img>` loaded cross-origin with no `crossorigin`
  attribute loads in "no-cors" mode: the browser shows it fine but treats any canvas draw from
  it as tainted, and `toDataURL()` throws, regardless of what headers the server sends. Fixing
  it needs both sides, or the video breaks instead of the snapshot:
  1. `camera_http.py` now sends `Access-Control-Allow-Origin: *` on the `/camera.mjpg`
     response.
  2. `dashboard.html`'s `connectCamera()` now sets `image.crossOrigin = "anonymous"` before
     assigning `image.src`, which is what makes the browser actually check that header. Set
     the header without this and nothing changes; set this without the header and the image
     fails to load at all.
- **The hardcoded robot #2 IP is gone.** `cameraUrl`'s default was
  `http://192.168.1.202:8082/camera.mjpg`, baked into the HTML input's `value` attribute since
  PR #35 - so the camera card was broken on every robot except #2 by construction, and it
  proved it: **robot #6 (192.168.1.206) showed "No stream", 2026-09-23,** the first time this
  was deployed there. Fixed the same way `$("wsUrl")` already handled this for rosbridge - the
  browser already knows which robot it's talking to (`location.hostname`, the host that
  served the page), so there is nothing to hardcode. `?video=<url>` still overrides it for a
  different robot or port, same pattern as `?url=` for rosbridge.
- **Still true, unchanged:** ports 8081 and 8082 have no authentication.

### Lidar radar view, and the /scan no-return sentinel (2026-09-23)

- **The LiDAR card draws the scan now**, not just the four summary numbers (points, nearest,
  farthest, field of view) it had before. A canvas in the card plots each valid return as a
  point, connects consecutive valid points into a line so a wall reads as a wall and a gap
  (doorway, or simply out of range) breaks the line instead of bridging it, draws range rings
  and the FOV boundary, and eases its own scale toward whatever the sensor is actually seeing
  (clamped 2-12 m) so a doorway does not zoom to a dot and an open hallway does not shrink a
  near wall to nothing. The geometry - `isValidRange()` and `polarToCanvas()` in
  `dashboard.html` - is checked with no browser or robot needed by
  `prototype/verify_radar.mjs` (`node verify_radar.mjs`).
- **Building it found a real bug in the summary stats that were already shipping.** A
  "no-return" beam on this Hokuyo does not come back as `inf` or `NaN`, and is not clipped to
  `range_max` - measured on the robot 2026-09-23, it reads back as **~65.5 m**, the raw SCIP
  sentinel `65535` (mm) passed straight through, which is *above* `range_max` (30 m). The
  existing `onScan()` filter (`value > 0`) let that sentinel through as a real distance, so the
  "Farthest" readout could report a phantom 65 m wall. Fixed by filtering against the
  message's own `range_min` / `range_max` instead of a hardcoded `> 0`, which is also what the
  radar plot filters on - one function, not two copies that could disagree.
- **The 270° FOV leaves a real 90° blind spot directly behind the sensor** (`angle_min` to
  `angle_max` is 270°, not 360°). The plot draws range rings and the FOV boundary only across
  the real arc, so the blind spot renders as a blank wedge - a *measured absence*, not
  "unmeasured yet."
- **Not verified in a browser against a live robot** - the math is checked by
  `verify_radar.mjs` and by hand, but nobody has watched it track a real wall yet. Do that
  before calling this done.

### What to do with the results

Every block writes a file. `scp` the directory back and fold the numbers into Section 3 and Section 4, then update `docs/design/subsystem-inventory.md` in the same pass - **the `[MEASURE]` and `[CONFIRM]` tags in #1 are the point of the exercise**, and a measurement that stays in a text file on the robot has not closed anything.

---

## 6. Does the page design actually work?

The plan: a student opens `dashboard.html` on their own laptop, points it at a robot's IP, sees ROS diagnostics plus system state, and can press a button to run a check on that robot.

**Verdict: yes. The ROS half and the system half both work on robot #2. The button is still missing.**

### What works today, verified

| Part of the plan | Status |
|---|---|
| Page opens on any laptop, nothing installed | **Works.** `dashboard.html` is one self-contained file - inline CSS and JS, no CDN, works with no internet |
| Connects to a chosen robot by IP | **Works.** It derives the target from wherever it was served, and takes `?url=ws://host:9090` to override |
| Reads ROS data with no ROS on the laptop | **Works, verified on hardware.** rosbridge translates to JSON on the robot |
| Reads `/sensors/core` despite `vesc_msgs` being a custom type | **Works.** rosbridge deserializes robot-side, where the package exists |
| Node roll call, topic liveness, battery, mux mode, `/diagnostics`, `/rosout` | **Works.** All of it is already in the page |
| Does not fall over when a message is malformed | **Works.** Handler is wrapped; one bad message cannot kill the loop |
| Shows its own staleness so a frozen page cannot look healthy | **Works.** Per-topic age plus a stale banner |

### The gap

**rosbridge only carries ROS.** Two things in the plan needed more than rosbridge:

1. **System state** - CPU temperature, load, disk, memory, Bluetooth, USB link speed, network carrier. No ROS node publishes any of it. That is S-02, S-04 to S-08, part of S-14, S-17 and part of S-18: **eight of #1's subsystems, four of them tier 1.** Now built, as option (b) below: `prototype/system_diagnostics.py`.
2. **The button.** There is no way for the page to ask the robot to run something. Not built yet.

### The fix, and why this shape

Two options. **We went with the second.**

**(a) Add an HTTP backend on the robot.** Node or FastAPI serving the page, `/api/*` endpoints for system state, and proxying the websocket so the browser only knows one port. Conventional, and it works.

**(b) Make the system half a ROS node.** One `f1tenth_diagnostics` Python node on the robot that:

- reads `/proc`, `/sys`, `bluetoothctl`, `ping` and so on once a second, and **publishes them as `diagnostic_msgs/DiagnosticArray` on `/diagnostics`** - the same channel and the same schema the lidar and the mux already use;
- exposes each button as a **ROS service** (`std_srvs/Trigger` for fixed checks, or a small custom service returning stdout as a string);
- also carries the topic-liveness logic for nodes that do not self-report, closing the coverage gap from Section 3.

`system_diagnostics.py` covers the first bullet. The service handlers and the liveness logic are not written yet; for now the page works out liveness in the browser.

**Why (b) wins:**

- **The client side already exists.** `dashboard.html:263` has a generic `call(service, args)` helper that speaks `op:'call_service'` over the same socket. It is already used for `/rosapi/nodes` and `/rosapi/publishers`. Adding a button is a service name and a render function - no new transport, no new protocol.
- **One channel, one schema.** No second port, no CORS, no static server, no separate API to document. Everything a student sees arrives the same way.
- **System state lands in `/diagnostics`**, so `diagnostic_aggregator` and `rqt_robot_monitor` display it for free, and a teammate who prefers a terminal gets it without a browser.
- **It solves the rate problem.** Section 2 measured `/scan` at 30.5 Hz from off-robot against a real 40.0. Rates computed inside a node on the robot and published as numbers are correct; rates derived in a browser over WiFi are not. The system node should compute them.
- It is one Python file, and it is the thing #12 was going to build anyway.

Whichever is chosen, the command-running rules are not optional: **whitelist fixed actions**, never an endpoint or service that accepts a command string, and `subprocess.run([...])` with a list, **never `shell=True`**. A backend that runs arbitrary shell commands is remote code execution on the robot.

### Three things to decide before building

**1. rosbridge has no authentication, and it can publish to any topic - including `/drive`.** For students to reach it from their own laptops it must listen on `0.0.0.0`. On a shared lab network with eight cars, **anyone who can open the page can also drive any robot.** Verified: bound to `127.0.0.1` it is reachable locally and refuses connections from the network interface, so this is a live choice, not a theoretical one. Options, for #3 to settle:

- accept it on an isolated lab network and write it down;
- keep rosbridge on localhost and put a small backend in front that exposes reads only;
- put a token-checked proxy in front of the websocket.

The read-only-versus-can-restart-nodes question is the same decision and should be settled at the same time.

**2. Which car am I looking at?** One file serves every robot, so the page must say. The lidar's `Device ID` is a free per-unit serial already on `/diagnostics`; hostname works too. Without it, a student on the wrong IP debugs the wrong robot.

**3. Several students at once is a load case, not a detail.** One careless unthrottled client wedged rosbridge. Keep the 200 ms throttle, never subscribe to `/scan` unthrottled to prove it is alive (publisher count plus a slow subscription is far cheaper), and measure the client ceiling - block I.

### What that leaves to build

1. The rest of the node: the topic-liveness bridge for nodes that do not self-report, and the service handlers behind the buttons. The system collectors are done (`system_diagnostics.py`).
2. An aggregator config listing the eight expected nodes under Sensors / Actuation / Control so a missing node surfaces as `Missing`.
3. VESC threshold checks on `/sensors/core`. Battery, `fault_code` and `temp_fet` all read correctly (`temp_fet` needs the driver patch); the temperature thresholds use the provisional values, since block F was dropped.
4. rosbridge in a launch file. Nothing in `f1tenth_system` starts it, despite it being a declared dependency of `f1tenth_stack`; `prototype/start_diagnostics.sh` starts it for now.
5. The page: buttons and the per-subsystem view over `/diagnostics_agg`. The system panel is done.

The page should not need rewriting as this lands. It already subscribes rather than computing health itself, so moving classification into the node makes it a thinner renderer, not a different one.

---

## 7. Traps that will cost someone a day

Recorded because each one produces a *wrong* reading rather than an obvious failure.

| Trap | What you see | Measured cost |
|---|---|---|
| **QoS mismatch** | zero messages from a perfectly healthy publisher | 0 vs **196** messages in 5 s |
| **Dead node lingers** | a killed node still listed as present | ~16-18 s of false "healthy" |
| **Dead topic vanishes** | after DDS times out the topic leaves the list entirely | a dead node goes invisible, not red |
| **One-shot `/diagnostics` read** | live components look missing | `--once` returned only `urg_node`'s array; `ackermann_mux` was publishing fine. Each publisher sends its own `DiagnosticArray`, so a single message is never the union. **Accumulate over a window keyed by `status[].name`.** Confirmed live: `ros2 topic echo /diagnostics --once \| grep 'system:'` printed nothing while the dashboard showed all ten system checks and the topic row read **3 publishers**. Use `--times 10` and grep that |
| **Hardcoded camera topic names** | false `NODE_DOWN` on a healthy camera | `camera_name:=rs` gives `/camera/rs/...`; the default gives `/camera/camera/...`. Discover by prefix, never by literal |
| **Per-sample thresholds on 50 Hz topics** | a healthy battery flapping Healthy/Degraded many times a second | `voltage_input` swings 11.0-11.2 V with throttle across #1's 11.1 V line. Use a rolling window or qualify by load |
| **A field that is never assigned** | a plausible-looking `0.0` forever | three sessions spent measuring `temp_fet: 0.0` that the driver never wrote. **A constant is not a reading** |
| **Stale ROS daemon** | `ros2 node list` showed 1 node while all topics were live | wrong picture of the graph |
| **One bad callback** | every topic reads `SILENT`; monitor reports a dead robot that is fine | total blackout |
| **Custom msg types, native client** | `/sensors/core` undecodable off-robot | values lost, liveness kept |
| **Off-robot rate measurement** | `/scan` reads 30.5 Hz | 25% low, looks like a real fault |
| **Unthrottled rosbridge** | server wedges, handshakes stop completing | needs a restart |
| **The lidar takes one connection** | `urg_node` loops "could not open ethernet port" while `ping` passes | an orphaned driver held it for 1 h 51 min. Only killing it, or a reboot, frees it |
| **Killing a launch leaves its nodes running** | `--stop` says "all stopped" while nodes live | 11 orphans on robot #2, including a second control chain. A refused second `start_diagnostics.sh` kills the running bringup and orphans its nodes |

**QoS mismatch is the worst one.** QoS is the set of delivery guarantees a publisher advertises and a subscriber requests. If a driver publishes `BEST_EFFORT` (normal for sensors, which would rather drop a frame than wait) and the monitor subscribes `RELIABLE`, DDS refuses to connect them and the monitor receives **nothing from a working sensor**. Read the publisher's advertised QoS with `get_publishers_info_by_topic()` and match it. ROS logs `offering incompatible QoS. No messages will be received`, and `ros2 topic info -v /scan` prints each publisher's full profile.

**Node presence is a slow signal and must not be the primary health check.** After a hard kill, both the rclpy graph API and `ros2 node list` reported the node present for six consecutive polls:

```
  t(s)   rclpy graph API        ros2 node list       --no-daemon
   0.0   PRESENT                PRESENT              gone
  10.8   PRESENT                PRESENT              gone
  16.3   PRESENT                gone                 gone
  19.2   gone                   gone                 gone
```

Message arrival detects the same failure in under a second.

**Neither `ros2 node list` variant is dependable.** Three runs, three different failures: run 1 gave **1 node** with the daemon while all topics were live and was correct with `--no-daemon`; run 2 was correct with the daemon and gave **9 nodes** with `--no-daemon`, missing `/rosapi` and `/static_baselink_to_laser`; run 3 was correct with the daemon and gave **7 nodes** with `--no-daemon`, missing `urg_node`, `vesc_driver_node`, `vesc_to_odom_node` and `joy_teleop` while `/scan` and `/sensors/core` were demonstrably publishing. The daemon caches a stale view; `--no-daemon` does a fresh discovery with a short timeout and misses slow responders. **The only method correct on every attempt was `/rosapi/nodes`** - a long-lived participant that has had time to discover. S-19 should use it, and should tolerate a node briefly missing rather than alarming on one bad sample.

**A callback exception silently kills everything.** An exception inside a subscription callback kills the rclpy executor thread, after which every topic reads `SILENT`. Wrap every callback. The specific thing that threw: **`DiagnosticStatus.level` is a `byte` (`b'\x00'`), not an `int`** - use `int.from_bytes(raw, 'big')`.

**Do not `apt install python3-websockets`.** Ubuntu 22.04 ships 9.1, which crashes on Python 3.10 with `TypeError: As of 3.10, the *loop* parameter was removed from Lock()`. Either `pip3 install -U "websockets>=12"` or use a stdlib-only client.

**`/scan` is bigger than you think.** 1081 ranges at 40 Hz is roughly 19 KB per message and ~780 KB/s as JSON. Always set `throttle_rate` for anything you are only displaying.

**No browser on the robot.** `snapd` is broken on this Jetson - `snap-confine` has lost its file capabilities, so `chromium` refuses to launch and *every* snap fails identically. Firefox is not installed despite `xdg-settings` naming it the default. This never blocked the spike, and it does not block the product either: **the page is meant to be opened on a student's laptop, not on the robot.** Untried fixes are in the appendix.

---

## 8. What this means for the other issues

### #3 - ADR, web app vs status server vs physical indicator

[ADR 0001](../adr/0001-diagnostics-form.md) has since proposed the web app. The points below still apply to it.

**1. The web app is viable and cheaper than it looks.** rosbridge is already a declared dependency, already installed, and works. The browser needs no ROS install and no message packages. Verified end to end on real hardware.

**2. "Status server" is largely a false alternative.** rosbridge *is* a status server. The question is not whether to build one but what renders its output, which reduces the ADR to web page versus physical indicator, plus how much logic sits robot-side. Section 6 argues most of it should.

**3. A network-delivered display cannot report its own transport failing, and the failure is silent** - a frozen page looks exactly like a healthy one. Whichever option is chosen needs a visible "last updated" age. This confirms cross-cutting finding 3 in #1, and the page already does it.

**4. The physical indicator has a stronger case than expected, for one specific job.** The robot's only stop is a software deadman over a wireless link and it fails open. Deadman state and controller-link health are the two most safety-relevant indicators, and they are precisely the two a network-delivered display is worst placed to show - the same link failure that loses the deadman may lose the page.

**5. Access control is now a decision, not a detail** - see Section 6. Letting students reach the page from their own machines means rosbridge is LAN-exposed, and rosbridge can drive the robot.

### #8 - health status schema

- **Adopt `diagnostic_msgs`** rather than inventing a parallel format. OK/WARN/ERROR/STALE maps onto Healthy/Degraded/Failed/unknown, and adopting it means `diagnostic_aggregator` and `rqt_robot_monitor` work for free.
- **Carry a topic class** (`continuous` / `event` / `latched` / `input`). Without it a healthy car reads as 16 broken topics.
- **Carry `depends_on`**, as #1 already recommends. S-09 failing takes S-01, S-10 and S-15 with it in the same instant.
- **Distinguish "check could not run" from "check passed"**, per #1's `unknown`. S-11, S-13 and parts of S-15 are only meaningful while moving.
- **The thresholds are proposed in [instructor-interview.md](../meetings/instructor-interview.md)**, one row
  per item in the professor's top band, with the basis for each number. He has signed off on
  them, and the rows marked *convention* have no measurement behind them. That document also
  lists where each item's data comes from and where its range is defined.
- **WiFi needs a schema entry.** S-16 was dropped from #1, but the professor asked for WiFi
  speed, packet loss and traffic. A replacement carrying signal, round trip, packet loss and
  send and receive rates fits the same states. Sources and design are in the WiFi entry in
  Section 5.
- **The lidar needs three states, not two**: link down, link up with the driver not connected,
  and connected with scans flowing. A ping-only link check cannot tell the middle one from
  healthy.

### #4 - interface mockup

Tier-1 subsystems that are **Ready** today and can be mocked against real data: S-01 battery, S-04 load, S-05 thermals, S-12 lidar, S-17 lidar link, S-18 gamepad, S-19 node set. S-03 is ready once it gates on Bluetooth state. S-10 can show battery, fault code and FET temperature (FET temperature on patched cars only). S-14 is confirmed present and can be mocked with presence and USB link speed.

The mockup should also budget space for **three things the spike says the page needs and which are easy to forget**: a visible last-updated age, an identifier for which car is being shown, and a place to put the output of a check that was run on the robot.

---

## Appendix

### The throwaway code

Kept so the results are reproducible. The two scripts worth running are in `prototype/tools/`. `rosbridge_check.py` is a pure-stdlib WebSocket client (no pip, no ROS, no browser) that prints the node list plus live status for `/scan`, `/odom`, `/sensors/core` and `/diagnostics`. `baseline_capture.sh` is a read-only robot dump covering topic rates, `/diagnostics`, Bluetooth, thermals, load, memory, disk, lidar ping, VESC device node and clock, and is what produced the numbers in Section 4.

The other experiment scripts (fake bringup nodes for testing without a robot, the QoS and stale-node probes, the `diagnostic_updater` demo and two small `/diagnostics` merge scripts) ran on a laptop in Docker and were not kept. Their results are recorded in Sections 2, 3 and 7.

The dashboard itself is the exception: `dashboard.html`, `start_diagnostics.sh` and `system_diagnostics.py` in `prototype/` came out of the spike and are the basis of the real page, assessed in Section 6.

### Running against the real robot

```bash
# on the robot: bringup, system diagnostics, rosbridge and the web server in one go
~/diag/start_diagnostics.sh

# or by hand, in two terminals
bringup                                                        # ros2 launch f1tenth_stack bringup_launch.py
ros2 launch rosbridge_server rosbridge_websocket_launch.xml    # not in any launch file yet

# then, from any machine on the network, with nothing installed
open http://192.168.1.202:8000/dashboard.html
```

### Without a robot

The Docker setup with fake nodes was not kept. `node prototype/verify_system.mjs` still checks the page's system panel with no robot.

### Untried fixes for the broken snap

Recorded so nobody re-diagnoses it. Not needed for this project.

```bash
ls -l /usr/lib/snapd/snap-confine     # want -rwsr-xr-x; the 's' matters
sudo chmod 4755 /usr/lib/snapd/snap-confine
sudo apt install --reinstall snapd
sudo apt install policycoreutils      # provides the missing matchpathcon
sudo apt install epiphany-browser     # or sidestep snap entirely
```
