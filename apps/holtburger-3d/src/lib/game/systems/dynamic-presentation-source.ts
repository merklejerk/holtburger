import type { DatAssetId } from "../game-types";
import type { AABB3, Vec3 } from "../math/types";
import type { ResolvedObjectBehavior } from "../resolution/landblock-layer";
import type { ResolvedObjectPresentation } from "../resolution/presentation";
import type { SceneSpatialPlacement } from "../scene";
import type { DynamicEntityCategory } from "../dynamic-entity-category";

/** Immutable visual and setup-default behavior facts shared by every dynamic producer. */
export interface DynamicPresentationSource {
	/** Producer-resolved frontend category controlling presentation participation. */
	readonly category: DynamicEntityCategory;
	/** Producer-stable identity used for behavior, diagnostics, and deterministic presentation ties. */
	readonly identity: string;
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

/** One dynamic presentation plus producer-owned initial scene placement. */
export interface PlacedDynamicPresentationSource {
	readonly source: DynamicPresentationSource;
	readonly placement: SceneSpatialPlacement;
}
