#!/usr/bin/env python3
"""Restart everything start_diagnostics.sh runs, on request from the dashboard.

The same as typing, on the car:

    ./start_diagnostics.sh --stop && ./start_diagnostics.sh

Used by the dashboard's Restart button through two routes, so it still works
when the thing that has hung is rosbridge itself:

  - system_diagnostics.py's ~/restart_stack service (over rosbridge), which
    first refuses while the car could be moving;
  - camera_http.py's POST /restart (plain HTTP on :8082), the fallback when
    rosbridge does not answer.

The restart runs as its own process in its own session, so it survives the
--stop it starts: --stop stops what a run started (bringup, rosbridge,
system_diagnostics, the web server, the camera) and the run itself, matched by
how each was launched; this process matches none of those. It waits a second
first, so whoever asked gets their answer before rosbridge goes away. The new
run gets the same options the old one was started with (--no-bringup and so
on), and its output goes to restart.log in the run's log folder.

This is not the bringup-integrated version (f1tenth_stack, started by
`bringup`): there is no start_diagnostics.sh there, and a restart says so.
"""

import os
import re
import subprocess
import time

SCRIPT_NAME = "start_diagnostics.sh"
LOGDIR = os.path.join(os.environ.get("TMPDIR") or "/tmp", "f1tenth-diag")
RESTART_LOG = os.path.join(LOGDIR, "restart.log")
RESTART_MARK = os.path.join(LOGDIR, "restart.started")
RESTART_GAP_S = 90          # a second request this soon is the same restart

# a run of the script, as pgrep -af prints it: "<pid> bash ./start_diagnostics.sh ..."
_RUN = re.compile(r"^(\d+)\s+(?:/\S*/)?bash\s+(\S*start_diagnostics\.sh)((?:\s+\S+)*)\s*$")
# options a run is started with that are worth keeping; --stop, --status and
# --help are one-off commands, not part of a run
_KEEP = {"--no-bringup", "--no-sysdiag", "--no-bridge", "--no-server", "--no-camera"}
_KEEP_WITH_VALUE = {"--port", "--dir", "--camera-device"}


def script_path(here):
    """start_diagnostics.sh next to this file, or None (the bringup version)."""
    path = os.path.join(here, SCRIPT_NAME)
    return path if os.path.isfile(path) else None


def run_options(pgrep_out):
    """The options the running start_diagnostics.sh was started with, from
    `pgrep -af 'bash [^ ]*start_diagnostics\\.sh'`. Only real runs count: a
    --stop or --status in progress is not one. [] when there is no run."""
    for line in (pgrep_out or "").splitlines():
        m = _RUN.match(line.strip())
        if not m:
            continue
        words = m.group(3).split()
        if any(w in ("--stop", "--status", "-h", "--help") for w in words):
            continue
        keep, i = [], 0
        while i < len(words):
            if words[i] in _KEEP:
                keep.append(words[i])
            elif words[i] in _KEEP_WITH_VALUE and i + 1 < len(words):
                keep += [words[i], words[i + 1]]
                i += 1
            i += 1
        return keep
    return []


def recently_started(now, mark_time):
    """A restart started this recently is still going; do not start another."""
    return mark_time is not None and 0 <= now - mark_time < RESTART_GAP_S


def _mark_time():
    try:
        return os.path.getmtime(RESTART_MARK)
    except OSError:
        return None


def restart(here):
    """Start the restart. (started?, message for whoever asked)."""
    script = script_path(here)
    if script is None:
        return False, ("no start_diagnostics.sh on this car: it runs the dashboard from "
                       "bringup (f1tenth_stack), so restart bringup instead")
    if recently_started(time.time(), _mark_time()):
        return True, "a restart is already under way"

    try:
        out = subprocess.run(["pgrep", "-af", r"bash [^ ]*start_diagnostics\.sh"],
                             capture_output=True, text=True, timeout=3).stdout
    except (OSError, subprocess.SubprocessError):
        out = ""
    options = run_options(out)

    os.makedirs(LOGDIR, exist_ok=True)
    with open(RESTART_MARK, "w") as f:
        f.write(f"{time.time()}\n")
    log = open(RESTART_LOG, "w")
    log.write(f"restart asked at {time.strftime('%H:%M:%S')}: "
              f"{script} --stop, then {script} {' '.join(options)}\n")
    log.flush()
    # "$0" is the script, "$@" the options: no quoting to get wrong
    subprocess.Popen(
        ["bash", "-c", 'sleep 1; "$0" --stop; exec "$0" "$@"', script, *options],
        cwd=here, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
        start_new_session=True, close_fds=True)
    log.close()
    return True, ("restarting: stopping everything start_diagnostics.sh runs, then "
                  f"starting it again{' with ' + ' '.join(options) if options else ''}. "
                  f"About a minute. Log: {RESTART_LOG}")


def self_test():
    """`python3 restart_stack.py --self-test`: no robot, nothing restarted."""
    import tempfile

    sample = ("4101 bash ./start_diagnostics.sh --no-camera --port 8080\n"
              "4500 bash /home/f1-wsu-2/diag/start_diagnostics.sh --status\n")
    assert run_options(sample) == ["--no-camera", "--port", "8080"], run_options(sample)
    assert run_options("4500 bash ./start_diagnostics.sh --stop\n") == [], "a --stop is not a run"
    assert run_options("77 /bin/bash ./start_diagnostics.sh\n") == []
    assert run_options("77 /usr/bin/bash /home/x/diag/start_diagnostics.sh --no-bringup\n") == ["--no-bringup"]
    assert run_options("12 nvim start_diagnostics.sh\n") == [], "an editor is not a run"
    assert run_options("12 bash -c sleep 1; ./start_diagnostics.sh --stop\n") == [], \
        "the restart's own shell is not a run"
    assert run_options(None) == [] and run_options("") == []
    assert run_options("9 bash ./start_diagnostics.sh --camera-device /dev/video2 --oops\n") == \
        ["--camera-device", "/dev/video2"], "unknown options are dropped"

    assert recently_started(100.0, 50.0) and not recently_started(100.0, None)
    assert not recently_started(1000.0, 100.0), "an old restart does not block a new one"

    with tempfile.TemporaryDirectory() as here:
        assert script_path(here) is None
        ok, msg = restart(here)
        assert not ok and "bringup" in msg, msg
    print("restart_stack self-test passed")


if __name__ == "__main__":
    import sys
    if "--self-test" in sys.argv:
        self_test()
