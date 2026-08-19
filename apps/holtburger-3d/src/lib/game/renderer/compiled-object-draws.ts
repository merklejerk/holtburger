import type { ObjectBlendPolicy } from "./object-rendering-policy";
import type { CompiledObjectDrawDiagnostics } from "./renderer";

/**
 * Every draw-consumed fact that is constant for one draw unit's lifetime.
 *
 * Compiled once per draw unit rather than once per frame: nothing here depends on the camera, the
 * view, or the render anchor. The one anchor-dependent fact — the landblock offset — is
 * deliberately kept out of compiled state entirely and resolved per frame from the view's
 * per-landblock offset map, so a compiled entry is shared by reference and survives re-anchoring.
 */
export interface CompiledObjectDraw<TCompatibility> {
	readonly blendPolicy: ObjectBlendPolicy;
	readonly compatibility: TCompatibility;
}

/**
 * Why every compiled entry was dropped.
 *
 * Each value names a real event that can invalidate compiled facts, and exists so a flush is
 * always attributable in diagnostics rather than appearing as unexplained recompilation:
 *
 * - `atlas-publication` — a texture atlas published a new layout. The stable planner never moves a
 *   retained placement, but compaction does, so cached atlas rects can no longer be trusted.
 * - `texture-filtering` — the frontend changed filtering policy, which selects samplers.
 * - `region-static-detail` — the active region's static detail bindings changed.
 * - `env-cell-render-mode` — flat and portal modes disagree about the shell cull-face override.
 */
export type CompiledObjectDrawFlushReason =
	| "atlas-publication"
	| "texture-filtering"
	| "region-static-detail"
	| "env-cell-render-mode";

/**
 * Compiled draw facts held against the draw units that own them.
 *
 * Keys are the artifact-owned draw unit and template objects, which outlive frames and die with
 * their publication. A `WeakMap` therefore expresses the retention rule exactly: an entry becomes
 * collectable when the draw unit it describes is no longer reachable, so node eviction, layer
 * replacement, and appearance changes need no eviction wiring and cannot leak. Whole-store
 * invalidation is a `flush`, because every listed reason invalidates every entry at once.
 */
export class CompiledObjectDrawStore<TSubmissions, TCompatibility> {
	#nodeSubmissions = new WeakMap<object, Map<string, TSubmissions>>();
	#draws = new WeakMap<
		object,
		Map<string, CompiledObjectDraw<TCompatibility>>
	>();
	#compiledEntryCount = 0;
	#totalCompilationCount = 0;
	readonly #flushCounts: Record<CompiledObjectDrawFlushReason, number> = {
		"atlas-publication": 0,
		"texture-filtering": 0,
		"region-static-detail": 0,
		"env-cell-render-mode": 0,
	};

	/**
	 * Return one publication's complete submission set, building it on first sight.
	 *
	 * Static publications are cached whole rather than per draw: every fact a static submission
	 * carries except the anchor-relative offset is fixed for the publication's lifetime, so a
	 * visible node costs one lookup per frame instead of one per draw unit, and its submissions
	 * are reused by reference rather than rebuilt.
	 */
	resolveNodeSubmissions(
		key: object,
		variant: string,
		compile: () => TSubmissions,
	): TSubmissions {
		return resolveVariant(
			this.#nodeSubmissions,
			key,
			variant,
			compile,
			this.#onCompiled,
		);
	}

	/**
	 * Return one draw unit's compiled facts, compiling them on first sight.
	 *
	 * Used where submissions cannot be cached whole because they carry per-frame state, which
	 * today means dynamic parts: their instance transforms are resampled every frame.
	 *
	 * A draw unit can be submitted under more than one ordering class: an effect ramping a
	 * dynamic part's translucency renders an otherwise opaque unit as transparent, and can settle
	 * there indefinitely. Variants therefore get their own slot rather than being treated as a
	 * cache miss that recompiles every frame for as long as the effect holds.
	 */
	resolveDraw(
		key: object,
		variant: string,
		compile: () => CompiledObjectDraw<TCompatibility>,
	): CompiledObjectDraw<TCompatibility> {
		return resolveVariant(this.#draws, key, variant, compile, this.#onCompiled);
	}

	/** Drop every compiled entry, because the named event invalidated all of them. */
	flush(reason: CompiledObjectDrawFlushReason): void {
		this.#flushCounts[reason] += 1;
		if (this.#compiledEntryCount === 0) return;
		this.#nodeSubmissions = new WeakMap();
		this.#draws = new WeakMap();
		this.#compiledEntryCount = 0;
	}

	getDiagnostics(): CompiledObjectDrawDiagnostics {
		return {
			compiledEntryCount: this.#compiledEntryCount,
			totalCompilationCount: this.#totalCompilationCount,
			flushCounts: { ...this.#flushCounts },
		};
	}

	readonly #onCompiled = (): void => {
		this.#compiledEntryCount += 1;
		this.#totalCompilationCount += 1;
	};
}

/** Shared get-or-compile across the two cached kinds, so their retention rules cannot drift. */
function resolveVariant<TValue>(
	entries: WeakMap<object, Map<string, TValue>>,
	key: object,
	variant: string,
	compile: () => TValue,
	onCompiled: () => void,
): TValue {
	let variants = entries.get(key);
	if (variants === undefined) {
		variants = new Map();
		entries.set(key, variants);
	}
	const existing = variants.get(variant);
	if (existing !== undefined) return existing;
	const compiled = compile();
	variants.set(variant, compiled);
	onCompiled();
	return compiled;
}
