# Steam Deck setup: drive a car with the Deck's sticks

How to set up a Steam Deck so that one Steam shortcut opens the dashboard full screen on whichever car is switched on, and the Deck's sticks drive the car. Follow it for a new Deck, or after wiping one.

This guide is for **whoever sets up a Deck**. Driving itself, arming and the safety rules are in [drive-tab.md](drive-tab.md). Seeing the Deck's controls live and fixing a button that lights wrongly is the [Controller tab](controller-tab.md#steam-deck-drive-from-its-browser).

## What you end up with

- A Steam shortcut. Launching it finds the car that is on (192.168.1.201 to .212), and opens its dashboard in Firefox, full screen, with no tabs or address bar.
- **Left stick** up/down: speed. **Right stick** left/right: steering. **B**: disarm. Centre both sticks and the car stops.
- **L1**, held, drives with the sticks too (the way the car's own controller does), and **R1**, held, starts an autonomous run when **Hold R1 to run** is on in the Drive tab.
- The dashboard's **Controller tab** has a **Steam Deck (this browser)** view that draws the Deck live, so you can check every button and **Map buttons** if one is wrong.
- The touch screen is used for the page's buttons (the safety box, Arm). Gaming Mode gives no mouse.

The Deck is only a browser. Nothing is installed on the cars for it, apart from the dashboard files every car already serves.

## Before you start

- The Deck, the cars and your laptop are on the same network (the cars are at `192.168.1.200` plus their number).
- At least one car is switched on and running `start_diagnostics.sh`, so the dashboard is being served on port 8000. The robot side is in the [prototype README](../../prototype/README.md).
- You have the launcher script, [`prototype/tools/open_dashboard.sh`](../../prototype/tools/open_dashboard.sh), from this repo.

## 1. Put the launcher on the Deck

Do this in **Desktop Mode** (Steam button, Power, Switch to Desktop).

Copy `open_dashboard.sh` to `/home/deck/open_dashboard.sh`. Either:

- **USB drive:** copy it to the drive, plug it into the Deck, and drag it into the Home folder in the file manager.
- **Over the network:** on the Deck, set a password with `passwd`, then `sudo systemctl enable --now sshd`. From the laptop, in the repo folder:
  ```bash
  scp prototype/tools/open_dashboard.sh deck@<deck-ip>:/home/deck/open_dashboard.sh
  ```
  Find the Deck's address with `ip a`.

Then, in a terminal on the Deck, make it runnable and strip Windows line endings (a file edited on Windows has them, and the script then fails with "permission denied" or finds no robot):

```bash
sed -i 's/\r$//' ~/open_dashboard.sh && chmod +x ~/open_dashboard.sh
```

## 2. Install Firefox and let it see gamepads

Firefox comes from the Discover store (the Flatpak version). If it is not installed, install it there first.

Check how it is installed:

```bash
flatpak list | grep -i firefox
```

If that prints a line, give it access to input devices. Without this, Firefox cannot see the Deck's gamepad:

```bash
flatpak override --user --device=all org.mozilla.firefox
```

## 3. Let Firefox use the gamepad on the cars' addresses

Firefox only offers the gamepad to pages loaded over `https` or `localhost`. The cars serve plain `http`, so the page sees no gamepad at all and says so: *No gamepad detected*, however many buttons you press. Tell Firefox to trust the cars' addresses. Once is enough; it is saved in the Firefox profile.

1. In a Deck terminal: `KIOSK=0 ~/open_dashboard.sh`. Firefox opens in a normal window.
2. Go to `about:config` and accept the warning.
3. Search for `dom.securecontext.allowlist`. If it does not exist, add it as a **String** with the **+** button.
4. Set it to every car's address, comma-separated, no spaces:
   ```
   192.168.1.201,192.168.1.202,192.168.1.203,192.168.1.204,192.168.1.205,192.168.1.206,192.168.1.207,192.168.1.208,192.168.1.209,192.168.1.210,192.168.1.211,192.168.1.212
   ```
5. While you are in `about:config`, also set `dom.allow_scripts_to_close_windows` to `true` (a boolean; toggle it if it exists, or add it). This lets the dashboard's **Close** button quit Firefox. Without it the button does nothing.
6. Close Firefox.

## 4. Add the Steam shortcut

Still in Desktop Mode, in Steam: **Games**, **Add a Non-Steam Game to My Library**, **Browse**. Set the file filter to **All files**, pick `open_dashboard.sh`, and add it.

Open the shortcut's **Properties** and set:

| Field | Value |
|---|---|
| **Target** | `"/home/deck/open_dashboard.sh"` |
| **Start In** | `"/home/deck/"` |
| **Launch Options** | empty |

Use the full `/home/deck/...` path. Steam does not expand `~`.

## 5. Set the Gamepad layout

Switch back to **Gaming Mode**. Highlight the shortcut, press the controller icon, and choose the **Gamepad** layout.

This is the layout that hands the sticks and buttons to the page as a gamepad. A mouse, keyboard or web browser layout turns the sticks into keys or a pointer instead, and the page never sees them. Desktop Mode does the same (its left stick sends WASD), so test in Gaming Mode.

## 6. Test it

### Check the controls on the Controller tab

Launch the shortcut, open the **Controller** tab, and switch it to **Steam Deck (this browser)**. Press any button once (Firefox only shows a gamepad after a press). The drawing of the Deck should light up as you press: the face buttons, bumpers, D-pad and menu buttons, the triggers filling from the bottom, and the sticks moving.

- If the wrong button lights up, use **Map buttons** (it asks for each control in turn), or click a single control on the drawing to **Remap one**. **Ignore it** stops a misbehaving control being read. The mapping is saved in Firefox's profile on the Deck, so do it once; **Use the default** undoes it.
- The back grips (L4, L5, R4, R5) only show if the Gamepad layout sends them as buttons. The trackpads are drawn but cannot be read by a browser.
- If a button flickers on and off with nobody touching it, the tab says so in red. Do not drive until it stops, especially for L1 or R1.

### Drive

Put the car's **wheels off the ground** and have someone hold the paired PS4 controller, which is the hardware backup stop.

1. Launch the shortcut from Gaming Mode. It opens the car that is on.
2. Tick the **safety box** and touch **Arm**.
3. Press any button on the Deck once. Firefox only sees a gamepad after a press.
4. Read the alert line. It should say **Gamepad ready**. While a controller is connected, the driving view's top bar also says **Steam Deck: sticks drive · B stops**.
5. Push the left stick: the speed readout follows it. Push the right stick: the steering follows it. Centre both: the car stops. Press **B**: the car disarms.

| The alert line says | What to do |
|---|---|
| Gamepad ready | Working. |
| No gamepad detected | Check step 3 (the allowlist) first, then step 2 (the Flatpak access), then step 5 (the layout). Relaunch the shortcut fully after each change. |
| Found but not mapped as standard | Firefox sees a pad with the wrong layout. Check step 5. Holding **L1** still drives with the sticks through the Controller tab's mapping. |
| Controller tab says *No controller on this device yet* | Press a button on the Deck first. If it stays empty, see *No gamepad detected* above. |
| The wrong control lights on the Controller tab | Map it on the Controller tab (above). |
| No alert line at all | The car is serving an old `drive.js`, or Firefox cached it. See below. |

## Everyday use

- **Launch:** the shortcut. If two cars are on, a pick list appears when `zenity` is installed; otherwise the lowest number opens. To choose, run `~/open_dashboard.sh 6` for car 6.
- **Exit:** touch **Close** in the dashboard's top bar (in full screen driving, beside **Exit**), then confirm. It disarms the car first. The button only appears on the Deck: the launcher opens the page with `?deck=1`. If it does nothing, `dom.allow_scripts_to_close_windows` is not set (step 3); press the Steam button and choose **Exit Game** instead, which always works.
- **A normal window instead of full screen:** `KIOSK=0 ~/open_dashboard.sh`.

## When the dashboard code changes

The cars serve their own copy of the dashboard from `~/diag/`. Merging to `main` does not update them. Copy the changed files to each car you will use (replace `<n>` with its number, and the address with `192.168.1.200 + n`):

```bash
scp -r prototype/dashboard.html prototype/css prototype/js f1-wsu-<n>@192.168.1.2<nn>:~/diag/
```

The web server reads files from disk, so no restart is needed. Check the car is serving the new file:

```bash
curl -s localhost:8000/js/drive.js | grep -c stickStatus
```

A number above 0 means the new one. If the Deck still behaves as before, Firefox cached the old file. In Desktop Mode run `KIOSK=0 ~/open_dashboard.sh`, press **Ctrl+Shift+R**, and close it.

If the number is 0 even after copying, the car's web server is serving a different folder. Check which with `ps -o pid,args -p $(pgrep -f "http.server")` and look at `--directory`.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| *Permission denied* running the script | Not executable. `chmod +x ~/open_dashboard.sh`. |
| *No robot answered* | The car is off, on another network, or its dashboard is not being served. Check it opens from a laptop at `http://192.168.1.2NN:8000/dashboard.html`. Also strip line endings (step 1). |
| Firefox shows tabs and a search bar | Launched without `--kiosk`. Use the current script. |
| No mouse in Gaming Mode | Expected with the Gamepad layout. Use the touch screen. |
| Sticks move the car in Desktop Mode but not Gaming Mode | In Desktop Mode the left stick sends WASD keys, which the page already handles. That is not the gamepad. Fix the Gaming Mode steps above. |
| Page loads but shows no data | rosbridge only serves 10 browsers at once; the 11th gets nothing. Close extra dashboards and wait 30 seconds. See the [prototype README](../../prototype/README.md). |

## Safety

- Always have the PS4 controller paired and held by someone, wheels off the ground for the first test.
- Start with the speed slider turned down, in a clear area.
- Space, Esc and B disarm. A button that flickers (shown in red on the Controller tab) must be fixed or ignored before driving. The car also stops if the window loses focus or the connection drops.
- Do not leave a Deck armed and set down.
