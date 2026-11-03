# The dashboard

This folder is the working dashboard: the page, the services it needs on the car, the start script, tools for checking a car, and the tests. It started as the proof of concept from the ROS status spike (#2), which is why it is called `prototype/`; the spike's findings are in [docs/research/ros-status-spike-summary.md](../docs/research/ros-status-spike-summary.md).

The page shows the car's health (battery, computer, subsystems, ROS nodes and topics, camera, LiDAR), drives the car from the Drive tab, and has an emergency stop. How to use each tab is in [docs/guides/](../docs/guides/); how it all works is in [docs/system-overview.md](../docs/system-overview.md).

## Files

| File | What it is |
|---|---|
| `dashboard.html` | The page's markup. It loads the stylesheets in `css/` and the scripts in `js/`, in that order. No CDN, works with no internet |
| `css/` | The page's styling, one file per area: `base`, `topbar`, `overview`, `drive`, `advanced`, `cockpit`. [css/README.md](css/README.md) says what is where |
| `js/*.js` | The page's logic, split by job. They are plain scripts that share one scope, so **the load order in `dashboard.html` matters**: `config.js` first, `main.js` last. See the table below |
| `start_diagnostics.sh` | Starts bringup, `system_diagnostics.py`, rosbridge and a web server, and stops them all on Ctrl+C |
| `camera_http.py` | The camera's HTTP proxy: relays the GStreamer MJPEG stream to browsers, always the newest frame, so a slow link drops frames instead of lagging |
| `restart_stack.py` | Restarts everything `start_diagnostics.sh` runs, for the dashboard's **Restart the dashboard on the car** button: reached through `system_diagnostics.py`'s `~/restart_stack` service, or `camera_http.py`'s `POST /restart` when rosbridge does not answer. Logs to `/tmp/f1tenth-diag/restart.log` |
| `system_diagnostics.py` | ROS node that publishes OS-level health (temperatures, CPU, memory, disk, network, USB devices, gamepad, clock) to `/diagnostics`, and runs the emergency stop, the drive watchdog and the **obstacle stop** (LiDAR ahead while `/drive` drives forward) |
| `tests/` | Checks that need no robot. Run them all with `node tests/run.mjs`: LiDAR plot geometry, beam selection maths, the system list, joystick check and connection banners (all against the page's real `js/`), and the self-tests in `camera_http.py` and `system_diagnostics.py` |
| `tools/baseline_capture.sh` | Read-only health snapshot of a car for a session log: topic rates, `/diagnostics`, Bluetooth, thermals, load, memory, disk, network and lidar ping, VESC device, camera and clock. Run with bringup up: `bash tools/baseline_capture.sh \| tee baseline.txt` |
| `tools/rosbridge_check.py` | Checks rosbridge from a terminal with only Python installed. Lists nodes, checks `/scan`, `/odom`, `/sensors/core` and `/diagnostics`, and prints the battery voltage: `python3 tools/rosbridge_check.py [host] [port]` |

### The scripts, in load order

| Script | What is in it |
|---|---|
| `js/config.js` | Thresholds, timings, expected nodes, the robot list (`ROBOTS`) and shared state. Change limits and node lists here |
| `js/icons.js` | The line icons used across the page (`icon("name")`, or `<i data-icon="name">` in the HTML) |
| `js/helpers.js` | Small shared helper functions |
| `js/connection.js` | The rosbridge connection, service calls and subscriptions, plus the scan handler and the LiDAR geometry helpers (`isValidRange`, `polarToCanvas`) |
| `js/graph-data.js` | Reading the ROS graph, diagnostics, VESC data and the log; topic classification |
| `js/health.js` | Subsystem health, overall health and the status banner |
| `js/status-panels.js` | Diagnostic counts, battery, uptime, footer and the ROS Graph card |
| `js/advanced-panels.js` | The Advanced tab: topic and node tables and the "Needs attention" list |
| `js/system-tiles.js` | The Robot System list (every OS-level probe and its readings) |
| `js/metrics.js` | The Overview tiles (CPU, RAM, GPU, Temperature, Network) and their row details, LiDAR readouts, and the Lines view of the LiDAR plot |
| `js/camera.js` | Camera stream, automatic reconnect, take-picture, and recording the camera to a video file |
| `js/checks.js` | Connection health banners and the on-demand joystick check |
| `js/lidar-select.js` | Select beams: picking a range of LiDAR beam indices |
| `js/estop.js` | The Emergency stop button and banner |
| `js/controller.js` | The Controller tab: the PS4 controller drawn live from `/joy`, or a Steam Deck (any controller on this device) through the browser's Gamepad API, which can also drive (`deckDriveInput`, read by `drive.js`); the deadman check, the battery, and Map buttons |
| `js/drive.js` | The driving logic: arming, the dead-man, limits, who's driving. Its own cards sit hidden under the driving view |
| `js/cockpit.js` | The driving view on the Drive tab and in full screen: panes, floating controls, Settings, the side rail, thumb sticks, speedometer |
| `js/radar.js` | The Detailed LiDAR view: the radar drawing, obstacle detection and its panel on the Overview card |
| `js/main.js` | Render loop, tabs, theme switch, buttons, the connection form and robot picker, and startup. Must load last |

## Looking at it

Nothing to install. Once it is running on the car, open this from any machine on the same network:

```
http://192.168.1.202:8000/dashboard.html
```

192.168.1.202 is robot #2. For another car, use the address `start_diagnostics.sh` prints.

## Running it on the car

Robot #2 already has these files in `~/diag/`. For another car, copy the runtime files and the `css/`, `js/` and `tools/` folders into a folder of their own. Don't put them straight in the home directory: the web server shares everything in the folder it serves.

```bash
ssh f1-wsu-2@192.168.1.202 mkdir -p diag
scp -r dashboard.html css js start_diagnostics.sh system_diagnostics.py camera_http.py tools f1-wsu-2@192.168.1.202:~/diag/
```

`camera_http.py` is the camera's HTTP proxy. `start_diagnostics.sh` runs it from the folder it serves, so leave it out only if you always start with `--no-camera`.

The page is no longer a single file, so copying `dashboard.html` alone leaves it unstyled and dead. If a page still looks old after an update, hard-refresh with Ctrl+Shift+R: browsers cache the `.css` and `.js` files separately.

Then on the robot:

```bash
chmod +x ~/diag/start_diagnostics.sh     # first time only
~/diag/start_diagnostics.sh
```

It starts each piece, waits for it to come up, and prints where to point a browser:

```
F1TENTH diagnostics  (ROS_DOMAIN_ID=202)

  · bringup started (pid 1234, log bringup.log)
  ✓ bringup up (8 nodes)
  · sysdiag started (pid 1250, log sysdiag.log)
  ✓ system diagnostics publishing to /diagnostics
  · rosbridge started (pid 1262, log rosbridge.log)
  ✓ rosbridge listening on 9090
  · webserver started (pid 1270, log webserver.log)
  ✓ serving /home/f1-wsu-2/diag on :8000

  open:  http://192.168.1.202:8000/dashboard.html

  Ctrl+C stops everything. Following bringup log…
```

After that it follows the bringup log, so the terminal behaves like plain `bringup`. Ctrl+C stops everything it started. Logs are kept in `/tmp/f1tenth-diag/`.

| Flag | Use when |
|---|---|
| `--no-bringup` | bringup is already running in another terminal |
| `--no-sysdiag` | you don't want the system panel |
| `--no-bridge` | rosbridge is already running |
| `--no-server` | you are serving the page from your own laptop instead |
| `--port 8080` | port 8000 is taken |
| `--dir /path` | `dashboard.html` is somewhere other than next to the script |
| `--status` | check what is running, e.g. from a second SSH session |
| `--stop` | stop a run that was started from another session |

## Working on the page

You don't have to copy the file to the robot after every change. Serve it from your own machine and point it at the car:

```bash
python3 -m http.server 8000          # in this folder
```

```
http://localhost:8000/dashboard.html?url=ws://192.168.1.202:9090
```

`?url=` sets the rosbridge address. Without it, the page connects to port 9090 on whatever host served it, which is why the robot-hosted version needs no setup. On the robot, start everything except the web server:

```bash
~/diag/start_diagnostics.sh --no-server
```

## Reading the page

Topics are classified by what they are supposed to do, because a single "has it published recently" rule marks most of a healthy car as broken.

| State | Meaning |
|---|---|
| `OK` | Publishing normally |
| `IDLE` | Event topic with no input right now. Normal at rest (`/teleop`, `/joy`, `/commands/*`) |
| `INPUT` | The stack subscribes to this and nothing is supposed to publish it (`/drive`) |
| `SILENT` | A publisher exists but has never sent anything. Real problem |
| `STALE` | Was publishing, then stopped. Real problem |
| `NOT_ADVERTISED` | The node is running but never created this publisher, usually because it could not open its device |
| `MISSING` | Not in the graph at all, so its node is not running |

`NOT_ADVERTISED` means "the driver started but the hardware isn't there". `MISSING` means "the process isn't running".

The robot system panel covers things ROS does not publish: temperatures, CPU load, memory, disk, network, the VESC serial device, the camera's USB link, the gamepad and the clock. It comes from `system_diagnostics.py`, which publishes ordinary ROS diagnostics, so rosbridge carries it with no extra port and `rqt_robot_monitor` sees the same data. If the panel says *waiting for system_diagnostics*, the node is not running. `start_diagnostics.sh` starts it, or run `python3 system_diagnostics.py` by hand.

Two readings show words instead of numbers on purpose:

- **Gamepad battery** says *not exposed by this driver*, and that is final. The DS4 (`054C:05C4`) binds to `hid-generic`; `hid_sony`, which is what creates `sony_controller_battery_*`, **is not built for this Tegra kernel** (`modprobe: FATAL: Module hid_sony not found in directory /lib/modules/5.15.148-tegra`) and `/sys/bus/hid/drivers/` has no `sony` entry to bind to. `upower -e` lists only `DisplayDevice`. Getting a charge level would mean building a kernel module. A blank field would look like a bug, so the page says why instead.
- **VESC temp** shows the FET sensor only. The motor has no temperature sensor fitted and reads about -74 C, so the page says *no motor sensor fitted*. `temp_fet` itself needs a two-line fix to `vesc_driver.cpp` that currently only exists on robot #2. Without it the field reads 0.0.

### Reading the LiDAR plot

Chase-cam view: the car is the blue outline at the centre, drawn to scale, with forward up and left on the left.

- **Status line** above the plot says what matters in one sentence, in plain words: *"All clear. Closest thing is 1.6 m away, to the left."*, *"Close: something 0.89 m ahead-right."*, or *"... Something ahead is getting closer (0.99 m)."* Its colour follows the same bands as the dots.
- **View**: **Lines** (the default) is the original radar as first built - black screen, three green range rings, one continuous green outline, a scale that eases smoothly to fit (2 to 12 m) on Auto - with two additions: the **red (0.5 m) and amber (1 m) circles** around the car, labelled, and the **to-scale blue car**. **Detailed** is the radar (`js/radar.js`): every return as a dot, walls drawn as outlines, the five nearest objects tagged with their distance, a status for each direction, and a **Sweep** button in the toolbar that turns its turning line on or off. A range picked with the buttons or zoom applies to both. One choice for both plots, remembered per browser. The status sentence works the same in both views; the plot details below are for Detailed.
- **Danger circles (both views)**: a soft red circle 0.5 m around the car and an amber one at 1 m, each labelled, so "too close" is a place on the picture.
- The point count, field of view and update age are under **Technical details**, closed by default.

- **Line pieces (Lines)** are returns, coloured by distance: red under 0.5 m, amber under 1 m, green beyond (`LIDAR_NEAR` / `LIDAR_CLOSE` in `metrics.js`). The driving view's edge lights use the same bands.
- **Objects (Detailed)**: neighbouring returns are grouped into objects; the nearest five get numbered tags, amber under 1 m and red under 0.3 m (`RADAR` in `radar.js`), with ▼ and a speed when one is getting closer. Point at the plot for an object's distance, direction and width.
- **Dashed line** points at the nearest return.
- **Shaded wedge at the back** is the blind spot (the Hokuyo sees 270°).
- **Range / zoom**: Auto steps between 2 / 4 / 8 / 15 m. It zooms out within half a second and zooms in only after the smaller step has fitted for 2.5 s, so the rings do not keep resizing. Pick a number to pin it, **scroll on the plot** to zoom in and out, and **double-click** to go back to Auto. The driving view's LiDAR pane has the same range buttons in its own toolbar, and **Center** puts the car back in the middle.
- **In the driving view** (Drive tab and full screen) the LiDAR is a pane: resize it with the divider, drag its title to move it, **Float** it over the camera, or close it with its **×**.
- **Readouts** under the Lines plot: the closest return **Ahead** (±20°), **Left** and **Right** (60 to 120°), and **Closest** overall (with its bearing), as large numbers in the same colours as the dots. The badge under each says ▼ closer (amber) / ▲ farther (green) / steady over the last second; a 10 cm dead band keeps sensor noise from flickering it.
- The plot is drawn at the screen's real pixel density and its text scales with the plot, so it stays sharp and readable at any size.

### The joystick check button

The one button on the page that makes the robot do something. It calls a `std_srvs/Trigger` service on `system_diagnostics.py` over the same websocket as everything else, which runs `ros2 run joy joy_enumerate_devices` on the car and reports what it found.

It exists because a silent `/joy` has three causes that look identical on the topic: no controller, a controller that has gone to sleep, and a controller that is paired and working while ROS has no permission to open it. The third one cost most of a session. `joy_enumerate_devices` is the only thing that separates them, and it is too slow to run on a 1 Hz loop, which is what makes it a button.

Press it when `/joy` reads `IDLE` and you expected it not to. It answers with one of:

- **A joystick is readable.** SDL can open the device, so `/joy` will publish once the pad sends events.
- **No controller is connected.** Expected state, not a fault. Pair one and press it again.
- **CONTRADICTION: the pad is paired and connected, but SDL cannot open it.** This is the permission trap. `joy` reads `/dev/input/event*`, which is `0660 root:input`, and over NoMachine the login ACL goes to `gdm` rather than to you. Fix is `sudo usermod -aG input $USER`, then log out and back in - already-open shells keep their old groups, including one running bringup.

If the button reports that the service does not exist, `system_diagnostics.py` is not running or is an older copy without it.

### The Drive tab (virtual controller)

Drives the car from the browser, no gamepad needed. It publishes `ackermann_msgs/AckermannDriveStamped` on `/drive` - the `ackermann_mux` **navigation** input - at 50 Hz over the same websocket, and at once whenever the input changes.

- **Nothing is sent until you arm it**: tick "area is clear", press Arm.
- **Dead-man**: commands go out only while the pad or a drive key (`W A S D` / arrows) is held. Letting go sends five zero-speed commands and then goes silent. Those zeros are what stop the car - `ackermann_mux` passes messages through one at a time and sends no zero of its own when an input goes quiet.
- **Link loss is the weak spot.** If Wi-Fi drops mid-drive, no zero reaches the car and the motor holds the last command until the VESC's own command timeout (roughly 1 s, not yet measured on our VESCs). Keep the speed limit low and the area clear.
- **Disarms itself** on STOP / `Space` / `Esc`, leaving the tab, the window losing focus, the page going to the background, or the socket closing or reconnecting.
- **Limits**: max speed (default and normal limit **3 m/s**) and max steering (default and normal limit **19°**, the stock joystick limit). **⚠ Unlock high speed** raises speed to 5 m/s and **⚠ Unlock full steering** raises steering to 23°, each only through a warning dialog with two ticked confirmations. Opening either disarms; both switch off again when you leave the Drive tab or reload, and show red **HIGH SPEED** / **FULL STEERING** badges while on. The VESC's own `speed_max` and servo limits still apply - the stock F1TENTH speed limit works out to about 5 m/s, but check `vesc.yaml` on your car.
- **🛑 E-STOP** (top bar, every tab): stops the car **for everyone**, including whoever is driving with the physical controller. It calls `~/emergency_stop` on `system_diagnostics.py`, which freezes `ackermann_to_vesc_node` (every input reaches the motor through it) and holds the motor at speed 0 at 50 Hz itself. No confirmation on the way in. A red banner shows on every open dashboard until someone presses **Release**, which asks first and is refused while anyone holds the controller's deadman. Needs the updated `system_diagnostics.py` on the robot; the page says so plainly if the service is missing or the robot is unreachable.
- **Who's driving** card: one big, colour-coded answer - *Nobody is driving*, *You're armed*, *You are driving*, *The controller is driving*, *Someone else is driving*, or *Autonomous code is driving* - with one line of context. Under it, a chip says whether the physical controller is connected (your backup stop), and warnings appear only when they apply: another dashboard armed, autonomous code running, or more people connected than rosbridge can serve. Arming is refused while someone else is sending drive commands.
- **Connected**: the status banner (on every tab) shows how many people have the dashboard open - "Just you", "3 people" - turning amber near rosbridge's 10-connection limit and red past it.
- **The physical joystick wins.** It is the mux's higher-priority input, so holding its deadman overrides the page. The "Driving input" vital shows which input is driving.

The tab is the driving view (`js/cockpit.js`): camera, LiDAR and controls as panes you can show, hide, resize and drag into place, with **Full screen** to cover the screen. Hiding the top bar on a computer moves the essentials into a side rail so the picture gets the whole height. The top bar shows **Latency**, the round trip to the car, and has **Record** for the camera. The camera is the same single MJPEG stream as the Overview card, moved into the view while it is open, so opening Drive does not double the Wi-Fi load. How to use all of it is in [docs/guides/drive-tab.md](../docs/guides/drive-tab.md).

If the car does not move while "DRIVING" shows, check the Mux input readout: `Idle` means the mux is not taking `/drive` - look at `mux.yaml` on the robot for a lock or a different navigation topic.

There are two banners and they mean different things. A **red** one means the page has heard nothing from the robot for four seconds. A frozen page otherwise looks exactly like a healthy one, so check the "last update" age in the top right before trusting what you see.

An **orange** banner means rosbridge is still answering but has stopped sending topic data, which is what being past the 10-client limit looks like from the starved side - every topic reads SILENT and the page otherwise looks like a dead robot. The header's `clients N / 10` turns amber at 8 and red above 10. It reads `clients -` until the count changes, because rosbridge only publishes `/client_count` on connect and disconnect: everyone already subscribed hears a new client arrive, but the new client itself subscribes after its own event and hears nothing.

The count is advisory - it is there so people can watch the room fill up before anyone gets hurt. It cannot warn the client that is actually being starved, because a starved client receives no topic data at all and `/client_count` is a topic. That is what the orange banner is for, and it needs no subscription to work.

## Troubleshooting

**Status dot stays red.** rosbridge isn't reachable. On the robot, check that it is listening with `ss -tlnp | grep 9090`. If it isn't, `~/diag/start_diagnostics.sh --no-bringup --no-server` starts it.

**Everything reads SILENT but `ros2 topic echo` works.** Publisher and subscriber QoS settings don't match. A `BEST_EFFORT` publisher sends nothing to a `RELIABLE` subscriber, which looks identical to a dead sensor. Check with `ros2 topic info -v /scan`.

**Nodes look missing that are definitely running.** `ros2 node list` is unreliable: the ROS daemon caches a stale view, and `--no-daemon` misses slow nodes. The page uses `rosapi/nodes`, which has been correct every time. If the terminal and the page disagree, trust the page.

**The page connects but every topic reads SILENT.** You are probably past rosbridge's 10-client limit. The page now says so itself with an orange bar - *"rosbridge is answering but sending no topic data"* - and the header shows `clients N / 10`. Closing another tab is the fix, not restarting anything.

**rosbridge stops responding** (connections are accepted but the page never connects). It has no rate limiting, and a client subscribing to everything *unthrottled* can wedge it, which needs a restart. Merely having too many throttled clients does not - that degrades and recovers on its own. The page throttles all of its own subscriptions.

## Things to know

- **rosbridge serves exactly 10 clients at once** (measured 2026-09-16: 5/5, 10/10, 10 of 15, 10 of 25). Client 11 connects, is counted by `/client_count`, and then receives nothing - which on this page looks identical to a dead robot. Your own open tab is one of the ten, and a tab is a heavier client than most. There is no `max_clients` setting to raise it. It recovers on its own within 30 seconds once clients disconnect.
- `/scan` is about 1081 values at 40 Hz. Expanded rows summarise large arrays instead of dumping them.
- rosbridge has no authentication. Anyone who can reach port 9090 can also publish, including to `/drive`, which drives the car. Decide how to handle that before this becomes permanent.
- Robot #2 uses `ROS_DOMAIN_ID=202`. If two cars on the same network share a domain ID, each sees the other's nodes and the node list mixes them up. Whether other cars use 202 hasn't been checked yet.
- The joystick check is the only button so far. Others that were wanted, like an on-demand camera snapshot, are not built yet.
