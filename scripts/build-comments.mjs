import fs from "node:fs/promises";

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const issueNumber = process.env.ISSUE_NUMBER || "1";

if (!token) {
  throw new Error("GITHUB_TOKEN がありません。");
}

if (!repository) {
  throw new Error("GITHUB_REPOSITORY がありません。");
}

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

async function fetchAllComments() {
  const all = [];
  let page = 1;

  while (true) {
    const url =
      `https://api.github.com/repos/${repository}/issues/${issueNumber}/comments?per_page=100&page=${page}`;

    const comments = await githubFetch(url);

    all.push(...comments);

    if (comments.length < 100) break;
    page += 1;
  }

  return all;
}

async function main() {
  const comments = await fetchAllComments();

  const output = {
    generated_at: new Date().toISOString(),
    repository,
    issue_number: Number(issueNumber),
    match: {
      title: "第74回岐阜県高等学校総合体育大会 軟式野球競技",
      subtitle: "2026.05.16(土) 夜明け前🏟️ / 準決勝 第2試合",
      awayTeam: "県岐商",
      homeTeam: "中京"
    },
    comments: comments.map((comment, index) => ({
      id: comment.id,
      number: index + 1,
      body: comment.body || "",
      created_at: comment.created_at,
      updated_at: comment.updated_at,
      html_url: comment.html_url,
      user: {
        login: comment.user?.login || "",
        avatar_url: comment.user?.avatar_url || ""
      }
    }))
  };

  await fs.mkdir("public", { recursive: true });
  await fs.writeFile(
    "public/comments.json",
    JSON.stringify(output, null, 2),
    "utf8"
  );

  console.log(`Generated public/comments.json with ${comments.length} comments.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
