import { loadConfig } from "./config.mjs";
import { loadEffectiveModels } from "./effective-models.mjs";
import { createExplicitSeat, listModels, resolveModel } from "./models.mjs";
import { resolveReasoningEffort } from "./reasoning.mjs";
import { readCcSwitchSnapshot } from "./ccswitch.mjs";
import { getAdapter } from "../adapters/index.mjs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { runtimeCapabilities } from "./runtime-contract.mjs";

function routeMetadata(model, harness, snapshot) {
  const route = model[harness];
  if (!route?.provider) return { configured: false };
  const provider = snapshot?.providers?.find((item) => item.appType === harness && item.id === route.provider);
  const entry = provider?.modelEntries?.find((item) => item.id === route.model || item.name === route.model) ?? null;
  return {
    configured: Boolean(provider),
    providerId: route.provider,
    providerName: provider?.name ?? null,
    model: route.model,
    apiFormat: provider?.apiFormat ?? null,
    transport: provider?.transport?.routingMode ?? null,
    cardCapabilities: entry ? {
      contextWindow: entry.contextWindow,
      maxOutputTokens: entry.maxTokens,
      reasoningLevels: entry.levels,
      defaultReasoningLevel: entry.defaultLevel,
      input: entry.input,
      reasoningEnabled: entry.reasoningEnabled
    } : null
  };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function redPng(width = 32, height = 32) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), ...Array.from({ length: width }, () => Buffer.from([255, 0, 0]))]);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

export async function capabilityMatrix() {
  const snapshot = await readCcSwitchSnapshot().catch(() => null);
  const modelsConfig = loadEffectiveModels({ snapshot });
  return {
    source: "cc-switch-readonly+vendor-policy",
    probedAt: new Date().toISOString(),
    models: listModels(modelsConfig).map((model) => ({
      id: model.id,
      family: model.family,
      defaultHarness: model.harness,
      supportedHarnesses: model.supportedHarnesses ?? [model.harness],
      capabilities: model.capabilities ?? [],
      reasoning: model.reasoning,
      limits: model.limits,
      runtime: Object.fromEntries((model.supportedHarnesses ?? [model.harness]).map((harness) => [harness, runtimeCapabilities(harness)])),
      routes: Object.fromEntries((model.supportedHarnesses ?? [model.harness])
        .filter((harness) => ["pi", "claude", "codex"].includes(harness))
        .map((harness) => [harness, routeMetadata(model, harness, snapshot)]))
    }))
  };
}

export async function liveCapabilityProbe({ model: selector, harness = "pi", cwd = process.cwd(), reasoningEffort, timeoutMs = 60000, feature = "text-tool" } = {}) {
  const config = loadConfig();
  const modelsConfig = loadEffectiveModels();
  const model = resolveModel(selector, modelsConfig);
  if (!(model.supportedHarnesses ?? [model.harness]).includes(harness)) {
    throw new Error(`${model.id} does not support harness=${harness}`);
  }
  const effort = resolveReasoningEffort(model.id, reasoningEffort ?? model.reasoning?.default, modelsConfig);
  const seat = createExplicitSeat({
    model: model.id,
    harness,
    role: "reviewer",
    mode: "plan",
    reasoningEffort: effort,
    cwd,
    maxTurns: 3
  }, 0, modelsConfig);
  const adapter = getAdapter(harness);
  const startedAt = Date.now();
  let temporary = null;
  let prompt = "Read package.json with a read-only tool, then answer exactly: CAPABILITY_OK <package-name>. Do not edit any file.";
  let expected = /^CAPABILITY_OK\s+\S+/m;
  if (feature === "image") {
    if (!model.capabilities?.includes("image")) throw new Error(`${model.id} does not declare image input capability`);
    temporary = await mkdtemp(join(tmpdir(), "codex-moa-image-probe-"));
    const imagePath = join(temporary, "red.png");
    await writeFile(imagePath, redPng());
    seat.attachments = [imagePath];
    prompt = "Confirm that the image attachment was accepted, then answer exactly IMAGE_OK. Do not edit any file.";
    expected = /^IMAGE_OK$/m;
  }
  const result = await adapter({ seat, prompt, config, timeoutMs, allowWrite: false }).finally(async () => {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  });
  return {
    model: model.id,
    harness,
    reasoningEffort: effort,
    status: result.status,
    durationMs: Date.now() - startedAt,
    feature,
    passed: expected.test(result.summary ?? ""),
    textAndReadTool: feature === "text-tool" ? expected.test(result.summary ?? "") : null,
    imageInput: feature === "image" ? expected.test(result.summary ?? "") : null,
    usage: result.usage ?? null,
    error: result.status === "done" ? null : result.stderr,
    summary: String(result.summary ?? "").slice(0, 500)
  };
}
