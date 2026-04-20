import type { MageConfig, MageData } from "./types";

type MageConfigFile = {
	preferredSpells?: unknown;
	bannedSpells?: unknown;
};

export function loadMageConfig(data: MageData | null): MageConfig {
	const rawConfig = HB.loadConfig();
	if (rawConfig == null) {
		HB.print("warn", `No mage config found. Using default spells.`);
	}

	return normalizeMageConfig(rawConfig, data);
}

export function normalizeMageConfig(
	rawConfig: unknown,
	data: MageData | null,
): MageConfig {
	if (
		rawConfig == null ||
		typeof rawConfig !== "object" ||
		Array.isArray(rawConfig)
	) {
		return {
			preferredSpellIds: [],
			bannedSpellIds: [],
		};
	}

	const config = rawConfig as MageConfigFile;
	return {
		preferredSpellIds: normalizePreferredSpells(config.preferredSpells, data),
		bannedSpellIds: normalizePreferredSpells(config.bannedSpells, data),
	};
}

function normalizePreferredSpells(
	value: unknown,
	data: MageData | null,
): number[] {
	if (!Array.isArray(value)) {
		return [];
	}

	const preferredSpellIds: number[] = [];
	const seenSpellIds = new Set<number>();

	for (const entry of value) {
		const preferredSpellId = resolvePreferredSpellId(entry, data);
		if (preferredSpellId == null || seenSpellIds.has(preferredSpellId)) {
			continue;
		}

		seenSpellIds.add(preferredSpellId);
		preferredSpellIds.push(preferredSpellId);
	}
	return preferredSpellIds;
}

function resolvePreferredSpellId(
	entry: unknown,
	data: MageData | null,
): number | null {
	if (typeof entry === "number" && Number.isInteger(entry) && entry > 0) {
		return entry;
	}

	if (typeof entry !== "string") {
		return null;
	}

	const preferredSpellKey = entry.trim();
	if (preferredSpellKey.length === 0 || data == null) {
		return null;
	}

	const spell = data.spells[preferredSpellKey];
	return spell?.spellId ?? null;
}
