import type { SceneNodeId } from "../../scene";
import type {
	ActiveDynamicPart,
	VisibleDynamicPresentation,
} from "../../systems/components";
import {
	selectOpaqueDynamicAppearanceVariant,
	type PreparedDynamicAppearance,
} from "./webgl2-dynamic-appearances";
import { retainsRetailGeometry } from "../retail-geometry-visibility";
import {
	retainsDynamicShadowRange,
	summarizeDynamicRangeAdmission,
} from "./object-rendering-policy";

/** Compact inputs shared by material-free mask and mapped-shadow preparation. */
export type DynamicDepthPresentation = Pick<
	VisibleDynamicPresentation,
	"allPartsOpaque" | "landblockId" | "renderScopes"
> & {
	/** Installed geometry identity, appearance, and dense current poses; no legacy draw units. */
	readonly visual: {
		/** Logical shared merged vertex allocation. */
		readonly layout: Pick<
			VisibleDynamicPresentation["visual"]["layout"],
			"key"
		>;
		/** Identity of the already-staged physical index generation. */
		readonly appearance: VisibleDynamicPresentation["visual"]["appearance"];
		/** Complete pose rows, including fully hidden parts that retain a dense selector. */
		readonly parts: readonly Pick<
			ActiveDynamicPart,
			"frameInstance" | "renderState"
		>[];
	};
};

/** Physical span whose material-free triangles share face rejection. */
interface DynamicDepthRange {
	/** Effective authored face rejection for this complete span. */
	cullFace: "back" | "front";
	/** Offset/count in the appearance-owned Uint32 index buffer. */
	indexStart: number;
	indexCount: number;
}

/** One root's complete depth geometry, borrowed by all passes/views until frame reset. */
export interface PreparedDynamicDepth {
	/** Pose-page address identity. */
	readonly nodeId: SceneNodeId;
	/** Coordinate owner used with each view's anchor. */
	readonly landblockId: DynamicDepthPresentation["landblockId"];
	/** Published visual scopes; shadow selection still requires outdoor membership. */
	readonly renderScopes: DynamicDepthPresentation["renderScopes"];
	/** Merged vertex allocation independent of appearance index organization. */
	readonly geometry: DynamicDepthPresentation["visual"]["layout"]["key"];
	/** Retained physical indices; mask and shadow consumers do not sample the material table. */
	readonly appearance: Extract<PreparedDynamicAppearance, { kind: "drawable" }>;
	/** Dense pose rows admitted to the pre-execution upload when this geometry is selected. */
	readonly parts: DynamicDepthPresentation["visual"]["parts"];
	/** Eligible adjacent spans; culling changes and hidden gaps remain separate. */
	readonly ranges: readonly Readonly<DynamicDepthRange>[];
	/** Exact distinct part and triangle counts, resolved once during preparation. */
	readonly selectedPartCount: number;
	readonly selectedTriangleCount: number;
}

/** Immutable depth spans and accounting for a fully opaque appearance. */
export interface CompiledOpaqueDynamicDepth {
	readonly ranges: readonly Readonly<DynamicDepthRange>[];
	readonly selectedPartCount: number;
	readonly selectedTriangleCount: number;
}

/** Preselect shadow or selection spans without requiring a frame-current part scan. */
export function compileOpaqueDynamicDepth(
	plan: Extract<PreparedDynamicAppearance, { kind: "drawable" }>["plan"],
	showRetailHiddenGeometry: boolean,
	opaqueOnly: boolean,
): CompiledOpaqueDynamicDepth {
	const ranges: DynamicDepthRange[] = [];
	const selectedParts = new Set<number>();
	let selectedTriangleCount = 0;
	for (const range of plan.physicalRanges) {
		const retained = opaqueOnly
			? retainsDynamicShadowRange(
					range.source.ordering,
					1,
					range.source.retailVisibility,
					showRetailHiddenGeometry,
				)
			: retainsRetailGeometry(
					range.source.retailVisibility,
					showRetailHiddenGeometry,
				);
		if (!retained) continue;
		const last = ranges.at(-1);
		if (
			last &&
			last.cullFace === range.batch.cullFace &&
			last.indexStart + last.indexCount === range.indexStart
		)
			last.indexCount += range.source.indexCount;
		else
			ranges.push({
				cullFace: range.batch.cullFace,
				indexStart: range.indexStart,
				indexCount: range.source.indexCount,
			});
		selectedParts.add(range.source.partSelector);
		selectedTriangleCount += range.source.indexCount / 3;
	}
	return {
		ranges,
		selectedPartCount: selectedParts.size,
		selectedTriangleCount,
	};
}

/** High-water scalar span storage contains no scene or GPU-resource references. */
interface DepthRangeStorage {
	/** Current active spans shared by consumers. */
	readonly ranges: DynamicDepthRange[];
	/** Retained scalar records repopulated next frame. */
	readonly pool: DynamicDepthRange[];
}

/** Renderer-owned frame cache: depth eligibility and coalescing are computed once per root. */
export class DynamicDepthPreparations {
	/** Cached null also prevents repeated hidden/empty queries. */
	readonly #preparedShadow = new Map<
		SceneNodeId,
		PreparedDynamicDepth | null
	>();
	readonly #preparedSelection = new Map<
		SceneNodeId,
		PreparedDynamicDepth | null
	>();
	/** Storage selected by current frame's nonempty root ordinal. */
	readonly #storage: DepthRangeStorage[] = [];
	/** Reused distinct-part scratch consumed synchronously by one preparation. */
	readonly #selectedParts = new Set<number>();
	/** Next available scalar span slot, reset after all consumers finish a frame. */
	#usedStorage = 0;
	/** Shared compact publication owner; called at most once per queried root each frame. */
	readonly #getPresentation: (
		nodeId: SceneNodeId,
	) => DynamicDepthPresentation | null;
	/** Lookup-only access to staged appearance resources; never initiates GPU preparation. */
	readonly #getAppearance: (
		appearance: DynamicDepthPresentation["visual"]["appearance"],
	) => PreparedDynamicAppearance;

	constructor(
		getPresentation: (nodeId: SceneNodeId) => DynamicDepthPresentation | null,
		getAppearance: (
			appearance: DynamicDepthPresentation["visual"]["appearance"],
		) => PreparedDynamicAppearance,
	) {
		this.#getPresentation = getPresentation;
		this.#getAppearance = getAppearance;
	}

	/** Release borrowed scene/resources and invalidate all spans before the next frame's queries. */
	beginFrame(): void {
		this.#preparedShadow.clear();
		this.#preparedSelection.clear();
		for (const storage of this.#storage) storage.ranges.length = 0;
		this.#usedStorage = 0;
		this.#selectedParts.clear();
	}

	/** Check analytic eligibility without building depth spans or uploading pose rows. */
	hasOutdoorDynamicShadowGeometry(
		nodeId: SceneNodeId,
		showRetailHiddenGeometry: boolean,
	): boolean {
		const visible = this.#getPresentation(nodeId);
		if (
			visible === null ||
			!visible.renderScopes.some((scope) => scope.kind === "outdoor")
		)
			return false;
		const appearance = this.#getAppearance(visible.visual.appearance);
		const opaqueVariant = selectOpaqueDynamicAppearanceVariant(
			appearance,
			visible.visual.parts.length,
			visible.allPartsOpaque,
			showRetailHiddenGeometry,
		);
		return opaqueVariant
			? opaqueVariant.admission.hasMaterialFreeShadowGeometry
			: summarizeDynamicRangeAdmission(
					appearance.rangeGroupsByPart,
					visible.visual.parts,
					showRetailHiddenGeometry,
				).hasMaterialFreeShadowGeometry;
	}

	/** Prepare opaque spans only for material-free shadow depth and shadow caster tiers. */
	prepare(
		nodeId: SceneNodeId,
		showRetailHiddenGeometry: boolean,
	): PreparedDynamicDepth | null {
		const existing = this.#preparedShadow.get(nodeId);
		if (existing !== undefined) return existing;
		const prepared = this.#prepare(nodeId, showRetailHiddenGeometry, true);
		this.#preparedShadow.set(nodeId, prepared);
		return prepared;
	}

	/** Prepare authored-visible spans regardless of current opacity for the selection mask. */
	prepareSelection(
		nodeId: SceneNodeId,
		showRetailHiddenGeometry: boolean,
	): PreparedDynamicDepth | null {
		const existing = this.#preparedSelection.get(nodeId);
		if (existing !== undefined) return existing;
		const prepared = this.#prepare(nodeId, showRetailHiddenGeometry, false);
		this.#preparedSelection.set(nodeId, prepared);
		return prepared;
	}

	#prepare(
		nodeId: SceneNodeId,
		showRetailHiddenGeometry: boolean,
		opaqueOnly: boolean,
	): PreparedDynamicDepth | null {
		const visible = this.#getPresentation(nodeId);
		if (visible === null) return null;
		const appearance = this.#getAppearance(visible.visual.appearance);
		if (appearance.kind === "empty") return null;
		const opaqueVariant = selectOpaqueDynamicAppearanceVariant(
			appearance,
			visible.visual.parts.length,
			visible.allPartsOpaque,
			showRetailHiddenGeometry,
		);
		if (opaqueVariant) {
			const depth = opaqueOnly
				? opaqueVariant.shadowDepth
				: opaqueVariant.selectionDepth;
			if (depth.ranges.length === 0) return null;
			return {
				nodeId,
				landblockId: visible.landblockId,
				renderScopes: visible.renderScopes,
				geometry: visible.visual.layout.key,
				appearance,
				parts: visible.visual.parts,
				ranges: depth.ranges,
				selectedPartCount: depth.selectedPartCount,
				selectedTriangleCount: depth.selectedTriangleCount,
			};
		}
		let storage = this.#storage[this.#usedStorage];
		if (storage === undefined) {
			storage = { ranges: [], pool: [] };
			this.#storage.push(storage);
		}
		const { ranges, pool } = storage;
		this.#selectedParts.clear();
		let selectedTriangleCount = 0;
		for (const range of appearance.plan.physicalRanges) {
			const part = visible.visual.parts[range.source.partSelector];
			if (part === undefined)
				throw new Error(
					`Dynamic depth range references missing part ${range.source.partSelector}.`,
				);
			// Shadow passes omit non-opaque spans (alpha-test, transparent, and additive)
			// because depth-only shaders cannot evaluate texture cutouts or alpha blend factors.
			// Selection keeps current-pose geometry through fades, including fully transparent parts.
			const retained = opaqueOnly
				? retainsDynamicShadowRange(
						range.source.ordering,
						part.frameInstance.color.a,
						range.source.retailVisibility,
						showRetailHiddenGeometry,
					)
				: retainsRetailGeometry(
						range.source.retailVisibility,
						showRetailHiddenGeometry,
					);
			if (!retained) continue;
			const last = ranges.at(-1);
			const cullFace = range.batch.cullFace;
			if (
				last !== undefined &&
				last.cullFace === cullFace &&
				last.indexStart + last.indexCount === range.indexStart
			)
				last.indexCount += range.source.indexCount;
			else {
				let span = pool[ranges.length];
				if (span === undefined) {
					span = {
						cullFace,
						indexStart: range.indexStart,
						indexCount: range.source.indexCount,
					};
					pool.push(span);
				} else {
					span.cullFace = cullFace;
					span.indexStart = range.indexStart;
					span.indexCount = range.source.indexCount;
				}
				ranges.push(span);
			}
			this.#selectedParts.add(range.source.partSelector);
			selectedTriangleCount += range.source.indexCount / 3;
		}
		if (ranges.length === 0) return null;
		this.#usedStorage += 1;
		return {
			nodeId,
			landblockId: visible.landblockId,
			renderScopes: visible.renderScopes,
			geometry: visible.visual.layout.key,
			appearance,
			parts: visible.visual.parts,
			ranges,
			selectedPartCount: this.#selectedParts.size,
			selectedTriangleCount,
		};
	}
}
