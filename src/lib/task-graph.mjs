const ROLE_ORDER = {
  researcher: 0,
  architect: 0,
  vision: 1,
  executor: 2,
  reviewer: 3,
  auditor: 4
};

export function buildTaskGraph(seats = []) {
  const nodes = seats.map((seat, index) => ({
    id: seat.seat,
    index,
    role: seat.role,
    model: seat.model,
    runtime: seat.runtime ?? "cli",
    auditMode: seat.auditMode ?? null,
    blocking: seat.blocking !== false,
    pairedExecutor: seat.pairedExecutor ?? null,
    dependsOn: []
  }));
  const byRole = (role) => nodes.filter((node) => node.role === role);
  const allBefore = (order) => nodes.filter((node) => (ROLE_ORDER[node.role] ?? 9) < order);
  for (const node of nodes) {
    const order = ROLE_ORDER[node.role] ?? 5;
    if (order === 2) node.dependsOn = allBefore(2).map((item) => item.id);
    else if (order === 3 || order === 4) {
      const executors = byRole("executor");
      node.dependsOn = (executors.length > 0 ? executors : allBefore(order)).map((item) => item.id);
    }
  }
  const layers = [];
  const remaining = new Set(nodes.map((node) => node.id));
  const completed = new Set();
  while (remaining.size > 0) {
    const layer = nodes.filter((node) => remaining.has(node.id) && node.dependsOn.every((id) => completed.has(id))).map((node) => node.id);
    if (layer.length === 0) return { nodes, edges: edgesOf(nodes), layers, cycle: [...remaining] };
    layers.push(layer);
    for (const id of layer) { remaining.delete(id); completed.add(id); }
  }
  return { nodes, edges: edgesOf(nodes), layers, cycle: [] };
}

function edgesOf(nodes) {
  return nodes.flatMap((node) => node.dependsOn.map((from) => ({ from, to: node.id })));
}
