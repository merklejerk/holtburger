import { describe, expect, it } from "vitest";
import {
	characterCreationDraftSchema,
	loadCharacterCreationCatalog,
	resolveCharacterCreationAppearance,
} from "./client-character-creation-contract";

const draft = {
	heritage: 1,
	gender: 1,
	name: "Amy",
	startArea: 0,
	attributes: [100, 10, 100, 100, 10, 10],
	skills: [],
	appearance: {
		eyes: 0,
		nose: 0,
		mouth: 0,
		hairColor: 0,
		eyeColor: 0,
		hairStyle: 0,
		headgearStyle: 0xffff_ffff,
		headgearColor: 0,
		shirtStyle: 0,
		shirtColor: 0,
		pantsStyle: 0,
		pantsColor: 0,
		footwearStyle: 0,
		footwearColor: 0,
		skinHue: 0.5,
		hairHue: 0.5,
		headgearHue: 0,
		shirtHue: 0,
		pantsHue: 0,
		footwearHue: 0,
	},
};

describe("creation host boundary", () => {
	it("resolves an appearance without requiring a name or completed build", async () => {
		const preview = {
			body: {
				setupDid: 0x02000001,
				appearance: {
					paletteDid: null,
					subPalettes: [],
					textureChanges: [],
					partChanges: [],
				},
				scale: 1,
				translucency: 0,
				pose: { kind: "setup-pose" },
			},
			backgroundSetupDid: 0x020005a1,
		};
		const request = {
			heritage: draft.heritage,
			gender: draft.gender,
			appearance: draft.appearance,
		};
		let dispatched: unknown;
		expect(
			await resolveCharacterCreationAppearance(
				{
					invoke: async (command, args) => {
						expect(command).toBe("resolve_character_creation_appearance");
						dispatched = args;
						return preview;
					},
				},
				request,
			),
		).toEqual(preview);
		expect(dispatched).toEqual({ request });
	});
	it("rejects identity and privilege fields outside the editable build", () => {
		expect(characterCreationDraftSchema.parse(draft)).toEqual(draft);
		for (const field of [
			"isAdmin",
			"isSentinel",
			"accountName",
			"characterSlot",
			"templateOption",
		])
			expect(() =>
				characterCreationDraftSchema.parse({ ...draft, [field]: true }),
			).toThrow();
	});

	it("rejects invalid shades before submitting them to the host", () => {
		for (const skinHue of [-0.1, 1.1, Number.NaN])
			expect(() =>
				characterCreationDraftSchema.parse({
					...draft,
					appearance: { ...draft.appearance, skinHue },
				}),
			).toThrow();
	});

	it("loads choices through the static content capability", async () => {
		const commands: string[] = [];
		const catalog = {
			minimumAttribute: 10,
			maximumAttribute: 100,
			skillSlots: 0,
			startAreas: [],
			heritages: [],
		};
		const result = await loadCharacterCreationCatalog({
			invoke: async (command) => {
				commands.push(command);
				return catalog;
			},
		});
		expect(result).toEqual(catalog);
		expect(commands).toEqual(["load_character_creation_catalog"]);
	});
});
