import type { LandblockId } from "../game-types";
import type { GeometryKey } from "../geometry/types";
import type { Camera } from "../runtime/types";
import type { Frustum } from "../math/frustum";
import type { ResolvedScenePlacement, SceneNodeId, VisibleScene } from "../scene";
import type { TerrainDrawUnit } from "../terrain/types";
import type { DynamicEntityRenderable } from "../systems/components";
import type {
	EnvCellRenderable,
	PortalDrawUnit,
	StaticObjectDrawUnit,
	StaticObjectRenderable,
} from "../commit/artifacts";
import type {
	TextureArrayBinding,
	TextureAtlasBinding,
} from "../textures/texture-manager";
import type {
	GeneratedTextureKey,
	AssetTextureKey,
	TextureArrayKey,
} from "../textures/types";
import type {
	GeometryResourceKey,
	InstanceStreamResourceKey,
	Texture2DResourceKey,
} from "./resource-manager";
import type { InstanceStreamManager } from "../systems/instance-stream-manager";

/** Private read-only query ports captured by one RenderWorld. */
interface RenderWorldSystems {
	readonly objectDetail: {
		getBinding(): ActiveRegionObjectDetailRenderBinding | null;
	};
	readonly scene: {
		getResolvedPlacement(nodeId: SceneNodeId): ResolvedScenePlacement | undefined;
		queryFrustum(
			frustum: Frustum,
			anchorLandblockId: LandblockId,
			origin: import("../scene").SceneScope,
		): VisibleScene;
	};
	readonly terrain: {
		getDrawUnit(
			nodeId: SceneNodeId,
			anchorLandblockId: LandblockId,
		): TerrainDrawUnit | null;
	};
	readonly staticObjects: {
		getRenderable(nodeId: SceneNodeId): StaticObjectRenderable | null;
	};
	readonly dynamics: {
		getRenderable(nodeId: SceneNodeId): DynamicEntityRenderable | null;
	};
	readonly envCells: {
		getCellRenderable(nodeId: SceneNodeId): EnvCellRenderable | null;
		getPortalDrawUnit(
			apertureId: `portal-aperture:${string}`,
		): PortalDrawUnit | null;
	};
	readonly geometry: {
		getResource(key: GeometryKey): GeometryResourceKey;
	};
	readonly instances: Pick<InstanceStreamManager, "getResource">;
	readonly textures: {
		getAtlasBinding(key: AssetTextureKey): TextureAtlasBinding;
		getTexture2DResource(
			key: AssetTextureKey | GeneratedTextureKey,
		): Texture2DResourceKey;
		getTextureArrayBinding(key: TextureArrayKey): TextureArrayBinding;
	};
}

/** Active-region detail selected independently from the current landblock's packed pages. */
export interface ActiveRegionObjectDetailRenderBinding {
	readonly key: AssetTextureKey;
	readonly tiling: number;
}

/** One typed logical render contribution selected from a visible scene node. */
export type RenderContribution =
	| {
			readonly kind: "static-object";
			readonly renderable: StaticObjectRenderable;
	  }
	| { readonly kind: "dynamic"; readonly renderable: DynamicEntityRenderable }
	| { readonly kind: "env-cell"; readonly renderable: EnvCellRenderable }
	| { readonly kind: "terrain"; readonly drawUnit: TerrainDrawUnit };

/** Backend selections for one static draw, without renderer pass policy. */
export interface ResolvedStaticDrawUnit {
	readonly drawUnit: StaticObjectDrawUnit;
	readonly geometry: GeometryResourceKey;
	readonly instances: InstanceStreamResourceKey | null;
}

/** One visible static node with its resolved landblock placement and device selections. */
export interface ResolvedStaticObjectNode {
	readonly placement: ResolvedScenePlacement;
	readonly drawUnits: readonly ResolvedStaticDrawUnit[];
}

/** Backend geometry selection for a rigid dynamic or cell-shell draw. */
export interface ResolvedGeometryDrawUnit<TDrawUnit> {
	readonly drawUnit: TDrawUnit;
	readonly geometry: GeometryResourceKey;
}

/** Read-only renderer view of the runtime systems that own scene and resource state. */
export class RenderWorld {
	readonly #systems: RenderWorldSystems;

	constructor(systems: RenderWorldSystems) {
		this.#systems = systems;
	}

	queryVisibleScene(
		camera: Camera,
		frustum: Frustum,
		anchorLandblockId: LandblockId,
	): VisibleScene {
		const origin =
			camera.placement.envCellId === null
				? {
						kind: "outdoor" as const,
					}
				: {
						envCellId: camera.placement.envCellId,
						kind: "env-cell" as const,
						landblockId: camera.placement.landblockId,
					};
		return this.#systems.scene.queryFrustum(frustum, anchorLandblockId, origin);
	}

	resolveTerrainDrawUnit(
		nodeId: SceneNodeId,
		anchorLandblockId: LandblockId,
	): TerrainDrawUnit | null {
		return this.#systems.terrain.getDrawUnit(nodeId, anchorLandblockId);
	}

	getRenderContribution(
		nodeId: SceneNodeId,
		anchorLandblockId: LandblockId,
	): RenderContribution | null {
		const staticObject = this.#systems.staticObjects.getRenderable(nodeId);
		if (staticObject)
			return { kind: "static-object", renderable: staticObject };
		const dynamic = this.#systems.dynamics.getRenderable(nodeId);
		if (dynamic) return { kind: "dynamic", renderable: dynamic };
		const cell = this.#systems.envCells.getCellRenderable(nodeId);
		if (cell) return { kind: "env-cell", renderable: cell };
		const terrain = this.resolveTerrainDrawUnit(nodeId, anchorLandblockId);
		return terrain ? { drawUnit: terrain, kind: "terrain" } : null;
	}

	getPortalDrawUnit(
		apertureId: `portal-aperture:${string}`,
	): PortalDrawUnit | null {
		return this.#systems.envCells.getPortalDrawUnit(apertureId);
	}

	resolveStaticObjectRenderable(
		renderable: StaticObjectRenderable,
	): readonly ResolvedStaticDrawUnit[] {
		return renderable.drawUnits.map((drawUnit) => ({
			drawUnit,
			geometry: this.resolveGeometry(drawUnit.geometry),
			instances:
				drawUnit.kind === "instanced"
					? this.#systems.instances.getResource(drawUnit.instances)
					: null,
		}));
	}

	/** Resolve a visible static node without exposing mutable scene or resource systems. */
	resolveStaticObjectNode(
		nodeId: SceneNodeId,
		renderable: StaticObjectRenderable,
	): ResolvedStaticObjectNode {
		const placement = this.#systems.scene.getResolvedPlacement(nodeId);
		if (!placement) throw new Error(`Static object node ${nodeId} no longer exists.`);
		return {
			drawUnits: this.resolveStaticObjectRenderable(renderable),
			placement,
		};
	}

	resolveDynamicRenderable(
		renderable: DynamicEntityRenderable,
	): readonly ResolvedGeometryDrawUnit<
		DynamicEntityRenderable["parts"][number]
	>[] {
		return renderable.parts.map((drawUnit) => ({
			drawUnit,
			geometry: this.resolveGeometry(drawUnit.geometry),
		}));
	}

	resolveEnvCellRenderable(
		renderable: EnvCellRenderable,
	): readonly ResolvedGeometryDrawUnit<
		EnvCellRenderable["drawUnits"][number]
	>[] {
		return renderable.drawUnits.map((drawUnit) => ({
			drawUnit,
			geometry: this.resolveGeometry(drawUnit.geometry),
		}));
	}

	resolvePortalDrawUnit(
		drawUnit: PortalDrawUnit,
	): ResolvedGeometryDrawUnit<PortalDrawUnit> {
		return { drawUnit, geometry: this.resolveGeometry(drawUnit.geometry) };
	}

	resolveGeometry(key: GeometryKey): GeometryResourceKey {
		return this.#systems.geometry.getResource(key);
	}

	resolveTexture2D(
		key: AssetTextureKey | GeneratedTextureKey,
	): Texture2DResourceKey {
		return this.#systems.textures.getTexture2DResource(key);
	}

	resolveAtlasTexture(key: AssetTextureKey): TextureAtlasBinding {
		return this.#systems.textures.getAtlasBinding(key);
	}

	resolveActiveRegionObjectDetail(): ActiveRegionObjectDetailRenderBinding | null {
		return this.#systems.objectDetail.getBinding();
	}

	resolveTextureArray(key: TextureArrayKey): TextureArrayBinding {
		return this.#systems.textures.getTextureArrayBinding(key);
	}
}
