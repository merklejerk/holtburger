import type { RuntimeLight } from "../environment/runtime-lights";
import type {
	GeometrySource,
	ObjectGeometryKey,
	PortalGeometryKey,
} from "../geometry/types";
import type { LandblockOwnerId } from "../game-types";
import type { AABB3 } from "../math/types";
import type { LandblockVec3 } from "../../assets/ac-frame";
import type { ObjectMaterialOrdering } from "../resolution/object-material-planner";
import type { StaticDetailRole } from "../resolution/static-detail-role";
import type {
	SceneEnvCellScopeInput,
	ScenePlacement,
	ScenePortalCrossingInput,
} from "../scene";
import type {
	ResolvedMaterial,
	RetailGeometryVisibility,
} from "../resolution/presentation";
import type {
	StaticGeometryKey,
	StaticInstallResourceNamespace,
	ObjectInstanceData,
} from "../systems/static-resources";
import type {
	AssetTextureKey,
	AssetTextureFact,
	TextureSamplerPolicy,
} from "../textures/types";

/** Transform, color, and landblock-space center floats retained by one transparent template. */
const FRAME_STREAMED_OBJECT_INSTANCE_TEMPLATE_FLOAT_COUNT = 23;

/** Fixed numeric payload bytes retained by one transparent instance template. */
export const FRAME_STREAMED_OBJECT_INSTANCE_TEMPLATE_BYTES =
	FRAME_STREAMED_OBJECT_INSTANCE_TEMPLATE_FLOAT_COUNT *
	Float32Array.BYTES_PER_ELEMENT;

/** Geometry strategies observed for one static-object preparation attempt. */
/** Geometry-worker facts retained beside a materialized static layer artifact. */
export interface StaticObjectGeometryDiagnostics {
	/** Static residents admitted to geometry preparation. */
	readonly sourceResidentCount: number;
	/** Setup or direct-geometry parts contributed by the source residents. */
	readonly sourcePartCount: number;
	/** Naive resident/part/material-slot submissions before polygon facts are distinguished. */
	readonly sourceMaterialSlotCount: number;
	/** Source resident/part/complete-binding submissions after polygon facts are distinguished. */
	readonly sourceRangeCount: number;
	/** Baked draw ranges in the layer's merged static buffer. */
	readonly bakedRangeCount: number;
	readonly bakedGeometryBytes: number;
	/** Bytes of shared template source geometry, instanced per frame by transparent residue. */
	readonly instancedGeometryBytes: number;
	readonly transparentTemplateCohortCount: number;
	readonly transparentTemplateInstanceCount: number;
	/** Fixed transform, color, and center payload bytes retained on the CPU. */
	readonly transparentTemplateBytes: number;
	/** Wall-clock duration inside the closed geometry worker. */
	readonly geometryWorkerDurationMs: number;
}

/** Source-to-geometry diagnostics retained with one outdoor-static layer commit. */
export interface StaticObjectLayerDiagnostics extends StaticObjectGeometryDiagnostics {
	/** Every source resident, including those promoted out of static materialization. */
	readonly expectedResidentCount: number;
	/** Source residents classified as eligible for static materialization. */
	readonly resolvedStaticResidentCount: number;
	/** Static residents represented by the published geometry, or zero for an empty artifact. */
	readonly materializedStaticResidentCount: number;
	/** Source residents promoted to the authored dynamic runtime. */
	readonly promotedDynamicResidentCount: number;
}

/** Source material plus polygon-owned facts; render pass policy remains renderer-private. */
export interface ObjectMaterialBinding {
	readonly source: ResolvedMaterial;
	/** Active-region detail binding selected by the owning static render domain, if any. */
	readonly detailRole: StaticDetailRole | null;
	/** Logical texture roles remain independent from their eventual atlas page placements. */
	readonly textures: {
		readonly base: AssetTextureKey | null;
		readonly palette: AssetTextureKey | null;
	};
	/** Draw-time source-local sampler policy, retained independently from packed gutters. */
	readonly sampler: TextureSamplerPolicy;
	/** Renderer compilation applies the retail indexed clip-map rule from this lossless fact. */
	readonly palettedClipMap: boolean;
	readonly polygon: {
		/** Effective GPU face rejection for this already-expanded render side. */
		readonly cullFace: "back" | "front";
		/** Retail SetSurface stippling flag selected from the expanded source side. */
		readonly stippled: boolean;
	};
}

/** Baked immutable geometry selected directly by one static draw. */
export interface StaticObjectDrawUnit {
	/** Geometry-owned material row addressed by every vertex in this range. */
	readonly materialSelector: number;
	readonly geometry: StaticGeometryKey;
	readonly indexStart: number;
	readonly indexCount: number;
	readonly material: ObjectMaterialBinding;
	/** Renderer-neutral ordering class selected from lossless source material facts. */
	readonly ordering: ObjectMaterialOrdering;
	/** Retail draw eligibility shared by every triangle in this immutable range. */
	readonly retailVisibility: RetailGeometryVisibility;
	/**
	 * Stable distance-sort input present only for transparent ranges.
	 *
	 * `center` is in landblock space, the space every transparent sort center reaches the renderer
	 * in. Baked ranges merge their contributions in landblock space already, so the bake stores the
	 * merged centroid verbatim.
	 */
	readonly transparentSort: {
		readonly stableId: string;
		readonly center: LandblockVec3;
	} | null;
}

/** Immutable source draw shared by every instance of one prepared geometry partition. */
export interface StaticObjectInstanceDraw {
	/** Complete semantic cohort identity for adjacent compatible-run coalescing. */
	readonly cohortKey: string;
	readonly geometry: StaticGeometryKey;
	readonly indexStart: number;
	readonly indexCount: number;
	readonly material: ObjectMaterialBinding;
	/** Retail draw eligibility shared by the source geometry partition. */
	readonly retailVisibility: RetailGeometryVisibility;
}

/** Immutable instance placement and sort facts retained for current-view ordering. */
export interface FrameStreamedObjectInstanceTemplate {
	/** Shared by reference through worker transport and used as the compiled draw cache key. */
	readonly draw: StaticObjectInstanceDraw;
	readonly instance: ObjectInstanceData;
	/**
	 * Stable distance-sort facts for this instance.
	 *
	 * `center` is in landblock space: the geometry is shared source-local, but each template's
	 * placement is fixed at bake, so the bake applies it once instead of every ordering frame.
	 */
	readonly transparentSort: {
		readonly center: LandblockVec3;
		readonly stableId: string;
	};
}

/** Persistent immutable-object presentation attached to one spatial scene node. */
export interface StaticObjectRenderable {
	readonly drawUnits: readonly StaticObjectDrawUnit[];
	/** Camera-ordered transparent contributions uploaded through renderer-owned frame storage. */
	readonly frameStreamedInstances: readonly FrameStreamedObjectInstanceTemplate[];
}

/** One immutable object publication emitted before SceneGraph assigns its node identity. */
export interface StaticObjectArtifact {
	readonly placement: ScenePlacement;
	/** Bounds in the object root's local coordinate space. */
	readonly localBounds: AABB3;
	readonly renderable: StaticObjectRenderable;
}

/** Complete data-only static-object layer prepared before runtime installation. */
export interface StaticObjectLayerArtifact {
	/** Collision-free namespace allocated before worker dispatch. */
	readonly resourceNamespace: StaticInstallResourceNamespace;
	readonly objects: readonly StaticObjectArtifact[];
	readonly geometry: readonly GeometrySource[];
	/** Complete logical requirements whose bindings must be ready before publication. */
	readonly textureRequirements: readonly AssetTextureFact[];
	/** Exact closed-worker facts for this materialized geometry. */
	readonly geometryDiagnostics: StaticObjectGeometryDiagnostics;
	/**
	 * Authored lights this layer emits, in landblock space.
	 *
	 * Only the outdoor Objects layer ever populates this: buildings reference GfxObjs, which
	 * cannot carry lights, no generated-scenery template authors one, and interior residents are
	 * lit by their bake instead. Gathered here so the set is resolved once per residency change
	 * rather than per frame.
	 */
	readonly staticLights: readonly RuntimeLight[];
}

/** Persistent shell render contribution attached to one env-cell root node. */
export interface EnvCellRenderable {
	/** Logical shell draw units remain domain-owned until renderer policy is implemented. */
	readonly drawUnits: readonly EnvCellDrawUnit[];
}

/** One logical env-cell shell draw range. */
export interface EnvCellDrawUnit {
	/** Source geometry selected by the cell structure baker. */
	readonly geometry: ObjectGeometryKey;
	/** First index selected from the source geometry. */
	readonly indexStart: number;
	/** Number of selected geometry indices. */
	readonly indexCount: number;
	/** Renderer-neutral material source selected for this draw. */
	readonly material: ObjectMaterialBinding;
	readonly ordering: ObjectMaterialOrdering;
	/**
	 * Stable ordering facts required only for transparent ranges.
	 *
	 * `center` is in landblock space; realization applies the shell's structure placement once,
	 * because a cell's structure never moves after it is realized.
	 */
	readonly transparentSort: {
		readonly stableId: string;
		readonly center: LandblockVec3;
	} | null;
}

/** Portal draw contribution addressed by topology rather than a scene node. */
export interface PortalDrawUnit {
	/** Portal aperture whose topology traversal selected this contribution. */
	readonly apertureId: `portal-aperture:${string}`;
	/** Geometry retained by the env-cell system and resolved by renderer policy. */
	readonly geometry: PortalGeometryKey;
	readonly indexStart: number;
	readonly indexCount: number;
	/** Landblock frame containing the already-transformed aperture positions. */
	readonly landblockId: LandblockOwnerId;
}

/** Bounded cell-shell presentation published as a scene resident. */
export interface EnvCellShellArtifact {
	/** Root placement mapping source structure space into its landblock. */
	readonly placement: ScenePlacement;
	/** Bounds in the reusable cell structure's local geometry frame. */
	readonly structureLocalBounds: AABB3;
	readonly renderable: EnvCellRenderable;
}

/** Complete data-only env-cell layer prepared before runtime installation. */
export interface EnvCellLayerArtifact {
	/** Shell and aperture geometry owned exactly once by the environment transaction. */
	readonly geometry: readonly GeometrySource[];
	readonly cellShells: readonly EnvCellShellArtifact[];
	readonly portalDrawUnits: ReadonlyMap<
		`portal-aperture:${string}`,
		PortalDrawUnit
	>;
	readonly scopes: readonly SceneEnvCellScopeInput[];
	readonly crossings: readonly ScenePortalCrossingInput[];
}
