import type {
	OutdoorStaticObjectLayerDomain,
	StaticDrawUnit,
} from "../static/contracts";
import type { TextureResourceDependencies } from "../textures/placement";
import type { DynamicAnimationPartBinding } from "./object-visual-recipe-bundle";
import type {
	ObjectVisualObjectIdentity,
	ObjectVisualSourceIdentity,
} from "./object-visual-source-payload";
import type {
	VisualGeometryMaterialTableEntry,
	VisualGeometryPayload,
	VisualGeometryRenderState,
} from "./visual-geometry";
import type { TextureBindingId } from "../textures/identity";

export type ObjectVisualDirectDrawUnit = Extract<
	StaticDrawUnit,
	{ readonly kind: "static-object-geometry" | "structured-interior-geometry" }
>;

export type ObjectVisualResourceId = string;

export interface ObjectVisualResourceKey {
	readonly kind: "static-object-visual-resource-key";
	/**
	 * Source-local geometry identity. Per-instance placement, residence, object id, bounds, and
	 * current sort bucket do not belong in the reusable key.
	 */
	readonly geometry: ObjectVisualSourceGeometryKey;
	/** Material family/pass choose shader and draw-list behavior. */
	readonly materialFamily: VisualGeometryPayload["materialFamily"];
	readonly materialPass: VisualGeometryPayload["materialPass"];
	/** Render state affects depth/blend/cull-equivalent behavior and is part of resource batching. */
	readonly renderState: VisualGeometryRenderState;
	/** Renderer-visible material/texture layout for every material slot used by the shared geometry. */
	readonly materialEntries: readonly VisualGeometryMaterialTableEntry[];
	/** GPU index element width required by the resource upload. */
	readonly indexType: VisualGeometryPayload["indexType"];
	/** Renderer texture bindings owned by this reusable resource. */
	readonly textureUseIds: readonly TextureBindingId[];
}

export interface ObjectVisualResource extends VisualGeometryPayload {
	readonly kind: "static-object-visual-resource";
	readonly resourceId: ObjectVisualResourceId;
	readonly key: ObjectVisualResourceKey;
	readonly geometry: ObjectVisualSourceGeometryKey;
	/**
	 * Source-local geometry copied from the source sidecar. Per-instance placement and scale are
	 * applied by the render instance.
	 */
	readonly coordinateSpace: "static-object-source-local";
}

export interface ObjectVisualRenderInstance {
	readonly kind: "static-object-render-instance";
	readonly instanceId: string;
	readonly resourceId: ObjectVisualResourceId;
	readonly domain: OutdoorStaticObjectLayerDomain;
	readonly landblockId: number;
	readonly transform: ObjectVisualPlacementTransform;
	/** Full source-geometry-to-landblock matrix for this object/part. */
	readonly sourceToLandblockMatrix: Float32Array;
	readonly bounds: ObjectVisualBounds;
	readonly sortCenter: ObjectVisualVec3;
	readonly transparency: ObjectVisualTransparencySubmission;
	readonly source: ObjectVisualObjectIdentity;
	readonly generated: ObjectVisualGeneratedFacts | null;
}

export interface ObjectVisualInstallSet {
	/** Object-like draw units that are already renderer-ready and do not use resource instancing. */
	readonly directDrawUnits: readonly ObjectVisualDirectDrawUnit[];
	/** Source-part animation bindings for dynamic or dynamic-shaped object visuals. */
	readonly dynamicAnimationPartBindings: readonly DynamicAnimationPartBinding[];
	/** Per-instance placements for reusable object visual resources. */
	readonly renderInstances: readonly ObjectVisualRenderInstance[];
	/** Texture dependencies pinned by renderer resource identity. */
	readonly textureDependencies: readonly TextureResourceDependencies[];
	/** Reusable object visual resources shared by one or more render instances. */
	readonly visualResources: readonly ObjectVisualResource[];
}

export function createEmptyObjectVisualInstallSet(): ObjectVisualInstallSet {
	return {
		directDrawUnits: [],
		dynamicAnimationPartBindings: [],
		renderInstances: [],
		textureDependencies: [],
		visualResources: [],
	};
}

export function createObjectVisualInstallSet(input: {
	readonly directDrawUnits?: readonly ObjectVisualDirectDrawUnit[];
	readonly dynamicAnimationPartBindings?: readonly DynamicAnimationPartBinding[];
	readonly renderInstances?: readonly ObjectVisualRenderInstance[];
	readonly textureDependencies?: readonly TextureResourceDependencies[];
	readonly visualResources?: readonly ObjectVisualResource[];
}): ObjectVisualInstallSet {
	return {
		directDrawUnits: input.directDrawUnits ?? [],
		dynamicAnimationPartBindings: input.dynamicAnimationPartBindings ?? [],
		renderInstances: input.renderInstances ?? [],
		textureDependencies: input.textureDependencies ?? [],
		visualResources: input.visualResources ?? [],
	};
}

export interface ObjectVisualSourceGeometryKey {
	readonly kind: "static-object-source-geometry";
	readonly source: ObjectVisualSourceIdentity;
	readonly canonical: ObjectVisualCanonicalGeometryKey;
}

interface ObjectVisualCanonicalGeometryKey {
	readonly kind: "static-object-canonical-geometry";
	readonly gfxObj: ObjectVisualSourceIdentity;
	readonly partIndex: number;
}

interface ObjectVisualPlacementTransform {
	readonly origin: ObjectVisualVec3;
	readonly orientation: ObjectVisualQuaternion;
}

interface ObjectVisualQuaternion {
	readonly w: number;
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

interface ObjectVisualVec3 {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

interface ObjectVisualBounds {
	readonly min: ObjectVisualVec3;
	readonly max: ObjectVisualVec3;
}

interface ObjectVisualGeneratedFacts {
	readonly terrainIndex: number;
	readonly sceneId: number;
	readonly sceneTemplateIndex: number;
}

type ObjectVisualTransparencySubmission =
	| {
			readonly kind: "depth-writing";
	  }
	| {
			readonly kind: "instanced-transparent";
			readonly sortCenter: ObjectVisualVec3;
	  }
	| {
			readonly kind: "direct-sorted-transparent";
			readonly sortCenter: ObjectVisualVec3;
	  };
