#!/usr/bin/env node
import { analyzeEvolution, applyProposal, createProposal, getProposal, listProposals, proposeFromEvidence, recordOutcome, rollbackProposal, updateProposalStatus } from "../src/lib/evolution.mjs";

const [command = "status", id, ...rest] = process.argv.slice(2);
const confirmation = process.env.CODEX_MOA_EVOLUTION_CONFIRM;

async function main() {
  if (command === "status") return { analysis: await analyzeEvolution(), proposals: await listProposals() };
  if (command === "propose") return proposeFromEvidence();
  if (command === "list") return listProposals();
  if (command === "get") return getProposal(id);
  if (command === "approve") return updateProposalStatus(id, "approved", confirmation, `APPROVE ${id}`);
  if (command === "reject") return updateProposalStatus(id, "rejected", confirmation, `REJECT ${id}`);
  if (command === "apply") return applyProposal(id, confirmation);
  if (command === "rollback") return rollbackProposal(id, confirmation);
  if (command === "record") {
    return recordOutcome({
      taskId: id,
      accepted: rest.includes("--accepted"),
      testsPassed: rest.includes("--tests-passed"),
      quality: rest.find((item) => item.startsWith("--quality="))?.split("=")[1],
      stage: rest.find((item) => item.startsWith("--stage="))?.split("=")[1] ?? "final",
      notes: rest.filter((item) => !item.startsWith("--")).join(" ")
    });
  }
  if (command === "draft") {
    return createProposal(JSON.parse(rest.join(" ") || "{}"));
  }
  throw new Error(`Unknown command: ${command}`);
}

const result = await main();
console.log(JSON.stringify(result, null, 2));
