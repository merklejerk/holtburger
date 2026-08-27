import type { LandblockOwnerId } from "../game-types";
import type { GeometryKey } from "../geometry/types";
import type { Frustum } from "../math/frustum";
import type {
	ResolvedScenePlacement,
	ResolvedSceneBounds,
	SceneNodeId,
	SceneScope,
	SceneScopeSelection,
	SceneTopologyView,
	VisibleScene,
	SceneCullingGroupFilter,
} from "../scene";
import type { AABB3 } from "../math/types";
import type { TerrainDrawUnit } from "../terrain/types";
import type { VisibleRigidPartContribution } from "../systems/components";
import type {
	EnvCellRenderable,
	FrameStreamedObjectInstanceTemplate,
	PortalDrawUnit,
	StaticObjectDrawUnit,
	StaticObjectRenderable,
} from "../commit/artifacts";
import type {
	TerrainColorTextureArrayBinding,
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
	Texture2DResourceKey,
} from "./resource-manager";
import type { StaticDetailRole } from "../resolution/static-detail-role";
import { LandblockLayerKind } from "../runtime/scene-interest";
import { scopeKey } from "../scene/scope";

/** Private read-only query ports captured by one RenderWorld. */
interface RenderWorldSystems {
	readonly staticDetails: {
		getBinding(
			role: StaticDetailRole,
		): ActiveRegionStaticDetailRenderBinding | null;
	};
	readonly scene: {
		getCullingGroup(nodeId: SceneNodeId): string | null;
		getResolvedBounds(nodeId: SceneNodeId): ResolvedSceneBounds | null;
		getResolvedPlacement(
			nodeId: SceneNodeId,
		): ResolvedScenePlacement | undefined;
		getPortalTopologyView(): SceneTopologyView;
		queryScopesFrustum(
			frustum: Frustum,
			anchorLandblockId: LandblockOwnerId,
			scopes: readonly SceneScope[],
			cullingGroupFilter: SceneCullingGroupFilter,
		): VisibleScene;
		queryScopeSelectionFrustum(
			frustum: Frustum,
			anchorLandblockId: LandblockOwnerId,
			scopes: SceneScopeSelection,
			cullingGroupFilter: SceneCullingGroupFilter,
		): VisibleScene;
		queryFlatFrustum(
			frustum: Frustum,
			anchorLandblockId: LandblockOwnerId,
			cullingGroupFilter: SceneCullingGroupFilter,
		): VisibleScene;
	};
	readonly terrain: {
		getDrawUnit(nodeId: SceneNodeId): TerrainDrawUnit | null;
	};
	readonly staticObjects: {
		getRenderable(nodeId: SceneNodeId): StaticObjectRenderable | null;
	};
	readonly dynamics: {
		getPublishedPresentationBounds(nodeId: SceneNodeId): AABB3 | null;
		getVisibleContributions(
			nodeId: SceneNodeId,
		): readonly VisibleRigidPartContribution[] | null;
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
	readonly textures: {
		getAtlasBinding(key: AssetTextureKey): TextureAtlasBinding;
		getTexture2DResource(
			key: AssetTextureKey | GeneratedTextureKey,
		): Texture2DResourceKey;
		getTextureArrayBinding(key: TextureArrayKey): TextureArrayBinding;
		getTerrainColorTextureArrayBinding(
			key: TextureArrayKey,
		): TerrainColorTextureArrayBinding;
	};
}

/** Active-region detail selected independently from the current landblock's packed pages. */
export interface ActiveRegionStaticDetailRenderBinding {
	readonly key: AssetTextureKey;
	readonly tiling: number;
}

/** Cheap renderer-facing fidelity facts available before contribution expansion. */
export type ObjectPresentationFootprint =
	| {
			readonly kind: "eligible";
			readonly objectClass:
				| "building"
				| "explicit-object"
				| "env-cell-resident"
				| "authored-dynamic";
			readonly localBounds: AABB3;
			readonly placement: ResolvedScenePlacement;
	  }
	| {
			readonly kind: "ineligible";
			readonly reason: "generated-instance-container";
	  };

/** One typed logical render contribution selected from a visible scene node. */
export type RenderContribution =
	| {
			readonly cullingGroup: string;
			readonly kind: "static-object";
			readonly footprint: ObjectPresentationFootprint;
			readonly renderable: StaticObjectRenderable;
	  }
	| {
			readonly kind: "dynamic";
			readonly footprint: Extract<
				ObjectPresentationFootprint,
				{ readonly kind: "eligible" }
			>;
	  }
	| { readonly kind: "env-cell"; readonly renderable: EnvCellRenderable }
	| { readonly kind: "terrain"; readonly drawUnit: TerrainDrawUnit };

/** Backend selections for one static draw, without renderer pass policy. */
export interface ResolvedStaticDrawUnit {
	readonly drawUnit: StaticObjectDrawUnit;
	readonly geometry: GeometryResourceKey;
}

/** One visible static node with its resolved landblock placement and device selections. */
export interface ResolvedStaticObjectNode {
	readonly placement: ResolvedScenePlacement;
	readonly drawUnits: readonly ResolvedStaticDrawUnit[];
	readonly frameStreamedInstances: readonly {
		readonly template: FrameStreamedObjectInstanceTemplate;
		readonly geometry: GeometryResourceKey;
	}[];
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

	queryFlatScene(
		frustum: Frustum,
		anchorLandblockId: LandblockOwnerId,
		cullingGroupFilter: SceneCullingGroupFilter,
	): VisibleScene {
		return this.#systems.scene.queryFlatFrustum(
			frustum,
			anchorLandblockId,
			cullingGroupFilter,
		);
	}

	queryScopesScene(
		frustum: Frustum,
		anchorLandblockId: LandblockOwnerId,
		scopes: readonly SceneScope[],
		cullingGroupFilter: SceneCullingGroupFilter,
	): VisibleScene {
		return this.#systems.scene.queryScopesFrustum(
			frustum,
			anchorLandblockId,
			scopes,
			cullingGroupFilter,
		);
	}

	queryScopeSelectionScene(
		frustum: Frustum,
		anchorLandblockId: LandblockOwnerId,
		scopes: SceneScopeSelection,
		cullingGroupFilter: SceneCullingGroupFilter,
	): VisibleScene {
		return this.#systems.scene.queryScopeSelectionFrustum(
			frustum,
			anchorLandblockId,
			scopes,
			cullingGroupFilter,
		);
	}

	getPortalTopologyView(): SceneTopologyView {
		return this.#systems.scene.getPortalTopologyView();
	}

	/** Resolve one resident scene owner to the renderer's canonical scope identity. */
	getRenderScopeKey(nodeId: SceneNodeId): string | null {
		const placement = this.#systems.scene.getResolvedPlacement(nodeId);
		return placement ? scopeKey(placement.scope) : null;
	}

	resolveTerrainDrawUnit(nodeId: SceneNodeId): TerrainDrawUnit | null {
		return this.#systems.terrain.getDrawUnit(nodeId);
	}

	getRenderContributionDescriptor(
		nodeId: SceneNodeId,
	): RenderContribution | null {
		const staticObject = this.#systems.staticObjects.getRenderable(nodeId);
		if (staticObject) {
			const cullingGroup = this.#systems.scene.getCullingGroup(nodeId);
			if (cullingGroup === null) {
				throw new Error(`Static object node ${nodeId} has no culling group.`);
			}
			return {
				cullingGroup,
				footprint: this.#staticObjectFootprint(nodeId, cullingGroup),
				kind: "static-object",
				renderable: staticObject,
			};
		}
		const dynamicBounds =
			this.#systems.dynamics.getPublishedPresentationBounds(nodeId);
		if (dynamicBounds) {
			return {
				footprint: {
					kind: "eligible",
					localBounds: dynamicBounds,
					objectClass: "authored-dynamic",
					placement: this.#requiredPlacement(nodeId, "Dynamic entity"),
				},
				kind: "dynamic",
			};
		}
		const cell = this.#systems.envCells.getCellRenderable(nodeId);
		if (cell) return { kind: "env-cell", renderable: cell };
		const terrain = this.resolveTerrainDrawUnit(nodeId);
		return terrain ? { drawUnit: terrain, kind: "terrain" } : null;
	}

	/** Expand a retained dynamic root only after renderer fidelity policy accepts it. */
	expandDynamicContributions(
		nodeId: SceneNodeId,
	): readonly VisibleRigidPartContribution[] {
		const contributions =
			this.#systems.dynamics.getVisibleContributions(nodeId);
		if (!contributions)
			throw new Error(`Dynamic entity ${nodeId} no longer exists.`);
		return contributions;
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
		}));
	}

	/** Resolve a visible static node without exposing mutable scene or resource systems. */
	resolveStaticObjectNode(
		nodeId: SceneNodeId,
		renderable: StaticObjectRenderable,
		footprint: ObjectPresentationFootprint,
	): ResolvedStaticObjectNode {
		const placement =
			footprint.kind === "eligible"
				? footprint.placement
				: this.#requiredPlacement(nodeId, "Static object");
		return {
			drawUnits: this.resolveStaticObjectRenderable(renderable),
			frameStreamedInstances: renderable.frameStreamedInstances.map(
				(template) => ({
					geometry: this.resolveGeometry(template.geometry),
					template,
				}),
			),
			placement,
		};
	}

	#staticObjectFootprint(
		nodeId: SceneNodeId,
		cullingGroup: string,
	): ObjectPresentationFootprint {
		if (cullingGroup === LandblockLayerKind.Generated) {
			return { kind: "ineligible", reason: "generated-instance-container" };
		}
		const objectClass =
			cullingGroup === LandblockLayerKind.Buildings
				? "building"
				: cullingGroup === LandblockLayerKind.Objects
					? "explicit-object"
					: cullingGroup === "env-cell-static-residents"
						? "env-cell-resident"
						: null;
		if (objectClass === null) {
			throw new Error(
				`Static object node ${nodeId} has unsupported culling group ${cullingGroup}.`,
			);
		}
		const resolvedBounds = this.#systems.scene.getResolvedBounds(nodeId);
		if (!resolvedBounds)
			throw new Error(`Static object node ${nodeId} has no resolved bounds.`);
		return {
			kind: "eligible",
			localBounds: resolvedBounds.localBounds,
			objectClass,
			placement: resolvedBounds.placement,
		};
	}

	#requiredPlacement(
		nodeId: SceneNodeId,
		label: "Dynamic entity" | "Static object",
	): ResolvedScenePlacement {
		const placement = this.#systems.scene.getResolvedPlacement(nodeId);
		if (!placement)
			throw new Error(`${label} node ${nodeId} no longer exists.`);
		return placement;
	}

	resolveDynamicContributions(
		contributions: readonly VisibleRigidPartContribution[],
	): readonly ResolvedGeometryDrawUnit<VisibleRigidPartContribution>[] {
		return contributions.map((contribution) => ({
			drawUnit: contribution,
			geometry: this.resolveGeometry(contribution.drawUnit.geometry),
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

	/** Resolve one cell shell with the same canonical placement contract as static objects. */
	resolveEnvCellNode(
		nodeId: SceneNodeId,
		renderable: EnvCellRenderable,
	): {
		readonly placement: ResolvedScenePlacement;
		readonly drawUnits: readonly ResolvedGeometryDrawUnit<
			EnvCellRenderable["drawUnits"][number]
		>[];
	} {
		const placement = this.#systems.scene.getResolvedPlacement(nodeId);
		if (!placement)
			throw new Error(`EnvCell shell node ${nodeId} no longer exists.`);
		return {
			drawUnits: this.resolveEnvCellRenderable(renderable),
			placement,
		};
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

	resolveActiveRegionStaticDetail(
		role: StaticDetailRole,
	): ActiveRegionStaticDetailRenderBinding | null {
		return this.#systems.staticDetails.getBinding(role);
	}

	resolveTextureArray(key: TextureArrayKey): TextureArrayBinding {
		return this.#systems.textures.getTextureArrayBinding(key);
	}

	resolveTerrainColorTextureArray(
		key: TextureArrayKey,
	): TerrainColorTextureArrayBinding {
		return this.#systems.textures.getTerrainColorTextureArrayBinding(key);
	}
}
