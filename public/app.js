const CURRENT_DATA_URL = "./data/current.json";
const REFRESH_MS = 15000;

let activeDataUrl = CURRENT_DATA_URL;
let activeIssueNumber = null;

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatUpdated(iso) {
  if (!iso) return "未更新";

  const d = new Date(iso);

  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(d);
}

function formatClock(iso) {
  if (!iso) return "--:--";

  const d = new Date(iso);

  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(d);
}

function renderCell(value) {
  if (value === "" || value === null || value === undefined) return "";
  return escapeHtml(value);
}

function getIssueFromUrl() {
  const params = new URLSearchParams(location.search);
  const issue = Number(params.get("issue") || params.get("game") || 0);
  return Number.isFinite(issue) && issue > 0 ? issue : null;
}

function gameDataUrl(issueNumber) {
  return `./data/game-${issueNumber}.json`;
}

function setUrlIssue(issueNumber) {
  const url = new URL(location.href);

  if (issueNumber) {
    url.searchParams.set("issue", String(issueNumber));
  } else {
    url.searchParams.delete("issue");
  }

  history.replaceState(null, "", url);
}

async function fetchGameData(url) {
  const res = await fetch(`${url}?ts=${Date.now()}`, {
    cache: "no-store"
  });

  if (!res.ok) {
    throw new Error(`試合データを読み込めません。${res.status}`);
  }

  return res.json();
}

function renderLineScore(data) {
  const innings = data.lineScore?.innings || [];
  const away = data.lineScore?.away || {};
  const home = data.lineScore?.home || {};

  const head = `
    <tr>
      <th class="teamCell">Team</th>
      ${innings.map((i) => `<th>${escapeHtml(i)}</th>`).join("")}
      <th>R</th>
      <th>H</th>
      <th>E</th>
    </tr>
  `;

  const row = (team) => `
    <tr>
      <td class="teamCell">${escapeHtml(team.team || "")}</td>
      ${innings.map((_, i) => `<td>${renderCell(team.runsByInning?.[i])}</td>`).join("")}
      <td class="total">${renderCell(team.runs)}</td>
      <td>${renderCell(team.hits)}</td>
      <td>${renderCell(team.errors)}</td>
    </tr>
  `;

  return `
    <table class="lineScore">
      <thead>${head}</thead>
      <tbody>
        ${row(away)}
        ${row(home)}
      </tbody>
    </table>
  `;
}

function normalizePosition(position) {
  const map = {
    投: "投",
    捕: "捕",
    一: "一",
    二: "二",
    三: "三",
    遊: "遊",
    左: "左",
    中: "中",
    右: "右",
    D: "D",
    P: "P",
    DH: "D"
  };

  return map[position] || position || "";
}

function renderLineup(list) {
  if (!Array.isArray(list) || list.length === 0) {
    return `<li class="muted" style="list-style:none;">未入力</li>`;
  }

  return list.map((player) => {
    if (typeof player === "string") {
      return `<li style="list-style:none;">${escapeHtml(player)}</li>`;
    }

    const order = player.order
      ? `<span class="batOrder" style="display:inline-block;min-width:2.2em;font-weight:900;color:var(--primary);">${escapeHtml(player.order)}.</span>`
      : "";

    const name = escapeHtml(player.name || "");
    const posText = normalizePosition(player.position);
    const pos = posText
      ? ` <span class="pos" style="color:var(--muted);font-size:13px;">(${escapeHtml(posText)})</span>`
      : "";

    return `<li style="list-style:none;">${order}${name}${pos}</li>`;
  }).join("");
}

function renderEvent(event) {
  return `
    <article class="event">
      <div class="eventTime">
        <div class="inning">${escapeHtml(event.inningLabel || "速報")}</div>
        <div class="attackTeam">${escapeHtml(event.attackTeam || "")}</div>
        <div class="clock">${escapeHtml(formatClock(event.created_at))}</div>
      </div>

      <div class="eventBody">
        <div class="eventText">${escapeHtml(event.text || "")}</div>

        <a class="eventLink" href="${escapeHtml(event.html_url || "#")}" target="_blank" rel="noreferrer">
          入力元を見る
        </a>
      </div>
    </article>
  `;
}

function applyLineupListStyle() {
  const away = $("awayLineup");
  const home = $("homeLineup");

  if (away) {
    away.style.listStyle = "none";
    away.style.paddingLeft = "0";
  }

  if (home) {
    home.style.listStyle = "none";
    home.style.paddingLeft = "0";
  }
}

function updateIssueDisplay(data) {
  const issue = data.issue_number || activeIssueNumber || "";

  if ($("viewIssueNumber")) {
    $("viewIssueNumber").value = issue || "";
  }

  if ($("currentIssueLabel")) {
    $("currentIssueLabel").value = issue ? `Issue #${issue}` : "最新の試合";
  }
}

function renderGame(data) {
  const match = data.match || {};

  $("matchTitle").textContent = match.title || "試合速報";

  $("matchSub").textContent = [
    match.date,
    match.venue,
    match.round,
    match.awayTeam && match.homeTeam ? `${match.awayTeam} vs ${match.homeTeam}` : ""
  ].filter(Boolean).join(" / ") || "試合情報未入力";

  $("gameStatus").textContent = data.status || "試合前";

  $("updatedAt").textContent = data.generated_at
    ? `更新 ${formatUpdated(data.generated_at)}`
    : "未更新";

  $("lineScoreWrap").innerHTML = renderLineScore(data);

  $("awayLineupTitle").textContent = match.awayTeam || "先攻";
  $("homeLineupTitle").textContent = match.homeTeam || "後攻";

  $("awayLineup").innerHTML = renderLineup(data.lineups?.away || []);
  $("homeLineup").innerHTML = renderLineup(data.lineups?.home || []);

  applyLineupListStyle();
  updateIssueDisplay(data);

  const events = data.events || [];

  if (events.length === 0) {
    $("empty").hidden = false;
    $("feed").innerHTML = "";
    return;
  }

  $("empty").hidden = true;
  $("feed").innerHTML = events.map(renderEvent).join("");
}

async function update() {
  const data = await fetchGameData(activeDataUrl);
  renderGame(data);
}

async function loadSelectedGame() {
  const issueNumber = Number($("viewIssueNumber").value);

  if (!Number.isFinite(issueNumber) || issueNumber <= 0) {
    alert("Issue番号を入力してください。");
    return;
  }

  activeIssueNumber = issueNumber;
  activeDataUrl = gameDataUrl(issueNumber);
  setUrlIssue(issueNumber);

  try {
    await update();
  } catch (err) {
    console.error(err);

    $("gameStatus").textContent = "読み込みエラー";
    $("empty").hidden = false;
    $("empty").textContent = `Issue #${issueNumber} の試合データを読み込めません。Actionsが成功しているか確認してください。`;
  }
}

async function loadCurrentGame() {
  activeIssueNumber = null;
  activeDataUrl = CURRENT_DATA_URL;
  setUrlIssue(null);

  try {
    await update();
  } catch (err) {
    console.error(err);

    $("gameStatus").textContent = "読み込みエラー";
    $("empty").hidden = false;
    $("empty").textContent = err.message;
  }
}

async function init() {
  const issueFromUrl = getIssueFromUrl();

  if (issueFromUrl) {
    activeIssueNumber = issueFromUrl;
    activeDataUrl = gameDataUrl(issueFromUrl);
  } else {
    activeIssueNumber = null;
    activeDataUrl = CURRENT_DATA_URL;
  }

  try {
    await update();
  } catch (err) {
    console.error(err);

    if ($("gameStatus")) {
      $("gameStatus").textContent = "読み込みエラー";
    }

    if ($("empty")) {
      $("empty").hidden = false;
      $("empty").textContent = err.message;
    }
  }
}

init();

setInterval(() => {
  update().catch(console.error);
}, REFRESH_MS);
