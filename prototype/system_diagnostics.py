#!/usr/bin/env python3
"""Publish OS-level robot health as ROS diagnostics.

The problem this solves: CPU load, temperatures, disk, network, and USB device
state are NOT in ROS. Nothing publishes them, so rosbridge cannot carry them and
the dashboard cannot see them. This node reads them from the same places
baseline_capture.sh does and republishes them as a standard DiagnosticArray on
/diagnostics, next to urg_node's and ackermann_mux's entries.

Everything downstream then works for free: the dashboard already accumulates
/diagnostics keyed by status[].name, rqt_robot_monitor renders it, and
diagnostic_aggregator can group it. No new transport, no second port, no
polling endpoint.

    ros2 run ...            # not installed as a package; run it directly:
    python3 system_diagnostics.py

Read-only. No sudo. Safe to run alongside bringup.
"""

import glob
import grp
import os
import re
import shutil
import subprocess
import sys
import threading
import time

try:
    import rclpy
    from diagnostic_msgs.msg import DiagnosticArray, DiagnosticStatus, KeyValue
    from rclpy.callback_groups import MutuallyExclusiveCallbackGroup
    from rclpy.executors import MultiThreadedExecutor
    from rclpy.node import Node
    from std_srvs.srv import Trigger
except ImportError:
    # --self-test exercises the pure decision logic, which is the part worth
    # checking and the part that has no business needing a sourced ROS install.
    if "--self-test" not in sys.argv:
        raise
    Node = object

OK, WARN, ERROR, STALE = 0, 1, 2, 3

# Thresholds. Values marked PROVISIONAL still need block F's 20-minute loaded
# run; the measured idle floor is recorded next to each so the gap is visible.
TJ_WARN, TJ_ERR = 70.0, 85.0        # PROVISIONAL. Measured idle: tj-thermal 51 C
FET_WARN, FET_ERR = 65.0, 80.0      # PROVISIONAL. Measured idle: temp_fet 31.4 C,
                                    # VESC's own OVER_TEMP_FET fault trips near 85 C
MEM_WARN, MEM_ERR = 20.0, 10.0      # percent available. Measured idle: 63 %
DISK_WARN, DISK_ERR = 85.0, 95.0    # percent used. Measured: 4 % on a 915 GB NVMe
GPU_WARN, GPU_ERR = 85.0, 97.0      # percent busy. PROVISIONAL, no loaded run yet
LIDAR_IP = "192.168.0.10"

SLOW_PERIOD = 10.0                  # seconds between expensive probes


def read(path, default=None):
    """Read a sysfs file, or return `default`.

    `except OSError` is NOT enough. A sysfs file that returns EAGAIN (the Jetson's
    cv0/1/2 thermal zones do this, transiently, and the set that fails rotates)
    makes the raw layer hand TextIOWrapper a None, and the decoder then fails with
    `TypeError: can't concat NoneType to bytes` - which is not an OSError and
    escaped the handler. That is exactly the error this node reported on the car
    while working fine on a laptop with no such zones.
    """
    try:
        with open(path, "rb") as f:
            return f.read().decode("utf-8", "replace").strip()
    except Exception:  # noqa: BLE001
        return default


def run(cmd, timeout=4):
    """Never let a hung external command take the node with it."""
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
        return p.stdout
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return ""


def probe(cmd, timeout=8):
    """Like run(), but the caller can tell "tool missing" from "printed nothing".

    joy_enumerate_devices printing zero rows is the whole signal we are after, so
    an absent `ros2` binary must never be allowed to look like zero joysticks.
    """
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
        return p.returncode, (p.stdout + p.stderr).strip()
    except subprocess.TimeoutExpired:
        return None, f"timed out after {timeout}s"
    except (FileNotFoundError, OSError) as e:
        return None, str(e)


# Where the Jetson GPU driver exposes its busy fraction, newest board first.
# The file reads 0-1000 (per mille). Orin moved it under bus@0; Nano/TX2/Xavier
# keep the older gpu.0 path. Globbed rather than hardcoded so one script covers
# every car in the fleet.
GPU_LOAD_GLOBS = (
    "/sys/devices/platform/bus@0/*.gpu/load",
    "/sys/devices/platform/*.gpu/load",
    "/sys/devices/platform/gpu.0/load",
    "/sys/devices/gpu.0/load",
    "/sys/devices/*.gpu/load",
)

# devfreq names the GPU after its chip on some boards (gv11b = Xavier,
# ga10b = Orin, gp10b = TX2, gm20b = Nano) and "<addr>.gpu" on others.
GPU_DEVFREQ = re.compile(r"gpu|gv11b|ga10b|gp10b|gm20b")


def find_gpu_files():
    """Return (load_path, cur_freq_path); either may be None off-Jetson."""
    load = next((p for g in GPU_LOAD_GLOBS for p in sorted(glob.glob(g))), None)
    freq = next((f"{d}/cur_freq" for d in sorted(glob.glob("/sys/class/devfreq/*"))
                 if GPU_DEVFREQ.search(os.path.basename(d))
                 and os.path.exists(f"{d}/cur_freq")), None)
    return load, freq


def parse_gr3d(line):
    """tegrastats' GPU field -> (busy %, MHz or None), or None if absent.

    Seen as `GR3D_FREQ 0%@305` (Nano), `GR3D_FREQ 0%@[305]` (Xavier) and
    `GR3D_FREQ 0%@[305,0]` or bare `GR3D_FREQ 0%` (Orin)."""
    m = re.search(r"GR3D_FREQ (\d+)%(?:@\[?(\d+))?", line or "")
    if not m:
        return None
    return int(m.group(1)), int(m.group(2)) if m.group(2) else None


def cpu_busy_pct(prev, cur):
    """Busy % between two /proc/stat `cpu` lines' counters, or None.

    iowait counts as idle: a core waiting on the NVMe is not doing work, and
    counting it as busy makes a log flush look like a CPU spike."""
    if not prev or not cur or len(prev) < 5 or len(cur) < 5:
        return None
    idle = (cur[3] + cur[4]) - (prev[3] + prev[4])
    total = sum(cur) - sum(prev)
    if total <= 0:
        return None
    return max(0.0, min(100.0, 100.0 * (total - idle) / total))


def parse_joy_devices(out):
    """Pull "<id>: <name>" out of joy_enumerate_devices' table.

    Confirmed on robot #2, 2026-09-16 - colon-separated, one header row, one rule:

        ID : GUID                             : GamePad : Mapped : Joystick Device Name
        ---------------------------------------------------------------------------
         0 : 050000004c050000c405000000010000 :    true :   true : PS4 Controller

    Only rows whose first field is a number are devices, which drops the header
    and the rule without having to recognise either of them.
    """
    devices = []
    for line in out.splitlines():
        fields = [f.strip() for f in line.split(":")]
        if len(fields) >= 2 and fields[0].isdigit():
            devices.append(f"{fields[0]}: {fields[-1]}")
    return devices


def in_input_group():
    try:
        return grp.getgrnam("input").gr_gid in os.getgroups()
    except KeyError:
        return False


def joy_verdict(rc, out, devices, connected, in_group):
    """Turn the joystick evidence into (usable_by_ros, human-readable report).

    Pure so it can be asserted without a robot: `python3 system_diagnostics.py
    --self-test`. The interesting row is (0 devices, pad connected) - the seat-ACL
    trap, where everything else on the page says the controller is fine and only
    ROS cannot read it. Before this check that state was indistinguishable from
    "nobody plugged a controller in".
    """
    if rc is None:
        return False, "could not run joy_enumerate_devices: " + out

    grp_note = "yes" if in_group else "NO  <- this is almost certainly the problem"
    lines = [
        f"{'joy_enumerate_devices:':<30}{len(devices)} device(s)"
        + (" -> " + "; ".join(devices) if devices else ""),
        f"{'bluetooth connected:':<30}{'yes' if connected else 'no'}",
        f"{'`input` group (this process):':<30}{grp_note}",
    ]

    # The verdict always carries what the command actually printed. The table
    # format is confirmed (robot #2, 2026-09-16) but it is a human-facing CLI
    # table, not an API, and a future column would make the parser wrong silently.
    # Side by side, a parser miss reads as a disagreement instead of a verdict.
    raw = ["", "raw output:"] + ["  " + ln for ln in (out.splitlines() or ["(nothing printed)"])]

    if devices:
        if connected:
            return True, "\n".join(lines + [
                "", "OK - SDL can open the device, so /joy will publish as soon as",
                "the pad sends events."] + raw)
        return True, "\n".join(lines + [
            "", "A joystick is readable but no Bluetooth link is up - a wired pad,",
            "or some other device SDL counts as a joystick."] + raw)

    if connected:
        return False, "\n".join(lines + [
            "",
            "CONTRADICTION: the pad is paired and connected, but SDL cannot open it.",
            "`joy` on Humble reads /dev/input/event*, not js0, and that node is 0660",
            "root:input. Over NoMachine the logind uaccess ACL goes to gdm, never to",
            "you, so /joy stays silent on a working controller.",
            "",
            "Fix:  sudo usermod -aG input $USER    then log out and back in",
            "      (already-open shells keep the old groups, bringup included)",
        ] + raw)

    return False, "\n".join(lines + [
        "", "No controller is connected. Pair one, then run this again - a silent",
        "/joy is expected in this state and is not a fault.",
    ] + raw)


def status(name, level, message, values, hardware_id=""):
    s = DiagnosticStatus()
    s.name = name
    s.level = bytes([level])
    s.message = message
    s.hardware_id = hardware_id
    s.values = [KeyValue(key=str(k), value=str(v)) for k, v in values]
    return s


def worst(*levels):
    return max(levels) if levels else OK


class SystemDiagnostics(Node):
    def __init__(self):
        super().__init__("system_diagnostics")
        self.pub = self.create_publisher(DiagnosticArray, "/diagnostics", 10)
        self.ncores = os.cpu_count() or 1
        self.gpu_load_path, self.gpu_freq_path = find_gpu_files()
        self._cpu_prev = None

        # Filled by the background thread. Until it has run once these report
        # STALE rather than a fabricated OK - an unmeasured subsystem is
        # `unknown`, which is the fourth state the spike insists on.
        self.slow = {}
        self.slow_lock = threading.Lock()
        threading.Thread(target=self._slow_loop, daemon=True).start()

        self.create_timer(1.0, self.tick)

        # On-demand checks live behind a service, not the 1 Hz loop: this one
        # shells out to `ros2 run`, which is far too slow to run on a clock. Its
        # own callback group + a MultiThreadedExecutor keep the several seconds it
        # blocks for off the publish timer - otherwise the whole dashboard would
        # go stale while the check runs and look like a robot fault.
        self.create_service(Trigger, "~/joystick_check", self.joystick_check,
                            callback_group=MutuallyExclusiveCallbackGroup())

        self.get_logger().info(
            f"publishing system diagnostics on /diagnostics ({self.ncores} cores); "
            "service ~/joystick_check ready")

    # ---------- on-demand checks, called from the dashboard ----------

    def joystick_check(self, _request, response):
        """Answer "why is /joy silent?" - the one question /joy itself cannot.

        A silent /joy has three causes that look identical on the topic: no pad,
        a sleeping pad, and a pad that ROS has no permission to open. Only
        joy_enumerate_devices separates the third, and it is the expensive one to
        run, which is what makes it a button rather than a tile.
        """
        # 8s: `ros2 run` pays DDS discovery on every invocation and is slow on the
        # Jetson. The page allows 12s, so this must fail first and say so.
        rc, out = probe(["ros2", "run", "joy", "joy_enumerate_devices"], timeout=8)
        devices = parse_joy_devices(out)
        pad = self._slow_get("pad") or {}
        response.success, response.message = joy_verdict(
            rc, out, devices, bool(pad.get("connected")), in_input_group())
        self.get_logger().info(f"joystick_check: {len(devices)} device(s), "
                               f"success={response.success}")
        return response

    # ---------- fast probes: pure sysfs reads, safe at 1 Hz ----------

    def thermal(self):
        vals, temps, unreadable = [], {}, []
        base = "/sys/devices/virtual/thermal"
        for zone in sorted(os.listdir(base)) if os.path.isdir(base) else []:
            if not zone.startswith("thermal_zone"):
                continue
            raw = read(f"{base}/{zone}/temp")
            kind = read(f"{base}/{zone}/type", zone)
            # Some Jetson zones (cv0/1/2) return EAGAIN transiently and the set
            # that fails rotates, so never blacklist them - just skip this pass.
            if raw is None or not re.fullmatch(r"-?\d+", raw or ""):
                unreadable.append(kind)
                continue
            c = int(raw) / 1000.0
            temps[kind] = c
            vals.append((kind, f"{c:.1f} C"))
        if unreadable:
            vals.append(("unreadable this pass", ", ".join(unreadable)))
        if not temps:
            return status("system: Thermal", STALE, "no readable thermal zones", vals)

        # tj-thermal is the Jetson's junction temperature and is the one #1's
        # S-05 asks for. On any other board it does not exist, and reporting the
        # hottest zone as "junction" would be a confident wrong label.
        if "tj-thermal" in temps:
            tj, label = temps["tj-thermal"], "junction"
        else:
            hottest = max(temps, key=temps.get)
            tj, label = temps[hottest], f"hottest zone ({hottest})"
        lvl = ERROR if tj >= TJ_ERR else WARN if tj >= TJ_WARN else OK
        return status("system: Thermal", lvl, f"{label} {tj:.1f} C", vals)

    def cpu(self):
        load = (read("/proc/loadavg") or "0 0 0").split()
        l1 = float(load[0]) if load else 0.0
        lvl = ERROR if l1 > self.ncores * 2 else WARN if l1 > self.ncores else OK
        vals = [("cores", self.ncores), ("load 1m", load[0]),
                ("load 5m", load[1] if len(load) > 1 else "?"),
                ("load 15m", load[2] if len(load) > 2 else "?")]
        # Utilisation over the last tick, from /proc/stat deltas. Load average
        # lags by a minute and counts blocked tasks; this is what "the CPU is
        # pegged" actually means right now.
        first = (read("/proc/stat") or "").split("\n", 1)[0].split()
        cur = [int(x) for x in first[1:] if x.isdigit()] if first[:1] == ["cpu"] else None
        busy = cpu_busy_pct(self._cpu_prev, cur)
        self._cpu_prev = cur
        if busy is not None:
            vals.append(("usage %", f"{busy:.1f}"))
        return status("system: CPU", lvl, f"load {l1:.2f} over {self.ncores} cores", vals)

    def gpu(self):
        """Jetson GPU busy %. sysfs first (1 Hz, no subprocess); tegrastats'
        GR3D_FREQ from the slow loop only if the driver file is not there."""
        vals, pct, source = [], None, None
        raw = read(self.gpu_load_path) if self.gpu_load_path else None
        if raw is not None and raw.isdigit():
            pct, source = int(raw) / 10.0, self.gpu_load_path
        else:
            gr3d = self._slow_get("gr3d")
            if gr3d:
                pct, source = float(gr3d[0]), "tegrastats"
                if gr3d[1]:
                    vals.append(("freq", f"{gr3d[1]} MHz"))
        if pct is None:
            return status("system: GPU", STALE,
                          "no GPU load source (not a Jetson, or tegrastats missing)",
                          [("searched", ", ".join(GPU_LOAD_GLOBS))])
        hz = read(self.gpu_freq_path) if self.gpu_freq_path else None
        if hz and hz.isdigit() and not any(k == "freq" for k, _ in vals):
            vals.append(("freq", f"{int(hz) / 1e6:.0f} MHz"))
        vals += [("usage %", f"{pct:.1f}"), ("source", source)]
        lvl = ERROR if pct >= GPU_ERR else WARN if pct >= GPU_WARN else OK
        return status("system: GPU", lvl, f"{pct:.0f}% busy", vals)

    def memory(self):
        info = {}
        for line in (read("/proc/meminfo") or "").splitlines():
            k, _, v = line.partition(":")
            info[k] = int(v.split()[0]) if v.split() and v.split()[0].isdigit() else 0
        total, avail = info.get("MemTotal", 0), info.get("MemAvailable", 0)
        if not total:
            return status("system: Memory", STALE, "/proc/meminfo unreadable", [])
        pct = 100.0 * avail / total
        lvl = ERROR if pct < MEM_ERR else WARN if pct < MEM_WARN else OK
        swap_t, swap_f = info.get("SwapTotal", 0), info.get("SwapFree", 0)
        return status("system: Memory", lvl, f"{pct:.0f}% available",
                      [("total", "%.2f GB" % (total / 1048576.0)),
                       ("available", "%.2f GB" % (avail / 1048576.0)),
                       ("available %", f"{pct:.1f}"),
                       ("swap used", "%.2f GB" % ((swap_t - swap_f) / 1048576.0))])

    def storage(self):
        try:
            u = shutil.disk_usage("/")
        except OSError:
            return status("system: Storage", STALE, "df failed", [])
        pct = 100.0 * u.used / u.total if u.total else 0.0
        lvl = ERROR if pct > DISK_ERR else WARN if pct > DISK_WARN else OK
        return status("system: Storage", lvl, f"{pct:.0f}% of / used",
                      [("total", "%.0f GB" % (u.total / 1e9)),
                       ("used", "%.0f GB" % (u.used / 1e9)),
                       ("free", "%.0f GB" % (u.free / 1e9)),
                       ("used %", f"{pct:.1f}")])

    def power(self):
        """S-02. Uptime is the brownout detector: if it goes backwards between
        two samples the board rebooted, and on this car that means the pack."""
        up = float((read("/proc/uptime") or "0").split()[0])
        vals = [("uptime", f"{up:.0f} s")]
        lvl, msg = OK, f"up {up:.0f} s"
        prev = getattr(self, "_last_uptime", None)
        if prev is not None and up < prev:
            lvl, msg = ERROR, "REBOOTED - uptime went backwards (brownout?)"
            self._reboot_seen = time.time()
        self._last_uptime = up
        if getattr(self, "_reboot_seen", 0):
            vals.append(("last reboot detected",
                         time.strftime("%H:%M:%S", time.localtime(self._reboot_seen))))
            lvl = worst(lvl, WARN)
        with self.slow_lock:
            rails = self.slow.get("rails")
        if rails:
            vals += list(rails.items())
        return status("system: Power", lvl, msg, vals)

    def vesc_device(self):
        """S-09. The serial node existing is separate from the topic flowing;
        this catches an unplugged VESC before the topic even goes silent."""
        path = "/dev/sensors/vesc"
        if os.path.exists(path):
            return status("system: VESC device", OK, "present",
                          [("path", path),
                           ("resolves to", os.path.realpath(path))])
        alt = sorted(p for p in os.listdir("/dev") if p.startswith("ttyACM"))
        return status("system: VESC device", ERROR,
                      "/dev/sensors/vesc missing",
                      [("ttyACM* present", ", ".join(alt) or "none")])

    # ---------- slow probes: subprocesses, once every SLOW_PERIOD ----------

    def _slow_loop(self):
        while True:
            try:
                self._probe_slow()
            # never let this thread die
            except Exception as e:  # noqa: BLE001
                self.get_logger().warn(f"slow probe failed: {e}")
            time.sleep(SLOW_PERIOD)

    def _probe_slow(self):
        out = {}

        # Power rails, S-02. tegrastats needs no sudo on this image.
        line = run(["timeout", "2", "tegrastats", "--interval", "500"], timeout=4)
        first = line.splitlines()[0] if line.splitlines() else ""
        rails = dict(re.findall(r"(VDD_\w+)\s+(\d+)mW", first))
        if rails:
            out["rails"] = {k: f"{v} mW" for k, v in rails.items()}
        # GPU fallback for boards where the sysfs load file is missing.
        gr3d = parse_gr3d(first)
        if gr3d:
            out["gr3d"] = gr3d

        # Lidar link, S-17.
        ping = run(["ping", "-c", "2", "-W", "2", LIDAR_IP], timeout=8)
        m = re.search(r"= [\d.]+/([\d.]+)/", ping)
        out["lidar"] = {"reachable": "1 received" in ping or "2 received" in ping,
                        "rtt_ms": m.group(1) if m else "?"}

        # Interfaces, S-17.
        nets = {}
        for n in sorted(os.listdir("/sys/class/net")):
            if n == "lo":
                continue
            nets[n] = {"carrier": read(f"/sys/class/net/{n}/carrier", "?"),
                       "operstate": read(f"/sys/class/net/{n}/operstate", "?")}
        out["nets"] = nets

        # Gamepad, S-03 / S-18.
        pad = {"js": sorted(p for p in os.listdir("/dev/input") if p.startswith("js"))}
        devices = run(["bluetoothctl", "devices"], timeout=5)
        for mac, name in re.findall(r"Device (\S+) (.+)", devices):
            info = run(["bluetoothctl", "info", mac], timeout=5)
            if "Connected: yes" in info:
                pad["mac"], pad["name"] = mac, name.strip()
                pad["connected"] = True
                b = re.search(r"Battery Percentage:.*\((\d+)\)", info)
                if b:
                    pad["battery"] = b.group(1)
                break
        else:
            pad["connected"] = False
        # Second path to the charge level, in case hid-sony ever binds. Match
        # the entry to THIS pad - a bare "first power_supply with a capacity"
        # happily reports an unrelated device (a wireless mouse, on the machine
        # this was tested on) as the controller's battery.
        mac_tag = pad.get("mac", "").lower().replace(":", "_")
        try:
            supplies = sorted(os.listdir("/sys/class/power_supply"))
        except OSError:
            supplies = []
        for entry in supplies:
            e = entry.lower()
            if not (e.startswith(("sony_controller_battery", "ps_controller_battery"))
                    or (mac_tag and mac_tag in e)):
                continue
            cap = read(f"/sys/class/power_supply/{entry}/capacity")
            if cap is not None:
                pad.setdefault("battery", cap)
                pad["battery_source"] = entry
                break
        out["pad"] = pad

        # Camera, S-14. Presence and link speed, independent of whether the ROS
        # node is running - which is the whole point, since it is not in bringup.
        cam = {"present": False}
        for dev in sorted(os.listdir("/sys/bus/usb/devices")):
            vid = read(f"/sys/bus/usb/devices/{dev}/idVendor")
            if vid != "8086":
                continue
            cam = {"present": True,
                   "speed": read(f"/sys/bus/usb/devices/{dev}/speed", "?"),
                   "product": read(f"/sys/bus/usb/devices/{dev}/product", "?"),
                   "serial": read(f"/sys/bus/usb/devices/{dev}/serial", "?"),
                   "port": dev}
            break
        out["camera"] = cam

        # Clock, S-08.
        td = run(["timedatectl", "show"], timeout=4)
        out["clock"] = dict(re.findall(r"^(\w+)=(.*)$", td, re.MULTILINE))

        with self.slow_lock:
            self.slow.update(out)

    # ---------- statuses built from the slow probe's results ----------

    def _slow_get(self, key):
        with self.slow_lock:
            return self.slow.get(key)

    def network(self):
        nets, lidar = self._slow_get("nets"), self._slow_get("lidar")
        if nets is None:
            return status("system: Network", STALE, "not probed yet", [])
        vals = [(n, f"carrier={d['carrier']} {d['operstate']}")
                for n, d in nets.items()]
        up = [n for n, d in nets.items() if d["carrier"] == "1"]
        lvl, msg = OK, f"{len(up)} link{'' if len(up) == 1 else 's'} up"
        if lidar:
            vals.append((f"lidar {LIDAR_IP}",
                         f"reachable, {lidar['rtt_ms']} ms" if lidar["reachable"]
                         else "NO REPLY"))
            if not lidar["reachable"]:
                lvl, msg = ERROR, f"lidar unreachable at {LIDAR_IP}"
        if not up:
            lvl, msg = ERROR, "no interface has carrier"
        return status("system: Network", lvl, msg, vals)

    def gamepad(self):
        pad = self._slow_get("pad")
        if pad is None:
            return status("system: Gamepad", STALE, "not probed yet", [])
        # /dev/input/js* disappears the moment the pad disconnects, and listing a
        # directory is cheap enough to do here at 1 Hz. bluetoothctl, which names the
        # device, only runs every SLOW_PERIOD, so relying on it alone left this tile
        # reading `connected` for up to 10 s after the link had gone. Measured on the
        # car during the block D e-stop runs: /joy went IDLE instantly while this
        # tile lagged a full probe cycle. S-03 depends on this tile to tell "the
        # operator let go" from "the operator lost the car", so it has to be prompt.
        try:
            js = sorted(p for p in os.listdir("/dev/input") if p.startswith("js"))
        except OSError:
            js = []
        vals = [("js devices", ", ".join(js) or "none"),
                ("bluetooth", "connected" if pad["connected"] else "not connected")]
        if pad.get("name"):
            vals.append(("device", f"{pad['name']} ({pad.get('mac', '?')})"))
        if pad.get("battery"):
            vals.append(("battery %", pad["battery"]))
            vals.append(("battery source", pad.get("battery_source", "bluetoothctl")))
        else:
            # Measured twice: this kernel binds hid-generic, not hid-sony, so no
            # power_supply entry appears even with the pad connected. Say so
            # rather than showing a blank field that looks like a bug.
            vals.append(("battery %", "not exposed by this driver"))
        if pad["connected"] and js:
            return status("system: Gamepad", OK, "connected", vals)
        if js:
            # Also the normal state for the first few seconds after connecting,
            # while the bluetoothctl probe catches up.
            return status("system: Gamepad", WARN, "js device but no BT link", vals)
        return status("system: Gamepad", WARN, "no controller connected", vals)

    def camera(self):
        cam = self._slow_get("camera")
        if cam is None:
            return status("system: Camera", STALE, "not probed yet", [])
        if not cam["present"]:
            return status("system: Camera", WARN, "no Intel camera on USB",
                          [("vendor 8086", "not found")])
        speed = cam.get("speed", "?")
        # Deliberately labelled "usb serial": on this D435i the USB iSerial
        # (327743063048) does NOT match what librealsense reports as the device
        # serial (317622075395). Calling either one "the serial number" invites
        # someone to match them and conclude the wrong camera is plugged in.
        vals = [("product", cam.get("product", "?")),
                ("usb serial", cam.get("serial", "?")),
                ("usb port", cam.get("port", "?")),
                ("link speed", f"{speed} M")]
        # 480M is the silent degradation this check exists to catch: the camera
        # works, publishes, and quietly runs at a fraction of its bandwidth.
        if speed == "5000" or (speed.isdigit() and int(speed) >= 5000):
            return status("system: Camera", OK, f"USB3 at {speed} M", vals,
                          cam.get("serial", ""))
        return status("system: Camera", WARN,
                      f"enumerated at {speed} M - expected 5000", vals,
                      cam.get("serial", ""))

    def clock(self):
        c = self._slow_get("clock")
        if c is None:
            return status("system: Clock", STALE, "not probed yet", [])
        synced = c.get("NTPSynchronized", "no") == "yes"
        return status("system: Clock", OK if synced else WARN,
                      "NTP synchronised" if synced else "clock NOT synchronised",
                      [("NTPSynchronized", c.get("NTPSynchronized", "?")),
                       ("Timezone", c.get("Timezone", "?")),
                       ("NTP", c.get("NTP", "?"))])

    # ---------- publish ----------

    def tick(self):
        msg = DiagnosticArray()
        msg.header.stamp = self.get_clock().now().to_msg()
        for build in (self.thermal, self.cpu, self.gpu, self.memory, self.storage,
                      self.power, self.vesc_device, self.network,
                      self.gamepad, self.camera, self.clock):
            try:
                msg.status.append(build())
            except Exception as e:  # noqa: BLE001
                line = getattr(getattr(e, "__traceback__", None), "tb_lineno", "?")
                msg.status.append(status(
                    f"system: {build.__name__.title()}", ERROR,
                    f"{type(e).__name__} at line {line}: {e}",
                    [("probe", build.__name__), ("exception", type(e).__name__),
                     ("line", line), ("detail", str(e))]))
        self.pub.publish(msg)


# Captured verbatim from robot #2 on 2026-09-16.
JOY_SAMPLE = """\
ID : GUID                             : GamePad : Mapped : Joystick Device Name
-------------------------------------------------------------------------------
 0 : 050000004c050000c405000000010000 :    true :   true : PS4 Controller"""


def self_test():
    """`python3 system_diagnostics.py --self-test` - no ROS, no robot, no hardware."""
    # The header and the rule are not devices, and the name is the last field,
    # not the whole row.
    assert parse_joy_devices(JOY_SAMPLE) == ["0: PS4 Controller"], parse_joy_devices(JOY_SAMPLE)
    header = JOY_SAMPLE.rsplit("\n", 1)[0]
    assert parse_joy_devices(header) == [], "the header alone must read as zero devices"
    assert parse_joy_devices("") == []

    devices = parse_joy_devices(JOY_SAMPLE)
    ok, msg = joy_verdict(0, JOY_SAMPLE, devices, True, True)
    assert ok and "OK -" in msg, msg
    assert "0: PS4 Controller" in msg and "050000004c05" not in msg.split("raw output:")[0], msg

    ok, msg = joy_verdict(0, "", [], True, False)
    assert not ok, msg
    assert "CONTRADICTION" in msg and "usermod -aG input" in msg, msg

    ok, msg = joy_verdict(0, "", [], False, True)
    assert not ok and "No controller is connected" in msg, msg
    assert "CONTRADICTION" not in msg, "a missing pad must not be reported as a permission fault"

    ok, msg = joy_verdict(None, "No such file or directory: 'ros2'", [], True, True)
    assert not ok and "could not run" in msg, msg

    # Every verdict has to carry what the command actually printed, so a parser
    # that misreads an unfamiliar output format shows up as a visible
    # disagreement instead of a confident wrong answer.
    for args in ((0, JOY_SAMPLE, devices, True, True), (0, header, [], True, False),
                 (0, header, [], False, True)):
        body = joy_verdict(*args)[1]
        assert "raw output:" in body, body
    assert "PS4 Controller" in joy_verdict(0, JOY_SAMPLE, [], False, True)[1], \
        "the raw table must survive even when the parser found nothing in it"

    print("joy_verdict self-test passed")

    # tegrastats GPU field, one sample per board generation's format.
    assert parse_gr3d("RAM 1/3 GR3D_FREQ 0%@305 EMC") == (0, 305)
    assert parse_gr3d("GR3D_FREQ 42%@[1377] VIC") == (42, 1377)
    assert parse_gr3d("GR3D_FREQ 7%@[305,0] APE") == (7, 305)
    assert parse_gr3d("GR3D_FREQ 13% cpu@50C") == (13, None)
    assert parse_gr3d("RAM 1/3 no gpu field") is None

    # /proc/stat: user nice system idle iowait irq softirq steal
    a = [100, 0, 100, 700, 100, 0, 0, 0]
    b = [150, 0, 150, 750, 150, 0, 0, 0]      # 100 busy of 200 -> 50 %
    assert cpu_busy_pct(a, b) == 50.0, cpu_busy_pct(a, b)
    assert cpu_busy_pct(None, b) is None and cpu_busy_pct(a, a) is None
    print("gpu/cpu parser self-test passed")


def main():
    if "--self-test" in sys.argv:
        return self_test()
    rclpy.init()
    node = SystemDiagnostics()
    executor = MultiThreadedExecutor()
    executor.add_node(node)
    try:
        executor.spin()
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == "__main__":
    main()
