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

function numericVersion(value) {
  const match = String(value ?? "").match(/(?:^|\s)(\d+)\.(\d+)\.(\d+)(?:\s|$|\))/);
  return match ? match.slice(1).map(Number) : null;
}

function versionAtLeast(actual, minimum) {
  const left = numericVersion(actual);
  const right = numericVersion(minimum);
  if (!left || !right) return null;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return true;
    if (left[index] < right[index]) return false;
  }
  return true;
}

export async function doctor({ checkLatest = false } = {}) {
  const config = loadConfig();
  const zcodeScript = config.commands?.zcode?.args?.[0];
  const [kimi, zcode, dsh, pi, claude, codex, claudeHelp, codexHelp, piHelp, dshProfile] = await Promise.all([
    probe("kimi", config.commands.kimi, ["--version"]),
    probe("zcode", config.commands.zcode, ["--version"]),
    probe("dsh", config.commands.dsh, ["--version"]),
    probe("pi", config.commands.pi, ["--version"]),
    probe("claude", config.commands.claude, ["--version"]),
    probe("codex", config.commands.codex, ["--version"]),
    runCommand({ command: commandParts(config.commands.claude).command, args: [...commandParts(config.commands.claude).args, "--help"], timeoutMs: 15000, stripSecretEnv: true }),
    runCommand({ command: commandParts(config.commands.codex).command, args: [...commandParts(config.commands.codex).args, "exec", "--help"], timeoutMs: 15000, stripSecretEnv: true }),
    runCommand({ command: commandParts(config.commands.pi).command, args: [...commandParts(config.commands.pi).args, "--help"], timeoutMs: 15000, stripSecretEnv: true }),
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

  const installedCommands = { pi, claude, codex };
  const minimumVersions = config.cliLifecycle?.minimumVersions ?? {};
  const packages = config.cliLifecycle?.packages ?? {};
  const latest = checkLatest ? Object.fromEntries(await Promise.all(Object.entries(packages).map(async ([name, packageName]) => {
    const result = await runCommand({ command: "npm", args: ["view", packageName, "version", "--json"], timeoutMs: 15000, stripSecretEnv: true });
    let version = null;
    if (result.ok) {
      try { version = JSON.parse(result.stdout); } catch { version = result.stdout.trim().replaceAll('"', ""); }
    }
    return [name, { package: packageName, available: result.ok, version, error: result.ok ? null : result.stderr.trim() }];
  }))) : {};
  const cliLifecycle = {
    policy: config.cliLifecycle?.policy ?? "detect-only",
    upgradeOwner: config.cliLifecycle?.upgradeOwner ?? "cc-switch-or-user",
    autoUpgrade: false,
    commands: Object.fromEntries(Object.entries(installedCommands).map(([name, result]) => {
      const minimum = minimumVersions[name] ?? null;
      const meetsMinimum = minimum ? versionAtLeast(result.version, minimum) : null;
      const latestVersion = latest[name]?.version ?? null;
      const upToDate = latestVersion ? versionAtLeast(result.version, latestVersion) : null;
      return [name, {
        available: result.available,
        installedVersion: result.version,
        minimumVersion: minimum,
        meetsMinimum,
        latestVersion,
        upToDate,
        package: packages[name] ?? null,
        action: !result.available ? "install" : meetsMinimum === false || upToDate === false ? "upgrade" : "none"
      }];
    }))
  };
  cliLifecycle.latestCheckPerformed = checkLatest;
  const helpText = {
    claude: `${claudeHelp.stdout}\n${claudeHelp.stderr}`,
    codex: `${codexHelp.stdout}\n${codexHelp.stderr}`,
    pi: `${piHelp.stdout}\n${piHelp.stderr}`
  };
  const cliCapabilities = {
    claude: {
      json: /--output-format/.test(helpText.claude),
      effort: /--effort/.test(helpText.claude),
      restricted: /--restricted/.test(helpText.claude),
      isolatedSettings: /--settings/.test(helpText.claude)
    },
    codex: {
      json: /--json/.test(helpText.codex),
      sandbox: /--sandbox/.test(helpText.codex),
      worktree: /--worktree/.test(helpText.codex),
      ephemeral: /--ephemeral/.test(helpText.codex)
    },
    pi: {
      json: /--mode <mode>/.test(helpText.pi),
      effort: /--thinking/.test(helpText.pi),
      toolAllowlist: /--tools/.test(helpText.pi),
      isolatedHome: /PI_CODING_AGENT_DIR/.test(helpText.pi)
    }
  };

  return {
    pluginRoot,
    captain,
    commands: { kimi, zcode, dsh, pi, claude, codex },
    cliLifecycle,
    cliCapabilities,
    models: listModels(models).map((model) => ({ id: model.id, harness: model.harness, tier: model.tier })),
    ccswitch,
    continuity: {
      kimi: "cli-session-resume + acp-session-resume",
      zcode: "cli-session-resume + app-server bridge",
      dsh: "acp-session-resume",
      pi: "cli-session-id",
      claude: "cli-resume",
      codex: "ephemeral"
    },
    zcodeSelections,
    checks: {
      zcodeScriptExists: zcodeScript ? existsSync(zcodeScript) : false,
      dshHeadlessProfileAvailable: dshProfile.ok,
      kimiAuthenticatedHint: "Run `kimi provider list` if --version succeeds but requests fail.",
      dshAuthenticatedHint: "Run a small `dsh --profile headless \"reply ok\"` probe before enabling audits.",
      piAuthenticatedHint: "Run `pi auth check --no-refresh --json` and verify kimi-coding/zai-coding-cn readiness.",
      claudeAuthenticatedHint: "CC Switch Claude cards are projected into private per-provider settings; run a read-only smoke probe before enabling a route.",
      codexAuthenticatedHint: "CC Switch Codex cards must use a direct Responses transport; run a read-only `codex exec --json` smoke probe before enabling a route.",
      zcodeAuthenticatedHint: "Run ZCode once or use its provider settings before headless execution."
    }
  };
}
