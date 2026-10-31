import {
	characterCreationAppearanceRequestSchema,
	characterCreationStatsRequestSchema,
	type CharacterCreationStatsRequest,
	type CharacterCreationStats,
	type CharacterCreationAppearanceRequest,
	type CharacterCreationCatalog,
	type CharacterCreationDraft,
	type CharacterCreationPreview,
} from "./client-character-creation-contract";
import type { LocalSceneModelSource } from "../lib/game/runtime/local-scene-model";
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
	resolveStats(
		request: CharacterCreationStatsRequest,
	): Promise<CharacterCreationStats>;
	resolveAppearance(
		request: CharacterCreationAppearanceRequest,
	): Promise<CharacterCreationPreview>;
	submit(draft: CharacterCreationDraft): Promise<void>;
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

/** Composite the editable body over the shared pregame scene, independent of preview framing. */
export function creationPreviewSource(
	preview: CharacterCreationPreview,
): LocalSceneModelSource {
	return { body: preview.body, attachments: [] };
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

/** Seed a newly visited body with randomized features, shades, and a valid starter outfit. */
export function initialCreationAppearance(
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
	return randomizeCreationAppearance(
		randomizeCreationClothing(appearance, gender, roll),
		gender,
		roll,
	);
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

/** Randomize body features and shades while retaining the selected outfit. */
export function randomizeCreationAppearance(
	current: CreationAppearance,
	gender: CreationGender,
	roll: () => number,
): CreationAppearance {
	const ordinal = (count: number) =>
		count === 0 ? 0 : Math.floor(roll() * count);
	return {
		...current,
		hairStyle: ordinal(gender.hairStyles),
		hairColor: ordinal(gender.hairColors.length),
		eyes: ordinal(gender.eyes),
		eyeColor: ordinal(gender.eyeColors.length),
		nose: ordinal(gender.noses),
		mouth: ordinal(gender.mouths),
		skinHue: roll(),
		hairHue: roll(),
	};
}

/** Assemble race-specific build defaults around the caller-owned body appearance and name. */
export function initialCreationDraft(
	catalog: CharacterCreationCatalog,
	heritageId: number,
	genderId: number,
	name: string,
	appearance: CreationAppearance,
): CharacterCreationDraft {
	const heritage = creationHeritage(catalog, heritageId);
	creationGender(heritage, genderId);
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
		appearance,
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

/** One active static query and the newest pending edit; retirement withdraws publication rights. */
class LatestCreationRequest<Request, Value> {
	readonly #resolve: (request: Request) => Promise<Value>;
	readonly #ready: (value: Value, request: Request) => void;
	readonly #failed: (message: string) => void;
	#revision = 0;
	#pending: { revision: number; request: Request } | null = null;
	#running = false;
	#disposed = false;

	constructor(
		resolve: (request: Request) => Promise<Value>,
		ready: (value: Value, request: Request) => void,
		failed: (message: string) => void,
	) {
		this.#resolve = resolve;
		this.#ready = ready;
		this.#failed = failed;
	}
	request(request: Request): void {
		if (this.#disposed) throw new Error("Creation query resolver is disposed.");
		this.#pending = { revision: ++this.#revision, request };
		if (!this.#running) void this.#drain();
	}
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
					const result = await this.#resolve(pending.request);
					if (!this.#disposed && pending.revision === this.#revision)
						this.#ready(result, pending.request);
				} catch (error) {
					if (!this.#disposed && pending.revision === this.#revision)
						this.#failed(
							error instanceof Error ? error.message : String(error),
						);
				}
			}
		} finally {
			this.#running = false;
		}
	}
}

/** Appearance retains its last usable visual while newer resources resolve. */
export class CharacterCreationPreviewResolver {
	readonly #owner: LatestCreationRequest<
		CharacterCreationAppearanceRequest,
		CharacterCreationPreview
	>;
	readonly #publish: (state: CreationPreviewResolution) => void;
	#lastGood: ResolvedCreationPreview | null = null;
	constructor(
		resolve: CharacterCreationServices["resolveAppearance"],
		publish: (state: CreationPreviewResolution) => void,
	) {
		this.#publish = publish;
		this.#owner = new LatestCreationRequest(
			resolve,
			(visual, request) => {
				this.#lastGood = { heritage: request.heritage, visual };
				publish({ kind: "ready", preview: this.#lastGood });
			},
			(message) =>
				publish({ kind: "failed", previous: this.#lastGood, message }),
		);
	}
	request(request: CharacterCreationAppearanceRequest): void {
		this.#publish({ kind: "pending", previous: this.#lastGood });
		this.#owner.request(
			characterCreationAppearanceRequestSchema.parse(request),
		);
	}
	dispose(): void {
		this.#owner.dispose();
	}
}

/** Same-race edits retain a complete snapshot until its replacement is ready. */
export type CreationStatsResolution =
	| {
			readonly kind: "pending";
			readonly previous: Extract<
				CharacterCreationStats,
				{ kind: "standard" }
			> | null;
	  }
	| { readonly kind: "ready"; readonly stats: CharacterCreationStats }
	| { readonly kind: "failed"; readonly message: string };

/** Allocation-only coalescing: cosmetic/name edits cannot create calculation or renderer work. */
export class CharacterCreationStatsResolver {
	readonly #owner: LatestCreationRequest<
		CharacterCreationStatsRequest,
		CharacterCreationStats
	>;
	readonly #publish: (state: CreationStatsResolution) => void;
	#lastKey: string | null = null;
	#lastGood: {
		readonly heritage: number;
		readonly stats: Extract<CharacterCreationStats, { kind: "standard" }>;
	} | null = null;
	constructor(
		resolve: CharacterCreationServices["resolveStats"],
		publish: (state: CreationStatsResolution) => void,
	) {
		this.#publish = publish;
		this.#owner = new LatestCreationRequest(
			resolve,
			(stats, request) => {
				this.#lastGood =
					stats.kind === "standard"
						? { heritage: request.heritage, stats }
						: null;
				publish({ kind: "ready", stats });
			},
			(message) => publish({ kind: "failed", message }),
		);
	}
	request(draft: CharacterCreationDraft): void {
		const request = characterCreationStatsRequestSchema.parse({
			heritage: draft.heritage,
			attributes: draft.attributes,
			skills: draft.skills,
		});
		const key = JSON.stringify(request);
		if (key === this.#lastKey) return;
		this.#lastKey = key;
		// Changing races retires the old snapshot even if the user switches back before completion.
		if (this.#lastGood !== null && this.#lastGood.heritage !== request.heritage)
			this.#lastGood = null;
		this.#publish({
			kind: "pending",
			previous: this.#lastGood === null ? null : this.#lastGood.stats,
		});
		this.#owner.request(request);
	}
	dispose(): void {
		this.#owner.dispose();
	}
}
