import fs from "node:fs/promises";

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const targetIssueNumber = Number(process.env.TARGET_ISSUE_NUMBER || 0);

if (!token) throw new Error("GITHUB_TOKEN がありません。");
if (!repository) throw new Error("GITHUB_REPOSITORY がありません。");

const BASE_INNINGS = 9;

const BLANK_MATCH = {
  title: "",
  date: "",
  venue: "",
  round: "",
  awayTeam: "",
  homeTeam: "",
  innings: BASE_INNINGS
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

async function fetchGameIssues() {
  const all = [];
  let page = 1;

  while (true) {
    const issues = await githubFetch(
      `https://api.github.com/repos/${repository}/issues?state=all&per_page=100&page=${page}&sort=created&direction=asc`
    );

    all.push(...issues);

    if (issues.length < 100) break;
    page += 1;
  }

  return all
    .filter((issue) => !issue.pull_request)
    .filter((issue) => String(issue.title || "").startsWith("速報入力"));
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

function emptyLineScore(length = BASE_INNINGS) {
  return Array.from({ length }, () => "");
}

function ensureInning(arr, inning) {
  while (arr.length < inning) {
    arr.push("");
  }
}

function numeric(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function cellNumber(value) {
  if (value === "" || value === null || value === undefined || value === "×") return 0;
  return numeric(value);
}

function addToCell(arr, inning, value) {
  ensureInning(arr, inning);
  arr[inning - 1] = cellNumber(arr[inning - 1]) + numeric(value);
}

function sumRuns(arr, touched) {
  if (!touched) return "";

  return arr.reduce((total, value) => {
    if (value === "×") return total;
    return total + cellNumber(value);
  }, 0);
}

function displayTotal(value, touched) {
  return touched ? value : "";
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

function attackTeam(match, half) {
  const h = normalizeHalf(half);

  if (h === "top") return match.awayTeam || "先攻";
  if (h === "bottom") return match.homeTeam || "後攻";

  return "";
}

function cleanMatchCommand(command) {
  return {
    title: String(command.title || ""),
    date: String(command.date || ""),
    venue: String(command.venue || ""),
    round: String(command.round || ""),
    awayTeam: String(command.awayTeam || ""),
    homeTeam: String(command.homeTeam || ""),
    innings: BASE_INNINGS
  };
}

function cleanLineupPlayers(players) {
  if (!Array.isArray(players)) return [];

  return players
    .map((player) => ({
      order: String(player.order || ""),
      name: String(player.name || "").trim(),
      position: String(player.position || "").trim()
    }))
    .filter((player) => player.name || player.position);
}

function processGame(issue, comments) {
  let match = { ...BLANK_MATCH };

  const lineups = {
    away: [],
    home: []
  };

  const awayRunsByInning = emptyLineScore();
  const homeRunsByInning = emptyLineScore();

  let awayHits = 0;
  let homeHits = 0;
  let awayErrors = 0;
  let homeErrors = 0;

  let awayRunsTouched = false;
  let homeRunsTouched = false;
  let awayHitsTouched = false;
  let homeHitsTouched = false;
  let awayErrorsTouched = false;
  let homeErrorsTouched = false;

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
        ...cleanMatchCommand(command)
      };
      continue;
    }

    if (command.type === "lineup") {
      const team = command.team === "home" ? "home" : "away";
      lineups[team] = cleanLineupPlayers(command.players);
      continue;
    }

    if (command.type === "event") {
      const inning = numeric(command.inning);
      const half = normalizeHalf(command.half);
      const finalChecked = command.final === true;

      if (inning >= 1) {
        ensureInning(awayRunsByInning, inning);
        ensureInning(homeRunsByInning, inning);
      }

      let appliedAwayRuns = 0;
      let appliedHomeRuns = 0;
      let appliedAwayHits = 0;
      let appliedHomeHits = 0;
      let appliedAwayErrors = 0;
      let appliedHomeErrors = 0;

      if (inning >= 1 && half === "top") {
        appliedAwayRuns = numeric(command.awayRuns);
        appliedAwayHits = numeric(command.awayHits);
        appliedHomeErrors = numeric(command.homeErrors);

        addToCell(awayRunsByInning, inning, appliedAwayRuns);
        awayRunsTouched = true;

        awayHits += appliedAwayHits;
        awayHitsTouched = true;

        homeErrors += appliedHomeErrors;
        homeErrorsTouched = true;
      }

      if (inning >= 1 && half === "bottom") {
        appliedHomeRuns = numeric(command.homeRuns);
        appliedHomeHits = numeric(command.homeHits);
        appliedAwayErrors = numeric(command.awayErrors);

        addToCell(homeRunsByInning, inning, appliedHomeRuns);
        homeRunsTouched = true;

        homeHits += appliedHomeHits;
        homeHitsTouched = true;

        awayErrors += appliedAwayErrors;
        awayErrorsTouched = true;
      }

      if (finalChecked) {
        isFinal = true;
        status = "試合終了";

        if (half === "top" && inning >= 1) {
          ensureInning(homeRunsByInning, inning);
          homeRunsByInning[inning - 1] = "×";
        }
      } else if (inning >= 1) {
        status = inningLabel(inning, half);
      }

      events.push({
        number: events.length + 1,
        inning,
        half,
        inningLabel: finalChecked ? "試合終了" : inningLabel(inning, half),
        attackTeam: finalChecked ? "" : attackTeam(match, half),
        text: String(command.text || "").trim(),
        created_at: source.created_at,
        updated_at: source.updated_at,
        html_url: source.html_url,
        awayRuns: appliedAwayRuns,
        homeRuns: appliedHomeRuns,
        awayHits: appliedAwayHits,
        homeHits: appliedHomeHits,
        awayErrors: appliedAwayErrors,
        homeErrors: appliedHomeErrors,
        final: finalChecked
      });
    }
  }

  const maxLength = Math.max(
    BASE_INNINGS,
    awayRunsByInning.length,
    homeRunsByInning.length
  );

  ensureInning(awayRunsByInning, maxLength);
  ensureInning(homeRunsByInning, maxLength);

  const awayRuns = sumRuns(awayRunsByInning, awayRunsTouched);
  const homeRuns = sumRuns(homeRunsByInning, homeRunsTouched);

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
      innings: Array.from({ length: maxLength }, (_, i) => i + 1),
      away: {
        team: match.awayTeam || "先攻",
        runsByInning: awayRunsByInning,
        runs: awayRuns,
        hits: displayTotal(awayHits, awayHitsTouched),
        errors: displayTotal(awayErrors, awayErrorsTouched)
      },
      home: {
        team: match.homeTeam || "後攻",
        runsByInning: homeRunsByInning,
        runs: homeRuns,
        hits: displayTotal(homeHits, homeHitsTouched),
        errors: displayTotal(homeErrors, homeErrorsTouched)
      }
    },
    lineups,
    events
  };
}

function blankGame() {
  return {
    generated_at: new Date().toISOString(),
    repository,
    issue_number: null,
    issue_title: "",
    issue_url: "",
    match: { ...BLANK_MATCH },
    status: "試合前",
    isFinal: false,
    lineScore: {
      innings: Array.from({ length: BASE_INNINGS }, (_, i) => i + 1),
      away: {
        team: "先攻",
        runsByInning: emptyLineScore(),
        runs: "",
        hits: "",
        errors: ""
      },
      home: {
        team: "後攻",
        runsByInning: emptyLineScore(),
        runs: "",
        hits: "",
        errors: ""
      }
    },
    lineups: {
      away: [],
      home: []
    },
    events: []
  };
}

async function main() {
  await fs.mkdir("public/data", { recursive: true });

  const gameIssues = await fetchGameIssues();

  if (gameIssues.length === 0) {
    const empty = blankGame();

    await fs.writeFile(
      "public/data/current.json",
      JSON.stringify(empty, null, 2),
      "utf8"
    );

    await fs.writeFile(
      "public/data/games.json",
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          repository,
          current_issue_number: null,
          games: []
        },
        null,
        2
      ),
      "utf8"
    );

    console.log("No game issues found. Generated blank data.");
    return;
  }

  const games = [];

  for (const issue of gameIssues) {
    const fullIssue = await fetchIssue(issue.number);
    const comments = await fetchComments(issue.number);
    const game = processGame(fullIssue, comments);

    games.push(game);

    await fs.writeFile(
      `public/data/game-${issue.number}.json`,
      JSON.stringify(game, null, 2),
      "utf8"
    );
  }

  const current =
    games.find((game) => game.issue_number === targetIssueNumber) ||
    games[games.length - 1];

  await fs.writeFile(
    "public/data/current.json",
    JSON.stringify(current, null, 2),
    "utf8"
  );

  await fs.writeFile(
    "public/data/games.json",
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        repository,
        current_issue_number: current.issue_number,
        games: games.map((game) => ({
          game_number: game.issue_number,
          issue_number: game.issue_number,
          issue_title: game.issue_title,
          issue_url: game.issue_url,
          match: game.match,
          status: game.status,
          isFinal: game.isFinal,
          data_url: `./game-${game.issue_number}.json`
        }))
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`Generated ${games.length} game file(s). Current game: #${current.issue_number}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
