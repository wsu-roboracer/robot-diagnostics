#!/usr/bin/env bash
# Start everything the diagnostics dashboard needs, on the robot.
#   bringup + system_diagnostics + rosbridge_websocket + a static server
#
#   ./start_diagnostics.sh                 # all four
#   ./start_diagnostics.sh --no-bringup    # bringup already running elsewhere
#   ./start_diagnostics.sh --no-sysdiag    # skip the OS-level diagnostics node
#   ./start_diagnostics.sh --port 8080
#   ./start_diagnostics.sh --stop     # stop a run started earlier (e.g. over SSH)
#   ./start_diagnostics.sh --status   # what is currently up
#
# Ctrl+C stops all of them. Each child gets its own process group so the ROS
# nodes actually die instead of being orphaned.

# sed reads clearer than ${var//$'\n'/...} for indenting multi-line output
# shellcheck disable=SC2001
set -uo pipefail

PORT=8000
WANT_BRINGUP=1 WANT_BRIDGE=1 WANT_SERVER=1 WANT_SYSDIAG=1
DO_STOP=0 DO_STATUS=0
SERVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGDIR="${TMPDIR:-/tmp}/f1tenth-diag"

while [ $# -gt 0 ]; do
  case "$1" in
    --port)        PORT="$2"; shift 2 ;;
    --dir)         SERVE_DIR="$2"; shift 2 ;;
    --no-bringup)  WANT_BRINGUP=0; shift ;;
    --no-sysdiag)  WANT_SYSDIAG=0; shift ;;
    --no-bridge)   WANT_BRIDGE=0; shift ;;
    --no-server)   WANT_SERVER=0; shift ;;
    --stop)        DO_STOP=1; shift ;;
    --status)      DO_STATUS=1; shift ;;
    -h|--help)     sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "unknown option: $1"; exit 1 ;;
  esac
done

# --- colours ---------------------------------------------------------------
if [ -t 1 ]; then R=$'\e[31m'; G=$'\e[32m'; Y=$'\e[33m'; D=$'\e[90m'; N=$'\e[0m'
else R=; G=; Y=; D=; N=; fi
ok(){   printf '  %s✓%s %s\n' "$G" "$N" "$1"; }
bad(){  printf '  %s✗%s %s\n' "$R" "$N" "$1"; }
info(){ printf '  %s·%s %s\n' "$D" "$N" "$1"; }

# --- ROS environment -------------------------------------------------------
# .bashrc already does this for interactive shells, but be safe when this is
# run from cron, systemd, or `bash script.sh` with a clean env.
# Test for the ros2 binary, NOT for $ROS_DISTRO - container images set that
# variable without having sourced setup.bash, which silently skips this.
if ! command -v ros2 >/dev/null 2>&1; then
  for f in /opt/ros/*/setup.bash; do
    # shellcheck source=/dev/null
    [ -f "$f" ] && { set +u; . "$f"; set -u; break; }
  done
fi
# shellcheck source=/dev/null
[ -f "$HOME/f1tenth_ws/install/setup.bash" ] && \
  { set +u; . "$HOME/f1tenth_ws/install/setup.bash"; set -u; }
: "${ROS_DOMAIN_ID:=202}"; export ROS_DOMAIN_ID

mkdir -p "$LOGDIR"
PIDFILE="$LOGDIR/pids"


# --- stop / status ---------------------------------------------------------
PATTERNS='start_diagnostics.sh|rosbridge_websocket|rosapi_node|bringup_launch.py|http\.server|system_diagnostics\.py'

# kill -0 succeeds on a zombie, so ask for the process state as well
alive(){ local st; st=$(ps -o stat= -p "$1" 2>/dev/null | tr -d ' '); \
         [ -n "$st" ] && [ "${st#Z}" = "$st" ]; }

show_status(){
  local found=0
  while read -r pid name; do
    [ -n "${pid:-}" ] || continue
    if alive "$pid"; then ok "$name running (pid $pid)"; found=1
    else info "$name not running"; fi
  done < <(cat "$PIDFILE" 2>/dev/null)
  local stray
  stray=$(pgrep -af "$PATTERNS" 2>/dev/null | grep -v "\-\-status\|\-\-stop" || true)
  [ -n "$stray" ] && { echo; info "matching processes:"; sed 's/^/      /' <<<"$stray"; found=1; }
  [ "$found" = 0 ] && info "nothing running"
  return 0
}

stop_all(){
  echo; echo "stopping…"
  # 1. anything we recorded, killed by process group
  while read -r pid name; do
    [ -n "${pid:-}" ] || continue
    kill -0 "$pid" 2>/dev/null || continue
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
    info "sent TERM to $name (pid $pid)"
  done < <(cat "$PIDFILE" 2>/dev/null)
  sleep 3
  # 2. anything that survived, or was left by a run we have no record of.
  #    NOTE: plain `pkill -f "$PATTERNS"` also matches THIS script's own command
  #    line and kills it before the cleanup finishes. Exclude self and parent.
  sweep(){
    local sig="$1" p
    for p in $(pgrep -f "$PATTERNS" 2>/dev/null); do
      [ "$p" = "$$" ] && continue
      [ "$p" = "${PPID:-0}" ] && continue
      kill "-$sig" "$p" 2>/dev/null
    done
  }
  sweep TERM; sleep 2; sweep KILL; sleep 1
  rm -f "$PIDFILE"
  local left
  left=$(pgrep -af "$PATTERNS" 2>/dev/null | grep -v "\-\-stop" || true)
  if [ -n "$left" ]; then bad "still running:"; sed 's/^/      /' <<<"$left"
  else ok "all stopped"; fi
}

if [ "$DO_STATUS" = 1 ]; then echo; show_status; echo; trap - EXIT; exit 0; fi
if [ "$DO_STOP"  = 1 ]; then stop_all;        echo; trap - EXIT; exit 0; fi

command -v ros2 >/dev/null || { bad "ros2 not on PATH - is ROS installed?"; exit 1; }

# --- child management ------------------------------------------------------
PIDS=() NAMES=()
# Ctrl+C used to kill only the PIDs THIS run recorded, while --stop also swept by
# pattern. So anything a previous run orphaned - or anything this run skipped
# because it was "already listening" and therefore never recorded - survived
# Ctrl+C while the banner promised it had stopped everything. Leftover bringups
# then fought over the joystick, and the symptom was "the controller will not
# connect". Use the one thorough path for both. Costs Ctrl+C a few extra seconds.
cleanup(){
  trap - INT TERM HUP EXIT
  stop_all
  info "logs kept in $LOGDIR"
  exit 0
}
# HUP matters: without it, closing an SSH session leaves the setsid'd children
# orphaned and running with no terminal to Ctrl+C from.
trap cleanup INT TERM HUP EXIT

start(){  # start <name> <logfile> <cmd...>
  local name="$1" log="$2"; shift 2
  setsid "$@" >"$log" 2>&1 &
  local pid=$!
  PIDS+=("$pid"); NAMES+=("$name")
  echo "$pid $name" >> "$PIDFILE"
  info "$name started (pid $pid, log ${log##*/})"
}

port_open(){ (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
wait_for(){  # wait_for <seconds> <test-cmd...>
  local n="$1"; shift
  for _ in $(seq 1 "$n"); do "$@" && return 0; sleep 1; done
  return 1
}

: > "$PIDFILE"          # fresh record for this run

echo
echo "F1TENTH diagnostics  (ROS_DOMAIN_ID=$ROS_DOMAIN_ID)"
echo

# --- 1. bringup ------------------------------------------------------------
# Two bringups fight over /dev/input/event* and the VESC serial port. The visible
# symptom is "the controller will not connect", which nobody traces back to here,
# so refuse rather than warn.
if [ "$WANT_BRINGUP" = 1 ] && pgrep -f bringup_launch.py >/dev/null 2>&1; then
  bad "a bringup is already running:"
  pgrep -af bringup_launch.py | cut -c1-100 | sed 's/^/      /'
  echo
  bad "stop it first:  $0 --stop"
  bad "or attach to it: $0 --no-bringup"
  echo
  exit 1
fi

if [ "$WANT_BRINGUP" = 1 ]; then
  start bringup "$LOGDIR/bringup.log" ros2 launch f1tenth_stack bringup_launch.py
  if wait_for 30 bash -c 'ros2 node list 2>/dev/null | grep -q urg_node'; then
    NODES=$(ros2 node list 2>/dev/null | wc -l)
    # urg_node alone is not proof bringup worked. A part-dead graph left by an
    # earlier run passes that test and then behaves strangely for the rest of
    # the session.
    if [ "$NODES" -ge 8 ]; then
      ok "bringup up ($NODES nodes)"
    else
      bad "bringup reports only $NODES nodes, expected at least 8"
      bad "a previous run is probably half-alive - $0 --stop, then start again"
    fi
  else
    bad "bringup did not produce urg_node in 30s - see $LOGDIR/bringup.log"
    tail -5 "$LOGDIR/bringup.log" | sed 's/^/      /'
  fi
else
  info "skipping bringup"
fi

# --- 1b. system diagnostics ------------------------------------------------
# CPU, temperatures, disk, network, USB devices - none of which are in ROS.
# This node reads them and republishes them as a standard DiagnosticArray on
# /diagnostics, so rosbridge carries them with no extra transport.
if [ "$WANT_SYSDIAG" = 1 ]; then
  SYSDIAG="$SERVE_DIR/system_diagnostics.py"
  if [ ! -f "$SYSDIAG" ]; then
    bad "system_diagnostics.py not found in $SERVE_DIR - skipping OS-level checks"
  else
    start sysdiag "$LOGDIR/sysdiag.log" python3 "$SYSDIAG"
    if wait_for 15 bash -c \
        'ros2 node list 2>/dev/null | grep -q system_diagnostics'; then
      ok "system diagnostics publishing to /diagnostics"
    else
      bad "system_diagnostics did not appear in 15s - see $LOGDIR/sysdiag.log"
      tail -5 "$LOGDIR/sysdiag.log" | sed 's/^/      /'
    fi
  fi
else
  info "skipping system diagnostics"
fi

# --- 2. rosbridge ----------------------------------------------------------
if [ "$WANT_BRIDGE" = 1 ]; then
  if port_open 9090; then
    ok "rosbridge already listening on 9090"
  else
    start rosbridge "$LOGDIR/rosbridge.log" \
      ros2 launch rosbridge_server rosbridge_websocket_launch.xml
    if wait_for 25 port_open 9090; then ok "rosbridge listening on 9090"
    else bad "rosbridge never opened 9090 - see $LOGDIR/rosbridge.log"; fi
  fi
else
  info "skipping rosbridge"
fi

# --- 3. static server ------------------------------------------------------
if [ "$WANT_SERVER" = 1 ]; then
  [ -f "$SERVE_DIR/dashboard.html" ] || \
    info "${Y}note${N}: no dashboard.html in $SERVE_DIR"
  if port_open "$PORT"; then
    ok "something already listening on $PORT"
  else
    start webserver "$LOGDIR/webserver.log" \
      python3 -m http.server "$PORT" --bind 0.0.0.0 --directory "$SERVE_DIR"
    if wait_for 10 port_open "$PORT"; then ok "serving $SERVE_DIR on :$PORT"
    else bad "web server failed - see $LOGDIR/webserver.log"; fi
  fi
else
  info "skipping web server"
fi

# --- where to point a browser ---------------------------------------------
IP=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -v '^169\.254' | grep -v '^$' | head -1)
echo
echo "  open:  http://${IP:-<robot-ip>}:$PORT/dashboard.html"
echo
echo "${D}  Ctrl+C stops everything. Following bringup log…${N}"
echo

# --- hold, showing bringup output ------------------------------------------
if [ "$WANT_BRINGUP" = 1 ] && [ -f "$LOGDIR/bringup.log" ]; then
  tail -n 0 -f "$LOGDIR/bringup.log" &
  PIDS+=($!); NAMES+=(tail)
fi
while true; do
  for i in "${!PIDS[@]}"; do
    kill -0 "${PIDS[$i]}" 2>/dev/null || { bad "${NAMES[$i]} exited"; cleanup; }
  done
  sleep 3
done
