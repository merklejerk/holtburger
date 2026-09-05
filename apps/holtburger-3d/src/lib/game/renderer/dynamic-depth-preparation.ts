import type { SceneNodeId } from "../scene";
import type {
	ActiveDynamicPart,
	VisibleDynamicPresentation,
} from "../systems/components";
import type { PreparedDynamicAppearance } from "./webgl2-dynamic-appearances";
import { retainsRetailGeometry } from "./retail-geometry-visibility";

/** Compact inputs shared by material-free mask and mapped-shadow preparation. */
export type DynamicDepthPresentation = Pick<
	VisibleDynamicPresentation,
	"landblockId" | "renderScopes"
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
		readonly parts: readonly Pick<ActiveDynamicPart, "frameInstance">[];
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
	readonly #prepared = new Map<SceneNodeId, PreparedDynamicDepth | null>();
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
		this.#prepared.clear();
		for (const storage of this.#storage) storage.ranges.length = 0;
		this.#usedStorage = 0;
		this.#selectedParts.clear();
	}

	/** All consumers pass the same frame-global retail visibility setting. */
	prepare(
		nodeId: SceneNodeId,
		showRetailHiddenGeometry: boolean,
	): PreparedDynamicDepth | null {
		const existing = this.#prepared.get(nodeId);
		if (existing !== undefined) return existing;
		const prepared = this.#prepare(nodeId, showRetailHiddenGeometry);
		this.#prepared.set(nodeId, prepared);
		return prepared;
	}

	#prepare(
		nodeId: SceneNodeId,
		showRetailHiddenGeometry: boolean,
	): PreparedDynamicDepth | null {
		const visible = this.#getPresentation(nodeId);
		if (visible === null) return null;
		const appearance = this.#getAppearance(visible.visual.appearance);
		if (appearance.kind === "empty") return null;
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
			// Both material-free passes retain partial fades and ignore texture alpha.
			if (
				part.frameInstance.color.a === 0 ||
				!retainsRetailGeometry(
					range.source.retailVisibility,
					showRetailHiddenGeometry,
				)
			)
				continue;
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
