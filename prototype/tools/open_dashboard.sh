#!/usr/bin/env bash
# Finds the F1TENTH car that is serving its dashboard and opens it in
# Firefox. For a launcher (Steam Deck) that cannot know which of the 12
# cars is switched on.
#
#   ./open_dashboard.sh        # open whichever car answers
#   ./open_dashboard.sh 6      # open car 6 only (192.168.1.206)
#
# Car N is at 192.168.1.(200+N), dashboard on :8000 - the address
# start_diagnostics.sh prints. If several cars answer, a pick list is
# shown when zenity is installed, otherwise the lowest number is opened.

SUBNET="192.168.1"
PORT=8000
CARS=12
PROBE_SECONDS=2

probe() {
  local n=$1
  curl -s -m "$PROBE_SECONDS" -o /dev/null -f \
    "http://$SUBNET.$((200 + n)):$PORT/dashboard.html" && echo "$n"
}

if [[ -n "$1" ]]; then
  if ! [[ "$1" =~ ^[0-9]+$ ]] || (( $1 < 1 || $1 > CARS )); then
    echo "Robot number must be 1-$CARS" >&2
    exit 2
  fi
  found="$1"
else
  # probe every car at once, so the wait is one timeout, not twelve
  found=$(
    for n in $(seq 1 "$CARS"); do probe "$n" & done | sort -n
    wait
  )
fi

if [[ -z "$found" ]]; then
  msg="No robot answered on $SUBNET.201-$((200 + CARS)):$PORT. Is it on, on this network, and running start_diagnostics.sh?"
  echo "$msg" >&2
  command -v zenity >/dev/null && zenity --error --text="$msg" 2>/dev/null
  exit 1
fi

n=$(echo "$found" | head -n 1)

if [[ $(echo "$found" | wc -l) -gt 1 ]] && command -v zenity >/dev/null; then
  n=$(zenity --list --title="Which robot?" --column="Robot" $found 2>/dev/null) || exit 0
fi

# ?deck=1 used for closing dashboard window on deck.
# here: kiosk mode has no window controls.
url="http://$SUBNET.$((200 + n)):$PORT/dashboard.html?deck=1"
echo "Opening robot $n: $url"

# --kiosk: fullscreen from the start, no tabs or address bar. Needed in
# Steam's Gaming Mode, where going fullscreen by hand shrinks the window.
# KIOSK=0 ./open_dashboard.sh gives a normal window.
KIOSK_FLAG="--kiosk"
[[ "$KIOSK" == "0" ]] && KIOSK_FLAG=""

if command -v firefox >/dev/null; then
  exec firefox $KIOSK_FLAG "$url"
elif command -v flatpak >/dev/null && flatpak info org.mozilla.firefox >/dev/null 2>&1; then
  exec flatpak run org.mozilla.firefox $KIOSK_FLAG "$url"
else
  exec xdg-open "$url"
fi
