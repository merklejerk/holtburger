import type {
	MageData,
	MageSkillName,
	SkillSnapshot,
	TrainingLevel,
} from "./types";

type CharacterSheetSkillEntry = {
	stat?: {
		skill_type?: string;
		current?: number;
		training?: TrainingLevel;
	};
};

export function isSkillUsable(
	skill: SkillSnapshot | null | undefined,
): boolean {
	return (
		skill != null &&
		skill.training !== "Unusable" &&
		skill.training !== "Untrained"
	);
}

export function currentSkills(data: MageData): Map<string, SkillSnapshot> {
	const sheet = HB.sheet() as { skills?: CharacterSheetSkillEntry[] } | null;
	const skills = new Map<string, SkillSnapshot>();
	if (sheet == null || !Array.isArray(sheet.skills)) {
		return skills;
	}

	for (const [debugId, skillId] of Object.entries(data.skills)) {
		const targetName = skillTypeFromId(skillId);
		const entry = sheet.skills.find(
			(candidate) => candidate.stat?.skill_type === targetName,
		);
		const stat = entry?.stat;
		if (
			stat == null ||
			typeof stat.current !== "number" ||
			stat.training == null
		) {
			continue;
		}

		skills.set(debugId, {
			skillId,
			effective: stat.current,
			training: stat.training,
		});
	}

	return skills;
}

export function currentSpellbook(): Set<number> {
	const spellbook = HB.spellbook();
	const ids = Array.isArray(spellbook?.knownSpells)
		? spellbook.knownSpells
		: [];
	return new Set(ids.map((spellId) => spellId & 0x7fffffff));
}

export function skillTypeFromId(skillId: number): MageSkillName {
	switch (skillId) {
		case 21:
			return "Healing";
		case 33:
			return "LifeMagic";
		case 34:
			return "WarMagic";
		case 43:
			return "VoidMagic";
		default:
			throw new Error(`unsupported mage skill id ${skillId}`);
	}
}
