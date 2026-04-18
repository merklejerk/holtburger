import { EMPTY_DAMAGE_TYPES, SPELL_SKILL_HEADROOM } from "../constants";
import { isSkillUsable } from "../skills";
import type {
	ChooseSpellOptions,
	MageData,
	MageDamageType,
	MageSpellRecord,
	SkillSnapshot,
} from "../types";

const DAMAGE_TYPES_BY_PREFERENCE: MageDamageType[] = [
	"acid",
	"bludgeon",
	"cold",
	"direct",
	"fire",
	"lightning",
	"pierce",
	"slash",
	"void",
];

export function availableSpells(
	data: MageData,
	spellbook: Set<number>,
	skills: Map<string, SkillSnapshot>,
): MageSpellRecord[] {
	return Object.values(data.spells).filter((spell) => {
		if (!spellbook.has(spell.spellId)) {
			return false;
		}

		const skill = skills.get(spell.school);
		if (skill == null || !isSkillUsable(skill)) {
			return false;
		}

		return skill.effective >= spell.difficulty + SPELL_SKILL_HEADROOM;
	});
}

export function canTargetSpell(
	spell: MageSpellRecord,
	targetGuid: Guid | null,
	selfGuid: Guid,
): boolean {
	if (spell.targetKind === "self") {
		return targetGuid == null || targetGuid === selfGuid;
	}

	return targetGuid != null && targetGuid !== selfGuid;
}

export function spellInRange(
	spell: MageSpellRecord,
	selfGuid: Guid,
	targetGuid: Guid | null,
	distanceBetween: (left: Guid, right: Guid) => number,
): boolean {
	if (targetGuid == null || spell.range == null) {
		return true;
	}

	return distanceBetween(selfGuid, targetGuid) <= spell.range;
}

export function chooseBestSpell(
	spells: MageSpellRecord[],
	options: ChooseSpellOptions,
	distanceBetween: (left: Guid, right: Guid) => number,
): MageSpellRecord | null {
	const preferredDamageTypes =
		options.preferredDamageTypes ?? EMPTY_DAMAGE_TYPES;
	const preferredSpellIds = options.preferredSpellIds ?? [];
	const candidates = spells.filter((spell) => {
		if (options.school != null && spell.school !== options.school) {
			return false;
		}
		if (options.type != null && spell.type !== options.type) {
			return false;
		}
		if (options.targetKind != null && spell.targetKind !== options.targetKind) {
			return false;
		}
		if (
			options.exactDamageType != null &&
			spell.damageType !== options.exactDamageType
		) {
			return false;
		}
		if (!canTargetSpell(spell, options.targetGuid ?? null, options.selfGuid)) {
			return false;
		}
		return spellInRange(
			spell,
			options.selfGuid,
			options.targetGuid ?? null,
			distanceBetween,
		);
	});

	if (candidates.length === 0) {
		return null;
	}

	candidates.sort((left, right) => {
		const leftPreferred = preferredDamageTypeIndex(
			preferredDamageTypes,
			left.damageType,
		);
		const rightPreferred = preferredDamageTypeIndex(
			preferredDamageTypes,
			right.damageType,
		);
		if (leftPreferred !== rightPreferred) {
			return leftPreferred - rightPreferred;
		}
		if (left.difficulty !== right.difficulty) {
			return right.difficulty - left.difficulty;
		}

		const leftPreferredSpell = preferredSpellIdIndex(
			preferredSpellIds,
			left.spellId,
		);
		const rightPreferredSpell = preferredSpellIdIndex(
			preferredSpellIds,
			right.spellId,
		);
		if (leftPreferredSpell !== rightPreferredSpell) {
			return leftPreferredSpell - rightPreferredSpell;
		}

		return left.spellId - right.spellId;
	});

	return candidates[0] ?? null;
}

export function preferredDamageTypesForWeenie(
	data: MageData,
	weenieId: number | null,
): MageDamageType[] {
	if (weenieId == null) {
		return EMPTY_DAMAGE_TYPES;
	}

	const resistWord = findResistWord(data.weenieResists, weenieId);
	if (resistWord == null) {
		return EMPTY_DAMAGE_TYPES;
	}

	return [...DAMAGE_TYPES_BY_PREFERENCE].sort((left, right) => {
		const leftScore = resistScoreForDamageType(resistWord, left);
		const rightScore = resistScoreForDamageType(resistWord, right);
		if (leftScore !== rightScore) {
			return rightScore - leftScore;
		}
		return (
			DAMAGE_TYPES_BY_PREFERENCE.indexOf(left) -
			DAMAGE_TYPES_BY_PREFERENCE.indexOf(right)
		);
	});
}

export function knownAttackSpells(
	spells: MageSpellRecord[],
	school: MageSpellRecord["school"],
): MageSpellRecord[] {
	return spells.filter(
		(spell) => spell.school === school && spell.type === "attack",
	);
}

export function maxSpellRange(spells: MageSpellRecord[]): number | null {
	const ranged = spells
		.map((spell) => spell.range)
		.filter((range): range is number => range != null);
	if (ranged.length === 0) {
		return null;
	}

	return Math.max(...ranged);
}

function preferredDamageTypeIndex(
	preferredDamageTypes: MageDamageType[],
	damageType: MageDamageType | null,
): number {
	if (damageType == null) {
		return Number.POSITIVE_INFINITY;
	}

	const index = preferredDamageTypes.indexOf(damageType);
	return index === -1 ? Number.POSITIVE_INFINITY : index;
}

function preferredSpellIdIndex(
	preferredSpellIds: number[],
	spellId: number,
): number {
	const index = preferredSpellIds.indexOf(spellId);
	return index === -1 ? Number.POSITIVE_INFINITY : index;
}

function findResistWord(
	weenieResists: Uint8Array,
	weenieId: number,
): bigint | null {
	if (weenieResists.byteLength < 8) {
		return null;
	}

	const view = new DataView(
		weenieResists.buffer,
		weenieResists.byteOffset,
		weenieResists.byteLength,
	);
	let low = 0;
	let high = Math.floor(view.byteLength / 8) - 1;

	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		const word = view.getBigUint64(mid * 8, true);
		const recordWeenieId = Number(word & 0xffffffn);

		if (recordWeenieId === weenieId) {
			return word;
		}

		if (recordWeenieId < weenieId) {
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}

	return null;
}

function resistScoreForDamageType(
	word: bigint,
	damageType: MageDamageType,
): number {
	switch (damageType) {
		case "pierce":
			return Number((word >> 24n) & 0xfn);
		case "bludgeon":
			return Number((word >> 28n) & 0xfn);
		case "slash":
			return Number((word >> 32n) & 0xfn);
		case "acid":
			return Number((word >> 36n) & 0xfn);
		case "cold":
			return Number((word >> 40n) & 0xfn);
		case "fire":
			return Number((word >> 44n) & 0xfn);
		case "lightning":
			return Number((word >> 48n) & 0xfn);
		case "void":
			return Number((word >> 52n) & 0xfn);
		case "direct":
			return 15;
	}

	return 15;
}
