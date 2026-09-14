import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyProposal, createProposal, getProposal, rollbackProposal, updateProposalStatus } from "../src/lib/evolution.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "codex-moa-evolution-"));
  const policy = join(root, "evolution.json");
  await writeFile(policy, JSON.stringify({ version: 1, audit: { avoidCaptainFamily: false }, timeouts: { deepMs: 1000 } }), "utf8");
  const paths = {
    root: join(root, "store"),
    events: join(root, "store", "events.jsonl"),
    outcomes: join(root, "store", "outcomes.jsonl"),
    proposals: join(root, "store", "proposals"),
    backups: join(root, "store", "backups")
  };
  for (const dir of [paths.root, paths.proposals, paths.backups]) await mkdir(dir, { recursive: true });
  return { root, policy, paths };
}

test("evolution proposal requires approval and confirmation", async () => {
  const { policy, paths } = await fixture();
  const proposal = await createProposal({
    title: "Enable strict audit",
    problem: "Same-family warnings observed",
    evidence: ["auditWarnings=2"],
    policyPatch: { audit: { avoidCaptainFamily: true } }
  }, paths);

  await assert.rejects(
    () => applyProposal(proposal.id, `APPLY ${proposal.id}`, paths, policy),
    /must be approved/
  );

  await updateProposalStatus(proposal.id, "approved", `APPROVE ${proposal.id}`, `APPROVE ${proposal.id}`, paths);
  await assert.rejects(
    () => applyProposal(proposal.id, "APPLY wrong", paths, policy),
    /Confirmation mismatch/
  );

  const applied = await applyProposal(proposal.id, `APPLY ${proposal.id}`, paths, policy);
  assert.equal(applied.status, "applied");
  const updated = JSON.parse(await readFile(policy, "utf8"));
  assert.equal(updated.audit.avoidCaptainFamily, true);

  const rolledBack = await rollbackProposal(proposal.id, `ROLLBACK ${proposal.id}`, paths, policy);
  assert.equal(rolledBack.status, "rolled_back");
  const restored = JSON.parse(await readFile(policy, "utf8"));
  assert.equal(restored.audit.avoidCaptainFamily, false);
});

test("rejects unsafe evolution policy keys", async () => {
  const { paths } = await fixture();
  await assert.rejects(
    () => createProposal({
      title: "Unsafe",
      problem: "Prototype pollution attempt",
      policyPatch: JSON.parse('{"__proto__":{"polluted":true}}')
    }, paths),
    /Unsafe policy key/
  );
});
