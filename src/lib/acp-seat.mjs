import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { buildEnv } from "./process.mjs";
import { commandParts } from "../adapters/base.mjs";
import { prepareDshHome } from "./dsh-home.mjs";
import { syncZCodeSelection } from "./zcode-model.mjs";
import { prepareZCodeHome } from "./zcode-home.mjs";
import { pendingCancellationFor, resolveControlRequest } from "./control-store.mjs";

const seats = new Map();
const DEFAULT_POLL_MS = 500;

function killTree(child, signal = "SIGTERM") {
  if (!child?.pid) return;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {}
  if (signal === "SIGTERM") setTimeout(() => killTree(child, "SIGKILL"), 2000).unref?.();
}

function textFromUpdate(update) {
  if (update?.sessionUpdate !== "agent_message_chunk") return "";
  if (update.content?.type === "text") return update.content.text ?? "";
  return "";
}

function normalizeUsage(usage) {
  if (!usage) return null;
  return {
    inputTokens: usage.inputTokens ?? usage.input_tokens ?? null,
    outputTokens: usage.outputTokens ?? usage.output_tokens ?? null,
    totalTokens: usage.totalTokens ?? usage.total_tokens ?? null,
    reasoningTokens: usage.thoughtTokens ?? usage.reasoningTokens ?? usage.reasoning_tokens ?? null,
    cacheReadTokens: usage.cachedReadTokens ?? usage.cacheReadTokens ?? null,
    cacheWriteTokens: usage.cachedWriteTokens ?? usage.cacheWriteTokens ?? null,
    contextUsed: usage.contextUsed ?? usage.used ?? null,
    contextWindow: usage.contextWindow ?? usage.size ?? null
  };
}

export class AcpSeat {
  constructor({ key, taskId, seat, harness, model, command, args, cwd, writeAllowed, timeoutMs, env = {} }) {
    this.runtime = "acp";
    this.key = key;
    this.taskId = taskId ?? null;
    this.seat = seat;
    this.harness = harness;
    this.model = model;
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.writeAllowed = writeAllowed;
    this.timeoutMs = timeoutMs;
    this.env = env;
    this.updates = [];
    this.child = null;
    this.connection = null;
    this.agent = null;
    this.sessionId = null;
    this.startedAt = null;
    this.promptActive = false;
    this.cancelRequested = false;
    this.contextUsage = null;
    this.exit = null;
  }

  async start() {
    if (this.agent && !this.connection?.signal?.aborted) return;
    this.child = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: buildEnv(this.env, true),
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "inherit"]
    });
    this.startedAt = new Date().toISOString();
    this.child.once("exit", (code, signal) => {
      this.exit = { code, signal, at: new Date().toISOString() };
    });
    const input = Writable.toWeb(this.child.stdin);
    const output = Readable.toWeb(this.child.stdout);
    const stream = acp.ndJsonStream(input, output);
    const app = acp.client({ name: "codex-moa" })
      .onNotification(acp.methods.client.session.update, (ctx) => {
        const update = ctx.params.update;
        this.updates.push(update);
        if (update?.sessionUpdate === "usage_update") {
          this.contextUsage = {
            used: update.used ?? null,
            size: update.size ?? null,
            cost: update.cost ?? null
          };
        }
        return {};
      })
      .onRequest(acp.methods.client.session.requestPermission, (ctx) => {
        const options = ctx.params.options ?? [];
        if (this.cancelRequested) return { outcome: { outcome: "cancelled" } };
        const desired = this.writeAllowed
          ? options.find((option) => option.kind === "allow_once" || option.kind === "allow_always")
          : options.find((option) => option.kind === "reject_once" || option.kind === "reject_always");
        if (!desired) return { outcome: { outcome: "cancelled" } };
        return { outcome: { outcome: "selected", optionId: desired.optionId } };
      });
    this.connection = app.connect(stream);
    this.agent = this.connection.agent;
    await this.agent.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {}
    });
  }

  async ensureSession(resumeSessionId) {
    if (this.sessionId && (!resumeSessionId || this.sessionId === resumeSessionId)) return this.sessionId;
    if (resumeSessionId) {
      try {
        await this.agent.request(acp.methods.agent.session.resume, {
          sessionId: resumeSessionId,
          cwd: this.cwd,
          additionalDirectories: [],
          mcpServers: []
        });
        this.sessionId = resumeSessionId;
        return this.sessionId;
      } catch {}
    }
    const created = await this.agent.request(acp.methods.agent.session.new, {
      cwd: this.cwd,
      additionalDirectories: [],
      mcpServers: []
    });
    this.sessionId = created.sessionId;
    return this.sessionId;
  }

  async prompt({ prompt, resumeSessionId }) {
    this.cancelRequested = false;
    await this.start();
    const sessionId = await this.ensureSession(resumeSessionId);
    this.updates = [];
    this.contextUsage = null;
    if (this.cancelRequested) return { sessionId, text: "", stopReason: "cancelled", usage: null };
    this.promptActive = true;
    try {
      const response = await this.agent.request(acp.methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: "text", text: prompt }]
      });
      const text = this.updates.map(textFromUpdate).join("").trim();
      let usage = normalizeUsage(response.usage) ?? (
        this.contextUsage
          ? { inputTokens: null, outputTokens: null, totalTokens: null, reasoningTokens: null, cacheReadTokens: null, cacheWriteTokens: null, contextUsed: this.contextUsage.used, contextWindow: this.contextUsage.size }
          : null
      );
      if (usage && this.contextUsage) {
        usage.contextUsed ??= this.contextUsage.used;
        usage.contextWindow ??= this.contextUsage.size;
      }
      return { sessionId, text, stopReason: response.stopReason ?? null, usage, contextUsage: this.contextUsage };
    } finally {
      this.promptActive = false;
    }
  }

  async cancel() {
    this.cancelRequested = true;
    if (!this.sessionId || !this.agent) return true;
    await this.agent.notify(acp.methods.agent.session.cancel, { sessionId: this.sessionId });
    return true;
  }

  stop() {
    this.promptActive = false;
    killTree(this.child);
    this.connection?.close?.();
    this.child = null;
    this.connection = null;
    this.agent = null;
    this.sessionId = null;
  }
}

export class ZCodeSeat {
  constructor({ key, taskId, seat, model, command, args, cwd, writeAllowed, env = {}, selection = {} }) {
    this.runtime = "zcode-app-server";
    this.key = key;
    this.taskId = taskId ?? null;
    this.seat = seat;
    this.harness = "zcode";
    this.model = model;
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.writeAllowed = writeAllowed;
    this.env = env;
    this.selection = selection;
    this.child = null;
    this.buffer = "";
    this.pending = new Map();
    this.nextRequestId = 1;
    this.sessionId = null;
    this.startedAt = null;
    this.promptActive = false;
    this.cancelRequested = false;
    this.exit = null;
    this.lastProjection = null;
  }

  workspace() {
    return { workspacePath: this.cwd, workspaceKey: this.cwd };
  }

  send(message) {
    if (!this.child?.stdin?.writable) throw new Error("ZCode app-server is not writable");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async request(method, params, timeoutMs = 30000) {
    const id = this.nextRequestId++;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(String(id));
        reject(new Error(`ZCode Protocol request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(String(id), (message) => {
        clearTimeout(timer);
        if (message.error) {
          const error = new Error(message.error.message ?? `ZCode Protocol error for ${method}`);
          error.code = message.error.code;
          error.data = message.error.data;
          reject(error);
        } else {
          resolve(message.result);
        }
      });
    });
    this.send({ id, method, params });
    return promise;
  }

  async respond(id, result) {
    this.send({ id, result });
  }

  async reject(id, code, message) {
    this.send({ id, error: { code, message } });
  }

  handleMessage(message) {
    if (message.id !== undefined && message.method) {
      void this.handleServerRequest(message);
      return;
    }
    if (message.id !== undefined && this.pending.has(String(message.id))) {
      this.pending.get(String(message.id))(message);
      this.pending.delete(String(message.id));
    }
  }

  async handleServerRequest(message) {
    try {
      if (message.method === "session/requestRuntimePreferences") {
        await this.respond(message.id, {
          nativeSearchEnhancementsEnabled: false,
          memoryEnabled: false,
          askUserQuestionAutoResolutionEnabled: true,
          modelContextBudgetStrategy: "preflight-v1"
        });
        return;
      }
      if (message.method === "interaction/requestProviderRuntimeHeaders") {
        await this.respond(message.id, { ok: true, headers: {} });
        return;
      }
      if (message.method === "interaction/requestPermission") {
        await this.respond(message.id, { action: this.writeAllowed ? "accept" : "decline", reason: this.writeAllowed ? "codex-moa approved" : "codex-moa read-only" });
        return;
      }
      if (message.method === "interaction/requestUserInput") {
        await this.respond(message.id, { action: "cancel", reason: "codex-moa cannot answer interactive follow-up questions" });
        return;
      }
      await this.reject(message.id, -32601, `Unsupported ZCode app-server request: ${message.method}`);
    } catch (error) {
      await this.reject(message.id, -32603, error.message).catch(() => {});
    }
  }

  async start() {
    if (this.child?.stdin?.writable) return;
    this.child = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: buildEnv(this.env, true),
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "inherit"]
    });
    this.startedAt = new Date().toISOString();
    this.child.stdout.on("data", (chunk) => {
      this.buffer += chunk.toString("utf8");
      let index;
      while ((index = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, index).trim();
        this.buffer = this.buffer.slice(index + 1);
        if (!line) continue;
        try {
          this.handleMessage(JSON.parse(line));
        } catch {}
      }
    });
    this.child.once("exit", (code, signal) => {
      this.exit = { code, signal, at: new Date().toISOString() };
      for (const [id, rejectPending] of this.pending.entries()) {
        rejectPending({ error: { message: `ZCode app-server exited before responding to ${id}` } });
      }
      this.pending.clear();
    });
  }

  async ensureSession(resumeSessionId) {
    if (this.sessionId && (!resumeSessionId || this.sessionId === resumeSessionId)) return this.sessionId;
    const selected = this.selection?.providerId && this.selection?.modelKey
      ? { providerId: this.selection.providerId, modelId: this.selection.modelKey }
      : undefined;
    if (resumeSessionId) {
      try {
        const resumed = await this.request("session/resume", { sessionId: resumeSessionId, workspace: this.workspace(), model: selected }, 30000);
        this.sessionId = resumed?.session?.sessionId ?? resumed?.sessionId ?? resumeSessionId;
        await this.subscribe().catch(() => {});
        return this.sessionId;
      } catch {}
    }
    const created = await this.request("session/create", {
      workspace: this.workspace(),
      mode: this.writeAllowed ? "build" : "plan",
      ...(selected ? { model: selected } : {})
    }, 30000);
    this.sessionId = created?.session?.sessionId;
    if (!this.sessionId) throw new Error("ZCode app-server did not return a session id");
    await this.subscribe().catch(() => {});
    return this.sessionId;
  }

  async subscribe() {
    if (!this.sessionId) return null;
    return this.request("session/subscribe", {
      sessionId: this.sessionId,
      deliveryKind: "web-remote-replayable"
    }, 30000);
  }

  async readSession() {
    return this.request("session/read", { sessionId: this.sessionId }, 30000);
  }

  async readMessages() {
    return this.request("session/messages", { sessionId: this.sessionId }, 30000);
  }

  async waitForTurn(initialTurnCount) {
    while (true) {
      const snapshot = await this.readSession();
      const projection = snapshot?.projection ?? {};
      this.lastProjection = {
        status: projection.status,
        turnCount: projection.turnCount,
        totalTokenCount: projection.totalTokenCount,
        contextUsed: projection.contextUsed,
        contextWindow: projection.contextWindow
      };
      if (this.cancelRequested) return { status: "cancelled", snapshot };
      if (projection.status === "error") return { status: "error", snapshot };
      if ((projection.turnCount ?? 0) > initialTurnCount && projection.status !== "running") {
        return { status: projection.status ?? "idle", snapshot };
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  extractMessages(raw) {
    const messages = raw?.messages ?? [];
    const assistantText = [];
    let usage = null;
    for (const message of messages) {
      if (message.info?.role !== "assistant") continue;
      const parts = message.parts ?? [];
      const text = parts.filter((part) => part.type === "text").map((part) => part.text ?? "").join("").trim();
      if (text) assistantText.push(text);
      if (message.info?.tokens) {
        usage = {
          inputTokens: message.info.tokens.input ?? null,
          outputTokens: message.info.tokens.output ?? null,
          totalTokens: (message.info.tokens.input ?? 0) + (message.info.tokens.output ?? 0) || null,
          reasoningTokens: message.info.tokens.reasoning ?? null,
          cacheReadTokens: message.info.tokens.cache?.read ?? null,
          cacheWriteTokens: message.info.tokens.cache?.write ?? null
        };
      }
      if (message.info?.error && assistantText.length === 0) {
        const error = message.info.error;
        const data = error.data ?? {};
        assistantText.push([
          data.message ?? error.name ?? "ZCode model request failed",
          data.code ? `code=${data.code}` : null,
          data.providerCode ? `providerCode=${data.providerCode}` : null,
          data.providerMessage ? `providerMessage=${data.providerMessage}` : null
        ].filter(Boolean).join(" · "));
      }
    }
    return { text: assistantText.join("\n").trim(), usage };
  }

  async prompt({ prompt, resumeSessionId }) {
    this.cancelRequested = false;
    await this.start();
    const sessionId = await this.ensureSession(resumeSessionId);
    const before = await this.readSession();
    const initialTurnCount = before?.projection?.turnCount ?? 0;
    if (this.cancelRequested) return { sessionId, text: "", stopReason: "cancelled", usage: null };
    this.promptActive = true;
    try {
      await this.request("session/send", { sessionId, content: prompt }, 30000);
      const outcome = await this.waitForTurn(initialTurnCount);
      const raw = await this.readMessages();
      const extracted = this.extractMessages(raw);
      const projection = outcome.snapshot?.projection ?? {};
      return {
        sessionId,
        text: extracted.text,
        stopReason: outcome.status === "cancelled" ? "cancelled" : outcome.status === "error" ? "error" : "end_turn",
        usage: extracted.usage ? {
          ...extracted.usage,
          contextUsed: projection.contextUsed ?? null,
          contextWindow: projection.contextWindow ?? null
        } : null,
        contextUsage: {
          used: projection.contextUsed ?? null,
          size: projection.contextWindow ?? null,
          cost: null
        }
      };
    } finally {
      this.promptActive = false;
    }
  }

  async cancel() {
    this.cancelRequested = true;
    if (!this.sessionId) return false;
    try {
      await this.request("session/stop", { sessionId: this.sessionId }, 10000);
      return true;
    } catch {
      this.stop();
      return false;
    }
  }

  stop() {
    this.promptActive = false;
    killTree(this.child);
    this.child = null;
    this.sessionId = null;
    this.pending.clear();
  }
}

export function acpCommandFor(harness, config, seat = {}) {
  const explicit = config.acp?.commands?.[harness];
  if (explicit) return commandParts(explicit);
  if (harness === "kimi") {
    const base = commandParts(config.commands.kimi);
    return { command: base.command, args: [...base.args, "-m", seat.providerModel ?? seat.model, "acp"] };
  }
  if (harness === "dsh") {
    const base = commandParts(config.commands.dsh);
    return { command: base.command, args: [...base.args, "--profile", "acp"] };
  }
  if (harness === "zcode") {
    const base = commandParts(config.commands.zcode);
    return { command: base.command, args: [...base.args, "app-server"] };
  }
  throw new Error(`No ACP command configured for harness: ${harness}`);
}

function seatKey(seat) {
  return seat.continuityKeyResolved ?? `${seat.taskId ?? "task"}:${seat.seat}:${seat.harness}:${seat.model}`;
}

async function createSeat({ seat, config, allowWrite, timeoutMs }) {
  const env = {};
  let selection = null;
  if (seat.harness === "kimi") {
    if (seat.reasoningEffort) env.KIMI_MODEL_THINKING_EFFORT = seat.reasoningEffort;
    if (seat.contextBudget) env.KIMI_MODEL_MAX_CONTEXT_SIZE = String(seat.contextBudget);
    if (seat.outputBudget) {
      env.KIMI_MODEL_MAX_OUTPUT_SIZE = String(seat.outputBudget);
      env.KIMI_MODEL_MAX_COMPLETION_TOKENS = String(seat.outputBudget);
    }
  } else if (seat.harness === "dsh") {
    const dshHome = await prepareDshHome(seat.reasoningEffort ?? null, {
      outputBudget: seat.outputBudget,
      provider: seat.dsh?.provider,
      model: seat.dsh?.model
    });
    env.DSH_HOME = dshHome.home;
  } else if (seat.harness === "zcode") {
    const zcodeHome = await prepareZCodeHome(config);
    env.HOME = zcodeHome.home;
    selection = await syncZCodeSelection({
      model: seat.providerModel ?? seat.model,
      reasoningEffort: seat.reasoningEffort,
      contextBudget: seat.contextBudget,
      outputBudget: seat.outputBudget,
      config: { ...config, zcode: { ...(config.zcode ?? {}), cliConfig: zcodeHome.cliConfigPath } }
    });
  }
  const command = acpCommandFor(seat.harness, config, seat);
  const key = seatKey(seat);
  if (seat.harness === "zcode") {
    return new ZCodeSeat({
      key,
      taskId: seat.taskId,
      seat: seat.seat,
      model: seat.model,
      command: command.command,
      args: command.args,
      cwd: seat.cwd,
      writeAllowed: allowWrite && seat.autoApprove,
      env,
      selection
    });
  }
  return new AcpSeat({
    key,
    taskId: seat.taskId,
    seat: seat.seat,
    harness: seat.harness,
    model: seat.model,
    command: command.command,
    args: command.args,
    cwd: seat.cwd,
    writeAllowed: allowWrite && seat.autoApprove,
    timeoutMs,
    env
  });
}

export async function runAcpSeat({ seat, prompt, config, timeoutMs, allowWrite = false }) {
  const key = seatKey(seat);
  let seatProcess = seats.get(key);
  if (!seatProcess) {
    seatProcess = await createSeat({ seat, config, allowWrite, timeoutMs });
    seats.set(key, seatProcess);
  }
  let controlRequest = null;
  let polling = false;
  const interval = setInterval(async () => {
    if (polling || controlRequest) return;
    polling = true;
    try {
      controlRequest = await pendingCancellationFor({ taskId: seat.taskId ?? null, seat: seat.seat, key });
      if (controlRequest) await seatProcess.cancel();
    } finally {
      polling = false;
    }
  }, Number(config.control?.pollMs ?? DEFAULT_POLL_MS));
  interval.unref?.();
  let timeoutHandle = null;
  try {
    const result = await Promise.race([
      seatProcess.prompt({ prompt, resumeSessionId: seat.continuitySessionId }),
      new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(`ACP seat timed out after ${timeoutMs}ms`)), timeoutMs);
        timeoutHandle.unref?.();
      })
    ]);
    if (controlRequest) {
      await resolveControlRequest(controlRequest.id, { status: "fulfilled", detail: { taskId: seat.taskId, seat: seat.seat, result: result.stopReason } });
    }
    return result;
  } catch (error) {
    seatProcess.stop();
    seats.delete(key);
    if (controlRequest) await resolveControlRequest(controlRequest.id, { status: "failed", detail: { error: error.message } });
    throw error;
  } finally {
    clearInterval(interval);
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

export async function cancelAcpSeats(filter = {}) {
  const matches = [];
  for (const [key, seat] of seats.entries()) {
    if (filter.key && key !== filter.key) continue;
    if (filter.taskId && seat.taskId !== filter.taskId) continue;
    if (filter.seat && seat.seat !== filter.seat) continue;
    if (!seat.child) continue;
    let cancelled = false;
    let error = null;
    try {
      cancelled = await seat.cancel();
    } catch (cancelError) {
      error = cancelError?.message ?? String(cancelError);
    }
    matches.push({ key, taskId: seat.taskId, seat: seat.seat, harness: seat.harness, sessionId: seat.sessionId, cancelled, error });
  }
  return matches;
}

export async function stopAcpSeats() {
  for (const seat of seats.values()) seat.stop();
  seats.clear();
}

export function listAcpSeats() {
  return [...seats.entries()].map(([key, seat]) => ({
    key,
    taskId: seat.taskId ?? null,
    seat: seat.seat ?? null,
    harness: seat.harness ?? null,
    model: seat.model ?? null,
    runtime: seat.runtime,
    pid: seat.child?.pid ?? null,
    sessionId: seat.sessionId,
    alive: Boolean(seat.child && !seat.exit),
    promptActive: seat.promptActive === true,
    cancelRequested: seat.cancelRequested === true,
    startedAt: seat.startedAt,
    lastProjection: seat.lastProjection ?? null
  }));
}
