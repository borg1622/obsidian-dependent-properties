import type { LegacySyncRule, SyncRule } from "./types";

export function asFrontmatterRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function isTypesJson(value: unknown): value is { types?: Record<string, string> } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const types = (value as { types?: unknown }).types;
  if (types === undefined) return true;
  if (types === null || typeof types !== "object" || Array.isArray(types)) {
    return false;
  }
  return Object.values(types).every((entry) => typeof entry === "string");
}

function isSyncRuleLike(value: unknown): value is LegacySyncRule {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const rule = value as Record<string, unknown>;
  if (rule.id !== undefined && typeof rule.id !== "string") return false;
  if (rule.enabled !== undefined && typeof rule.enabled !== "boolean") return false;
  if (rule.name !== undefined && typeof rule.name !== "string") return false;
  if (rule.watchedRoot !== undefined && typeof rule.watchedRoot !== "string") return false;
  if (rule.linkProperty !== undefined && typeof rule.linkProperty !== "string") return false;
  if (rule.attributeMappings !== undefined && typeof rule.attributeMappings !== "string") {
    return false;
  }
  if (rule.attributesToCopy !== undefined) {
    if (!Array.isArray(rule.attributesToCopy)) return false;
    if (!rule.attributesToCopy.every((entry) => typeof entry === "string")) return false;
  }
  return true;
}

export function isMigratableSyncRule(value: unknown): value is LegacySyncRule {
  return isSyncRuleLike(value);
}

export function isLegacySyncRule(value: unknown): boolean {
  if (!isSyncRuleLike(value)) return false;
  return "attributeMappings" in value || !Array.isArray(value.attributesToCopy);
}

export function isPartialPluginSettings(
  value: unknown
): value is { rules?: unknown[]; debounceMs?: unknown; debug?: unknown } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const settings = value as Record<string, unknown>;
  if (settings.rules !== undefined && !Array.isArray(settings.rules)) return false;
  if (settings.debounceMs !== undefined && typeof settings.debounceMs !== "number") {
    return false;
  }
  if (settings.debug !== undefined && typeof settings.debug !== "boolean") return false;
  return true;
}

export function migrateRule(rule: LegacySyncRule): SyncRule {
  let attributesToCopy = Array.isArray(rule.attributesToCopy)
    ? rule.attributesToCopy.filter((name) => typeof name === "string" && name.trim())
    : [];

  if (attributesToCopy.length === 0 && rule.attributeMappings) {
    attributesToCopy = migrateAttributeMappings(rule.attributeMappings);
  }

  return {
    id: rule.id || crypto.randomUUID(),
    enabled: rule.enabled ?? true,
    name: rule.name ?? "",
    watchedRoot: rule.watchedRoot ?? "",
    linkProperty: rule.linkProperty ?? "",
    attributesToCopy
  };
}

function migrateAttributeMappings(input: string): string[] {
  return input
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (line.includes("->")) {
        return line.split("->")[0].trim();
      }
      if (line.includes(":")) {
        return line.split(":")[0].trim();
      }
      return line;
    })
    .filter(Boolean);
}
