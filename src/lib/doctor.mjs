import { existsSync } from "node:fs";
import { loadConfig, loadModels, pluginRoot } from "./config.mjs";
import { runCommand } from "./process.mjs";
import { commandParts } from "../adapters/base.mjs";
import { listModels } from "./models.mjs";
import { resolveZCodeSelection } from "./zcode-model.mjs";
import { bindModelsToCcSwitch, ccSwitchSkillStatus, ccswitchRoutingAudit, readCcSwitchSnapshot } from "./ccswitch.mjs";
import { resolveCaptain } from "./captain.mjs";

async function probe(label, commandConfig, versionArgs) {
  const { command, args } = commandParts(commandConfig);
  const result = await runCommand({
    command,
    args: [...args, ...versionArgs],
    timeoutMs: 15000,
    maxOutputBytes: 1024 * 1024,
    stripSecretEnv: true
  });
  return {
    label,
    command,
    args,
    available: result.ok,
    version: (result.stdout || result.stderr || "").trim().split(/\r?\n/)[0] || null,
    error: result.ok ? null : (result.stderr || `exit ${result.code}`).trim()
  };
}

export async function doctor() {
  const config = loadConfig();
  const zcodeScript = config.commands?.zcode?.args?.[0];
  const [kimi, zcode, dsh, dshProfile] = await Promise.all([
    probe("kimi", config.commands.kimi, ["--version"]),
    probe("zcode", config.commands.zcode, ["--version"]),
    probe("dsh", config.commands.dsh, ["--version"]),
    runCommand({
      command: commandParts(config.commands.dsh).command,
      args: [...commandParts(config.commands.dsh).args, "--profile", config.profiles?.dsh?.fast ?? "headless", "--help"],
      timeoutMs: 15000,
      maxOutputBytes: 1024 * 1024,
      stripSecretEnv: true
    })
  ]);

  const models = loadModels();
  let ccswitch = { available: false };
  let ccSwitchSnapshot = null;
  try {
    const snapshot = await readCcSwitchSnapshot();
    ccSwitchSnapshot = snapshot;
    ccswitch = {
      available: snapshot.available,
      settings: snapshot.settings,
      currentProviders: snapshot.currentProviders,
      skill: ccSwitchSkillStatus(snapshot, "codex-moa"),
      routingAudit: ccswitchRoutingAudit(snapshot, models),
      modelBindings: bindModelsToCcSwitch(snapshot, models)
    };
  } catch (error) {
    ccswitch = { available: false, error: error.message };
  }
  const zcodeSelections = {};
  for (const model of ["GLM-5.3", "GLM-5.3-Flash"]) {
    try {
      const selection = await resolveZCodeSelection({ model, config });
      zcodeSelections[model] = {
        provider: selection.providerId,
        model: selection.modelKey,
        modelRef: `${selection.providerId}/${selection.modelKey}`,
        baseURL: selection.provider?.options?.baseURL,
        apiKeyPresent: Boolean(selection.provider?.options?.apiKey)
      };
    } catch (error) {
      zcodeSelections[model] = { error: error.message };
    }
  }

  let captain;
  try {
    captain = await resolveCaptain({ ccswitchSnapshot: ccSwitchSnapshot });
  } catch (error) {
    captain = { model: "unknown", source: "error", error: error.message };
  }

  return {
    pluginRoot,
    captain,
    commands: { kimi, zcode, dsh },
    models: listModels(models).map((model) => ({ id: model.id, harness: model.harness, tier: model.tier })),
    ccswitch,
    continuity: {
      kimi: "cli-session-resume + acp-session-resume",
      zcode: "cli-session-resume + app-server bridge",
      dsh: "acp-session-resume"
    },
    zcodeSelections,
    checks: {
      zcodeScriptExists: zcodeScript ? existsSync(zcodeScript) : false,
      dshHeadlessProfileAvailable: dshProfile.ok,
      kimiAuthenticatedHint: "Run `kimi provider list` if --version succeeds but requests fail.",
      dshAuthenticatedHint: "Run a small `dsh --profile headless \"reply ok\"` probe before enabling audits.",
      zcodeAuthenticatedHint: "Run ZCode once or use its provider settings before headless execution."
    }
  };
}
