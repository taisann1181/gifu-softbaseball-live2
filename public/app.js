const CURRENT_DATA_URL = "./data/current.json";
const REFRESH_MS = 15000;
const STORAGE_KEY = "gifu_softbaseball_selected_game_number";

let activeDataUrl = CURRENT_DATA_URL;
let activeGameNumber = null;

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

function getGameFromUrl() {
  const params = new URLSearchParams(location.search);
  const game = Number(params.get("game") || 0);
  return Number.isFinite(game) && game > 0 ? game : null;
}

function getSavedGameNumber() {
  const saved = Number(localStorage.getItem(STORAGE_KEY) || 0);
  return Number.isFinite(saved) && saved > 0 ? saved : null;
}

function saveGameNumber(gameNumber) {
  if (gameNumber) {
    localStorage.setItem(STORAGE_KEY, String(gameNumber));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function gameDataUrl(gameNumber) {
  return `./data/game-${gameNumber}.json`;
}

function setUrlGame(gameNumber) {
  const url = new URL(location.href);

  if (gameNumber) {
    url.searchParams.set("game", String(gameNumber));
  } else {
    url.searchParams.delete("game");
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
    return `<li class="muted">未入力</li>`;
  }

  return list.map((player) => {
    const order = player.order ? `<span class="batOrder">${escapeHtml(player.order)}.</span>` : "";
    const name = escapeHtml(player.name || "");
    const posText = normalizePosition(player.position);
    const pos = posText ? ` <span class="pos">(${escapeHtml(posText)})</span>` : "";

    return `<li>${order}${name}${pos}</li>`;
  }).join("");
}

function baseText(bases) {
  const list = [];

  if (bases?.first) list.push(`一:${bases.first}`);
  if (bases?.second) list.push(`二:${bases.second}`);
  if (bases?.third) list.push(`三:${bases.third}`);

  return list.length ? list.join(" / ") : "なし";
}

function renderPitchRows(pitches) {
  if (!Array.isArray(pitches) || pitches.length === 0) {
    return `<div class="pitchEmpty">まだ球歴はありません</div>`;
  }

  return `
    <div class="pitchTable">
      ${pitches.map((pitch) => `
        <div class="pitchRow">
          <div class="pitchNo">${escapeHtml(pitch.number)}球目</div>
          <div class="pitchMain">
            <strong>${escapeHtml(pitch.result || "記録")}</strong>
            <span>${[
              pitch.pitchType,
              pitch.course,
              pitch.zone,
              pitch.speed ? `${pitch.speed}km/h` : "",
              pitch.runnerEvent
            ].filter(Boolean).map(escapeHtml).join(" / ")}</span>
            ${pitch.text ? `<p>${escapeHtml(pitch.text)}</p>` : ""}
          </div>
          <div class="pitchCount">B${escapeHtml(pitch.ball)} S${escapeHtml(pitch.strike)}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderAtBat(atBat) {
  return `
    <article class="atBatCard">
      <div class="atBatHead">
        <div>
          <p class="inning">${escapeHtml(atBat.inningLabel || "速報")}</p>
          <h3>${escapeHtml(atBat.attackTeam || "")}</h3>
        </div>
        <div class="atBatMeta">
          <span>${escapeHtml(formatClock(atBat.created_at))}</span>
        </div>
      </div>

      <div class="batterPitcher">
        <div>
          <p>打者</p>
          <strong>${escapeHtml(atBat.batter || "--")}</strong>
        </div>
        <div>
          <p>投手</p>
          <strong>${escapeHtml(atBat.pitcher || "--")}</strong>
        </div>
        <div>
          <p>開始時</p>
          <strong>${escapeHtml(atBat.outsStart)}アウト / ${escapeHtml(baseText(atBat.basesStart))}</strong>
        </div>
      </div>

      ${renderPitchRows(atBat.pitches)}

      ${
        atBat.result || atBat.text
          ? `
            <div class="paResult">
              <span>結果</span>
              <strong>${escapeHtml(atBat.result || "")}</strong>
              ${atBat.resultDetail ? `<em>${escapeHtml(atBat.resultDetail)}</em>` : ""}
              ${atBat.text ? `<p>${escapeHtml(atBat.text)}</p>` : ""}
            </div>
          `
          : ""
      }
    </article>
  `;
}

function renderNote(note) {
  return `
    <article class="noteCard">
      <div class="noteLabel">${escapeHtml(note.category || "メモ")}</div>
      <div>
        <p class="inning">${escapeHtml(note.inningLabel || "速報")}</p>
        <div class="noteText">${escapeHtml(note.text || "")}</div>
      </div>
    </article>
  `;
}

function renderTimeline(data) {
  const atBatMap = new Map((data.atBats || []).map((atBat) => [atBat.number, atBat]));
  const noteMap = new Map((data.notes || []).map((note) => [note.number, note]));

  const timeline = data.timeline || [];

  if (!timeline.length) {
    return "";
  }

  return timeline.map((item) => {
    if (item.kind === "atbat") {
      const atBat = atBatMap.get(item.number);
      return atBat ? renderAtBat(atBat) : "";
    }

    if (item.kind === "note") {
      const note = noteMap.get(item.number);
      return note ? renderNote(note) : "";
    }

    return "";
  }).join("");
}

function updateCurrentPanel(data) {
  const state = data.currentState || {};

  $("currentInning").textContent = state.inningLabel || "--";
  $("currentAttack").textContent = state.attackTeam || "現在の攻撃";
  $("currentBatter").textContent = state.batter || "--";
  $("currentPitcher").textContent = state.pitcher || "--";
  $("currentBases").textContent = baseText(state.bases || {});
  $("ballCount").textContent = state.ball ?? 0;
  $("strikeCount").textContent = state.strike ?? 0;
  $("outCount").textContent = state.outs ?? 0;
}

function updateGameSelector(data) {
  const gameNumber = data.issue_number || activeGameNumber || "";

  if ($("viewGameNumber")) {
    $("viewGameNumber").value = gameNumber || "";
  }

  if ($("currentGameLabel")) {
    $("currentGameLabel").textContent = gameNumber ? `#${gameNumber}` : "最新";
  }
}

function renderGame(data) {
  const match = data.match || {};

  $("matchTitle").textContent = match.title || "1球速報";

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

  updateCurrentPanel(data);
  updateGameSelector(data);

  const feed = renderTimeline(data);

  if (!feed) {
    $("empty").hidden = false;
    $("feed").innerHTML = "";
  } else {
    $("empty").hidden = true;
    $("feed").innerHTML = feed;
  }

  if (data.isFinal) {
    $("feed").innerHTML += `
      <article class="finalEvent">
        <div class="finalEventTitle">試合終了</div>
      </article>
    `;
  }
}

async function update() {
  const data = await fetchGameData(activeDataUrl);
  renderGame(data);
}

function showLoadError(message) {
  $("gameStatus").textContent = "読み込みエラー";
  $("empty").hidden = false;
  $("empty").textContent = message;
}

async function loadGameNumber(gameNumber) {
  if (!Number.isFinite(gameNumber) || gameNumber <= 0) return;

  activeGameNumber = gameNumber;
  activeDataUrl = gameDataUrl(gameNumber);

  saveGameNumber(gameNumber);
  setUrlGame(gameNumber);

  try {
    await update();
  } catch (err) {
    console.error(err);
    showLoadError(`試合 #${gameNumber} のデータを読み込めません。Actionsが成功しているか確認してください。`);
  }
}

async function loadSelectedGame() {
  const gameNumber = Number($("viewGameNumber").value);
  await loadGameNumber(gameNumber);
}

async function loadCurrentGame() {
  activeGameNumber = null;
  activeDataUrl = CURRENT_DATA_URL;

  saveGameNumber(null);
  setUrlGame(null);

  try {
    await update();
  } catch (err) {
    console.error(err);
    showLoadError(err.message);
  }
}

function setupGameInputEvents() {
  const input = $("viewGameNumber");
  if (!input) return;

  input.addEventListener("keydown", async (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      await loadSelectedGame();
      input.blur();
    }
  });

  input.addEventListener("change", async () => {
    await loadSelectedGame();
  });
}

async function init() {
  setupGameInputEvents();

  const gameFromUrl = getGameFromUrl();
  const savedGameNumber = getSavedGameNumber();

  if (gameFromUrl) {
    activeGameNumber = gameFromUrl;
    activeDataUrl = gameDataUrl(gameFromUrl);
    saveGameNumber(gameFromUrl);
  } else if (savedGameNumber) {
    activeGameNumber = savedGameNumber;
    activeDataUrl = gameDataUrl(savedGameNumber);
    setUrlGame(savedGameNumber);
  } else {
    activeGameNumber = null;
    activeDataUrl = CURRENT_DATA_URL;
  }

  try {
    await update();
  } catch (err) {
    console.error(err);
    showLoadError(err.message);
  }
}

init();

setInterval(() => {
  update().catch(console.error);
}, REFRESH_MS);
