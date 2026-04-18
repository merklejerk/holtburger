import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import type {
	MageDamageType,
	MageSpellRecord,
	MageSpellSchool,
	MageTargetKind,
	MageSpellType,
} from "../types";

type MinimalSpellExportFile = {
	fileId: number;
	fields: string[];
	spells: Record<string, MinimalSpellExportSpell>;
};

type MinimalSpellExportSpell = {
	name: string;
	description: string;
	school: number;
	category: number;
	bitfield: number;
	base_range_constant: number;
	base_range_mod: number;
	power: number;
};

type BuildMageDataOptions = {
	inputPath: string;
	outputPath: string;
};

type ParsedMageData = {
	spells: MageSpellFileGroups;
	skills: Record<string, number>;
};

type MageSpellFileRecord = {
	name: string;
	spellId: number;
	type: MageSpellType;
	difficulty: number;
	targetKind: MageTargetKind;
	damageType?: MageDamageType;
	range?: number;
};

type MageSpellFileGroups = Record<
	MageSpellSchool,
	Record<string, MageSpellFileRecord>
>;

const DEFAULT_SKILLS: Record<string, number> = {
	healing: 21,
	life: 33,
	void: 43,
	war: 34,
};

const SELF_TARGETED_FLAG = 0x8;

const HEAL_CATEGORY_IDS = new Set([79]);
const REVITALIZE_CATEGORY_IDS = new Set([81]);
const RESOURCE_TRANSFER_CATEGORY_IDS = new Set([87, 88, 89, 90, 91, 92]);

const ATTACK_CATEGORY_DAMAGE_TYPES = new Map<number, MageDamageType>([
	[117, "acid"],
	[118, "bludgeon"],
	[119, "cold"],
	[120, "lightning"],
	[121, "fire"],
	[122, "pierce"],
	[123, "slash"],
	[640, "void"],
]);
const VULN_CATEGORY_DAMAGE_TYPES = new Map<number, MageDamageType>([
	[102, "acid"],
	[104, "bludgeon"],
	[106, "cold"],
	[108, "lightning"],
	[110, "fire"],
	[112, "pierce"],
	[114, "slash"],
	[286, "acid"],
	[288, "fire"],
	[290, "cold"],
	[292, "lightning"],
	[402, "bludgeon"],
	[404, "slash"],
	[406, "pierce"],
]);

type ResourceTransferSource = "health" | "mana" | "stamina";

const MAX_SPELL_RANGE_OUTDOORS = 75.0;

export async function main(args = process.argv.slice(2)): Promise<void> {
	const options = parseArgs(args);
	const output = await buildMageData(options);
	await writeFile(options.outputPath, `${JSON.stringify(output, null, 2)}\n`);
	const spellCount = countGroupedSpells(output.spells);
	console.log(
		`wrote ${spellCount} spells and ${Object.keys(output.skills).length} skills to ${options.outputPath}`,
	);
}

export async function buildMageData(
	options: BuildMageDataOptions,
): Promise<ParsedMageData> {
	const exportText = await readFile(options.inputPath, "utf8");
	const minimalSpellExport = JSON.parse(exportText) as MinimalSpellExportFile;

	return {
		skills: { ...DEFAULT_SKILLS },
		spells: buildSpellsFromExport(minimalSpellExport.spells),
	};
}

export function buildSpells(
	templateSpells: Record<string, MageSpellRecord>,
	exportedSpells: Record<string, MinimalSpellExportSpell>,
): Record<string, MageSpellRecord> {
	const spellsById = new Map<number, MinimalSpellExportSpell>();

	for (const [spellId, spell] of Object.entries(exportedSpells)) {
		spellsById.set(Number(spellId), spell);
	}

	const output: Record<string, MageSpellRecord> = {};

	for (const [spellKey, templateSpell] of Object.entries(templateSpells)) {
		const exportedSpell = spellsById.get(templateSpell.spellId);
		if (!exportedSpell) {
			output[spellKey] = templateSpell;
			continue;
		}

		const classified = classifySpell(templateSpell.spellId, exportedSpell);
		if (classified == null) {
			if (shouldFilterSpell(templateSpell)) {
				continue;
			}

			output[spellKey] = templateSpell;
			continue;
		}

		output[spellKey] = classified;
	}

	return output;
}

function buildSpellsFromExport(
	exportedSpells: Record<string, MinimalSpellExportSpell>,
): MageSpellFileGroups {
	const output: MageSpellFileGroups = {
		war: {},
		life: {},
		void: {},
	};
	const usedKeysBySchool: Record<MageSpellSchool, Set<string>> = {
		war: new Set<string>(),
		life: new Set<string>(),
		void: new Set<string>(),
	};
	const sortedSpells = Object.entries(exportedSpells).sort(
		(left, right) => Number(left[0]) - Number(right[0]),
	);

	for (const [spellId, spell] of sortedSpells) {
		const classified = classifySpell(Number(spellId), spell);
		if (classified == null) {
			continue;
		}

		const spellKey = spellKeyFromName(
			spell.name,
			Number(spellId),
			usedKeysBySchool[classified.school],
		);
		usedKeysBySchool[classified.school].add(spellKey);
		output[classified.school][spellKey] = toSpellFileRecord(
			classified,
			spell.name,
		);
	}

	return output;
}

function toSpellFileRecord(
	spell: MageSpellRecord,
	name: string,
): MageSpellFileRecord {
	const fileRecord: MageSpellFileRecord = {
		name,
		spellId: spell.spellId,
		type: spell.type,
		difficulty: spell.difficulty,
		targetKind: spell.targetKind,
	};

	if (spell.damageType != null) {
		fileRecord.damageType = spell.damageType;
	}

	if (spell.range != null) {
		fileRecord.range = spell.range;
	}

	return fileRecord;
}

function classifySpell(
	spellId: number,
	spell: MinimalSpellExportSpell,
): MageSpellRecord | null {
	const school = classifySchool(spell.school);
	if (school == null) {
		return null;
	}

	const targetKind = classifyTargetKind(spell);
	const damageType = classifyDamageType(spell.category);
	const spellType = classifySpellType(
		spell.category,
		spell.description,
		school,
	);
	if (spellType == null) {
		return null;
	}

	if (spellType === "vuln" && targetKind === "self") {
		return null;
	}

	const range = targetKind === "self" ? null : finalSpellRange(spell);

	return {
		spellId,
		school,
		type: spellType,
		difficulty: spell.power,
		damageType,
		range,
		targetKind,
	};
}

function classifySchool(rawSchool: number): MageSpellSchool | null {
	switch (rawSchool) {
		case 1:
			return "war";
		case 2:
			return "life";
		case 5:
			return "void";
		default:
			return null;
	}
}

function classifyTargetKind(spell: MinimalSpellExportSpell): MageTargetKind {
	if (
		(spell.bitfield & SELF_TARGETED_FLAG) !== 0 ||
		spell.name.includes(" Self")
	) {
		return "self";
	}

	return "other";
}

function classifySpellType(
	category: number,
	description: string,
	school: MageSpellSchool,
): MageSpellType | null {
	if (HEAL_CATEGORY_IDS.has(category)) {
		return "heal";
	}

	if (REVITALIZE_CATEGORY_IDS.has(category)) {
		return "revitalize";
	}

	if (isVulnerabilityCategory(category)) {
		return "vuln";
	}

	if (ATTACK_CATEGORY_DAMAGE_TYPES.has(category)) {
		return "attack";
	}

	if (RESOURCE_TRANSFER_CATEGORY_IDS.has(category) && school === "life") {
		return classifyResourceTransferSpellType(category, description);
	}

	return null;
}

function classifyResourceTransferSpellType(
	category: number,
	description: string,
): MageSpellType | null {
	const source = resourceTransferSourceForCategory(category);
	if (source == null) {
		return null;
	}

	const destination =
		resourceTransferDestinationForDescription(description) ?? source;
	return resourceTransferType(source, destination);
}

function resourceTransferSourceForCategory(
	category: number,
): ResourceTransferSource | null {
	switch (category) {
		case 87:
		case 88:
			return "health";
		case 89:
		case 90:
			return "stamina";
		case 91:
		case 92:
			return "mana";
		default:
			return null;
	}
}

function resourceTransferDestinationForDescription(
	description: string,
): ResourceTransferSource | null {
	const lowerDescription = description.toLowerCase();

	if (lowerDescription.includes("to his/her health")) {
		return "health";
	}
	if (lowerDescription.includes("to his/her mana")) {
		return "mana";
	}
	if (lowerDescription.includes("to his/her stamina")) {
		return "stamina";
	}

	return null;
}

function resourceTransferType(
	source: ResourceTransferSource,
	destination: ResourceTransferSource,
): MageSpellType {
	if (source === "health") {
		if (destination === "health") {
			return "health-to-health";
		}
		if (destination === "mana") {
			return "health-to-mana";
		}
		return "health-to-stamina";
	}

	if (source === "mana") {
		if (destination === "health") {
			return "mana-to-health";
		}
		if (destination === "mana") {
			return "mana-to-mana";
		}
		return "mana-to-stamina";
	}

	if (destination === "health") {
		return "stamina-to-health";
	}
	if (destination === "mana") {
		return "stamina-to-mana";
	}
	return "stamina-to-stamina";
}

function classifyDamageType(category: number): MageDamageType | null {
	const attackDamageType = ATTACK_CATEGORY_DAMAGE_TYPES.get(category);
	if (attackDamageType != null) {
		return attackDamageType;
	}

	const vulnDamageType = VULN_CATEGORY_DAMAGE_TYPES.get(category);
	if (vulnDamageType != null) {
		return vulnDamageType;
	}

	return null;
}

function shouldFilterSpell(spell: MageSpellRecord): boolean {
	return (
		((spell.school === "war" || spell.school === "void") &&
			spell.type === "attack") ||
		(spell.type === "vuln" && spell.targetKind === "self")
	);
}

function isVulnerabilityCategory(category: number): boolean {
	return VULN_CATEGORY_DAMAGE_TYPES.has(category);
}

function roundRange(range: number): number {
	return Math.round(range * 100) / 100;
}

function finalSpellRange(spell: MinimalSpellExportSpell): number | null {
	const range = Math.min(
		spell.base_range_constant + spell.power * spell.base_range_mod,
		MAX_SPELL_RANGE_OUTDOORS,
	);

	if (range <= 0.0) {
		return null;
	}

	return roundRange(range);
}

function spellKeyFromName(
	name: string,
	spellId: number,
	usedKeys: Set<string>,
): string {
	const normalizedName = name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

	const baseKey = normalizedName || `spell-${spellId}`;
	if (!usedKeys.has(baseKey)) {
		return baseKey;
	}

	return `${baseKey}-${spellId}`;
}

function countGroupedSpells(spells: MageSpellFileGroups): number {
	return Object.values(spells).reduce(
		(total, schoolSpells) => total + Object.keys(schoolSpells).length,
		0,
	);
}

function parseArgs(args: string[]): BuildMageDataOptions {
	let inputPath = "";
	let outputPath = "../../mage.data.json";

	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		switch (argument) {
			case "--input":
				inputPath = args[++index] ?? "";
				break;
			case "--output":
				outputPath = args[++index] ?? outputPath;
				break;
			case "--help":
			case "-h":
				printHelpAndExit();
				break;
			default:
				throw new Error(`unknown argument: ${argument}`);
		}
	}

	if (!inputPath) {
		throw new Error("missing required --input path to a minimal spell export");
	}

	return { inputPath, outputPath };
}

function printHelpAndExit(): never {
	console.log(
		[
			"Usage: tsx src/cli/build-mage-data.ts --input <spell-export.json> [--output <mage.data.json>]",
			"",
			"Generates mage.data.json from a minimal spell export from dat-tool.",
		].join("\n"),
	);
	process.exit(0);
}

const isExecutedDirectly =
	process.argv[1] != null &&
	resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (isExecutedDirectly) {
	main().catch((error: unknown) => {
		console.error(error);
		process.exit(1);
	});
}
