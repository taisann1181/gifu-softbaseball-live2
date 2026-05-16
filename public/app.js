const GITHUB_OWNER = "taisann1181";
const GITHUB_REPO = "gifu-softbaseball-live2";
const ISSUE_NUMBER = 1;

const AWAY_TEAM = "県岐商";
const HOME_TEAM = "中京";
const REFRESH_MS = 30000;

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeNumberText(text) {
  return String(text ?? "")
    .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
    .replace(/[−ー－―]/g, "-");
}

function formatClock(iso) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(d);
}

function formatUpdated(iso) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(d);
}

function kanjiToNumber(s) {
  const map = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10
  };

  if (s === "十") return 10;

  if (s.includes("十")) {
    const [a, b] = s.split("十");
    return (a ? map[a] : 1) * 10 + (b ? map[b] : 0);
  }

  return map[s] || s;
}

function extractInning(text) {
  const t = normalizeNumberText(text);

  let m = t.match(/([0-9]+)\s*回\s*(表|裏)/);
  if (m) return `${m[1]}回${m[2]}`;

  m = t.match(/([一二三四五六七八九十]+)\s*回\s*(表|裏)/);
  if (m) return `${kanjiToNumber(m[1])}回${m[2]}`;

  if (/試合開始|プレイボール/.test(t)) return "試合開始";
  if (/試合終了|ゲームセット|終了/.test(t)) return "試合終了";

  return null;
}

function extractScore(text) {
  const t = normalizeNumberText(text);

  let m = t.match(new RegExp(`${AWAY_TEAM}\\s*(\\d{1,2})\\s*[-―－ー]\\s*(\\d{1,2})\\s*${HOME_TEAM}`));
  if (m) return { away: Number(m[1]), home: Number(m[2]) };

  m = t.match(new RegExp(`${HOME_TEAM}\\s*(\\d{1,2})\\s*[-―－ー]\\s*(\\d{1,2})\\s*${AWAY_TEAM}`));
  if (m) return { away: Number(m[2]), home: Number(m[1]) };

  m = t.match(/(\d{1,2})\s*[-―－ー]\s*(\d{1,2})/);
  if (m && /得点|先制|追加点|同点|逆転|勝ち越し|試合終了|ゲームセット|終了|スコア/.test(t)) {
    return { away: Number(m[1]), home: Number(m[2]) };
  }

  return null;
}

function classifyEvent(text) {
  const rules = [
    ["final", /試合終了|ゲームセット|終了/, "試合終了"],
    ["score", /得点|先制|追加点|同点|逆転|勝ち越し|本塁打|ホームラン|スクイズ|タイムリー/, "得点"],
    ["hit", /安打|ヒット|二塁打|三塁打|ツーベース|スリーベース|内野安打/, "安打"],
    ["change", /チェンジ|攻守交代/, "チェンジ"],
    ["change", /投手交代|守備交代|代打|代走|選手交代/, "交代"],
    ["out", /三振|凡退|フライ|ゴロ|アウト|併殺|見逃し|空振り/, "アウト"],
    ["runner", /四球|死球|盗塁|犠打|送りバント|満塁|出塁|進塁|一塁|二塁|三塁/, "走者"],
    ["error", /失策|エラー|暴投|捕逸|悪送球/, "ミス"]
  ];

  for (const [type, regex, label] of rules) {
    if (regex.test(text)) return { type, label };
  }

  return { type: "normal", label: "速報" };
}

async function fetchIssueComments() {
  const commentsUrl =
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${ISSUE_NUMBER}/comments?per_page=100`;

  const res = await fetch(commentsUrl, {
    headers: {
      Accept: "application/vnd.github+json"
    }
  });

  if (!res.ok) {
    if (res.status === 403) {
      throw new Error("GitHub APIの制限に当たっています。少し待ってから再読み込みしてください。");
    }

    throw new Error(`Issueコメントを読み込めません。${res.status}`);
  }

  return res.json();
}

function buildEvents(comments) {
  let awayScore = null;
  let homeScore = null;
  let status = "試合前";

  const events = comments.map((comment, index) => {
    const text = String(comment.body || "").trim();
    const inning = extractInning(text);
    const score = extractScore(text);
    const tag = classifyEvent(text);

    if (inning) status = inning;

    if (score) {
      awayScore = score.away;
      homeScore = score.home;
    }

    return {
      id: comment.id,
      number: index + 1,
      text,
      created_at: comment.created_at,
      html_url: comment.html_url,
      inning: inning || status,
      tag,
      awayScore,
      homeScore
    };
  });

  return {
    events,
    awayScore,
    homeScore,
    status
  };
}

function renderEvent(event) {
  return `
    <article class="event">
      <div class="eventTime">
        <div class="inning">${escapeHtml(event.inning)}</div>
        <div class="clock">${escapeHtml(formatClock(event.created_at))}</div>
      </div>

      <div class="eventBody">
        <div class="eventTop">
          <span class="tag ${escapeHtml(event.tag.type)}">${escapeHtml(event.tag.label)}</span>
          <span class="replyOrder">#${event.number}</span>
        </div>

        <div class="eventText">${escapeHtml(event.text)}</div>

        <a class="eventLink" href="${escapeHtml(event.html_url)}" target="_blank" rel="noreferrer">
          入力元を見る
        </a>
      </div>
    </article>
  `;
}

async function update() {
  const comments = await fetchIssueComments();
  const live = buildEvents(comments);

  $("awayScore").textContent = live.awayScore ?? "-";
  $("homeScore").textContent = live.homeScore ?? "-";
  $("gameStatus").textContent = live.status;
  $("updatedAt").textContent = `更新 ${formatUpdated(new Date().toISOString())}`;

  if (!live.events.length) {
    $("empty").hidden = false;
    $("feed").innerHTML = "";
    return;
  }

  $("empty").hidden = true;
  $("feed").innerHTML = live.events.map(renderEvent).join("");
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
