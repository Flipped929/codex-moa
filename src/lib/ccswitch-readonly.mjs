/**
 * cc-switch 只读纪律（用户裁决 2026-09-15）
 *
 * 「cc-switch 是管模型和思考等级的唯一出口；codex-moa 不写 cc-switch 的配置。」
 *
 * 含义：codex-moa 只能读 cc-switch（库、卡片、catalog、skills 目录），
 * 任何写入——包括"顺手补一个缺失字段"——都必须到 CC Switch 界面里做。
 * 该拒绝是硬性的、无环境变量旁路：要改值就改 CC Switch，再让 codex-moa 读。
 *
 * 注意：本模块只管 cc-switch 一侧。codex-moa 自己的产物
 * （.pi/moa 任务记录、~/.codex-moa/*、worktree、调研报告）不受此限。
 */

export const CC_SWITCH_READONLY_MESSAGE =
  "codex-moa 对 CC Switch 只读（用户裁决 2026-09-15）：请在 CC Switch 里修改供应商卡/模型等级，不要由 codex-moa 写入。";

/** 任何写 cc-switch（库 / 卡片 / catalog / skills 目录）的动作都必须先过这里 */
export function assertCcSwitchReadOnly(operation = "写入 CC Switch") {
  throw new Error(`${CC_SWITCH_READONLY_MESSAGE}（被拒操作：${operation}）`);
}

/** 只读工具的统一返回标记，便于调用方/日志识别"这次没有也不会写" */
export function readonlyResult(payload = {}) {
  return { readOnly: true, ...payload };
}
