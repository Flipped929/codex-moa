import { runKimiSeat } from "./kimi.mjs";
import { runZCodeSeat } from "./zcode.mjs";
import { runDshSeat } from "./dsh.mjs";
import { runPiSeat } from "./pi.mjs";
import { runClaudeSeat } from "./claude.mjs";
import { runCodexSeat } from "./codex.mjs";

export function getAdapter(harness) {
  if (harness === "kimi") return runKimiSeat;
  if (harness === "zcode") return runZCodeSeat;
  if (harness === "dsh") return runDshSeat;
  if (harness === "pi") return runPiSeat;
  if (harness === "claude") return runClaudeSeat;
  if (harness === "codex") return runCodexSeat;
  throw new Error(`Unknown harness: ${harness}`);
}
