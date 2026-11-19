import type { EnvCellId, LandblockOwnerId } from "../game-types";
import type { GeometryKey } from "../geometry/types";
import type { Frustum } from "../math/frustum";
import type {
	ResolvedScenePlacement,
	ResolvedSceneState,
	SceneSpatialMembership,
	SceneNodeId,
	SceneScope,
	SceneScopeWindowSelection,
	SceneTopologyView,
	VisibleScene,
	SceneCullingGroupFilter,
	SceneNodeFilter,
} from "../scene";
import type { AABB3, Mat4, Vec3 } from "../math/types";
import type { OceanBackdropDrawUnit, TerrainDrawUnit } from "../terrain/types";
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
import type { NameplateSourceVisual } from "./overlays/nameplate-policy";
import { isEntityShadowCasterClass } from "./shadows/entity-shadow-policy";

const OUTDOOR_SCOPE = [{ kind: "outdoor" }] as const;
const isDynamicCullingGroup: SceneCullingGroupFilter = (group) =>
	group === "dynamic";

/** Private read-only query ports captured by one RenderWorld. */
interface RenderWorldSystems {
	readonly oceanBackdrop: { readDrawUnits(): readonly OceanBackdropDrawUnit[] };
	readonly staticDetails: {
		getBinding(
			role: StaticDetailRole,
		): ActiveRegionStaticDetailRenderBinding | null;
	};
	readonly scene: {
		getCullingGroup(nodeId: SceneNodeId): string | null;
		readResolvedState(nodeId: SceneNodeId): ResolvedSceneState | undefined;
		readLocalBounds(nodeId: SceneNodeId): AABB3 | null;
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
			nodeFilter: SceneNodeFilter | null,
		): VisibleScene;
		queryScopesMultiFrustumMasks(
			frusta: readonly Frustum[],
			anchorLandblockId: LandblockOwnerId,
			scopes: readonly SceneScope[],
			cullingGroupFilter: SceneCullingGroupFilter,
			nodeFilter: SceneNodeFilter | null,
			out: Map<SceneNodeId, number>,
		): void;
		queryScopeWindowSelectionFrustum(
			clipFromAnchor: Mat4,
			cameraPosition: Vec3,
			anchorLandblockId: LandblockOwnerId,
			scopes: SceneScopeWindowSelection,
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
		getOverlayFacts(nodeId: SceneNodeId): EntityOverlayFacts | null;
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

/** Synchronous logical contribution; nested scene facts must not escape across scene mutations. */
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

type StaticContribution = Extract<
	RenderContribution,
	{ readonly kind: "static-object" }
>;
type DynamicContribution = Extract<
	RenderContribution,
	{ readonly kind: "dynamic" }
>;

/** Cached wrappers are mutable only within the synchronous read boundary. */
type MutableStaticContribution = {
	-readonly [K in keyof StaticContribution]: StaticContribution[K];
};
type MutableDynamicContribution = {
	-readonly [K in keyof DynamicContribution]: DynamicContribution[K];
};
type MutableEligibleFootprint = {
	-readonly [
		K in keyof Extract<ObjectPresentationFootprint, { kind: "eligible" }>
	]: Extract<ObjectPresentationFootprint, { kind: "eligible" }>[K];
};

const GENERATED_FOOTPRINT: ObjectPresentationFootprint = {
	kind: "ineligible",
	reason: "generated-instance-container",
};

/** Backend selections for one static draw, without renderer pass policy. */
export interface ResolvedStaticDrawUnit {
	readonly drawUnit: StaticObjectDrawUnit;
	readonly geometry: GeometryResourceKey;
}

/** Static compilation inputs with an owned placement independent of later scene mutations. */
export interface ResolvedStaticObjectNode {
	/** Owned snapshot retained by compiled static submissions. */
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

/** Anchor bounds, stable identity, and optional label content for one selected dynamic entity. */
export interface EntityOverlayFacts {
	/** Label display value; null still anchors an independently admitted health bar. */
	readonly content: NameplateContent | null;
	readonly identity: string;
	/** Exact current rigid-pose bounds before particle-envelope expansion. */
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
	readonly #staticContributions = new WeakMap<
		StaticObjectRenderable,
		MutableStaticContribution
	>();
	readonly #dynamicContributions = new WeakMap<
		AABB3,
		MutableDynamicContribution
	>();
	readonly #cellContributions = new WeakMap<
		EnvCellRenderable,
		RenderContribution
	>();
	readonly #terrainContributions = new WeakMap<
		TerrainDrawUnit,
		RenderContribution
	>();
	/** Read current publication policy before a shadow query tests or expands a root. */
	readonly #isShadowCaster: SceneNodeFilter = (nodeId) => {
		const entityClass = this.#systems.dynamics.getPresentationClass(nodeId);
		return entityClass !== null && isEntityShadowCasterClass(entityClass);
	};

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

	/** Select outdoor caster roots once for all shadow cascades. */
	queryOutdoorShadowCasterMasks(
		frusta: readonly Frustum[],
		anchorLandblockId: LandblockOwnerId,
		out: Map<SceneNodeId, number>,
	): void {
		this.#systems.scene.queryScopesMultiFrustumMasks(
			frusta,
			anchorLandblockId,
			OUTDOOR_SCOPE,
			isDynamicCullingGroup,
			this.#isShadowCaster,
			out,
		);
	}

	queryScopeWindowSelectionScene(
		clipFromAnchor: Mat4,
		cameraPosition: Vec3,
		anchorLandblockId: LandblockOwnerId,
		scopes: SceneScopeWindowSelection,
		cullingGroupFilter: SceneCullingGroupFilter,
	): VisibleScene {
		return this.#systems.scene.queryScopeWindowSelectionFrustum(
			clipFromAnchor,
			cameraPosition,
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
		const resolved = this.#systems.scene.readResolvedState(nodeId);
		return resolved ? scopeKey(resolved.placement.scope) : null;
	}

	/** Visual ocean has no scene-node or DAT identity; the renderer routes it through outdoor visibility. */
	readOceanBackdropDrawUnits(): readonly OceanBackdropDrawUnit[] {
		return this.#systems.oceanBackdrop.readDrawUnits();
	}

	resolveTerrainDrawUnit(nodeId: SceneNodeId): TerrainDrawUnit | null {
		return this.#systems.terrain.getDrawUnit(nodeId);
	}

	/** Borrow scene facts for immediate preparation; retained static submissions copy at compilation. */
	readRenderContribution(nodeId: SceneNodeId): RenderContribution | null {
		const group = this.#systems.scene.getCullingGroup(nodeId);
		switch (group) {
			case LandblockLayerKind.Buildings:
			case LandblockLayerKind.Objects:
			case LandblockLayerKind.Generated:
			case "env-cell-static-residents": {
				const renderable = this.#systems.staticObjects.getRenderable(nodeId);
				if (!renderable) return null;
				let cached = this.#staticContributions.get(renderable);
				const footprint = this.#staticObjectFootprint(
					nodeId,
					group,
					cached?.footprint,
				);
				if (!cached) {
					cached = {
						cullingGroup: group,
						footprint,
						kind: "static-object",
						renderable,
					};
					this.#staticContributions.set(renderable, cached);
				} else {
					cached.cullingGroup = group;
					cached.footprint = footprint;
				}
				return cached;
			}
			case "dynamic": {
				const bounds =
					this.#systems.dynamics.getPublishedPresentationBounds(nodeId);
				if (!bounds) return null;
				const entityClass = this.#systems.dynamics.getPresentationClass(nodeId);
				if (entityClass === null)
					throw new Error(
						`Dynamic entity ${nodeId} has no presentation class.`,
					);
				const resolved = this.#systems.scene.readResolvedState(nodeId);
				if (!resolved)
					throw new Error(`Dynamic entity ${nodeId} no longer exists.`);
				let cached = this.#dynamicContributions.get(bounds);
				if (!cached) {
					cached = {
						entityClass,
						footprint: {
							kind: "eligible",
							localBounds: bounds,
							objectClass: "authored-dynamic",
							placement: resolved.placement,
						},
						kind: "dynamic",
					};
					this.#dynamicContributions.set(bounds, cached);
				} else {
					cached.entityClass = entityClass;
					(cached.footprint as MutableEligibleFootprint).placement =
						resolved.placement;
				}
				return cached;
			}
			case "env-cell-shell": {
				const renderable = this.#systems.envCells.getCellRenderable(nodeId);
				if (!renderable) return null;
				let cached = this.#cellContributions.get(renderable);
				if (!cached) {
					cached = { kind: "env-cell", renderable };
					this.#cellContributions.set(renderable, cached);
				}
				return cached;
			}
			case LandblockLayerKind.Terrain: {
				const drawUnit = this.resolveTerrainDrawUnit(nodeId);
				if (!drawUnit) return null;
				let cached = this.#terrainContributions.get(drawUnit);
				if (!cached) {
					cached = { drawUnit, kind: "terrain" };
					this.#terrainContributions.set(drawUnit, cached);
				}
				return cached;
			}
			default:
				return null;
		}
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

	getEntityOverlayFacts(nodeId: SceneNodeId): EntityOverlayFacts | null {
		return this.#systems.dynamics.getOverlayFacts(nodeId);
	}

	/** Check scope admission before reading exact pose bounds for indoor grounding. */
	hasIndoorShadowScope(nodeId: SceneNodeId): boolean {
		const membership = this.#systems.scene.getResolvedSpatialMembership(nodeId);
		if (membership === undefined)
			throw new Error(`Dynamic entity ${nodeId} lacks spatial membership.`);
		return membership.scopes.some((scope) => scope.kind === "env-cell");
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
		const resolved = this.#systems.scene.readResolvedState(nodeId);
		if (resolved === undefined)
			throw new Error(`EnvCell shell node ${nodeId} no longer exists.`);
		const { placement } = resolved;
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
		return { bounds, scope: { ...placement.scope } };
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

	/** Copy placement for retained static compilation and resolve its immutable device selections. */
	resolveStaticObjectNode(
		nodeId: SceneNodeId,
		renderable: StaticObjectRenderable,
	): ResolvedStaticObjectNode {
		// Static submission caches retain this matrix beyond the synchronous scene read.
		const placement = this.#systems.scene.getResolvedPlacement(nodeId);
		if (placement === undefined)
			throw new Error(`Static object node ${nodeId} no longer exists.`);
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
		previous?: ObjectPresentationFootprint,
	): ObjectPresentationFootprint {
		if (cullingGroup === LandblockLayerKind.Generated) {
			return GENERATED_FOOTPRINT;
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
		const localBounds = this.#systems.scene.readLocalBounds(nodeId);
		const resolved = this.#systems.scene.readResolvedState(nodeId);
		if (!localBounds || !resolved)
			throw new Error(`Static object node ${nodeId} has no resolved bounds.`);
		if (previous?.kind === "eligible") {
			const footprint = previous as MutableEligibleFootprint;
			footprint.localBounds = localBounds;
			footprint.objectClass = objectClass;
			footprint.placement = resolved.placement;
			return footprint;
		}
		return {
			kind: "eligible",
			localBounds,
			objectClass,
			placement: resolved.placement,
		};
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
