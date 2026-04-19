import type {
	MageData,
	MageDamageType,
	MageSpellRecord,
	MageSpellSchool,
	MageSpellType,
	MageTargetKind,
} from "./types";

type MageSpellFileRecord = {
	name: string;
	spellId: number;
	type: MageSpellType;
	difficulty: number;
	targetKind: MageTargetKind;
	damageType?: MageDamageType;
	range?: number;
};

type MageDataFile = {
	spells: Record<MageSpellSchool, Record<string, MageSpellFileRecord>>;
	skills: Record<string, number>;
};

export function loadMageData(): MageData | null {
	return loadMageDataWithStatus().data;
}

export function loadMageDataWithStatus(): MageDataLoadStatus {
	const rawData = HB.loadData();
	const rawResistData = HB.loadDataBin();
	const resistBytes = coerceResistBytes(rawResistData);

	return {
		data: normalizeMageData(rawData, resistBytes),
		hasJson: rawData != null,
		hasBin: resistBytes != null,
	};
}

export type MageDataLoadStatus = {
	data: MageData | null;
	hasJson: boolean;
	hasBin: boolean;
};

export function normalizeMageData(
	rawData: unknown,
	rawResistData: unknown,
): MageData | null {
	if (
		rawData == null ||
		typeof rawData !== "object" ||
		Array.isArray(rawData)
	) {
		return null;
	}

	if (!isUint8Array(rawResistData)) {
		return null;
	}

	const data = rawData as Partial<MageDataFile>;
	if (
		data.spells == null ||
		data.skills == null ||
		typeof data.spells !== "object" ||
		typeof data.skills !== "object"
	) {
		return null;
	}

	const spells: Record<string, MageSpellRecord> = {};
	for (const [school, schoolSpells] of Object.entries(data.spells)) {
		if (!isMageSpellSchool(school) || !isSpellGroup(schoolSpells)) {
			return null;
		}

		for (const [spellKey, spell] of Object.entries(schoolSpells)) {
			if (!isMageSpellFileRecord(spell)) {
				return null;
			}

			spells[spellKey] = {
				name: spell.name,
				spellId: spell.spellId,
				school,
				type: spell.type as MageSpellType,
				difficulty: spell.difficulty,
				damageType: spell.damageType ?? null,
				range: spell.range ?? null,
				targetKind: spell.targetKind as MageTargetKind,
			};
		}
	}

	return {
		spells,
		skills: data.skills,
		weenieResists: rawResistData,
	};
}

export function filterMageDataSpells(
	data: MageData | null,
	bannedSpellIds: number[],
): MageData | null {
	if (data == null || bannedSpellIds.length === 0) {
		return data;
	}

	const bannedSpellIdSet = new Set(bannedSpellIds);
	if (bannedSpellIdSet.size === 0) {
		return data;
	}

	const filteredSpells = Object.fromEntries(
		Object.entries(data.spells).filter(
			([, spell]) => !bannedSpellIdSet.has(spell.spellId),
		),
	);

	if (Object.keys(filteredSpells).length === Object.keys(data.spells).length) {
		return data;
	}

	return {
		...data,
		spells: filteredSpells,
	};
}

function isUint8Array(value: unknown): value is Uint8Array {
	return value instanceof Uint8Array;
}

function coerceResistBytes(value: unknown): Uint8Array | null {
	if (value instanceof Uint8Array) {
		return value;
	}

	if (
		Array.isArray(value) &&
		value.every((entry) => typeof entry === "number")
	) {
		return Uint8Array.from(value);
	}

	if (value instanceof ArrayBuffer) {
		return new Uint8Array(value);
	}

	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	}

	return null;
}

function isMageSpellSchool(value: string): value is MageSpellSchool {
	return value === "war" || value === "life" || value === "void";
}

function isSpellGroup(
	value: unknown,
): value is Record<string, MageSpellFileRecord> {
	return value != null && typeof value === "object" && !Array.isArray(value);
}

function isMageSpellFileRecord(value: unknown): value is MageSpellFileRecord {
	if (value == null || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}

	const spell = value as Partial<MageSpellFileRecord>;
	return (
		typeof spell.name === "string" &&
		typeof spell.spellId === "number" &&
		typeof spell.type === "string" &&
		typeof spell.difficulty === "number" &&
		typeof spell.targetKind === "string"
	);
}
