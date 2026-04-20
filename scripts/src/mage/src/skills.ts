import type { MageData, SkillSnapshot } from "./types";

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
	const sheet = HB.characterSheet();
	const skills = new Map<string, SkillSnapshot>();
	if (sheet == null) {
		return skills;
	}

	for (const [debugId, skillId] of Object.entries(data.skills)) {
		const skill = sheet.skills.find(
			(entry) => entry.skillType === skillTypeFromId(skillId),
		);
		if (!skill) {
			continue;
		}

		skills.set(debugId, {
			skillId,
			effective: skill.effective,
			training: skill.training,
		});
	}

	return skills;
}

export function currentSpellbook(): Set<number> {
	return new Set(HB.spellbook().map((spellId) => spellId & 0x7fffffff));
}

export function skillTypeFromId(skillId: number): SkillType {
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
