import type { MageConfig } from "./types";

type MageConfigFile = {
  preferredSpellIds?: unknown;
};

export function loadMageConfig(): MageConfig {
  const rawConfig = HB.loadConfig();
  if (rawConfig == null) {
    HB.writeConfig({});
  }

  return normalizeMageConfig(rawConfig);
}

export function normalizeMageConfig(rawConfig: unknown): MageConfig {
  if (
    rawConfig == null ||
    typeof rawConfig !== "object" ||
    Array.isArray(rawConfig)
  ) {
    return {
      preferredSpellIds: [],
    };
  }

  const config = rawConfig as MageConfigFile;
  return {
    preferredSpellIds: normalizePreferredSpellIds(config.preferredSpellIds),
  };
}

function normalizePreferredSpellIds(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const preferredSpellIds: number[] = [];
  const seenSpellIds = new Set<number>();

  for (const entry of value) {
    if (!Number.isInteger(entry) || entry <= 0 || seenSpellIds.has(entry)) {
      continue;
    }

    seenSpellIds.add(entry);
    preferredSpellIds.push(entry);
  }

  return preferredSpellIds;
}