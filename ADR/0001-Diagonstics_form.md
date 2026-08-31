# 0001. Choosing the form for RoberRacer Diagnostics System

**Status:** **Proposed** | Accepted | Superseded by ADR-NNNN
**Date:** YYYY-MM-DD
**Deciders:** names of everyone who agreed to this

## Context

We need to find a suitable display for our health diagnostics system.

Constraints:
* Must have a status indicator that is easily visible and intuitive
* Must run and diagnose in real-time with accurate results
* Must be opened/run on startup


## Options considered

### Option A: Web App Interface

- Pro: Intuitve and User friendly
- Pro: Easy to visualize statuses at a glance
- Con: Requires front-end development
- Con: Could be difficult to translate certain files and statuses into the Web UI

### Option B: Lightweight status server

- Pro: Easier to implement
- Con: Less user-friendly

### Option C: Physical indicator on robot

- Pro: Physical status indicator without needing to connect to an external app
- Con: Requires hardware to be built

## Decision

We chose **Option X**.

Why. This should follow clearly from the context and the trade-offs above. If the deciding
factor was something practical — time, hardware access, what the team already knows — say
so plainly. That is a legitimate reason and pretending otherwise helps nobody.

## Consequences

**Easier now:**
- ...

**Harder now:**
- ...

**We are committed to:**
- ...

**We should revisit this if:**
- ...
