const PERSISTENT_TRANSPORTS = Object.freeze({
  kimi: { transport: "native-acp", streaming: true, protocolSteer: true, resume: true, compact: false },
  dsh: { transport: "native-acp", streaming: true, protocolSteer: true, resume: true, compact: false },
  zcode: { transport: "zcode-app-server", streaming: false, steer: "boundary", resume: true, compact: false },
  pi: { transport: "pi-rpc", streaming: true, protocolSteer: true, resume: true, compact: true },
  claude: { transport: "claude-stream-resume", streaming: false, steer: "boundary", resume: true, compact: true },
  codex: { transport: "codex-exec-resume", streaming: false, steer: "boundary", resume: true, compact: false }
});

export const RUNTIME_VALUES = ["cli", "acp", "auto", "persistent", "oneshot"];

export function runtimeCapabilities(harness) {
  const persistent = PERSISTENT_TRANSPORTS[harness] ?? null;
  return {
    harness,
    modes: persistent ? ["oneshot", "persistent"] : ["oneshot"],
    transports: ["cli", ...(persistent ? [persistent.transport] : [])],
    persistent: Boolean(persistent),
    streaming: persistent?.streaming === true,
    // The transports above may support native steering, but job steering is
    // currently delivered at orchestration boundaries. Keep this capability
    // honest until the job control loop forwards messages to active seats.
    steer: "boundary",
    protocolSteer: persistent?.protocolSteer === true,
    cancel: persistent ? "active-process" : "boundary",
    resume: persistent?.resume === true,
    compact: persistent?.compact === true
  };
}

export function resolveSeatRuntime(seat = {}) {
  const requested = seat.runtime ?? "cli";
  const mode = requested === "acp" || requested === "persistent" ? "persistent"
    : requested === "oneshot" || requested === "cli" ? "oneshot"
      : requested === "auto" ? (seat.continuityKey ? "persistent" : "oneshot")
        : null;
  if (!mode) throw new Error(`Unsupported runtime: ${requested}`);
  const capabilities = runtimeCapabilities(seat.harness);
  if (mode === "persistent" && !capabilities.persistent) {
    throw new Error(`No persistent runtime configured for harness: ${seat.harness}`);
  }
  return {
    requested,
    mode,
    transport: mode === "persistent" ? capabilities.transports.at(-1) : "cli",
    capabilities
  };
}

export function applyRuntimeResolution(seat) {
  const resolved = resolveSeatRuntime(seat);
  seat.runtimeRequested = resolved.requested;
  seat.runtimeMode = resolved.mode;
  seat.runtimeTransport = resolved.transport;
  seat.controlCapability = resolved.capabilities.steer;
  return resolved;
}

export function isPersistentRuntime(seat = {}) {
  return resolveSeatRuntime(seat).mode === "persistent";
}
