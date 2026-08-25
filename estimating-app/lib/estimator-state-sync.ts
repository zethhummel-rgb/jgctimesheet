import type { AppState } from "./estimator-data";

const missing = Symbol("missing");
type MergeValue = unknown | typeof missing;

export interface EstimatorStateMergeResult {
  state: AppState | null;
  conflicts: string[];
}

function same(left: MergeValue, right: MergeValue) {
  if (left === missing || right === missing) return left === right;
  return JSON.stringify(left) === JSON.stringify(right);
}

function isPlainRecord(value: MergeValue): value is Record<string, unknown> {
  return value !== missing && Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIdRecordArray(value: MergeValue): value is Array<Record<string, unknown> & { id: string }> {
  return Array.isArray(value) && value.every((item) => isPlainRecord(item) && typeof item.id === "string");
}

function mergeIdRecordArray(
  path: string,
  base: Array<Record<string, unknown> & { id: string }>,
  local: Array<Record<string, unknown> & { id: string }>,
  remote: Array<Record<string, unknown> & { id: string }>,
  conflicts: string[],
) {
  const baseById = new Map(base.map((item) => [item.id, item]));
  const localById = new Map(local.map((item) => [item.id, item]));
  const remoteById = new Map(remote.map((item) => [item.id, item]));
  const ids = new Set([...baseById.keys(), ...localById.keys(), ...remoteById.keys()]);
  const mergedById = new Map<string, Record<string, unknown> & { id: string }>();

  for (const id of ids) {
    const merged = mergeValue(
      `${path}[${id}]`,
      baseById.get(id) ?? missing,
      localById.get(id) ?? missing,
      remoteById.get(id) ?? missing,
      conflicts,
    );
    if (merged !== missing) mergedById.set(id, merged as Record<string, unknown> & { id: string });
  }

  const baseOrder = base.map((item) => item.id).filter((id) => mergedById.has(id));
  const localOrder = local.map((item) => item.id).filter((id) => mergedById.has(id));
  const remoteOrder = remote.map((item) => item.id).filter((id) => mergedById.has(id));
  let order: string[];
  if (same(localOrder, remoteOrder)) order = localOrder;
  else if (same(localOrder, baseOrder)) order = remoteOrder;
  else if (same(remoteOrder, baseOrder)) order = localOrder;
  else order = [...remoteOrder, ...localOrder.filter((id) => !remoteOrder.includes(id))];

  for (const id of mergedById.keys()) if (!order.includes(id)) order.push(id);
  return order.map((id) => mergedById.get(id)!);
}

function mergeValue(path: string, base: MergeValue, local: MergeValue, remote: MergeValue, conflicts: string[]): MergeValue {
  if (same(local, remote)) return local;
  if (same(local, base)) return remote;
  if (same(remote, base)) return local;

  if (isPlainRecord(base) && isPlainRecord(local) && isPlainRecord(remote)) {
    const result: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
    for (const key of keys) {
      const merged = mergeValue(
        path ? `${path}.${key}` : key,
        Object.prototype.hasOwnProperty.call(base, key) ? base[key] : missing,
        Object.prototype.hasOwnProperty.call(local, key) ? local[key] : missing,
        Object.prototype.hasOwnProperty.call(remote, key) ? remote[key] : missing,
        conflicts,
      );
      if (merged !== missing) result[key] = merged;
    }
    return result;
  }

  if (isIdRecordArray(base) && isIdRecordArray(local) && isIdRecordArray(remote)) {
    return mergeIdRecordArray(path, base, local, remote, conflicts);
  }

  conflicts.push(path || "workspace");
  return local;
}

export function mergeConcurrentEstimatorState(base: AppState, local: AppState, remote: AppState): EstimatorStateMergeResult {
  const conflicts: string[] = [];
  const state = mergeValue("", base, local, remote, conflicts) as AppState;
  return { state: conflicts.length ? null : state, conflicts };
}
