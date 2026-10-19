## Sprint 2 Report - 0002

**Team:** Alex, Luke, Saman, Darrin
**Sprint:** 2 (Sep 14 - Sep 28)

### Completed

Items that meet every line of the Definition of Done.

| Issue | What it is | PR |
|---|---|---|
| #2 | Spike: how to read live subsystem status from ROS | #23 |
| #6 | Find out what actually breaks: interview the instructor | #37 |
| #7 | Survey existing ROS diagnostics tooling before building anything | (direct commit) |
| #8 | Define the health status data schema | #25, #37 |

#6 and #8 both got signed off by the professor in person: the battery/thermal
thresholds from the interview, and what green/yellow/red actually mean on the
dashboard. #7's findings mostly live in the spike write-up (`ros-status-spike-summary.md`
/ `-notes.md`) rather than only in Darrin's survey doc.

Also landed, not tied to a single issue: the dashboard mockup (#28), the camera
feature and camera streaming research (#35, #36), the lidar radar view and camera
stream automation (#38), splitting `dashboard.html` into CSS/JS files (#40), and
closing out four inventory blocks - e-stop timing, the rosbridge 10-client limit, the
`/ackermann_drive` remap being a no-op, and controller battery (#31).

### Not completed

| Issue | Why not | What we're doing with it |
|---|---|---|
| #5 | Only a brief summary went in - README and repo setup weren't revisited beyond that | Carrying to Sprint 3, to finish once the dashboard's features and design are finalized |

### Demo on Monday

The basic camera and lidar setup we had running on the dashboard.

### What we learned

From the ROS status spike (#2): ROS already has a diagnostics stack
(`diagnostic_msgs`, `diagnostic_updater`, `diagnostic_aggregator`) that does most of
what we were about to build from scratch - the real gap is making it readable without
opening `rqt`. Also found a live bug while testing: the VESC driver never wrote
`temp_fet`/`temp_motor` into its ROS message, so those fields read `0.0` forever - a
constant that looked like a sensor reading but wasn't.

### Blockers and asks

- What we need from Scott: Nothing yet
- What we need from another track: Nothing yet
- What we need to figure out ourselves: Whether the dashboard stays read-only or should
  be able to restart failed nodes - affects the design, worth settling before more UI
  work goes in

### Hours

| Person | Hours this sprint |
|---|---|
| Alex | 21 |
| Saman | 12 |
| Luke | 16 |
| Darrin | 20 |

Honest numbers. A low number with a reason is fine; a made-up number is not.

### Proposed for Sprint 3

1. Finish #5 - write up the README/repo setup once the dashboard design is locked in
2. Dedup pass on the dashboard - several values currently render in more than one place
3. Look at folding `system_diagnostics.py`/`start_diagnostics.sh` into `f1tenth_system` itself, so every robot gets the diagnostics stack on a plain `git pull`
4. More physical indicator design options, plan for building, and psuedo code for LED hookup

### Retro notes

- **Start:** Make sure when you plug in a battery it's actually charging
- **Stop: pushing straight to `main`** - a couple of docs landed this sprint with no PR, same thing we said we'd stop doing last sprint
- **Keep: getting the professor to sign off on thresholds in person** - the battery/thermal ranges and the green/yellow/red definitions are real numbers now instead of guesses
