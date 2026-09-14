# Diagnostics dashboard prototype

Proof of concept from the ROS status spike (#2). Its only job was to show that a web page can display live robot health, so it is scrappy on purpose and not the final tool. The findings are in [docs/ros-status-spike-summary.md](../docs/ros-status-spike-summary.md).

The page is read-only and changes nothing on the car. It shows which nodes are running, which topics are actually publishing, battery voltage, the mux's active control input, everything on `/diagnostics`, a live `/rosout` warning and error feed, and an OS-level system panel. Click a topic row to see its real message data.

## Files

| File | What it is |
|---|---|
| `dashboard.html` | The whole page in one file. Inline CSS and JavaScript, no CDN, works with no internet |
| `start_diagnostics.sh` | Starts bringup, `system_diagnostics.py`, rosbridge and a web server, and stops them all on Ctrl+C |
| `system_diagnostics.py` | ROS node that publishes OS-level health (temperatures, CPU, memory, disk, network, USB devices, gamepad, clock) to `/diagnostics` |
| `verify_system.mjs` | Runs the page's real system panel code against sample messages. No robot needed: `node verify_system.mjs` |
| `tools/baseline_capture.sh` | Read-only health snapshot of a car for a session log: topic rates, `/diagnostics`, Bluetooth, thermals, load, memory, disk, network and lidar ping, VESC device, camera and clock. Run with bringup up: `bash tools/baseline_capture.sh \| tee baseline.txt` |
| `tools/rosbridge_check.py` | Checks rosbridge from a terminal with only Python installed. Lists nodes, checks `/scan`, `/odom`, `/sensors/core` and `/diagnostics`, and prints the battery voltage: `python3 tools/rosbridge_check.py [host] [port]` |

## Looking at it

Nothing to install. Once it is running on the car, open this from any machine on the same network:

```
http://192.168.1.202:8000/dashboard.html
```

192.168.1.202 is robot #2. For another car, use the address `start_diagnostics.sh` prints.

## Running it on the car

Robot #2 already has these files in `~/diag/`. For another car, copy the three runtime files and `tools/` into a folder of their own. Don't put them straight in the home directory: the web server shares everything in the folder it serves.

```bash
ssh f1-wsu-2@192.168.1.202 mkdir -p diag
scp -r dashboard.html start_diagnostics.sh system_diagnostics.py tools f1-wsu-2@192.168.1.202:~/diag/
```

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

- **Gamepad battery** says *not exposed by this driver*. With the pad connected, no battery entry appears in `/sys/class/power_supply/`, and a blank field would look like a bug.
- **VESC temp** shows the FET sensor only. The motor has no temperature sensor fitted and reads about -74 C, so the page says *no motor sensor fitted*. `temp_fet` itself needs a two-line fix to `vesc_driver.cpp` that currently only exists on robot #2. Without it the field reads 0.0.

A red banner across the top means the page has heard nothing from the robot for four seconds. A frozen page otherwise looks exactly like a healthy one, so check the "last update" age in the top right before trusting what you see.

## Troubleshooting

**Status dot stays red.** rosbridge isn't reachable. On the robot, check that it is listening with `ss -tlnp | grep 9090`. If it isn't, `~/diag/start_diagnostics.sh --no-bringup --no-server` starts it.

**Everything reads SILENT but `ros2 topic echo` works.** Publisher and subscriber QoS settings don't match. A `BEST_EFFORT` publisher sends nothing to a `RELIABLE` subscriber, which looks identical to a dead sensor. Check with `ros2 topic info -v /scan`.

**Nodes look missing that are definitely running.** `ros2 node list` is unreliable: the ROS daemon caches a stale view, and `--no-daemon` misses slow nodes. The page uses `rosapi/nodes`, which has been correct every time. If the terminal and the page disagree, trust the page.

**rosbridge stops responding** (connections are accepted but the page never connects). It has no rate limiting, and a client subscribing to everything unthrottled can wedge it. Restart it. The page throttles all of its own subscriptions.

## Things to know

- Several people can have the page open at once. Each browser is a separate rosbridge client and adds real traffic, and expanding a row subscribes faster. How many it can handle hasn't been measured.
- `/scan` is about 1081 values at 40 Hz. Expanded rows summarise large arrays instead of dumping them.
- rosbridge has no authentication. Anyone who can reach port 9090 can also publish, including to `/drive`, which drives the car. Decide how to handle that before this becomes permanent.
- Robot #2 uses `ROS_DOMAIN_ID=202`. If two cars on the same network share a domain ID, each sees the other's nodes and the node list mixes them up. Whether other cars use 202 hasn't been checked yet.
- Buttons that run a check on the robot, like taking a photo, are not built yet.
