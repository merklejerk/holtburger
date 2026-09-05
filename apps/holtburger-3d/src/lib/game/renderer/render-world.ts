import type { EnvCellId, LandblockOwnerId } from "../game-types";
import type { GeometryKey } from "../geometry/types";
import type { Frustum } from "../math/frustum";
import type {
	ResolvedScenePlacement,
	ResolvedSceneBounds,
	SceneSpatialMembership,
	SceneNodeId,
	SceneScope,
	SceneScopeSelection,
	SceneTopologyView,
	VisibleScene,
	SceneCullingGroupFilter,
} from "../scene";
import type { AABB3 } from "../math/types";
import type { TerrainDrawUnit } from "../terrain/types";
import type { VisibleDynamicPresentation } from "../systems/components";
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
import type { DynamicEntityPresentationClass } from "../dynamic-entity-presentation-class";
import type { NameplateContent } from "../systems/dynamic-presentation-source";
import type { NameplateSourceVisual } from "./nameplate-policy";

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
		getResolvedSpatialMembership(
			nodeId: SceneNodeId,
		): SceneSpatialMembership | undefined;
		getPortalTopologyView(): SceneTopologyView;
		queryEnvCellBounds(envCellId: EnvCellId): AABB3 | null;
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
		getPresentationClass(
			nodeId: SceneNodeId,
		): DynamicEntityPresentationClass | null;
		getPresentationIdentity(nodeId: SceneNodeId): string | null;
		getPublishedPresentationBounds(nodeId: SceneNodeId): AABB3 | null;
		getPublishedRigidPresentationBounds(nodeId: SceneNodeId): AABB3 | null;
		getNameplatePopulationRevision(): number;
		forEachNameplateVisual(
			visit: (identity: string, visual: NameplateSourceVisual) => void,
		): void;
		getNameplateFacts(nodeId: SceneNodeId): {
			readonly content: NameplateContent;
			readonly identity: string;
			readonly rigidBounds: AABB3;
		} | null;
		getVisiblePresentation(
			nodeId: SceneNodeId,
		): VisibleDynamicPresentation | null;
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
			readonly entityClass: DynamicEntityPresentationClass;
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

/** Dynamic facts shared by indoor radial and outdoor directional entity shadows. */
export interface EntityShadowDynamicFacts {
	readonly identity: string;
	/** Exact current rigid-pose bounds before particle-envelope expansion. */
	readonly rigidBounds: AABB3;
	readonly spatialMembership: SceneSpatialMembership;
}

/** Display value and exact current rigid bounds for one selected dynamic entity. */
export interface EntityNameplateFacts {
	readonly content: NameplateContent;
	readonly identity: string;
	readonly rigidBounds: AABB3;
}

/** EnvCell facts read only when indoor grounding is active for a visible shell. */
export interface IndoorGroundingEnvCellFacts {
	readonly bounds: AABB3;
	readonly scope: Extract<SceneScope, { readonly kind: "env-cell" }>;
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
			const entityClass = this.#systems.dynamics.getPresentationClass(nodeId);
			if (entityClass === null) {
				throw new Error(`Dynamic entity ${nodeId} has no presentation class.`);
			}
			return {
				entityClass,
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

	/** Publish installed layout, appearance, and dense part poses without expanding material ranges. */
	getVisibleDynamicPresentation(
		nodeId: SceneNodeId,
	): VisibleDynamicPresentation | null {
		return this.#systems.dynamics.getVisiblePresentation(nodeId);
	}

	getNameplatePopulationRevision(): number {
		return this.#systems.dynamics.getNameplatePopulationRevision();
	}

	forEachNameplateVisual(
		visit: (identity: string, visual: NameplateSourceVisual) => void,
	): void {
		this.#systems.dynamics.forEachNameplateVisual(visit);
	}

	getEntityNameplateFacts(nodeId: SceneNodeId): EntityNameplateFacts | null {
		return this.#systems.dynamics.getNameplateFacts(nodeId);
	}

	/** Resolve the two facts not already carried by a visible dynamic contribution. */
	getEntityShadowDynamicFacts(nodeId: SceneNodeId): EntityShadowDynamicFacts {
		const identity = this.#systems.dynamics.getPresentationIdentity(nodeId);
		const rigidBounds =
			this.#systems.dynamics.getPublishedRigidPresentationBounds(nodeId);
		const spatialMembership =
			this.#systems.scene.getResolvedSpatialMembership(nodeId);
		if (
			identity === null ||
			rigidBounds === null ||
			spatialMembership === undefined
		) {
			throw new Error(`Dynamic entity ${nodeId} lacks shadow-caster facts.`);
		}
		return { identity, rigidBounds, spatialMembership };
	}

	/** Resolve immutable world bounds and exact scope for one visible EnvCell shell. */
	getIndoorGroundingEnvCellFacts(
		nodeId: SceneNodeId,
	): IndoorGroundingEnvCellFacts {
		const placement = this.#requiredPlacement(nodeId, "EnvCell shell");
		if (placement.scope.kind !== "env-cell") {
			throw new Error(`EnvCell shell node ${nodeId} has outdoor residency.`);
		}
		const bounds = this.#systems.scene.queryEnvCellBounds(
			placement.scope.envCellId,
		);
		if (bounds === null) {
			throw new Error(
				`EnvCell shell node ${nodeId} has no installed cell bounds.`,
			);
		}
		return { bounds, scope: placement.scope };
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
					geometry: this.resolveGeometry(template.draw.geometry),
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
		label: "Dynamic entity" | "EnvCell shell" | "Static object",
	): ResolvedScenePlacement {
		const placement = this.#systems.scene.getResolvedPlacement(nodeId);
		if (!placement)
			throw new Error(`${label} node ${nodeId} no longer exists.`);
		return placement;
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
