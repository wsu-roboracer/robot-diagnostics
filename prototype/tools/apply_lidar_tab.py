#!/usr/bin/env python3
"""Adds the LiDAR tab to a dashboard.html in place. Safe to run twice.
Usage: python3 apply_lidar_tab.py path/to/dashboard.html

Finds the spots by text (not line numbers) and keeps the file's own
line endings, so it fits the robot copies that differ from the repo."""
import re
import sys

PANEL = r'''  <!-- ==========================================================
       LIDAR - the Overview's LiDAR card moves in here (main.js showTab),
       with the sensor's own details beside it (js/lidar-tab.js)
  =========================================================== -->
  <div class="tab-panel" id="panelLidar" role="tabpanel" hidden>

    <div class="lidar-tab-grid">

      <div id="lidarSlot" class="lidar-slot"></div>

      <div class="lidar-side">

        <div class="advanced-card">
          <h3>
            <span>Sensor health</span>
            <span class="h3-note" id="ltHealthNote">waiting</span>
          </h3>
          <div class="card-body">
            <div class="lt-health" id="ltHealth">Waiting for the LiDAR.</div>
            <ul class="lt-list" id="ltChecks"></ul>
          </div>
        </div>

        <div class="advanced-card">
          <h3>
            <span>Scan settings</span>
            <span class="h3-note">from the latest /scan</span>
          </h3>
          <div class="card-intro">
            What the sensor reports about itself. These are set by the
            driver (<span class="mono">sensors.yaml</span> on the car), not here.
          </div>
          <table class="raw-table">
            <tbody id="ltSettings"></tbody>
          </table>
        </div>

        <div class="advanced-card">
          <h3>
            <span>Live readings</span>
            <span class="h3-note" id="ltAge"></span>
          </h3>
          <table class="raw-table">
            <tbody id="ltLive"></tbody>
          </table>
        </div>

        <div class="advanced-card">
          <h3>
            <span>Driver diagnostics</span>
            <span class="h3-note">urg_node on /diagnostics</span>
          </h3>
          <div class="scroll" data-empty="The LiDAR driver has not reported anything yet.">
            <table class="raw-table">
              <thead><tr><th>Name</th><th>Level</th><th>Message</th></tr></thead>
              <tbody id="ltDiagRows"></tbody>
            </table>
          </div>
        </div>

      </div>
    </div>

  </div>

'''

NL = "\n"
path = sys.argv[1]
raw = open(path, "rb").read().decode("utf-8")
crlf = "\r\n" in raw
s = raw.replace("\r\n", NL)

if "panelLidar" in s:
    print(path, "already has the LiDAR tab")
else:
    # 1. tab button, after Controller
    m = re.search(r'[ \t]*<button class="tab"[^>]*id="tabController"[^>]*>.*?</button>\n', s, re.S)
    assert m, "controller tab button not found"
    s = (s[:m.end()]
         + '    <button class="tab" role="tab" id="tabLidar"\n'
         + '            data-tab="lidar" aria-selected="false">LiDAR</button>\n'
         + s[m.end():])

    # 2. wrap the LiDAR card so it can move between tabs
    card = '<div class="live-card lidar-card" data-view="lines">'
    assert s.count(card) == 1, "lidar card not found"
    i = s.index(card)
    s = s.replace(
        card,
        '<div id="lidarHome" class="lidar-home">\n'
        '    <div class="live-card lidar-card" id="lidarCard" data-view="lines">', 1)
    j = s.index("</section>", i)
    k = s.rindex("</div>", i, j) + len("</div>")
    s = s[:k] + "\n    </div>" + s[k:]

    # 3. the tab's panel, before the Advanced panel
    marker = '<div class="tab-panel" id="panelAdvanced"'
    assert marker in s, "advanced panel not found"
    p = s.index(marker)
    line_start = s.rfind("\n", 0, p) + 1
    s = s[:line_start] + PANEL + s[line_start:]

    # 4. the script tag
    s, n = re.subn(
        r'([ \t]*)<script src="js/main\.js[^"]*"></script>',
        r'\1<script src="js/lidar-tab.js?v=20261118a"></script>\n'
        r'\1<script src="js/main.js?v=20261118a"></script>', s, count=1)
    assert n == 1, "main.js script tag not found"
    print(path, "LiDAR tab added")

# the version of every file this feature touches (bumped so the Deck refetches)
VERSIONS = {
    r"css/advanced\.css": "20261118b",
    r"js/lidar-tab\.js": "20261118c",
    r"js/radar\.js": "20261118c",
    r"js/metrics\.js": "20261118c",
    r"js/main\.js": "20261118a",
    r"js/drive\.js": "20261118d",
}
for name, version in VERSIONS.items():
    s = re.sub(name + r"\?v=\w+", name.replace("\\", "") + "?v=" + version, s)

if crlf:
    s = s.replace(NL, "\r\n")
open(path, "wb").write(s.encode("utf-8"))
