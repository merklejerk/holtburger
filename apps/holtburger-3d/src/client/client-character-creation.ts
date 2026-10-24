import {
	characterCreationAppearanceRequestSchema,
	type CharacterCreationAppearanceRequest,
	type CharacterCreationCatalog,
	type CharacterCreationDraft,
	type CharacterCreationPreview,
} from "./client-character-creation-contract";
import type { CharacterManagementState } from "./client-host-contract";
import type { ObjectPreviewSource } from "../lib/game/runtime/object-preview-source";
import type { ObjectPreviewFraming } from "../lib/game/preview/object-preview-viewport";
import { OBJECT_PREVIEW_VERTICAL_FOV_DEGREES } from "../lib/game/renderer/object-preview-camera";
import { Vec3 } from "../lib/game/math/types";

/** Catalog-owned dependent choices, used by the draft editor without another projection. */
export type CreationHeritage = CharacterCreationCatalog["heritages"][number];
export type CreationGender = CreationHeritage["genders"][number];
export type CreationAppearance = CharacterCreationDraft["appearance"];

/** One capability set for production transport and synthetic creator acceptance. */
export interface CharacterCreationServices {
	loadCatalog(): Promise<CharacterCreationCatalog>;
	resolveAppearance(
		request: CharacterCreationAppearanceRequest,
	): Promise<CharacterCreationPreview>;
	submit(draft: CharacterCreationDraft): Promise<void>;
}

/** Shared frontend admission for creation, selection and entry controls. Core checks again. */
export function characterManagementPending(
	state: CharacterManagementState,
): boolean {
	return (
		state.kind === "creating" ||
		state.kind === "deleting" ||
		state.kind === "restoring" ||
		state.kind === "uncertain"
	);
}

/** A garment's dependent fields travel together when its style changes. */
const STARTER_GARMENTS = [
	{
		choices: "headgear",
		style: "headgearStyle",
		color: "headgearColor",
		hue: "headgearHue",
		optional: true,
	},
	{
		choices: "shirts",
		style: "shirtStyle",
		color: "shirtColor",
		hue: "shirtHue",
		optional: false,
	},
	{
		choices: "pants",
		style: "pantsStyle",
		color: "pantsColor",
		hue: "pantsHue",
		optional: false,
	},
	{
		choices: "footwear",
		style: "footwearStyle",
		color: "footwearColor",
		hue: "footwearHue",
		optional: false,
	},
] as const;

/** Wire sentinel explicitly selects no headgear; it is never a clothing color key. */
export const NO_CREATION_HEADGEAR = 0xffff_ffff;

/** Frontend framing from retail ZoomIn's heritage-specific camera heights/distances
 * (acclient.c:177471). Our fitted projection scales that focus with the selected body;
 * no part number or generic human head is inferred for alternate bodies. */
export function creationFaceFraming(
	heritage: number,
	scale: number,
): ObjectPreviewFraming {
	const height = heritage === 12 ? 1.85 : heritage === 13 ? 2.75 : 1.65;
	const distance =
		heritage === 12
			? 1.85
			: heritage === 13
				? 3.05
				: heritage === 7
					? 0.85
					: 0.55;
	return {
		kind: "face",
		center: new Vec3(0, height * scale, 0),
		height:
			2 *
			distance *
			Math.tan((OBJECT_PREVIEW_VERTICAL_FOV_DEGREES * Math.PI) / 360) *
			scale,
	};
}

/** Creator-only backdrop composed before the common preview boundary; zoom never changes pose. */
export function creationPreviewSource(
	preview: CharacterCreationPreview,
): ObjectPreviewSource {
	return {
		body: preview.body,
		attachments: [],
		background:
			preview.backgroundSetupDid === null
				? null
				: {
						setupDid: preview.backgroundSetupDid,
						scale: 1,
						translucency: 0,
						appearance: {
							paletteDid: null,
							subPalettes: [],
							textureChanges: [],
							partChanges: [],
						},
						pose: { kind: "setup-pose" },
					},
	};
}

/** Hide headgear only in the face-preview request; retain the actual outfit for submission. */
export function creationAppearanceRequest(
	draft: CharacterCreationDraft,
	face: boolean,
): CharacterCreationAppearanceRequest {
	return {
		heritage: draft.heritage,
		gender: draft.gender,
		appearance: face
			? { ...draft.appearance, headgearStyle: NO_CREATION_HEADGEAR }
			: draft.appearance,
	};
}

export function creationHeritage(
	catalog: CharacterCreationCatalog,
	id: number,
): CreationHeritage {
	const heritage = catalog.heritages.find((entry) => entry.id === id);
	if (heritage === undefined)
		throw new Error(`Creation heritage ${id} is absent from the catalog.`);
	return heritage;
}

export function creationGender(
	heritage: CreationHeritage,
	id: number,
): CreationGender {
	const gender = heritage.genders.find((entry) => entry.id === id);
	if (gender === undefined)
		throw new Error(
			`Creation body ${id} is absent from heritage ${heritage.id}.`,
		);
	return gender;
}

/** Randomize starter clothing once per body selection; facial edits keep those choices stable. */
function initialCreationAppearance(
	gender: CreationGender,
	roll: () => number,
): CreationAppearance {
	const appearance: CreationAppearance = {
		eyes: 0,
		nose: 0,
		mouth: 0,
		hairColor: 0,
		eyeColor: 0,
		hairStyle: 0,
		headgearStyle: NO_CREATION_HEADGEAR,
		headgearColor: 0,
		shirtStyle: 0,
		shirtColor: 0,
		pantsStyle: 0,
		pantsColor: 0,
		footwearStyle: 0,
		footwearColor: 0,
		skinHue: 0.5,
		hairHue: 0.5,
		headgearHue: 0.5,
		shirtHue: 0.5,
		pantsHue: 0.5,
		footwearHue: 0.5,
	};
	return randomizeCreationClothing(appearance, gender, roll);
}

/** Replace only clothing choices; retain the edited face and never mutate the current draft. */
export function randomizeCreationClothing(
	current: CreationAppearance,
	gender: CreationGender,
	roll: () => number,
): CreationAppearance {
	const appearance = { ...current };
	for (const garment of STARTER_GARMENTS) {
		appearance[garment.style] = garment.optional ? NO_CREATION_HEADGEAR : 0;
		appearance[garment.color] = 0;
		appearance[garment.hue] = 0.5;
		const choices = gender[garment.choices];
		if (choices.length === 0) continue;
		// Optional headgear includes a first "none" outcome so randomization can leave hair visible.
		const style =
			Math.floor(roll() * (choices.length + (garment.optional ? 1 : 0))) -
			(garment.optional ? 1 : 0);
		if (style < 0) continue;
		const selected = choices[style];
		if (selected === undefined)
			throw new Error("Random clothing style is absent from its catalog.");
		const key =
			selected.paletteTemplateIds[
				Math.floor(roll() * selected.paletteTemplateIds.length)
			];
		if (key === undefined)
			throw new Error("Random clothing color is absent from its garment.");
		appearance[garment.style] = style;
		appearance[garment.color] = key;
		appearance[garment.hue] = roll();
	}
	return appearance;
}

/** Rebuild every dependent build choice on heritage/body selection, preserving only the typed name. */
export function initialCreationDraft(
	catalog: CharacterCreationCatalog,
	heritageId: number,
	genderId: number,
	name: string,
	roll: () => number,
): CharacterCreationDraft {
	const heritage = creationHeritage(catalog, heritageId);
	const gender = creationGender(heritage, genderId);
	const defaults = heritage.defaults;
	const startArea = heritage.startAreaIds[0];
	if (startArea === undefined)
		throw new Error(`Creation heritage ${heritageId} has no starting area.`);
	if (defaults.skills.length !== catalog.skillSlots)
		throw new Error("Creation defaults have an incomplete skill vector.");
	return {
		heritage: heritageId,
		gender: genderId,
		name,
		startArea,
		attributes: [...defaults.attributes],
		skills: [...defaults.skills],
		appearance: initialCreationAppearance(gender, roll),
	};
}

/** Display-only accounting; the host's shared builder remains submission authority. */
export function creationBuildBalance(
	heritage: CreationHeritage,
	draft: CharacterCreationDraft,
): { readonly attributes: number; readonly skills: number } {
	let spent = 0;
	for (const skill of heritage.skills) {
		const advancement = draft.skills[skill.id];
		if (advancement === undefined)
			throw new Error(`Draft is missing skill slot ${skill.id}.`);
		if (advancement >= 2) {
			if (skill.trainedCost === null)
				throw new Error(`Skill ${skill.name} cannot be trained.`);
			spent += skill.trainedCost;
		}
		if (advancement === 3) {
			if (skill.specializationUpgradeCost === null)
				throw new Error(`Skill ${skill.name} cannot be specialized.`);
			spent += skill.specializationUpgradeCost;
		}
	}
	return {
		attributes:
			heritage.attributeCredits -
			draft.attributes.reduce((sum, value) => sum + value, 0),
		skills: heritage.skillCredits - spent,
	};
}

/** Resolved visual and the heritage owning its face-framing policy must change together. */
export interface ResolvedCreationPreview {
	/** Heritage of this completed request, which may precede the latest editable draft. */
	readonly heritage: number;
	/** Production host's visual resolution, without duplicate appearance choices. */
	readonly visual: CharacterCreationPreview;
}

/** Resolution status retains the last usable visual while an ordinary draft edit prepares or fails. */
export type CreationPreviewResolution =
	| {
			readonly kind: "pending";
			readonly previous: ResolvedCreationPreview | null;
	  }
	| { readonly kind: "ready"; readonly preview: ResolvedCreationPreview }
	| {
			readonly kind: "failed";
			readonly previous: ResolvedCreationPreview | null;
			readonly message: string;
	  };

/** One host request in flight plus the latest pending edit; obsolete work never reaches the GPU. */
export class CharacterCreationPreviewResolver {
	readonly #resolve: CharacterCreationServices["resolveAppearance"];
	readonly #publish: (state: CreationPreviewResolution) => void;
	#revision = 0;
	#pending: {
		readonly revision: number;
		readonly request: CharacterCreationAppearanceRequest;
	} | null = null;
	#running = false;
	#disposed = false;
	#lastGood: ResolvedCreationPreview | null = null;

	constructor(
		resolve: CharacterCreationServices["resolveAppearance"],
		publish: (state: CreationPreviewResolution) => void,
	) {
		this.#resolve = resolve;
		this.#publish = publish;
	}

	request(request: CharacterCreationAppearanceRequest): void {
		if (this.#disposed)
			throw new Error("Creation preview resolver is disposed.");
		this.#pending = {
			revision: ++this.#revision,
			request: characterCreationAppearanceRequestSchema.parse(request),
		};
		this.#publish({ kind: "pending", previous: this.#lastGood });
		if (!this.#running) void this.#drain();
	}

	/** Pending transport cannot be cancelled, but retirement withdraws its right to publish. */
	dispose(): void {
		this.#disposed = true;
		this.#pending = null;
		this.#revision++;
	}

	async #drain(): Promise<void> {
		this.#running = true;
		try {
			while (!this.#disposed && this.#pending !== null) {
				const pending = this.#pending;
				this.#pending = null;
				try {
					const preview = await this.#resolve(pending.request);
					if (this.#disposed || pending.revision !== this.#revision) continue;
					this.#lastGood = {
						heritage: pending.request.heritage,
						visual: preview,
					};
					this.#publish({ kind: "ready", preview: this.#lastGood });
				} catch (error) {
					if (this.#disposed || pending.revision !== this.#revision) continue;
					this.#publish({
						kind: "failed",
						previous: this.#lastGood,
						message: error instanceof Error ? error.message : String(error),
					});
				}
			}
		} finally {
			this.#running = false;
		}
	}
}
