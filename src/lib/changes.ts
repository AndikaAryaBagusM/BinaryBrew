// The fields of a patch whose value differs from the current row, as the
// audit log records them: { price: { from: 20000, to: 22000 } }.
export function changedFields<T extends Record<string, unknown>>(
  current: T,
  patch: Partial<T>,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, to] of Object.entries(patch)) {
    if (to !== undefined && current[key] !== to) {
      changes[key] = { from: current[key], to };
    }
  }
  return changes;
}
