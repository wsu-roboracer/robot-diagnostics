# Diagnostics dashboard prototype

Proof of concept from the ROS status spike (#2). Its only job was to show that a web page can display live robot health, so it is scrappy on purpose and not the final tool. The findings are in [docs/ros-status-spike-summary.md](../docs/ros-status-spike-summary.md).

The page is read-only apart from one button, and changes nothing on the car. It shows which nodes are running, which topics are actually publishing, battery voltage, the mux's active control input, everything on `/diagnostics`, a live `/rosout` warning and error feed, and an OS-level system panel. Click a topic row to see its real message data.

## Files

| File | What it is |
|---|---|
| `dashboard.html` | The page's markup. It loads `css/dashboard.css` and the scripts in `js/`, in that order. No CDN, works with no internet |
| `css/dashboard.css` | All of the page's styling |
| `js/*.js` | The page's logic, split by job. They are plain scripts that share one scope, so **the load order in `dashboard.html` matters**: `config.js` first, `main.js` last. See the table below |
| `start_diagnostics.sh` | Starts bringup, `system_diagnostics.py`, rosbridge and a web server, and stops them all on Ctrl+C |
| `system_diagnostics.py` | ROS node that publishes OS-level health (temperatures, CPU, memory, disk, network, USB devices, gamepad, clock) to `/diagnostics` |
| `verify_system.mjs` | Runs the page's real system panel and joystick-check code against sample messages. No robot needed: `node verify_system.mjs` |
| `tools/baseline_capture.sh` | Read-only health snapshot of a car for a session log: topic rates, `/diagnostics`, Bluetooth, thermals, load, memory, disk, network and lidar ping, VESC device, camera and clock. Run with bringup up: `bash tools/baseline_capture.sh \| tee baseline.txt` |
| `tools/rosbridge_check.py` | Checks rosbridge from a terminal with only Python installed. Lists nodes, checks `/scan`, `/odom`, `/sensors/core` and `/diagnostics`, and prints the battery voltage: `python3 tools/rosbridge_check.py [host] [port]` |

### The scripts, in load order

| Script | What is in it |
|---|---|
| `js/config.js` | Thresholds, timings, expected nodes and shared state. Change limits and node lists here |
| `js/helpers.js` | Small shared helper functions |
| `js/connection.js` | The rosbridge connection, service calls and subscriptions |
| `js/graph-data.js` | Reading the ROS graph, diagnostics, VESC data and the log; topic classification |
| `js/health.js` | Subsystem health, overall health and alerts |
| `js/status-panels.js` | Diagnostics list, battery, uptime and footer |
| `js/advanced-panels.js` | The advanced topic and node tables |
| `js/system-tiles.js` | The robot system (OS-level) tiles |
| `js/metrics.js` | Advanced diagnostics, priority metrics, hardware strip and lidar readout |
| `js/camera.js` | Camera stream and take-picture |
| `js/checks.js` | Connection health and on-demand checks |
| `js/main.js` | Render loop, buttons, connection form and startup. Must load last |

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
scp -r dashboard.html css js start_diagnostics.sh system_diagnostics.py tools f1-wsu-2@192.168.1.202:~/diag/
```

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

### The joystick check button

The one button on the page that makes the robot do something. It calls a `std_srvs/Trigger` service on `system_diagnostics.py` over the same websocket as everything else, which runs `ros2 run joy joy_enumerate_devices` on the car and reports what it found.

It exists because a silent `/joy` has three causes that look identical on the topic: no controller, a controller that has gone to sleep, and a controller that is paired and working while ROS has no permission to open it. The third one cost most of a session. `joy_enumerate_devices` is the only thing that separates them, and it is too slow to run on a 1 Hz loop, which is what makes it a button.

Press it when `/joy` reads `IDLE` and you expected it not to. It answers with one of:

- **A joystick is readable.** SDL can open the device, so `/joy` will publish once the pad sends events.
- **No controller is connected.** Expected state, not a fault. Pair one and press it again.
- **CONTRADICTION: the pad is paired and connected, but SDL cannot open it.** This is the permission trap. `joy` reads `/dev/input/event*`, which is `0660 root:input`, and over NoMachine the login ACL goes to `gdm` rather than to you. Fix is `sudo usermod -aG input $USER`, then log out and back in - already-open shells keep their old groups, including one running bringup.

If the button reports that the service does not exist, `system_diagnostics.py` is not running or is an older copy without it.

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
