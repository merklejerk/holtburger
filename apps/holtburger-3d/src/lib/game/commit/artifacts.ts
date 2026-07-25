import type {
	GeometryKey,
	GeometrySource,
	ObjectGeometryKey,
} from "../geometry/types";
import type { AABB3 } from "../math/types";
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
import type { AssetTextureKey, TexturePurpose } from "../textures/types";

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
	readonly polygon: {
		readonly sidedness: "one-sided" | "two-sided";
		readonly positiveSurfaceId: string | null;
		readonly negativeSurfaceId: string | null;
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
}

/** Instanced immutable geometry selected by one persistent instance cohort. */
export interface InstancedStaticDrawUnit {
	readonly kind: "instanced";
	readonly geometry: StaticGeometryKey;
	readonly instances: StaticInstanceStreamKey;
	readonly indexStart: number;
	readonly indexCount: number;
	readonly material: StaticObjectMaterialBinding;
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
