import type { SceneVector3 } from "../../assets/ac-frame";
import type { SceneScope } from "../scene";

/** One confirmed combat outcome; styling is decided only in the frontend. */
export type CombatEffectOutcome =
	| {
			readonly kind: "damage";
			readonly amount: number;
			readonly criticalHit: boolean;
	  }
	| { readonly kind: "evaded" }
	| { readonly kind: "resisted" };

/** Each confirmed kind has one explicit text/profile mapping; magic shares existing styling. */
function effectAppearance(outcome: CombatEffectOutcome): {
	text: string;
	profile: CombatEffectProfile;
} {
	switch (outcome.kind) {
		case "damage":
			return {
				text: String(outcome.amount),
				profile: outcome.criticalHit ? "critical" : "damage",
			};
		case "evaded":
			return { text: "MISS", profile: "avoidance" };
		case "resisted":
			return { text: "RESIST", profile: "avoidance" };
	}
}

/** Captured world placement survives entity removal; unplaced effects use the HUD lane. */
export type CombatEffectPlacement =
	| {
			readonly kind: "world";
			readonly position: SceneVector3;
			readonly scopes: readonly SceneScope[];
	  }
	| { readonly kind: "unplaced" };

/** A profile is selected once at spawn and shared by every glyph in that effect. */
type CombatEffectProfile = "damage" | "avoidance" | "critical";

/** Frontend-owned animation and typography knobs, independent of decoded game content. */
export interface CombatEffectsTuning {
	/** Simultaneous logical effects; a critical label shares its number's slot. */
	readonly maximumActive: number;
	/** Total lifetime and pop/fade phase durations in milliseconds. */
	readonly lifetimeMs: number;
	readonly popMs: number;
	readonly fadeMs: number;
	/** Initial scale peaks for ordinary and critical outcomes. */
	readonly popScale: number;
	readonly criticalPopScale: number;
	/** Captured world anchor rises this many world units. */
	readonly worldRise: number;
	/** Unplaced lane rise and camera-facing lateral spread in CSS pixels. */
	readonly screenRise: number;
	readonly spreadPixels: number;
	/** Typography and normal/critical outline widths in CSS pixels. */
	readonly font: string;
	readonly fontSize: number;
	readonly outlineWidth: number;
	readonly criticalOutlineWidth: number;
	/** Smaller label relative to its damage number, and gap between them. */
	readonly criticalLabelScale: number;
	readonly criticalLabelGap: number;
	/** Normalized RGB tints applied by the renderer. */
	readonly colors: Readonly<
		Record<CombatEffectProfile, readonly [number, number, number]>
	>;
}

/** Cold, resolved theme appearance; animation and budget policy stays module-owned. */
export type CombatEffectsAppearance = Pick<
	CombatEffectsTuning,
	"font" | "fontSize" | "colors"
>;

/** Current animation facts; no GPU handles or target references are retained. */
export interface CombatEffectInstance {
	readonly text: string;
	readonly profile: CombatEffectProfile;
	readonly placement: CombatEffectPlacement;
	readonly spreadPixels: number;
	/** Current rise as a normalized fraction of total travel. */
	progress: number;
	scale: number;
	opacity: number;
}

/** Context-bound adapter lease; the system owns release and submission lifetime. */
export interface CombatEffectsResources {
	/** Color changes retain the atlas; typography changes invalidate its glyphs. */
	setAppearance(appearance: CombatEffectsAppearance): void;
	/** Loaded browser font faces invalidate rasterized glyphs even when the family name is unchanged. */
	refreshFontAtlas(): void;
	submit(instances: readonly CombatEffectInstance[]): void;
	clear(): void;
	release(): void;
}

/** Renderer creates its own concrete adapter, without exposing a WebGL context. */
export interface RendererCombatEffectsCapability {
	create(tuning: CombatEffectsTuning): CombatEffectsResources;
}

interface ActiveEffect {
	readonly spawnedAtMs: number;
	readonly instance: CombatEffectInstance;
}

/** One bounded owner for spawn, motion, expiry, reset, and renderer resource lifetime. */
export class CombatEffectsSystem {
	#tuning: CombatEffectsTuning;
	readonly #resources: CombatEffectsResources;
	readonly #active: ActiveEffect[] = [];
	readonly #instances: CombatEffectInstance[] = [];
	#sequence = 0;
	#disposed = false;

	constructor(
		tuning: CombatEffectsTuning,
		capability: RendererCombatEffectsCapability,
	) {
		validateCombatEffectsTuning(tuning);
		this.#tuning = tuning;
		this.#resources = capability.create(tuning);
	}

	/** Apply theme appearance without clearing existing effects or changing their spawn facts. */
	setAppearance(appearance: CombatEffectsAppearance): void {
		if (this.#disposed) return;
		const tuning = { ...this.#tuning, ...appearance };
		validateCombatEffectsTuning(tuning);
		this.#resources.setAppearance(appearance);
		this.#tuning = tuning;
	}

	refreshFontAtlas(): void {
		if (!this.#disposed) this.#resources.refreshFontAtlas();
	}

	get activeCount(): number {
		return this.#active.length;
	}

	/** Position and profile are fixed at intake; later selection/entity changes cannot retarget them. */
	accept(
		outcome: CombatEffectOutcome,
		placement: CombatEffectPlacement,
		nowMs: number,
	): void {
		if (this.#disposed) return;
		const { text, profile } = effectAppearance(outcome);
		// A deterministic bounded sequence spreads adjacent hits without per-frame random state.
		const spread = ((this.#sequence++ % 5) - 2) / 2;
		if (this.#active.length === this.#tuning.maximumActive) {
			this.#active.shift();
		}
		this.#active.push({
			spawnedAtMs: nowMs,
			instance: {
				text,
				profile,
				placement,
				spreadPixels: spread * this.#tuning.spreadPixels,
				progress: 0,
				scale: 1,
				opacity: 1,
			},
		});
		this.advance(nowMs);
	}

	/** Advances even with no visible scene; hidden effects expire on the same clock. */
	advance(nowMs: number): void {
		if (this.#disposed) return;
		this.#instances.length = 0;
		let retained = 0;
		for (const effect of this.#active) {
			const age = Math.max(0, nowMs - effect.spawnedAtMs);
			if (age >= this.#tuning.lifetimeMs) continue;
			const instance = effect.instance;
			instance.progress = age / this.#tuning.lifetimeMs;
			const peak =
				instance.profile === "critical"
					? this.#tuning.criticalPopScale
					: this.#tuning.popScale;
			const pop = Math.min(1, age / this.#tuning.popMs);
			// Sine gives a quick peak then a continuous settle without integrating scale deltas.
			instance.scale = 1 + (peak - 1) * Math.sin(Math.PI * pop);
			instance.opacity = Math.min(
				1,
				(this.#tuning.lifetimeMs - age) / this.#tuning.fadeMs,
			);
			this.#active[retained++] = effect;
			this.#instances.push(instance);
		}
		this.#active.length = retained;
		this.#resources.submit(this.#instances);
	}

	/** Reset drops submitted work but keeps the lazily allocated atlas reusable. */
	clear(): void {
		this.#active.length = 0;
		this.#instances.length = 0;
		this.#sequence = 0;
		if (!this.#disposed) this.#resources.clear();
	}

	dispose(): void {
		if (this.#disposed) return;

		this.clear();
		this.#resources.release();
		this.#disposed = true;
	}
}

/** Validate actual consumer requirements before any adapter resources can be created. */
function validateCombatEffectsTuning(tuning: CombatEffectsTuning): void {
	if (!Number.isSafeInteger(tuning.maximumActive) || tuning.maximumActive <= 0)
		throw new Error("Combat effect budget must be a positive safe integer.");
	for (const [name, value] of Object.entries({
		lifetimeMs: tuning.lifetimeMs,
		popMs: tuning.popMs,
		fadeMs: tuning.fadeMs,
		fontSize: tuning.fontSize,
	})) {
		if (!Number.isFinite(value) || value <= 0)
			throw new Error(`Combat effect ${name} must be finite and positive.`);
	}
	for (const [name, value] of Object.entries({
		popMs: tuning.popMs,
		fadeMs: tuning.fadeMs,
	})) {
		if (value > tuning.lifetimeMs)
			throw new Error(`Combat effect ${name} exceeds its lifetime.`);
	}
	for (const [name, value] of Object.entries({
		worldRise: tuning.worldRise,
		screenRise: tuning.screenRise,
		spreadPixels: tuning.spreadPixels,
		outlineWidth: tuning.outlineWidth,
		criticalOutlineWidth: tuning.criticalOutlineWidth,
		criticalLabelGap: tuning.criticalLabelGap,
	})) {
		if (!Number.isFinite(value) || value < 0)
			throw new Error(`Combat effect ${name} must be finite and nonnegative.`);
	}
	for (const [name, value] of Object.entries({
		popScale: tuning.popScale,
		criticalPopScale: tuning.criticalPopScale,
		criticalLabelScale: tuning.criticalLabelScale,
	})) {
		if (!Number.isFinite(value) || value <= 0)
			throw new Error(`Combat effect ${name} must be finite and positive.`);
	}
	for (const [profile, color] of Object.entries(tuning.colors)) {
		if (
			color.some((value) => !Number.isFinite(value) || value < 0 || value > 1)
		)
			throw new Error(`Combat effect ${profile} color must be normalized RGB.`);
	}
	if (tuning.font.trim().length === 0)
		throw new Error("Combat effect font must be specified.");
}
