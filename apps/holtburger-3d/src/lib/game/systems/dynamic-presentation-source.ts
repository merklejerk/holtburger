import type { DatAssetId } from "../game-types";
import type { AABB3, Vec3 } from "../math/types";
import type { ResolvedObjectBehavior } from "../resolution/landblock-layer";
import type { ResolvedObjectPresentation } from "../resolution/presentation";
import type { SceneSpatialPlacement } from "../scene";
import type { DynamicEntityPresentationClass } from "../dynamic-entity-presentation-class";

/** Complete visual value currently painted into one entity nameplate. */
export interface NameplateContent {
	readonly name: string;
	readonly level: number | null;
}

/** Immutable visual and setup-default behavior facts shared by every dynamic producer. */
export interface DynamicPresentationSource {
	/** Producer-resolved entity class controlling presentation participation. */
	readonly entityClass: DynamicEntityPresentationClass;
	/** Producer-stable identity used for behavior, diagnostics, and deterministic presentation ties. */
	readonly identity: string;
	/** Entity display content, or null for authored dynamics without an entity authority. */
	readonly nameplate: NameplateContent | null;
	/** Exact SetupModel DAT identity that owns setup-default behavior. */
	readonly setupId: DatAssetId;
	/** Host-resolved appearance and rigid-part inputs. */
	readonly presentation: ResolvedObjectPresentation;
	/** Setup-default behavior references; decoded assets remain behind repositories. */
	readonly behavior: ResolvedObjectBehavior;
	/** Producer-selected root scale in render axes. */
	readonly scale: Vec3;
	/** Bounds in the entity root's local coordinate space. */
	readonly localBounds: AABB3 | null;
}

/** Mutable presentation consequences carried independently from immutable visual identity. */
export interface DynamicEntityPresentationState {
	readonly noDraw: boolean;
	readonly hidden: boolean;
	readonly cloaked: boolean;
	readonly lighting: boolean;
	/** Current whole-object translucency in the inclusive unit interval. */
	readonly translucency: number;
}

/** One dynamic presentation plus producer-owned initial scene placement. */
export interface PlacedDynamicPresentationSource {
	readonly source: DynamicPresentationSource;
	readonly placement: SceneSpatialPlacement;
	/** Complete initial state installed before setup behavior is replayed. */
	readonly initialPresentationState: DynamicEntityPresentationState;
}
