# Driving the Car from the Dashboard

How the dashboard's **Drive** tab controls the robot: the path a command takes from the
browser to the motors, the safety rules around it, and where each piece lives in the code.

> **Status.** Implemented in `prototype/js/drive.js`. It has been tested in a browser against
> a simulated connection (every message the page sends was recorded and checked). It has
> **not yet been run on a robot**, and two robot-side assumptions still need to be confirmed:
> see [Before the first real drive](#before-the-first-real-drive).

---

## Contents

- [The short version](#the-short-version)
- [The command path](#the-command-path)
- [What the page sends](#what-the-page-sends)
- [Arming, holding, stopping](#arming-holding-stopping)
- [Turning input into a command](#turning-input-into-a-command)
- [How the page knows it worked](#how-the-page-knows-it-worked)
- [Priority: the physical controller always wins](#priority-the-physical-controller-always-wins)
- [The camera on the Drive tab](#the-camera-on-the-drive-tab)
- [Code map](#code-map)
- [Changing the behaviour](#changing-the-behaviour)
- [Testing without a robot](#testing-without-a-robot)
- [Before the first real drive](#before-the-first-real-drive)
- [Known risks](#known-risks)
- [Troubleshooting](#troubleshooting)

---

## The short version

The dashboard does not have its own path to the motors. It publishes an ordinary ROS 2
message on **`/drive`**, which is the input the F1TENTH stack already reserves for
navigation / autonomous driving. From there the existing stack takes over exactly as it
would for any autonomous node.

- Commands travel over the **same rosbridge WebSocket** the dashboard already uses for
  diagnostics (port 9090). No new server, port or ROS node.
- Nothing is sent until the user **arms** the controller.
- Commands are sent only **while a key or the pad is held** (dead-man). Letting go stops
  the car.
- The **physical joystick has priority** and overrides the page whenever its deadman is held.

---

## The command path

```
 Browser (Drive tab)
   │  WebSocket, JSON  (rosbridge protocol: advertise / publish / unadvertise)
   ▼
 rosbridge_server  :9090
   │  ackermann_msgs/msg/AckermannDriveStamped
   ▼
 /drive                       ← mux NAVIGATION input  (lower priority)
 /teleop  (from joy_teleop)   ← mux JOYSTICK input    (higher priority)
   │
   ▼
 ackermann_mux  ──►  /ackermann_cmd
                        │
                        ▼
              ackermann_to_vesc_node
                 │                 │
                 ▼                 ▼
   /commands/motor/speed   /commands/servo/position
                 │                 │
                 └──────┬──────────┘
                        ▼
                 vesc_driver_node  ──►  VESC  ──►  motor + steering servo
```

Things to notice:

1. **`/drive` is not new.** It is already in the dashboard's topic list as an `INPUT` topic
   ("the stack subscribes to this and nothing is supposed to publish it"). The Drive tab is
   the thing that publishes it.
2. **The mux decides, but does not stop the car.** `ackermann_mux` forwards whichever input
   has the highest priority and has published recently. Its `mux.yaml` sets a **0.2 s
   timeout** on each input, but that timeout only decides **priority**: the mux passes
   messages through one at a time and sends **no zero of its own** when an input goes quiet
   (see `prototype/tools/estop_capture.py`). What actually stops the motor is either an
   explicit zero-speed command or the **VESC's own command timeout** (roughly 1 s, not yet
   measured on our VESCs; see S-23 in `subsystem-inventory.md`).
3. **Everything downstream of the mux is unchanged.** Speed-to-ERPM conversion, steering
   calibration and the VESC's own limits all still apply.

---

## What the page sends

All messages are rosbridge protocol v2 JSON over the existing socket (`send()` in
`prototype/js/helpers.js`).

**On arm**, once:

```json
{ "op": "advertise", "topic": "/drive",
  "type": "ackermann_msgs/msg/AckermannDriveStamped" }
```

**While driving**, 20 times a second:

```json
{
  "op": "publish",
  "topic": "/drive",
  "msg": {
    "header": { "stamp": { "sec": 1790000000, "nanosec": 123000000 }, "frame_id": "base_link" },
    "drive": {
      "steering_angle": 0.34,
      "steering_angle_velocity": 0,
      "speed": 1.0,
      "acceleration": 0,
      "jerk": 0
    }
  }
}
```

- `speed` is in **m/s**; positive is forward, negative is reverse.
- `steering_angle` is in **radians**; positive is **left**, per ROS REP-103.
- The stamp is the browser's clock. The mux uses arrival time, not this stamp, so a
  browser clock that disagrees with the robot's does not matter.

**On disarm**, once:

```json
{ "op": "unadvertise", "topic": "/drive" }
```

---

## Arming, holding, stopping

The controller is a small state machine. The rule underneath it: **the car only moves while
a human is actively holding something**, and every uncertain situation resolves to "stop".

```
            tick "area is clear"
            + press Arm
            (needs a live connection)
 DISARMED ───────────────────────────►  ARMED  ─── hold pad / key ───►  DRIVING
    ▲                                    ▲  │                              │
    │                                    │  └────────── let go ◄───────────┘
    │                                    │        (5 zero-speed messages,
    │                                    │         then silence)
    └──────────── any disarm trigger ────┴──────────────────────────────────┘
```

| State | What is sent |
|---|---|
| **Disarmed** | Nothing. `/drive` is not advertised. |
| **Armed** (nothing held) | Nothing (the last thing sent was a zero). |
| **Driving** (something held) | A command every 50 ms (20 Hz). |
| **Just released** | Five `speed: 0, steering_angle: 0` messages, then nothing. |

The zero-speed burst on release **is** the stop. Nothing downstream turns silence into a zero,
so the page makes sure the last command the car received was "stop".

> **The one case the page cannot cover: losing the link while driving.** If Wi-Fi drops, the
> browser crashes, or the laptop sleeps mid-drive, no zero reaches the car. The motor holds
> the last command until the VESC's command timeout, which is estimated at around 1 s and
> not yet measured. At 1 m/s that is about a metre of travel. This is why the default speed
> limit is low, and why the physical controller should stay within reach.

### Disarm triggers

Any of these disarms immediately. If the controller was armed, three zero-speed messages are
sent first, then `/drive` is unadvertised:

| Trigger | Why |
|---|---|
| **STOP** button, **Space**, **Esc** | Explicit stop. |
| **Disarm** button, or unticking "area is clear" | Explicit. |
| Switching to another dashboard tab | You can no longer see the controls. |
| The browser window losing focus | Key-up events stop arriving when the window is not focused, so a held key could otherwise be "stuck". |
| The page being hidden (minimised, other browser tab) | Browsers slow timers down in background tabs. |
| The page closing or reloading | Page hide. |
| The WebSocket closing, or being replaced by **Connect** / **Refresh** | The command channel is gone. Checked on every tick. |

Re-arming always takes a deliberate press of **Arm**.

---

## Turning input into a command

Two ways to drive, both treated as the dead-man:

**The pad** (mouse, touch or pen). The knob's position inside the circle is a vector with a
length of at most 1:

```
speed          = -y × max_speed        (up is forward)
steering_angle = -x × max_steering     (left of centre is a positive, left, angle)
```

Releasing the pointer returns the knob to the centre. The page captures the pointer, so
dragging outside the circle keeps working until you let go.

**The keyboard.** `W` / `↑` forward, `S` / `↓` reverse, `A` / `←` left, `D` / `→` right.
Keys combine (W + A is forward-left). Keys are ignored while you are typing in a text box.

**Limits and ramps** (`prototype/js/drive.js`):

| Setting | Default | Notes |
|---|---|---|
| Max speed | 1.0 m/s | Slider, 0.3 to 3.0 m/s |
| Max steering | 0.34 rad (19°) | Slider, 0.05 to 0.41 rad |
| `DRIVE_ACCEL` | 2.0 m/s² | How fast the speed may rise or change |
| `STEER_RATE` | 2.5 rad/s | How fast steering may change |
| `DRIVE_HZ` | 20 | Commands per second while driving |
| `STOP_BURST` | 5 | Zero-speed messages after release |

Speed is **ramped** so a key press does not ask the VESC for a step change. **Stopping is
never ramped:** the moment nothing is held, the command drops to zero.

---

## How the page knows it worked

The Drive tab only uses data the dashboard already receives. It adds no subscriptions.

| Shown as | Comes from | Tells you |
|---|---|---|
| **Driving input** vital | `ackermann_mux` status on `/diagnostics` (which input is "unmasked") | `This page (/drive)` means the mux is forwarding the page's commands. `Physical controller` means the joystick has taken over. `Idle` means nothing is being forwarded. |
| **Measured** (camera overlay) and **Speed** vital | `/odom`, `twist.twist.linear.x` | What the car is actually doing, compared with **Command**. |
| **Link** vital | Time since the last message from rosbridge | A frozen connection looks exactly like a healthy one, so check this. |
| **Nearest obstacle** vital | The closest valid `/scan` return in any direction | Amber under 1 m, red under 0.5 m, the same colours as the LiDAR plot. **This is a display only; it does not stop the car.** |
| **Battery**, **Temperature**, **CPU** vitals | `/sensors/core` and `system_diagnostics.py` | The same numbers as the Overview tab. |

If **Command** is non-zero but **Driving input** stays `Idle` and **Measured** stays at 0,
the mux is not accepting `/drive`. See [Troubleshooting](#troubleshooting).

---

## Priority: the physical controller always wins

`/teleop` (the PS4 controller via `joy_teleop`) is the mux's higher-priority input. While the
controller's deadman is held, the mux forwards the joystick and ignores `/drive` entirely,
whatever the page is doing. The **Driving input** vital shows `Physical controller`, with the
note "has priority over this page".

This is deliberate. A person holding the real controller should never have to fight a
browser tab. It also means the physical deadman stays a working e-stop for web driving:
grab the controller, hold L1, and the car does what the controller says.

---

## The camera on the Drive tab

The camera is a plain MJPEG stream from `camera_http.py` (port 8082). That server opens a
**separate GStreamer connection for every viewer**, so showing the camera in two places
would double the video traffic over Wi-Fi.

To avoid that, the page keeps **one** `<img>` element and **moves** it: into the Drive tab's
camera slot when Drive is opened, and back to the Overview camera card when you leave
(`showTab()` in `prototype/js/main.js`). Moving an element that is already loaded does not
restart the stream.

The Drive camera has a **Small / Large** size switch. The choice is remembered per browser
in `localStorage` under the key `driveCam`.

---

## Code map

| File | What it does |
|---|---|
| `prototype/js/drive.js` | The whole controller: arm and disarm, the 20 Hz loop (`driveTick`), pad and keyboard input, disarm triggers, the Vitals list (`driveVitals`), the camera size switch |
| `prototype/js/main.js` | `showTab()`: disarms when leaving Drive, and moves the camera. Calls `renderDrive()` from the 2 Hz render loop |
| `prototype/js/connection.js` | The rosbridge socket (`ws`) and `connect()`. Replacing the socket disarms the controller on its next tick |
| `prototype/js/helpers.js` | `send()`: writes one JSON message to the socket if it is open |
| `prototype/js/graph-data.js` | `onDiagnostics()`: sets `mux` (`teleop` / `autonomous` / `idle`) from the `ackermann_mux` status |
| `prototype/js/metrics.js` | `updateSpeed()` from `/odom`, and `drawScanCanvas()`, used by the Surroundings view |
| `prototype/dashboard.html` | The Drive tab markup (`#panelDrive`) |
| `prototype/css/dashboard.css` | The "DRIVE TAB" section: layout, pad, camera overlay, vitals |

The main functions in `drive.js`:

| Function | Role |
|---|---|
| `armDrive()` | Checks the connection and the safety box, advertises `/drive`, records which socket it armed on |
| `disarmDrive(reason)` | Sends zero commands if needed, unadvertises, clears all input, shows the reason |
| `driveTick()` | Runs every 50 ms. Works out the target from the pad or keys, ramps towards it, publishes, or runs the stop burst |
| `publishDrive(speed, steer)` | Builds and sends one `AckermannDriveStamped` |
| `renderDrive()` | The slower (2 Hz) parts: the Vitals list, the battery chip on the camera, the Surroundings radar |

---

## Changing the behaviour

| To change | Edit |
|---|---|
| The topic or message type | `DRIVE_TOPIC`, `DRIVE_TYPE` in `drive.js` |
| The command rate | `DRIVE_HZ`. Keep the period well under the mux's 0.2 s timeout, or the mux masks `/drive` between messages and the car stutters |
| How gently speed builds up | `DRIVE_ACCEL`, `STEER_RATE` |
| The slider ranges and defaults | The `#maxSpeed` and `#maxSteer` inputs in `dashboard.html` |
| The obstacle warning distances (plot and vital together) | `LIDAR_NEAR`, `LIDAR_CLOSE` in `metrics.js` |
| The keys | `KEY_FWD`, `KEY_BACK`, `KEY_LEFT`, `KEY_RIGHT` in `drive.js` |

If you add a new way for the page to lose control (a new tab, a modal, a new connection
path), add a matching disarm trigger. The rule is that anything uncertain resolves to stop.

---

## Testing without a robot

You can check everything up to the WebSocket in a browser, with no car and no ROS:

1. Open `prototype/dashboard.html`.
2. In the developer console, swap in a fake socket that records what the page sends:

   ```js
   const sent = [];
   ws = { readyState: 1, send: m => sent.push(JSON.parse(m)), close() {} };
   ```

3. Go to the **Drive** tab, tick the box, press **Arm**, hold `W` for a second, then let go.
4. Inspect what was sent:

   ```js
   sent.filter(m => m.op === "publish").map(m => m.msg.drive)
   ```

   You should see about 20 messages per second of holding, speed rising in 0.1 m/s steps
   up to the max-speed limit, then exactly five messages with `speed: 0`, then nothing more.
5. Arm again, hold `W`, and click the **Overview** tab. The last message should be a zero,
   followed by `{ "op": "unadvertise", "topic": "/drive" }`.

These are the same checks that were run when the feature was built.

---

## Before the first real drive

Do this once per robot, with the **wheels off the ground** (car on a stand):

1. **Confirm the mux accepts `/drive`.** On the robot, check `mux.yaml` for the navigation
   input's topic name and any lock topic:

   ```bash
   ros2 param dump /ackermann_mux
   ```

   The dashboard assumes the navigation input is `/drive` with no lock. If there is a lock
   (a topic that must publish `true` before navigation is allowed through), the page will
   show **Command** changing but **Driving input** staying `Idle`.
2. **Confirm the message type is installed:**

   ```bash
   ros2 interface show ackermann_msgs/msg/AckermannDriveStamped
   ```

3. **Watch the output while driving from the page:**

   ```bash
   ros2 topic echo /ackermann_cmd
   ```

   Hold `W` briefly. The speed should match **Command**, and drop to `0.0` as soon as you
   let go (the zero-speed burst).
4. **Check the steering direction.** Hold `A`: the front wheels should turn **left**.
5. **Check the physical override.** While holding `W` on the page, hold L1 on the PS4
   controller with the sticks centred. The wheels should stop, and **Driving input** should
   switch to `Physical controller`.
6. **Measure a lost connection.** While driving on the stand, disconnect Wi-Fi on the laptop
   and time how long the wheels keep turning. This is the VESC command timeout; with no zero
   coming from the page, nothing else stops them. `prototype/tools/estop_capture.py` records
   the chain with timestamps. If it is much more than 1 s, lower the VESC timeout before
   driving on the floor.

Only then drive on the floor, starting at the default 1.0 m/s limit.

---

## Known risks

- **rosbridge has no authentication.** Anyone on the network who can reach port 9090 can
  publish `/drive`, with or without this page. The Drive tab does not create that risk,
  but it makes it a button. Restrict access (network isolation, or a rosbridge
  authentication layer) before this is used anywhere but a supervised lab.
- **More than one dashboard can arm at once.** Two browsers publishing `/drive` would both
  feed the same mux input. There is no "someone else is driving" check yet.
- **The obstacle distance is a warning, not a brake.** Nothing on this page stops the car
  because something is close.
- **Link loss is not covered by the page.** If the connection dies mid-drive, the car holds
  its last command until the VESC's own command timeout (around 1 s, unmeasured). Measure it
  (step 6 above) before driving on the floor.
- **Wi-Fi latency is in the loop.** Every command, including STOP, takes the network trip to
  reach the car.
- **Browser throttling.** Browsers slow down timers in background tabs. The page disarms
  when it is hidden for this reason. Do not remove that trigger.

---

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| **Arm** is greyed out | Not connected, or the safety box is not ticked | Check the connection status in the top bar; tick the box |
| "DRIVING" shows, but the car does not move and **Driving input** stays `Idle` | The mux is not forwarding `/drive` (wrong topic name, or a lock) | See step 1 of [Before the first real drive](#before-the-first-real-drive) |
| **Driving input** says `Physical controller` | The PS4 deadman is held | Release L1 on the controller |
| The car moves, but steers the wrong way | Servo direction or calibration in the VESC config | Fix it in the VESC / `vesc.yaml`, not in the page: the page follows REP-103 |
| It keeps disarming on its own | The window is losing focus (clicking another app, a notification) | Keep the browser window focused while driving |
| **Measured** stays `—` | `/odom` is not arriving (`vesc_to_odom_node` down) | Check the Subsystems table on the Overview tab |
| The camera is black on the Drive tab | The stream dropped | Press **reconnect** in the camera card header |
