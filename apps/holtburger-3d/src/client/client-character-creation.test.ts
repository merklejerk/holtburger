import { appearanceShadeIndex } from "./client-body-appearance";
import { describe, expect, it, vi } from "vitest";
import reconciliationFixture from "../../../../crates/holtburger-core/tests/fixtures/character_creation_reconciliation.json";
import { characterCreationDraftSchema } from "./client-character-creation-contract";
import {
	CharacterCreationPreviewResolver,
	CharacterCreationStatsResolver,
	type CreationStatsResolution,
	creationBuildBalance,
	initialCreationDraft,
	initialCreationAppearance,
	randomizeCreationClothing,
	randomizeCreationAppearance,
	NO_CREATION_HEADGEAR,
	creationAppearanceRequest,
	creationPreviewSource,
	type CreationPreviewResolution,
	type CreationHeritage,
} from "./client-character-creation";
import {
	creationBuildControls,
	applyCreationAttribute,
	applyCreationSkill,
	creationSkillFormulaText,
	reconcileCreationHeritage,
} from "./client-character-creation-build";
import type {
	CharacterCreationCatalog,
	CharacterCreationPreview,
	CharacterCreationStats,
	CharacterCreationStatsRequest,
} from "./client-character-creation-contract";

const catalog = {
	attributeDescriptions: [
		"Strength help",
		"Endurance help",
		"Coordination help",
		"Quickness help",
		"Focus help",
		"Self help",
	],
	minimumAttribute: 10,
	maximumAttribute: 100,
	skillSlots: 2,
	startAreas: [{ id: 4, name: "Town" }],
	heritages: [
		{
			id: 1,
			name: "Heritage",
			lore: ["Heritage lore."],
			benefits: { descriptions: [], skillGroups: [] },
			attributeCredits: 330,
			skillCredits: 12,
			startAreaIds: [4],
			usesStarterClothing: true,
			genders: [
				{
					id: 1,
					name: "Body",
					hairStyles: 2,
					hairColors: [["#331100"], ["#ccaa55"]],
					skinColors: ["#ccaa88"],
					eyes: 2,
					eyeColors: ["#224488", "#442211"],
					noses: 2,
					mouths: 2,
					headgear: [{ name: "Hat", paletteTemplateIds: [23] }],
					shirts: [{ name: "Shirt", paletteTemplateIds: [17, 42] }],
					pants: [{ name: "Trousers", paletteTemplateIds: [9] }],
					footwear: [{ name: "Boots", paletteTemplateIds: [3] }],
				},
			],
			defaults: { attributes: [10, 10, 10, 10, 10, 10], skills: [1, 2] },
			skills: [
				{
					id: 0,
					name: "Weapon",
					description: "Weapon skill",
					formula: { first: "Strength", second: "Coordination", divisor: 3 },
					minimumAdvancement: 1,
					trainedCost: 4,
					specializationUpgradeCost: 6,
				},
				{
					id: 1,
					name: "Innate",
					description: "Free training",
					formula: null,
					minimumAdvancement: 2,
					trainedCost: 0,
					specializationUpgradeCost: 2,
				},
			],
		},
	],
} satisfies CharacterCreationCatalog;
const initialDraft = (roll: () => number, name: string) =>
	initialCreationDraft(
		catalog,
		1,
		1,
		name,
		initialCreationAppearance(catalog.heritages[0].genders[0], roll),
	);
const draft = () => initialDraft(() => 0, "Amy");
const preview: CharacterCreationPreview = {
	body: {
		setupDid: 0x02000001,
		scale: 1,
		translucency: 0,
		pose: { kind: "setup-pose" },
		appearance: {
			paletteDid: null,
			subPalettes: [],
			textureChanges: [],
			partChanges: [],
		},
	},
	backgroundSetupDid: null,
};

function deferred<T>() {
	let resolve: (value: T) => void = () => {
		throw new Error("Not initialized.");
	};
	let reject: (error: unknown) => void = () => {
		throw new Error("Not initialized.");
	};
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
async function flush(): Promise<void> {
	for (let index = 0; index < 8; index++) await Promise.resolve();
}

describe("starting stat query lifetime", () => {
	const result: CharacterCreationStats = {
		kind: "standard",
		vitals: [28, 55, 55],
		skills: [{ id: 0, value: 47, usable: true }],
	};

	it("ignores cosmetic and identity edits and coalesces allocation edits and retains the last complete same-race snapshot", async () => {
		const first = deferred<CharacterCreationStats>();
		const second = deferred<CharacterCreationStats>();
		const resolve = vi
			.fn<
				(
					request: CharacterCreationStatsRequest,
				) => Promise<CharacterCreationStats>
			>()
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);
		const states: CreationStatsResolution[] = [];
		const owner = new CharacterCreationStatsResolver(resolve, (state) =>
			states.push(state),
		);
		const initial = draft();
		owner.request(initial);
		owner.request({
			...initial,
			name: "Changed",
			gender: 2,
			startArea: 4,
			appearance: { ...initial.appearance, skinHue: 0.9 },
		});
		expect(resolve).toHaveBeenCalledTimes(1);
		owner.request({ ...initial, attributes: [10, 20, 10, 10, 10, 10] });
		owner.request({ ...initial, attributes: [10, 30, 10, 10, 10, 10] });
		first.resolve(result);
		await flush();
		expect(states.every((state) => state.kind === "pending")).toBe(true);
		expect(resolve).toHaveBeenCalledTimes(2);
		expect(resolve.mock.calls[1][0].attributes[1]).toBe(30);
		second.resolve(result);
		await flush();
		expect(states.at(-1)).toEqual({ kind: "ready", stats: result });
		owner.request({ ...initial, attributes: [10, 40, 10, 10, 10, 10] });
		expect(states.at(-1)).toEqual({ kind: "pending", previous: result });
		owner.dispose();
		await flush();
	});

	it("withdraws normal stats during race changes, omits Olthoi, and recalculates on return", async () => {
		const delayed = deferred<CharacterCreationStats>();
		const resolve = vi
			.fn<
				(
					request: CharacterCreationStatsRequest,
				) => Promise<CharacterCreationStats>
			>()
			.mockResolvedValueOnce(result)
			.mockReturnValueOnce(delayed.promise)
			.mockResolvedValueOnce({ kind: "olthoi" })
			.mockResolvedValueOnce(result);
		const states: CreationStatsResolution[] = [];
		const owner = new CharacterCreationStatsResolver(resolve, (state) =>
			states.push(state),
		);
		const initial = draft();
		owner.request(initial);
		await flush();
		owner.request({ ...initial, heritage: 12 });
		expect(states.at(-1)).toEqual({ kind: "pending", previous: null });
		owner.request({ ...initial, heritage: 13 });
		delayed.resolve(result);
		await flush();
		expect(states.at(-1)).toEqual({ kind: "ready", stats: { kind: "olthoi" } });
		owner.request(initial);
		await flush();
		expect(states.at(-1)).toEqual({ kind: "ready", stats: result });
		owner.dispose();
	});

	it("replaces a retained snapshot atomically and never restores it across an interrupted race change", async () => {
		const update = deferred<CharacterCreationStats>();
		const race = deferred<CharacterCreationStats>();
		const returned = deferred<CharacterCreationStats>();
		const replacement: CharacterCreationStats = {
			kind: "standard",
			vitals: [5, 10, 10],
			skills: [{ id: 0, value: 12, usable: true }],
		};
		const resolve = vi
			.fn<
				(
					request: CharacterCreationStatsRequest,
				) => Promise<CharacterCreationStats>
			>()
			.mockResolvedValueOnce(result)
			.mockReturnValueOnce(update.promise)
			.mockReturnValueOnce(race.promise)
			.mockReturnValueOnce(returned.promise);
		const states: CreationStatsResolution[] = [];
		const owner = new CharacterCreationStatsResolver(resolve, (state) =>
			states.push(state),
		);
		const initial = draft();
		initial.attributes = [55, 55, 55, 55, 55, 55];
		owner.request(initial);
		await flush();
		owner.request({ ...initial, attributes: [10, 10, 10, 10, 10, 10] });
		expect(states.at(-1)).toEqual({ kind: "pending", previous: result });
		update.resolve(replacement);
		await flush();
		expect(states.at(-1)).toEqual({ kind: "ready", stats: replacement });
		owner.request({ ...initial, heritage: 12 });
		expect(states.at(-1)).toEqual({ kind: "pending", previous: null });
		owner.request(initial);
		expect(states.at(-1)).toEqual({ kind: "pending", previous: null });
		race.resolve({ kind: "olthoi" });
		await flush();
		expect(states.at(-1)).toEqual({ kind: "pending", previous: null });
		returned.resolve(result);
		await flush();
		expect(states.at(-1)).toEqual({ kind: "ready", stats: result });
		owner.dispose();
	});

	it("surfaces current failures and prevents publication after disposal", async () => {
		const delayed = deferred<CharacterCreationStats>();
		const states: CreationStatsResolution[] = [];
		const owner = new CharacterCreationStatsResolver(
			() => delayed.promise,
			(state) => states.push(state),
		);
		owner.request(draft());
		delayed.reject(new Error("Missing stat table"));
		await flush();
		expect(states.at(-1)).toEqual({
			kind: "failed",
			message: "Missing stat table",
		});
		owner.dispose();
		const retired = deferred<CharacterCreationStats>();
		const publish = vi.fn();
		const other = new CharacterCreationStatsResolver(
			() => retired.promise,
			publish,
		);
		other.request(draft());
		other.dispose();
		retired.resolve(result);
		await flush();
		expect(publish).toHaveBeenCalledTimes(1);
		expect(publish).toHaveBeenLastCalledWith({
			kind: "pending",
			previous: null,
		});
	});
});
const request = (skinHue: number) => ({
	heritage: 1,
	gender: 1,
	appearance: { ...draft().appearance, skinHue },
});

describe("creator draft policy", () => {
	it("randomizes bounded facial choices and shades while retaining clothing and the original appearance", () => {
		const before = draft().appearance;
		const gender = catalog.heritages[0].genders[0];
		const after = randomizeCreationAppearance(before, gender, () => 0.999);
		expect(after).toEqual({
			...before,
			hairStyle: gender.hairStyles - 1,
			hairColor: gender.hairColors.length - 1,
			eyeColor: gender.eyeColors.length - 1,
			eyes: gender.eyes - 1,
			nose: gender.noses - 1,
			mouth: gender.mouths - 1,
			skinHue: 0.999,
			hairHue: 0.999,
		});
		expect(before).toEqual(draft().appearance);
		const absent = randomizeCreationAppearance(
			before,
			{
				...gender,
				hairStyles: 0,
				hairColors: [],
				eyeColors: [],
				eyes: 0,
				noses: 0,
				mouths: 0,
			},
			() => 0.999,
		);
		expect(absent).toMatchObject({
			hairStyle: 0,
			hairColor: 0,
			eyeColor: 0,
			eyes: 0,
			nose: 0,
			mouth: 0,
		});
	});
	it("maps every palette swatch midpoint and both hue endpoints to the authored bin", () => {
		const count = catalog.heritages[0].genders[0].eyeColors.length;
		expect(appearanceShadeIndex(0, count)).toBe(0);
		expect(appearanceShadeIndex(1, count)).toBe(count - 1);
		for (let index = 0; index < count; index++)
			expect(appearanceShadeIndex((index + 0.5) / count, count)).toBe(index);
	});

	it("hides headgear only in the face request while retaining the submitted outfit and idle pose", () => {
		const build = draft();
		build.appearance.headgearStyle = 0;
		build.appearance.headgearColor = 23;
		expect(
			creationAppearanceRequest(build, true).appearance.headgearStyle,
		).toBe(NO_CREATION_HEADGEAR);
		expect(
			creationAppearanceRequest(build, false).appearance.headgearStyle,
		).toBe(0);
		expect(build.appearance.headgearStyle).toBe(0);
		expect(creationPreviewSource(preview).body.pose).toBe(preview.body.pose);
	});
	it("rerolls clothing without resetting facial edits and can remove previously selected headgear", () => {
		const before = {
			...draft().appearance,
			eyes: 1,
			hairStyle: 1,
			skinHue: 0.9,
			headgearStyle: 0,
			headgearColor: 23,
			shirtColor: 42,
		};
		const after = randomizeCreationClothing(
			before,
			catalog.heritages[0].genders[0],
			() => 0,
		);
		expect(after).toMatchObject({
			eyes: 1,
			hairStyle: 1,
			skinHue: 0.9,
			headgearStyle: NO_CREATION_HEADGEAR,
			headgearColor: 0,
			shirtColor: 17,
		});
		expect(before).toMatchObject({
			headgearStyle: 0,
			headgearColor: 23,
			shirtColor: 42,
		});
	});
	it("initializes randomized features and clothing with valid garment color keys", () => {
		const first = initialDraft(() => 0, "Amy");
		const last = initialDraft(() => 0.999, "Amy");
		expect(last.appearance).toMatchObject({
			headgearStyle: 0,
			headgearColor: 23,
			shirtColor: 42,
			pantsColor: 9,
			footwearColor: 3,
			shirtHue: 0.999,
		});
		expect(first.appearance.headgearStyle).toBe(NO_CREATION_HEADGEAR);
		expect(last.appearance.skinHue).toBe(0.999);
		expect(last.appearance.hairHue).toBe(0.999);
		expect(last.appearance.hairStyle).toBe(
			catalog.heritages[0].genders[0].hairStyles - 1,
		);
		expect(first.appearance.skinHue).toBe(0);
		expect(first.appearance.hairStyle).toBe(0);
		expect(last.attributes).toEqual(first.attributes);
		expect(last.skills).toEqual(first.skills);
	});
	it("starts with actual garment template keys and rebuilds dependent choices", () => {
		const original = draft();
		expect(original.appearance).toMatchObject({
			headgearStyle: NO_CREATION_HEADGEAR,
			shirtColor: 17,
			pantsColor: 9,
			footwearColor: 3,
		});
		original.appearance.shirtColor = 42;
		original.attributes[0] = 100;
		original.skills[0] = 3;
		const reset = initialDraft(() => 0, original.name);
		expect(reset).toEqual(draft());
		expect(reset.startArea).toBe(4);
	});

	it("accounts training plus additional specialization and exact attribute spend", () => {
		const build = draft();
		build.attributes = [100, 10, 100, 100, 10, 10];
		build.skills = [3, 3];
		expect(creationBuildBalance(catalog.heritages[0], build)).toEqual({
			attributes: 0,
			skills: 0,
		});
	});
});

describe("creator appearance resolution", () => {
	it("coalesces a slider burst before dispatch and discards an obsolete rejection", async () => {
		const first = deferred<CharacterCreationPreview>();
		const resolve = vi
			.fn()
			.mockReturnValueOnce(first.promise)
			.mockResolvedValue(preview);
		const states: CreationPreviewResolution[] = [];
		const owner = new CharacterCreationPreviewResolver(resolve, (state) =>
			states.push(state),
		);
		owner.request(request(0));
		owner.request(request(0.2));
		owner.request(request(0.4));
		owner.request(request(0.9));
		expect(resolve).toHaveBeenCalledTimes(1);
		first.reject(new Error("Obsolete appearance failed."));
		await flush();
		expect(resolve).toHaveBeenCalledTimes(2);
		expect(resolve.mock.calls[1]).toEqual([request(0.9)]);
		expect(states.filter((state) => state.kind !== "pending")).toEqual([
			{ kind: "ready", preview: { heritage: 1, visual: preview } },
		]);
		owner.dispose();
	});

	it("preserves the last successful visual on a current failure and ignores retired work", async () => {
		const late = deferred<CharacterCreationPreview>();
		const resolve = vi
			.fn()
			.mockResolvedValueOnce(preview)
			.mockRejectedValueOnce(new Error("Missing hair asset."))
			.mockReturnValueOnce(late.promise);
		const states: CreationPreviewResolution[] = [];
		const owner = new CharacterCreationPreviewResolver(resolve, (state) =>
			states.push(state),
		);
		owner.request(request(0));
		await flush();
		owner.request(request(0.5));
		await flush();
		expect(states.at(-1)).toEqual({
			kind: "failed",
			previous: { heritage: 1, visual: preview },
			message: "Missing hair asset.",
		});
		owner.request(request(1));
		owner.dispose();
		const count = states.length;
		late.resolve(preview);
		await flush();
		expect(states).toHaveLength(count);
	});
});

describe("creator attribute and skill controls", () => {
	const heritage = catalog.heritages[0];
	const controls = (
		value: ReturnType<typeof draft>,
		race: CreationHeritage = heritage,
	) => creationBuildControls(catalog, race, value);
	const row = (
		value: ReturnType<typeof draft>,
		id: number,
		race: CreationHeritage = heritage,
	) => {
		const result = controls(value, race).skills.find(
			(entry) => entry.skill.id === id,
		);
		if (result === undefined) throw new Error(`Missing fixture skill ${id}`);
		return result;
	};
	it("bounds every attribute drag by both the catalog cap and the remaining pool", () => {
		let value = draft();
		for (let index = 0; index < value.attributes.length; index++) {
			const control = controls(value).attributes[index];
			value = applyCreationAttribute(value, control, catalog.maximumAttribute);
			expect(controls(value).balance.attributes).toBeGreaterThanOrEqual(0);
		}
		expect(controls(value).balance.attributes).toBe(0);
		const before = value;
		for (const control of controls(value).attributes) {
			expect(control.maximum).toBe(control.value);
			value = applyCreationAttribute(value, control, catalog.maximumAttribute);
		}
		expect(value).toEqual(before);
		value = applyCreationAttribute(
			value,
			controls(value).attributes[0],
			catalog.minimumAttribute,
		);
		expect(controls(value).balance.attributes).toBe(
			before.attributes[0] - catalog.minimumAttribute,
		);
		expect(controls(value).attributes[0].maximum).toBe(
			catalog.maximumAttribute,
		);
	});
	it("clamps decreases to the minimum and rejects fractional edits", () => {
		const value = draft();
		const control = controls(value).attributes[0];
		expect(
			applyCreationAttribute(value, control, catalog.minimumAttribute - 1)
				.attributes[0],
		).toBe(catalog.minimumAttribute);
		expect(() =>
			applyCreationAttribute(value, control, catalog.minimumAttribute + 0.5),
		).toThrow("integers");
	});
	it("charges each upgrade once and refunds the same amount on each downgrade", () => {
		const weapon = heritage.skills[0];
		const before = draft();
		let value = applyCreationSkill(
			before,
			weapon.id,
			row(before, weapon.id).upgrade,
		);
		expect(row(value, weapon.id).training).toBe(2);
		expect(controls(value).balance.skills).toBe(
			heritage.skillCredits - weapon.trainedCost,
		);
		value = applyCreationSkill(value, weapon.id, row(value, weapon.id).upgrade);
		expect(row(value, weapon.id).training).toBe(3);
		expect(controls(value).balance.skills).toBe(
			heritage.skillCredits -
				weapon.trainedCost -
				weapon.specializationUpgradeCost,
		);
		expect(row(value, weapon.id).upgrade.kind).toBe("blocked");
		value = applyCreationSkill(
			value,
			weapon.id,
			row(value, weapon.id).downgrade,
		);
		expect(row(value, weapon.id).training).toBe(2);
		value = applyCreationSkill(
			value,
			weapon.id,
			row(value, weapon.id).downgrade,
		);
		expect(value).toEqual(before);
		expect(row(value, weapon.id).downgrade.kind).toBe("blocked");
	});
	it("blocks unaffordable upgrades without changing the build, and still permits free ones", () => {
		const weapon = heritage.skills[0];
		const limited = { ...heritage, skillCredits: weapon.trainedCost };
		let value = draft();
		value = applyCreationSkill(
			value,
			weapon.id,
			row(value, weapon.id, limited).upgrade,
		);
		expect(controls(value, limited).balance.skills).toBe(0);
		const blocked = row(value, weapon.id, limited).upgrade;
		expect(blocked.kind).toBe("blocked");
		expect(applyCreationSkill(value, weapon.id, blocked)).toBe(value);
		const free = {
			...limited,
			skills: limited.skills.map((skill) => ({
				...skill,
				specializationUpgradeCost: 0,
			})),
		};
		expect(row(value, weapon.id, free).upgrade).toMatchObject({
			kind: "available",
			credits: 0,
		});
	});
	it("keeps mandatory training, and allows a specialized skill to return to that floor", () => {
		const innate = heritage.skills[1];
		let value = draft();
		expect(row(value, innate.id).downgrade.kind).toBe("blocked");
		value = applyCreationSkill(value, innate.id, row(value, innate.id).upgrade);
		value = applyCreationSkill(
			value,
			innate.id,
			row(value, innate.id).downgrade,
		);
		expect(row(value, innate.id).training).toBe(innate.minimumAdvancement);
		expect(row(value, innate.id).downgrade.kind).toBe("blocked");
	});
	it("blocks unavailable training and specialization tiers", () => {
		const weapon = heritage.skills[0];
		const unavailable = {
			...heritage,
			skills: [{ ...weapon, trainedCost: null }, heritage.skills[1]],
		};
		expect(row(draft(), weapon.id, unavailable).upgrade.kind).toBe("blocked");
		const trained = applyCreationSkill(
			draft(),
			weapon.id,
			row(draft(), weapon.id).upgrade,
		);
		const noSpecialization = {
			...heritage,
			skills: [
				{ ...weapon, specializationUpgradeCost: null },
				heritage.skills[1],
			],
		};
		expect(row(trained, weapon.id, noSpecialization).upgrade.kind).toBe(
			"blocked",
		);
	});
	it("rejects an already overspent draft instead of hiding a negative balance", () => {
		const value = draft();
		value.attributes.fill(catalog.maximumAttribute);
		expect(() => controls(value)).toThrow("attribute budget");
		const skillValue = draft();
		skillValue.skills[0] = 2;
		expect(() =>
			controls(skillValue, { ...heritage, skillCredits: 0 }),
		).toThrow("skill budget");
	});
	it("rejects malformed advancement values", () => {
		const value = draft();
		value.skills[0] = 4;
		expect(() => controls(value)).toThrow("Invalid creation advancement");
	});
	it("formats one- and two-attribute formulas and preserves formula-free skills", () => {
		expect(creationSkillFormulaText(heritage.skills[0].formula)).toBe(
			"(Strength + Coordination) / 3",
		);
		expect(
			creationSkillFormulaText({ first: "Focus", second: null, divisor: 2 }),
		).toBe("Focus / 2");
		expect(
			creationSkillFormulaText({ first: "Self", second: null, divisor: 1 }),
		).toBe("Self");
		expect(creationSkillFormulaText(null)).toBeNull();
	});
});

describe("race-change reconciliation", () => {
	const original = catalog.heritages[0];
	const build = () => initialDraft(() => 0, "Preserved Name");
	function reconcile(
		draft: ReturnType<typeof build>,
		target: CreationHeritage,
	) {
		return reconcileCreationHeritage(
			{ ...catalog, heritages: [original, { ...target, id: 2 }] },
			draft,
			2,
			draft.appearance,
		);
	}

	it("preserves compatible choices and never mutates its input", () => {
		const draft = build();
		draft.attributes[0] = catalog.maximumAttribute;
		draft.skills[0] = 3;
		const before = structuredClone(draft);
		const result = reconcile(draft, original);
		expect(result).toEqual({ ...before, heritage: 2 });
		expect(draft).toEqual(before);
		const again = reconcileCreationHeritage(
			{ ...catalog, heritages: [{ ...original, id: 2 }] },
			result,
			2,
			draft.appearance,
		);
		expect(again).toEqual(result);
	});

	it("preserves gender identity rather than choosing the first body", () => {
		const draft = build();
		const target = {
			...original,
			genders: [{ ...original.genders[0], id: 2 }, original.genders[0]],
		};
		expect(reconcile(draft, target).gender).toBe(draft.gender);
		expect(() =>
			reconcile(draft, { ...target, genders: [target.genders[0]] }),
		).toThrow();
	});

	it("reduces highest attributes with stable tuple ties and leaves larger budgets unspent", () => {
		const draft = build();
		draft.attributes[0] += 2;
		draft.attributes[1] += 2;
		const minimum = catalog.minimumAttribute * draft.attributes.length;
		const result = reconcile(draft, {
			...original,
			attributeCredits: minimum + 1,
		});
		expect(result.attributes).toEqual([
			catalog.minimumAttribute,
			catalog.minimumAttribute + 1,
			...draft.attributes.slice(2),
		]);
		expect(
			reconcile(draft, {
				...original,
				attributeCredits: original.attributeCredits + 1,
			}).attributes,
		).toEqual(draft.attributes);
		expect(() =>
			reconcile(draft, { ...original, attributeCredits: minimum - 1 }),
		).toThrow("minimum attributes");
	});

	it("retains lost free training when its new cost is affordable and applies new requirements", () => {
		const draft = build();
		const paid = {
			...original.skills[1],
			trainedCost: original.skills[0].trainedCost,
			minimumAdvancement: 1,
		};
		expect(
			reconcile(draft, { ...original, skills: [original.skills[0], paid] })
				.skills[1],
		).toBe(2);
		const required = { ...original.skills[0], minimumAdvancement: 2 };
		const result = reconcile(draft, {
			...original,
			skills: [required, original.skills[1]],
		});
		expect(result.skills[0]).toBe(required.minimumAdvancement);
	});

	it("removes optional specialization before training and reprices the target race", () => {
		const draft = build();
		draft.skills = [3, 3];
		const target = {
			...original,
			skillCredits: original.skills[0].trainedCost,
			skills: [
				original.skills[0],
				{
					...original.skills[1],
					specializationUpgradeCost:
						original.skills[0].specializationUpgradeCost + 1,
				},
			],
		};
		const result = reconcile(draft, target);
		expect(result.skills).toEqual([2, 2]);
		expect(creationBuildBalance(target, result).skills).toBe(0);
	});

	it("unlocks paid training refunds through a zero-cost specialization", () => {
		const draft = build();
		draft.skills[0] = 3;
		const result = reconcile(draft, {
			...original,
			skillCredits: 0,
			skills: [
				{ ...original.skills[0], specializationUpgradeCost: 0 },
				original.skills[1],
			],
		});
		expect(result.skills).toEqual([1, 2]);
	});

	it("refunds the largest specialization first and breaks equal refunds by skill ID", () => {
		const draft = build();
		draft.skills = [3, 3];
		const upgrade = original.skills[0].specializationUpgradeCost;
		const training = original.skills[0].trainedCost;
		const target = {
			...original,
			skillCredits: training + upgrade,
			skills: [
				original.skills[0],
				{ ...original.skills[1], specializationUpgradeCost: upgrade + 1 },
			],
		};
		expect(reconcile(draft, target).skills).toEqual([3, 2]);
		expect(
			reconcile(draft, {
				...target,
				skills: [
					target.skills[0],
					{ ...target.skills[1], specializationUpgradeCost: upgrade },
				],
			}).skills,
		).toEqual([2, 3]);
	});

	it("clears skills made inactive and rejects inconsistent requirements or vector sizes", () => {
		const draft = build();
		const result = reconcile(draft, {
			...original,
			skills: [original.skills[0]],
		});
		expect(result.skills[1]).toBe(0);
		expect(() => reconcile({ ...draft, skills: [] }, original)).toThrow(
			"incomplete skill vector",
		);
		expect(() =>
			reconcile(draft, {
				...original,
				skills: [{ ...original.skills[0], id: catalog.skillSlots }],
			}),
		).toThrow("exceeds the skill vector");
		expect(() =>
			reconcile(draft, {
				...original,
				skills: [
					{
						...original.skills[0],
						minimumAdvancement: 3,
						specializationUpgradeCost: null,
					},
				],
			}),
		).toThrow("Required training is unavailable");
	});

	it("lowers unavailable tiers without removing required training", () => {
		const draft = build();
		draft.skills[0] = 3;
		expect(
			reconcile(draft, {
				...original,
				skills: [
					{ ...original.skills[0], specializationUpgradeCost: null },
					original.skills[1],
				],
			}).skills[0],
		).toBe(2);
		expect(
			reconcile(draft, {
				...original,
				skills: [
					{ ...original.skills[0], trainedCost: null },
					original.skills[1],
				],
			}).skills[0],
		).toBe(1);
		expect(() =>
			reconcile(draft, {
				...original,
				skillCredits: 0,
				skills: [
					{ ...original.skills[0], minimumAdvancement: 2 },
					original.skills[1],
				],
			}),
		).toThrow("required training");
	});

	it("retains valid towns and selects a valid replacement", () => {
		const draft = build();
		const target = { ...original, id: 2, startAreaIds: [5] };
		const result = reconcileCreationHeritage(
			{
				...catalog,
				startAreas: [...catalog.startAreas, { id: 5, name: "Other town" }],
				heritages: [original, target],
			},
			draft,
			target.id,
			draft.appearance,
		);
		expect(result.startArea).toBe(target.startAreaIds[0]);
		expect(() => reconcile(draft, { ...original, startAreaIds: [] })).toThrow(
			"starting town",
		);
	});
});

it("produces the same asset-independent reconciled build admitted by the Rust builder", () => {
	const source = catalog.heritages[0];
	const target: CreationHeritage = {
		...source,
		id: reconciliationFixture.heritage,
		attributeCredits: reconciliationFixture.attributeCredits,
		skillCredits: reconciliationFixture.skillCredits,
		startAreaIds: [0],
		skills: reconciliationFixture.skills.map((skill) => ({
			...skill,
			description: skill.name,
			formula: null,
		})),
	};
	const draft = characterCreationDraftSchema.parse({
		...initialDraft(() => 0, "Shared fixture"),
		attributes: reconciliationFixture.attributes,
		skills: reconciliationFixture.requestedSkills,
		startArea: 0,
	});
	const result = reconcileCreationHeritage(
		{
			...catalog,
			skillSlots: reconciliationFixture.requestedSkills.length,
			startAreas: [{ id: 0, name: "Holtburg" }],
			heritages: [source, target],
		},
		draft,
		target.id,
		draft.appearance,
	);
	expect(result.attributes).toEqual(reconciliationFixture.attributes);
	expect(result.skills).toEqual(reconciliationFixture.expectedSkills);
	expect(creationBuildBalance(target, result)).toEqual({
		attributes: 0,
		skills: 0,
	});
});
