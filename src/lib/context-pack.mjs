import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "./process.mjs";

const STOP_WORDS = new Set(["the", "and", "for", "with", "this", "that", "from", "into", "代码", "任务", "实现", "修复", "优化"]);

function keywords(task) {
  return [...new Set(String(task).toLowerCase().match(/[a-zA-Z0-9_./-]{3,}|[\u4e00-\u9fff]{2,}/g) ?? [])]
    .filter((word) => !STOP_WORDS.has(word))
    .slice(0, 40);
}

function estimateTokens(text) {
  return Math.ceil(String(text).length / 4);
}

export async function buildContextPack({ cwd, task, maxFiles = 20, maxTotalTokens = 32000 }) {
  const listed = await runCommand({ command: "git", args: ["ls-files"], cwd, timeoutMs: 20000, maxOutputBytes: 4 * 1024 * 1024 });
  if (!listed.ok) return { files: [], totalTokens: 0, keywords: keywords(task), supported: false };
  const terms = keywords(task);
  const candidates = [];
  for (const rel of listed.stdout.split(/\r?\n/).filter(Boolean)) {
    const lower = rel.toLowerCase();
    let score = 0;
    for (const term of terms) if (lower.includes(term)) score += 8;
    if (/(^|\/)(src|lib|app|packages)\//.test(lower)) score += 2;
    if (/test|spec/.test(lower)) score += 1;
    if (/readme|license|lock|\.png|\.jpg|\.jpeg|\.gif|\.svg/.test(lower)) score -= 4;
    if (score <= 0) continue;
    let content = "";
    try { content = await readFile(join(cwd, rel), "utf8"); } catch {}
    for (const term of terms) if (content.toLowerCase().includes(term)) score += 2;
    candidates.push({ path: rel, score, size: content.length, hash: createHash("sha256").update(content).digest("hex").slice(0, 16), excerpt: content.slice(0, 1200) });
  }
  candidates.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const files = [];
  let totalTokens = 0;
  for (const file of candidates) {
    const tokens = estimateTokens(file.excerpt);
    if (files.length >= maxFiles || totalTokens + tokens > maxTotalTokens) break;
    files.push({ ...file, estimatedTokens: tokens, reason: `keyword-score:${file.score}` });
    totalTokens += tokens;
  }
  return { supported: true, keywords: terms, files, totalTokens };
}

export function renderContextPack(pack) {
  if (!pack?.files?.length) return "";
  return [
    "## Context Pack",
    `Estimated tokens: ${pack.totalTokens}`,
    ...pack.files.map((file) => `- ${file.path} (${file.estimatedTokens} tokens, ${file.reason})`)
  ].join("\n");
}
