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
  if (value === "" || value === null || value === undefined || value === "×") {
    return 0;
  }

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

function baseState(command, prefix = "") {
  return {
    first: String(command[`${prefix}base1`] ?? command[`${prefix}first`] ?? ""),
    second: String(command[`${prefix}base2`] ?? command[`${prefix}second`] ?? ""),
    third: String(command[`${prefix}base3`] ?? command[`${prefix}third`] ?? "")
  };
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

function makeEmptyAtBat(match, source, command) {
  const inning = numeric(command.inning);
  const half = normalizeHalf(command.half);

  return {
    number: 0,
    inning,
    half,
    inningLabel: inningLabel(inning, half),
    attackTeam: attackTeam(match, half),
    batter: String(command.batter || ""),
    pitcher: String(command.pitcher || ""),
    outsStart: numeric(command.outs),
    outsEnd: "",
    basesStart: baseState(command),
    basesEnd: baseState(command),
    pitches: [],
    result: "",
    resultDetail: "",
    text: "",
    runs: 0,
    hits: 0,
    errors: 0,
    rbi: 0,
    final: false,
    created_at: source.created_at,
    updated_at: source.updated_at,
    html_url: source.html_url
  };
}

function latestPitchCount(atBat) {
  const last = atBat?.pitches?.at(-1);

  return {
    ball: last?.ball ?? 0,
    strike: last?.strike ?? 0
  };
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
  let currentAtBat = null;

  const atBats = [];
  const notes = [];
  const timeline = [];

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

  function pushAtBat(atBat) {
    atBat.number = atBats.length + 1;
    atBats.push(atBat);
    timeline.push({
      kind: "atbat",
      number: atBat.number,
      created_at: atBat.created_at
    });
    currentAtBat = atBat;
  }

  function getOrCreateAtBat(source, command) {
    if (currentAtBat) return currentAtBat;

    const atBat = makeEmptyAtBat(match, source, command);
    pushAtBat(atBat);
    return atBat;
  }

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

    if (command.type === "pa_start") {
      const atBat = makeEmptyAtBat(match, source, command);
      status = inningLabel(atBat.inning, atBat.half);
      pushAtBat(atBat);
      continue;
    }

    if (command.type === "pitch") {
      const atBat = getOrCreateAtBat(source, command);
      const pitchNo = numeric(command.pitchNo) || atBat.pitches.length + 1;

      atBat.pitches.push({
        number: pitchNo,
        result: String(command.result || ""),
        detail: String(command.detail || ""),
        pitchType: String(command.pitchType || ""),
        speed: String(command.speed || ""),
        course: String(command.course || ""),
        zone: String(command.zone || ""),
        ball: numeric(command.ball),
        strike: numeric(command.strike),
        runnerEvent: String(command.runnerEvent || ""),
        text: String(command.text || ""),
        created_at: source.created_at,
        updated_at: source.updated_at,
        html_url: source.html_url
      });

      status = atBat.inningLabel;
      continue;
    }

    if (command.type === "pa_result") {
      const atBat = getOrCreateAtBat(source, command);
      const inning = numeric(command.inning) || atBat.inning;
      const half = normalizeHalf(command.half) || atBat.half;
      const finalChecked = command.final === true;

      atBat.inning = inning;
      atBat.half = half;
      atBat.inningLabel = inningLabel(inning, half);
      atBat.attackTeam = attackTeam(match, half);

      if (inning >= 1) {
        ensureInning(awayRunsByInning, inning);
        ensureInning(homeRunsByInning, inning);
      }

      let appliedRuns = numeric(command.runs);
      let appliedHits = numeric(command.hits);
      let appliedErrors = numeric(command.errors);

      if (command.runs === undefined) {
        appliedRuns = half === "top" ? numeric(command.awayRuns) : numeric(command.homeRuns);
      }

      if (command.hits === undefined) {
        appliedHits = half === "top" ? numeric(command.awayHits) : numeric(command.homeHits);
      }

      if (command.errors === undefined) {
        appliedErrors = half === "top" ? numeric(command.homeErrors) : numeric(command.awayErrors);
      }

      if (inning >= 1 && half === "top") {
        addToCell(awayRunsByInning, inning, appliedRuns);
        awayRunsTouched = true;

        awayHits += appliedHits;
        awayHitsTouched = true;

        homeErrors += appliedErrors;
        homeErrorsTouched = true;
      }

      if (inning >= 1 && half === "bottom") {
        addToCell(homeRunsByInning, inning, appliedRuns);
        homeRunsTouched = true;

        homeHits += appliedHits;
        homeHitsTouched = true;

        awayErrors += appliedErrors;
        awayErrorsTouched = true;
      }

      atBat.outsEnd = numeric(command.outs);
      atBat.basesEnd = baseState(command);
      atBat.result = String(command.result || "");
      atBat.resultDetail = String(command.detail || "");
      atBat.text = String(command.text || "");
      atBat.runs = appliedRuns;
      atBat.hits = appliedHits;
      atBat.errors = appliedErrors;
      atBat.rbi = numeric(command.rbi);
      atBat.final = finalChecked;
      atBat.updated_at = source.updated_at;
      atBat.html_url = source.html_url;

      if (finalChecked) {
        isFinal = true;
        status = "試合終了";

        if (half === "top" && inning >= 1) {
          ensureInning(homeRunsByInning, inning);
          homeRunsByInning[inning - 1] = "×";
        }
      } else {
        status = atBat.inningLabel;
      }

      currentAtBat = null;
      continue;
    }

    if (command.type === "note") {
      const inning = numeric(command.inning);
      const half = normalizeHalf(command.half);

      const note = {
        number: notes.length + 1,
        category: String(command.category || "メモ"),
        inning,
        half,
        inningLabel: inningLabel(inning, half),
        attackTeam: attackTeam(match, half),
        text: String(command.text || ""),
        created_at: source.created_at,
        updated_at: source.updated_at,
        html_url: source.html_url
      };

      notes.push(note);

      timeline.push({
        kind: "note",
        number: note.number,
        created_at: note.created_at
      });

      continue;
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

  const latestAtBat = atBats.at(-1) || null;
  const count = latestPitchCount(latestAtBat);

  const currentState = latestAtBat
    ? {
        inningLabel: latestAtBat.inningLabel,
        attackTeam: latestAtBat.attackTeam,
        batter: latestAtBat.batter,
        pitcher: latestAtBat.pitcher,
        ball: count.ball,
        strike: count.strike,
        outs: latestAtBat.outsEnd === "" ? latestAtBat.outsStart : latestAtBat.outsEnd,
        bases: latestAtBat.result ? latestAtBat.basesEnd : latestAtBat.basesStart
      }
    : {
        inningLabel: "",
        attackTeam: "",
        batter: "",
        pitcher: "",
        ball: 0,
        strike: 0,
        outs: 0,
        bases: {
          first: "",
          second: "",
          third: ""
        }
      };

  return {
    generated_at: new Date().toISOString(),
    repository,
    issue_number: issue.number,
    issue_title: issue.title,
    issue_url: issue.html_url,
    match,
    status,
    isFinal,
    currentState,
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
    atBats,
    notes,
    timeline
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
    currentState: {
      inningLabel: "",
      attackTeam: "",
      batter: "",
      pitcher: "",
      ball: 0,
      strike: 0,
      outs: 0,
      bases: {
        first: "",
        second: "",
        third: ""
      }
    },
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
    atBats: [],
    notes: [],
    timeline: []
  };
}

async function main() {
  await fs.mkdir("public/data", { recursive: true });

  const gameIssues = await fetchGameIssues();

  if (gameIssues.length === 0) {
    const empty = blankGame();

    await fs.writeFile("public/data/current.json", JSON.stringify(empty, null, 2), "utf8");

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
