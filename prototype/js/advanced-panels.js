"use strict";

/* Advanced view: topic and node tables. */

/* ==========================================================
   ADVANCED TOPICS
========================================================== */

function setText(element, value) {

  if (element && element.textContent !== value) {
    element.textContent = value;
  }
}

/* Built once, then updated in place: rebuilding the whole table
   twice a second destroys an expanded row and any text the
   reader has selected. */
function buildTopicTable(names) {

  const body = $("topicRows");

  body.innerHTML = "";
  rowEls.clear();

  for (const name of names) {

    const spec = TOPICS[name] || {};

    const tr = document.createElement("tr");

    tr.className = "topic-row";

    tr.innerHTML = `
      <td class="mono">
        <div>
          <span class="caret">&#9654;</span>${escapeHtml(name)}${
            spec.sub
              ? `<span class="sub-tag">${escapeHtml(spec.sub)}</span>`
              : ""
          }
        </div>

        <div class="why" style="padding-left:15px">${escapeHtml(
          topics.get(name).type || ownerLabel(spec)
        )}</div>
      </td>

      <td>
        <span class="state-pill"></span>
        <div class="why"></div>
      </td>

      <td></td>
      <td></td>
      <td></td>
    `;

    const detail = document.createElement("tr");

    detail.className = "topic-detail";
    detail.style.display = "none";

    detail.innerHTML =
      '<td colspan="5">' +
      '<div class="detail-meta"></div>' +
      "<pre></pre>" +
      "</td>";

    tr.onclick = () => toggleTopic(name);

    body.appendChild(tr);
    body.appendChild(detail);

    rowEls.set(name, {
      tr,
      detail,
      pre: detail.querySelector("pre"),
      meta: detail.querySelector(".detail-meta"),
      state: tr.querySelector(".state-pill"),
      why: tr.querySelectorAll(".why")[1],
      pubs: tr.children[2],
      msgs: tr.children[3],
      age: tr.children[4]
    });

    if (expanded.has(name)) {

      tr.classList.add("open");
      detail.style.display = "";
    }
  }
}

function renderTopicTable() {

  const now =
    performance.now();

  const names =
    [...topics.keys()].sort();

  const key = names.join("|");

  if (key !== tableKey) {

    tableKey = key;
    buildTopicTable(names);
  }

  let bad = 0;

  for (const name of names) {

    const topic = topics.get(name);
    const state = classifyTopic(topic);
    const row = rowEls.get(name);

    if (BAD_TOPIC_STATES.has(state)) bad++;

    if (!row) continue;

    setText(row.state, state);

    row.state.className = "state-pill s-" + state;

    setText(row.why, topicReason(topic, state));
    setText(row.pubs, String(topic.pubs));
    setText(row.msgs, String(topic.count));

    setText(
      row.age,
      topic.last === null
        ? "-"
        : ((now - topic.last) / 1000).toFixed(2) + "s"
    );

    if (expanded.has(name)) {

      const message = latestMsg.get(name);

      if (message !== undefined) {

        row.pre.textContent =
          JSON.stringify(summarize(message), null, 2);
      }

      const span =
        topic.first !== null && topic.last !== null
          ? (topic.last - topic.first) / 1000
          : 0;

      const rate =
        span > 0.5 && topic.count > 1
          ? ((topic.count - 1) / span).toFixed(1) + " Hz"
          : "-";

      setText(
        row.meta,
        `${topic.type || ""}    rate ${rate}    ` +
        `${topic.count} msgs`
      );
    }
  }

  $("topicSummary").textContent =
    names.length
      ? bad
        ? `${bad} needing attention`
        : "all nominal"
      : "click a row for live data";
}

/* ==========================================================
   ADVANCED NODES
========================================================== */

function renderNodeTable() {

  $("nodeRows").innerHTML =
    EXPECTED_NODES.map(name => {

      const running =
        runningNodes.has(name);

      return `
        <tr>

          <td class="mono">
            ${escapeHtml(name)}
          </td>

          <td style="color:${
            running
              ? "var(--healthy)"
              : "var(--failed)"
          };font-weight:700">

            ${
              running
                ? "RUNNING"
                : "NOT RUNNING"
            }

          </td>

        </tr>
      `;
    }).join("");

  let down = 0;

  EXPECTED_NODES.forEach(name => {
    if (!runningNodes.has(name)) down++;
  });

  $("nodeSummary").textContent =
    `${EXPECTED_NODES.length - down} / ` +
    `${EXPECTED_NODES.length} up`;

  /* Anything running that we did not expect. Usually harmless,
     occasionally the duplicate node that explains a fight over
     a topic. */
  const extra =
    [...runningNodes]
      .filter(
        name => !EXPECTED_NODES.includes(name)
      )
      .sort();

  $("extraNodes").innerHTML =
    extra.length
      ? "also running: " +
        extra
          .map(
            name =>
              `<span>${escapeHtml(name)}</span>`
          )
          .join("")
      : "";
}

