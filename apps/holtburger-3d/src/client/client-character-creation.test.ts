import { describe, expect, it, vi } from "vitest";
import {
	CharacterCreationPreviewResolver,
	creationBuildBalance,
	initialCreationDraft,
	randomizeCreationClothing,
	NO_CREATION_HEADGEAR,
	creationAppearanceRequest,
	creationPreviewSource,
	type CreationPreviewResolution,
} from "./client-character-creation";
import type {
	CharacterCreationCatalog,
	CharacterCreationPreview,
} from "./client-character-creation-contract";

const catalog: CharacterCreationCatalog = {
	minimumAttribute: 10,
	maximumAttribute: 100,
	skillSlots: 2,
	startAreas: [{ id: 4, name: "Town" }],
	heritages: [
		{
			id: 1,
			name: "Heritage",
			attributeCredits: 330,
			skillCredits: 12,
			startAreaIds: [4],
			usesStarterClothing: true,
			genders: [
				{
					id: 1,
					name: "Body",
					hairStyles: 2,
					hairColors: 2,
					eyes: 2,
					eyeColors: 2,
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
					minimumAdvancement: 1,
					trainedCost: 4,
					specializationUpgradeCost: 6,
				},
				{
					id: 1,
					name: "Innate",
					description: "Free training",
					minimumAdvancement: 2,
					trainedCost: 0,
					specializationUpgradeCost: 2,
				},
			],
		},
	],
};
const draft = () => initialCreationDraft(catalog, 1, 1, "Amy", () => 0);
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
const request = (skinHue: number) => ({
	heritage: 1,
	gender: 1,
	appearance: { ...draft().appearance, skinHue },
});

describe("creator draft policy", () => {
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
	it("randomizes only starter clothing using the selected garment's real color keys", () => {
		const first = initialCreationDraft(catalog, 1, 1, "Amy", () => 0);
		const last = initialCreationDraft(catalog, 1, 1, "Amy", () => 0.999);
		expect(last.appearance).toMatchObject({
			headgearStyle: 0,
			headgearColor: 23,
			shirtColor: 42,
			pantsColor: 9,
			footwearColor: 3,
			shirtHue: 0.999,
		});
		expect(first.appearance.headgearStyle).toBe(NO_CREATION_HEADGEAR);
		expect(last.appearance.skinHue).toBe(first.appearance.skinHue);
		expect(last.appearance.hairStyle).toBe(first.appearance.hairStyle);
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
		const reset = initialCreationDraft(catalog, 1, 1, original.name, () => 0);
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
