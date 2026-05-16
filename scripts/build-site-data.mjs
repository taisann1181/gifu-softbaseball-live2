import fs from "node:fs/promises";

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const currentIssueNumber = Number(process.env.ISSUE_NUMBER || 1);

if (!token) throw new Error("GITHUB_TOKEN がありません。");
if (!repository) throw new Error("GITHUB_REPOSITORY がありません。");

const DEFAULT_MATCH = {
  title: "第74回岐阜県高等学校総合体育大会 軟式野球競技",
  date: "2026.05.16(土)",
  venue: "夜明け前🏟️",
  round: "準決勝 第2試合",
  awayTeam: "県岐商",
  homeTeam: "中京",
  innings: 7
};

async function githubFetch(url) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "gifu-softbaseball-live"
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${text}`);
  }

  return res.json();
}

async function fetchIssue(issueNumber) {
  return githubFetch(`https://api.github.com/repos/${repository}/issues/${issueNumber}`);
}

async function fetchComments(issueNumber) {
  const all = [];
  let page = 1;

  while (true) {
    const comments = await githubFetch(
      `https://api.github.com/repos/${repository}/issues/${issueNumber}/comments?per_page=100&page=${page}`
    );

    all.push(...comments);

    if (comments.length < 100) break;
    page += 1;
  }

  return all;
}

function parseCommand(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const fence = raw.match(/```(?:livejson|json)?\s*([\s\S]*?)```/i);
  const jsonText = fence ? fence[1].trim() : raw;

  if (!jsonText.startsWith("{")) return null;

  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

function makeArray(length, value = 0) {
  return Array.from({ length }, () => value);
}

function normalizeHalf(half) {
  if (half === "top" || half === "表") return "top";
  if (half === "bottom" || half === "裏") return "bottom";
  return "";
}

function inningLabel(inning, half) {
  const h = normalizeHalf(half);
  if (!inning) return "速報";
  if (h === "top") return `${inning}回表`;
  if (h === "bottom") return `${inning}回裏`;
  return `${inning}回`;
}

function numberValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeRunsArray(value, innings) {
  const arr = Array.isArray(value) ? value : [];
  return makeArray(innings).map((_, i) => numberValue(arr[i]));
}

function processGame(issue, comments) {
  let match = { ...DEFAULT_MATCH };
  let lineups = {
    away: [],
    home: []
  };

  let innings = Number(match.innings || 7);

  let awayRunsByInning = makeArray(innings);
  let homeRunsByInning = makeArray(innings);

  let awayHits = 0;
  let homeHits = 0;
  let awayErrors = 0;
  let homeErrors = 0;

  let status = "試合前";
  let isFinal = false;

  const events = [];

  const sources = [
    {
      body: issue.body || "",
      created_at: issue.created_at,
      updated_at: issue.updated_at,
      html_url: issue.html_url,
      source: "issue"
    },
    ...comments.map((comment) => ({
      body: comment.body || "",
      created_at: comment.created_at,
      updated_at: comment.updated_at,
      html_url: comment.html_url,
      source: "comment",
      user: comment.user?.login || ""
    }))
  ];

  for (const source of sources) {
    const command = parseCommand(source.body);
    if (!command || !command.type) continue;

    if (command.type === "match") {
      match = {
        ...match,
        ...command
      };

      innings = Number(match.innings || innings || 7);

      awayRunsByInning = normalizeRunsArray(awayRunsByInning, innings);
      homeRunsByInning = normalizeRunsArray(homeRunsByInning, innings);
      continue;
    }

    if (command.type === "lineup") {
      const team = command.team === "home" ? "home" : "away";
      lineups[team] = Array.isArray(command.players)
        ? command.players.map((p) => String(p).trim()).filter(Boolean)
        : [];
      continue;
    }

    if (command.type === "scoreboard") {
      awayRunsByInning = normalizeRunsArray(command.awayRunsByInning, innings);
      homeRunsByInning = normalizeRunsArray(command.homeRunsByInning, innings);

      awayHits = numberValue(command.awayHits);
      homeHits = numberValue(command.homeHits);
      awayErrors = numberValue(command.awayErrors);
      homeErrors = numberValue(command.homeErrors);

      if (command.status) status = String(command.status);
      continue;
    }

    if (command.type === "event" || command.type === "final") {
      const inning = Number(command.inning || 0);
      const half = normalizeHalf(command.half);

      const awayRuns = numberValue(command.awayRuns);
      const homeRuns = numberValue(command.homeRuns);

      if (inning >= 1 && inning <= innings) {
        awayRunsByInning[inning - 1] += awayRuns;
        homeRunsByInning[inning - 1] += homeRuns;
      }

      awayHits += numberValue(command.awayHits);
      homeHits += numberValue(command.homeHits);
      awayErrors += numberValue(command.awayErrors);
      homeErrors += numberValue(command.homeErrors);

      if (command.type === "final" || command.final === true) {
        status = "試合終了";
        isFinal = true;
      } else if (command.status) {
        status = String(command.status);
      } else if (inning) {
        status = inningLabel(inning, half);
      }

      events.push({
        number: events.length + 1,
        type: command.type,
        inning,
        half,
        inningLabel: command.type === "final" ? "試合終了" : inningLabel(inning, half),
        text: String(command.text || "").trim(),
        created_at: source.created_at,
        updated_at: source.updated_at,
        html_url: source.html_url,
        awayRuns,
        homeRuns,
        awayHits: numberValue(command.awayHits),
        homeHits: numberValue(command.homeHits),
        awayErrors: numberValue(command.awayErrors),
        homeErrors: numberValue(command.homeErrors)
      });
    }
  }

  const awayRuns = awayRunsByInning.reduce((a, b) => a + b, 0);
  const homeRuns = homeRunsByInning.reduce((a, b) => a + b, 0);

  return {
    generated_at: new Date().toISOString(),
    repository,
    issue_number: issue.number,
    issue_title: issue.title,
    issue_url: issue.html_url,
    match,
    status,
    isFinal,
    lineScore: {
      innings: makeArray(innings).map((_, i) => i + 1),
      away: {
        team: match.awayTeam,
        runsByInning: awayRunsByInning,
        runs: awayRuns,
        hits: awayHits,
        errors: awayErrors
      },
      home: {
        team: match.homeTeam,
        runsByInning: homeRunsByInning,
        runs: homeRuns,
        hits: homeHits,
        errors: homeErrors
      }
    },
    lineups,
    events
  };
}

async function main() {
  await fs.mkdir("public/data", { recursive: true });

  const currentIssue = await fetchIssue(currentIssueNumber);
  const currentComments = await fetchComments(currentIssueNumber);
  const currentGame = processGame(currentIssue, currentComments);

  await fs.writeFile(
    "public/data/current.json",
    JSON.stringify(currentGame, null, 2),
    "utf8"
  );

  await fs.writeFile(
    `public/data/game-${currentIssueNumber}.json`,
    JSON.stringify(currentGame, null, 2),
    "utf8"
  );

  const gamesIndex = {
    generated_at: new Date().toISOString(),
    repository,
    current_issue_number: currentIssueNumber,
    games: [
      {
        issue_number: currentIssueNumber,
        title: currentGame.issue_title,
        match: currentGame.match,
        status: currentGame.status,
        url: `./game-${currentIssueNumber}.json`
      }
    ]
  };

  await fs.writeFile(
    "public/data/games.json",
    JSON.stringify(gamesIndex, null, 2),
    "utf8"
  );

  console.log(`Generated game data for issue #${currentIssueNumber}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
