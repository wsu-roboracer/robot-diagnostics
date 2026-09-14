#!/usr/bin/env bash
# Baseline capture for the CS-4850 diagnostics track.
# Read-only. No sudo. Safe to run any time bringup is up.
#
#   bash baseline_capture.sh | tee ~/baseline_$(date +%F_%H%M).txt
#
# Answers the Inventory's open questions and captures the [MEASURE] baselines
# that every threshold check is blocked on.
#
# ls output below is only printed for a human, never parsed
# shellcheck disable=SC2012

hr(){ printf '\n=== %s %s\n' "$1" "$(printf '=%.0s' $(seq 1 $((60 - ${#1}))))"; }
have(){ command -v "$1" >/dev/null 2>&1; }

echo "baseline capture - $(date -Is) - $(hostname)"

hr "ROS NODES  [if this looks short, the ros2 daemon has a stale view]"
timeout 15 ros2 node list 2>/dev/null || echo "(no ros2 / bringup not running)"
echo "-- same list without the daemon (NOT authoritative - both variants under-report; /rosapi/nodes is the only reliable one) --"
timeout 20 ros2 node list --no-daemon 2>/dev/null | sed 's/^/  /' || echo "  (timed out)"

hr "TOPIC RATES  [answers: /sensors/core rate, S-09, S-13, S-19 per-node rates]"
for t in /sensors/core /odom /sensors/imu /sensors/imu/raw /scan /joy /tf; do
  printf '%-22s ' "$t"
  timeout 7 ros2 topic hz "$t" 2>/dev/null | grep -m1 'average rate' || echo "no messages in 7s"
done

hr "DIAGNOSTICS  [urg_node + ackermann_mux already publish here]"
timeout 8 ros2 topic echo /diagnostics --once 2>/dev/null | head -40 || echo "none"

hr "CONTROLLER / BLUETOOTH  [S-03, S-18]"
echo "-- joystick device nodes --"
ls -l /dev/input/js* 2>/dev/null || echo "  none - no controller attached"
echo "-- bluetooth: paired / connected --"
if have bluetoothctl; then
  echo "  [paired]"; timeout 6 bluetoothctl devices 2>/dev/null | sed 's/^/    /'
  # older bluetoothctl rejects `devices Connected`, so ask per-device instead
  timeout 6 bluetoothctl devices 2>/dev/null | awk '{print $2}' | while read -r mac; do
    [ -n "$mac" ] || continue
    st=$(timeout 4 bluetoothctl info "$mac" 2>/dev/null | grep -E 'Connected|Name|Battery' | tr '\n' ' ')
    echo "    $mac  $st"
  done
else echo "  bluetoothctl not installed"; fi
have hcitool && { echo "  [hcitool con]"; timeout 4 hcitool con 2>/dev/null | sed 's/^/    /'; }
echo "-- power_supply entries (DS4 charge level?)  NOTE: only meaningful with the controller CONNECTED --"
ls /sys/class/power_supply/ 2>/dev/null || echo "  none"
for f in /sys/class/power_supply/*/capacity; do
  [ -e "$f" ] && echo "  $f = $(cat "$f" 2>/dev/null)"
done
echo "-- hid / input devices --"
grep -iE 'Name=|Handlers=' /proc/bus/input/devices 2>/dev/null | grep -iB1 'js[0-9]' | head -10

hr "THERMALS  [S-05 - baseline these AFTER a 20 min run]"
for z in /sys/devices/virtual/thermal/thermal_zone*; do
  [ -e "$z/temp" ] || continue
  raw=$(cat "$z/temp" 2>/dev/null)          # some zones return EAGAIN; guard the maths
  case "$raw" in
    ''|*[!0-9-]*) printf '  %-18s unreadable\n' "$(cat "$z/type" 2>/dev/null)" ;;
    *)            printf '  %-18s %s C\n' "$(cat "$z/type" 2>/dev/null)" "$((raw / 1000))" ;;
  esac
done

hr "CPU / LOAD / MEMORY  [S-04, S-07]"
echo "  cores:    $(nproc)"
echo "  loadavg:  $(cat /proc/loadavg)"
echo "  uptime:   $(cut -d' ' -f1 /proc/uptime)s   [S-02: a drop here means a brownout reboot]"
grep -E 'MemTotal|MemAvailable|SwapTotal|SwapFree' /proc/meminfo | sed 's/^/  /'

hr "STORAGE  [S-06]"
df -h / /home 2>/dev/null | sed 's/^/  /'

hr "NETWORK  [S-17 lidar link]"
ip -br addr 2>/dev/null | sed 's/^/  /'
for i in /sys/class/net/*/carrier; do
  n=$(basename "$(dirname "$i")"); [ "$n" = lo ] && continue
  echo "  $n carrier=$(cat "$i" 2>/dev/null) operstate=$(cat "/sys/class/net/$n/operstate" 2>/dev/null)"
done
echo "-- lidar at 192.168.0.10 --"
ping -c 3 -W 2 192.168.0.10 2>&1 | tail -3 | sed 's/^/  /'

hr "VESC SERIAL DEVICE  [S-09]"
ls -l /dev/sensors/ 2>/dev/null | sed 's/^/  /' || echo "  /dev/sensors missing"
ls -l /dev/ttyACM* /dev/ttyUSB* 2>/dev/null | sed 's/^/  /'

hr "CAMERA  [S-14 - only meaningful once realsense is launched]"
if have lsusb; then lsusb -t 2>/dev/null | grep -iA1 -B1 'intel\|realsense' | sed 's/^/  /' || echo "  no realsense on USB"; fi
for d in /sys/bus/usb/devices/*/speed; do
  v=$(cat "$d" 2>/dev/null); [ "$v" = "5000" ] && echo "  $(dirname "$d") USB3 (5000M)"
done | head -5

hr "CLOCK  [S-08 - a bad clock makes everything read stale]"
timedatectl show 2>/dev/null | grep -E 'NTP|Synchronized|Timezone' | sed 's/^/  /'

hr "DONE"
echo "Paste this whole file back to fill in the [MEASURE] and [CONFIRM] gaps."
