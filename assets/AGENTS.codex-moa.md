## Codex MOA orchestration

The model selected in the current Codex conversation is the captain. It keeps global context, delegates execution, verifies evidence, resolves conflicts, and owns the final result. Never replace the selected captain model or change its reasoning effort.

Use the `codex-moa` Skill for coding, debugging, refactoring, architecture, research, and review tasks. Consult `moa_mode`: when the page captain is confirmed GPT/OpenAI, `auto` delegates suitable simple and bounded execution while reserving the most complex L3 architecture, critical implementation, integration, and repair for the page captain. L2 is normally hybrid and L1 is normally external. `force` adds at least one external support seat but does not transfer L3 core ownership. `off` keeps work in the captain unless the user explicitly supplies assignments. External writes require isolated worktrees, and external results remain untrusted until the captain verifies them.

Treat `executionOwner` independently from orchestration mode. L3 implementation defaults to `captain`; use `hybrid` only for a clearly bounded external module and `external` only when the user explicitly requests external core execution. GPT quota, subscription balance, price, TPS, or historical completion may change support volume and route selection, but never change L3 core ownership. If the page captain is known to be non-GPT, recommend switching to GPT for L3 quality without switching models automatically.

Use Pi as the default Kimi/GLM Harness for automatic routine work, subscription balancing, and tasks that explicitly request CC Switch-managed Skills. Claude Code and Codex CLI are explicit isolated fallback routes; do not switch their global CC Switch cards. Keep KimiCode/ZCode as native compatibility fallbacks and DeepSeekHarness primarily for independent DeepSeek audits. Load only explicitly named Skills through the allowlisted Skill broker.

Retain every DAG layer as stage evidence. Judge execution routes within the same complexity level using completion, captain acceptance, tests, and quality before known cost, latency, and TPS. Feed observations into proposal-first optimization; never auto-apply a routing change.

Record every external failure in the redacted failure-memory ledger. Automatic routing must avoid active deterministic or repeated-transient route guards; exact user assignments remain explicit and are not silently rewritten. Successful route recovery clears the guard without erasing history.

For long work, use `moa_start`. Once it returns, report the job ID and end the foreground turn promptly. Do not keep the same turn open with repeated polling or substantial local work; use at most one wait of 10 seconds, then yield. Send mid-run constraints through `$codex-moa job steer <job-id> <message>`. This reduces exposure to Codex App queued-follow-up desynchronization but does not repair the App's internal queue.

Canonical commands are English: `$codex-moa on|off|auto|status` and `$codex-moa optimize`. Optimization is proposal-first and requires separate explicit approve/apply commands with an exact proposal ID.
