import type {
	GeometryKey,
	GeometrySource,
	ObjectGeometryKey,
} from "../geometry/types";
import type { AABB3 } from "../math/types";
import type { Vec3 } from "../math/types";
import type { ObjectMaterialOrdering } from "../resolution/object-material-planner";
import type {
	SceneEnvCellScopeInput,
	ScenePlacement,
	ScenePortalCrossingInput,
} from "../scene";
import type { ResolvedMaterial } from "../resolution/presentation";
import type {
	StaticGeometryKey,
	StaticInstallResourceNamespace,
	StaticInstanceStreamKey,
	StaticInstanceStreamSource,
} from "../systems/static-resources";
import type {
	TexturePageId,
	TexturePlacement,
} from "../textures/texture-manager";
import type {
	AssetTextureKey,
	AssetTextureFact,
	TexturePurpose,
	TextureSamplerPolicy,
} from "../textures/types";

/** Source-to-bake diagnostics retained with one static building-layer commit. */
export interface StaticObjectLayerDiagnostics {
	/** Every source resident, including those promoted out of static materialization. */
	readonly expectedResidentCount: number;
	/** Source residents classified as eligible for static materialization. */
	readonly resolvedStaticResidentCount: number;
	/** Static residents represented by the published geometry, or zero for an empty artifact. */
	readonly materializedStaticResidentCount: number;
	/** Source residents promoted to the existing runtime-deferred dynamic seam. */
	readonly promotedDynamicResidentCount: number;
	/** Naive resident/part/material-slot submissions before polygon facts are distinguished. */
	readonly sourceMaterialSlotCount: number;
	/** Source resident/part/complete-binding submissions after polygon facts are distinguished. */
	readonly sourceRangeCount: number;
	/** Final baked draw ranges retained by the published static artifact. */
	readonly bakedRangeCount: number;
	/** Final independent transparent ranges requiring camera-dependent ordering. */
	readonly transparentRangeCount: number;
	/** Final additive ranges submitted in their distinct deterministic phase. */
	readonly additiveRangeCount: number;
	/** Bytes in the final one-allocation object geometry. */
	readonly geometryBytes: number;
	/** Bytes uploaded by the building atlas pages before shared-page arbitration. */
	readonly packedTextureBytes: number;
	/** Packed static atlas pages emitted by this building layer. */
	readonly atlasPageCount: number;
	/** Wall-clock duration inside the closed geometry worker. */
	readonly geometryWorkerDurationMs: number;
	/** Wall-clock duration inside the closed texture-packing worker. */
	readonly textureWorkerDurationMs: number;
}

/** Prepared atlas page retained with one committed static-object layer. */
export interface StaticTexturePageArtifact {
	readonly pageId: TexturePageId;
	readonly width: number;
	readonly height: number;
	readonly purpose: TexturePurpose;
	readonly pageBits: Uint8Array;
	readonly textures: readonly {
		readonly key: AssetTextureKey;
		readonly placement: TexturePlacement;
	}[];
}

/** Source material plus polygon-owned facts; render pass policy remains renderer-private. */
export interface StaticObjectMaterialBinding {
	readonly source: ResolvedMaterial;
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
		/** Authored polygon culling mode, retained independently from its expanded render side. */
		readonly cullMode: "single" | "double" | "both" | "counter-clockwise";
		/** Expanded source side that selected this draw range's material and winding. */
		readonly renderSide: "positive" | "positive-reversed" | "negative";
		/** Retail SetSurface stippling flag selected from the expanded source side. */
		readonly stippled: boolean;
	};
}

/** Baked immutable geometry selected directly by one static draw. */
export interface BakedStaticDrawUnit {
	readonly kind: "baked";
	readonly geometry: StaticGeometryKey;
	readonly indexStart: number;
	readonly indexCount: number;
	readonly material: StaticObjectMaterialBinding;
	/** Renderer-neutral ordering class selected from lossless source material facts. */
	readonly ordering: ObjectMaterialOrdering;
	/** Stable distance-sort input present only for transparent ranges. */
	readonly transparentSort: {
		readonly stableId: string;
		readonly center: Vec3;
	} | null;
}

/** Instanced immutable geometry selected by one persistent instance cohort. */
export interface InstancedStaticDrawUnit {
	readonly kind: "instanced";
	readonly geometry: StaticGeometryKey;
	readonly instances: StaticInstanceStreamKey;
	readonly indexStart: number;
	readonly indexCount: number;
	readonly material: StaticObjectMaterialBinding;
	readonly ordering: ObjectMaterialOrdering;
	readonly transparentSort: null;
}

/** Logical immutable-object draw contribution retained beside its spatial node. */
export type StaticObjectDrawUnit =
	| BakedStaticDrawUnit
	| InstancedStaticDrawUnit;

/** Persistent immutable-object presentation attached to one spatial scene node. */
export interface StaticObjectRenderable {
	readonly drawUnits: readonly StaticObjectDrawUnit[];
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
	readonly instanceStreams: readonly StaticInstanceStreamSource[];
	/**
	 * Complete logical source requirements retained beside the legacy physical pages until the
	 * resident-atlas cutover replaces those pages.
	 */
	readonly textureRequirements: readonly AssetTextureFact[];
	readonly texturePages: readonly StaticTexturePageArtifact[];
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
	readonly materialId: string;
}

/** Portal draw contribution addressed by topology rather than a scene node. */
export interface PortalDrawUnit {
	/** Portal aperture whose topology traversal selected this contribution. */
	readonly apertureId: `portal-aperture:${string}`;
	/** Geometry retained by the env-cell system and resolved by renderer policy. */
	readonly geometry: GeometryKey;
	readonly indexStart: number;
	readonly indexCount: number;
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
	readonly cellShells: readonly EnvCellShellArtifact[];
	readonly portalDrawUnits: ReadonlyMap<
		`portal-aperture:${string}`,
		PortalDrawUnit
	>;
	readonly scopes: readonly SceneEnvCellScopeInput[];
	readonly crossings: readonly ScenePortalCrossingInput[];
}
