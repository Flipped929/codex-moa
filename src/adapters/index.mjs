import { runKimiSeat } from "./kimi.mjs";
import { runZCodeSeat } from "./zcode.mjs";
import { runDshSeat } from "./dsh.mjs";

export function getAdapter(harness) {
  if (harness === "kimi") return runKimiSeat;
  if (harness === "zcode") return runZCodeSeat;
  if (harness === "dsh") return runDshSeat;
  throw new Error(`Unknown harness: ${harness}`);
}
