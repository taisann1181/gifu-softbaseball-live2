const DATA_URL = "./data/current.json";
const REFRESH_MS = 15000;

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

async function fetchGameData() {
  const res = await fetch(`${DATA_URL}?ts=${Date.now()}`, {
    cache: "no-store"
  });

  if (!res.ok) {
    throw new Error(`試合データを読み込めません。${res.status}`);
  }

  return res.json();
}

function renderLineScore(data) {
  const innings = data.lineScore.innings || [];
  const away = data.lineScore.away;
  const home = data.lineScore.home;

  const head = `
    <tr>
      <th class="teamCell">Team</th>
      ${innings.map((i) => `<th>${i}</th>`).join("")}
      <th>R</th>
      <th>H</th>
      <th>E</th>
    </tr>
  `;

  const row = (team) => `
    <tr>
      <td class="teamCell">${escapeHtml(team.team)}</td>
      ${innings.map((_, i) => `<td>${escapeHtml(team.runsByInning[i] ?? 0)}</td>`).join("")}
      <td class="total">${escapeHtml(team.runs)}</td>
      <td>${escapeHtml(team.hits)}</td>
      <td>${escapeHtml(team.errors)}</td>
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

function renderLineup(list) {
  if (!Array.isArray(list) || list.length === 0) {
    return `<li class="muted">未入力</li>`;
  }

  return list.map((player) => `<li>${escapeHtml(player)}</li>`).join("");
}

function renderEvent(event) {
  return `
    <article class="event">
      <div class="eventTime">
        <div class="inning">${escapeHtml(event.inningLabel || "速報")}</div>
        <div class="clock">${escapeHtml(formatClock(event.created_at))}</div>
      </div>

      <div class="eventBody">
        <div class="eventText">${escapeHtml(event.text || "")}</div>

        <a class="eventLink" href="${escapeHtml(event.html_url)}" target="_blank" rel="noreferrer">
          入力元を見る
        </a>
      </div>
    </article>
  `;
}

async function update() {
  const data = await fetchGameData();
  const match = data.match || {};

  $("matchTitle").textContent = match.title || "試合速報";
  $("matchSub").textContent = [
    match.date,
    match.venue,
    match.round,
    `${match.awayTeam || "先攻"} vs ${match.homeTeam || "後攻"}`
  ].filter(Boolean).join(" / ");

  $("gameStatus").textContent = data.status || "試合前";
  $("updatedAt").textContent = data.generated_at
    ? `更新 ${formatUpdated(data.generated_at)}`
    : "未更新";

  $("lineScoreWrap").innerHTML = renderLineScore(data);

  $("awayLineupTitle").textContent = match.awayTeam || "先攻";
  $("homeLineupTitle").textContent = match.homeTeam || "後攻";

  $("awayLineup").innerHTML = renderLineup(data.lineups?.away || []);
  $("homeLineup").innerHTML = renderLineup(data.lineups?.home || []);

  const events = data.events || [];

  if (events.length === 0) {
    $("empty").hidden = false;
    $("feed").innerHTML = "";
    return;
  }

  $("empty").hidden = true;
  $("feed").innerHTML = events.map(renderEvent).join("");
}

update().catch((err) => {
  console.error(err);
  $("gameStatus").textContent = "読み込みエラー";
  $("empty").hidden = false;
  $("empty").textContent = err.message;
});

setInterval(() => {
  update().catch(console.error);
}, REFRESH_MS);
