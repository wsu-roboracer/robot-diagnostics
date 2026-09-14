# 0001. Choosing the form for RoboRacer Diagnostics System

**Status:** **Proposed** | Accepted | Superseded by ADR-NNNN
**Date:** 2026-09-09
**Deciders:** Luke, Alex, Saman, Darren

## Context

We need to find a suitable display for our health diagnostics system.

Constraints:
* Must have a status indicator that is easily visible and intuitive
* Must run and diagnose in real-time with accurate results
* Must be opened/run or function correctly on startup
* Nodes/Functions/Features must be clearly labeled


## Options considered

### Option A: Web App Interface

- Pro: Intuitve and User friendly
- Pro: Easy to visualize statuses at a glance
- Pro: Versatile and easier to scale
- Con: Requires front-end development
- Con: Could be difficult to translate certain diagnostic messages and topics into the Web UI

### Option B: Lightweight status server

- Pro: Easier to implement, no need for a site or external device.
- Pro: Fast setup
- Con: Harder to access and visualize multiple running instances at once.
- Con: Less user-friendly, less intuitive if using a CLI/Terminal
- Con: Requires the diagnosing device to be more reachable.
- Con: More tedious to check and restart various functions.
- Con: Harder to display some data such as camera pictures

### Option C: Physical indicator on robot

- Pro: Could access data and nodes without needing to connect to an external app
- Pro: Displays broad information quickly
- Pro: Allows users to easily see exact numbers or seeing a specific problem in words.
- Pro: Accessible to someone who is standing next to the car without access to a different device.
- Con: A physical LED system would be hard to see exact numbers or to see why something failed.
- Con: A physical monitor on the robot would make it difficult to access different subsystems or sections at once
- Con: Requires hardware to be built
- Con: Easy for scope-creep to build up
- Con: Physical indicator itself could fail, and would be harder to debug

## Decision

We chose **Option A**.

We chose Option A because a Web App Interface provides a user-friendly way to use the health diagnostic system, using intuitive buttons and options to access inmportant information compared to having to use certain commands to access critical information. The web-app interface also allows the user to gain information faster, gathering information at a glance. No additional hardware would need to be added, and the diagnostic system would be easier to use and debug with easy and informative visual indicators.
In summary, a Web App Interface would the be the best option compared to others because it is visually intuitive and accessible, easier to debug, and doesn't require additional hardware or resources to implement.

## Consequences

**Easier now:**
- Anyone with a browser can check system health without ROS or command-line knowledge.
- No new hardware required

**Harder now:**
- Requires ROS2 and rosbridge to be on the viewing computer
- Dependent on a good network connection to run

**We are committed to:**
- Building the Web App interface and ensuring that all features, nodes and statuses are displayed.

**We should revisit this if:**
- We want to scale the web-app interface to include a physical LED indicator on the car. Allowing us to easily visualize the broad data and using the web app interface to hone in on specific nodes or features.
