import { OCEAN_BACKDROP_BOUNDS } from "../../terrain/ocean-backdrop";
import {
	createFrustumFromClipMatrix,
	frustumIntersectsAABB,
} from "../../math/frustum";
import {
	createLandblockOffset,
	createLandblockWorldOrigin,
	getLandblockCoordinates,
} from "../../landblocks";
import {
	createPerspectiveMat4,
	createViewMat4,
	multiplyMat4,
	transformPoint3,
} from "../../math/matrices";
import { Vec3 } from "../../math/types";
import type { SceneNodeId, SceneScope } from "../../scene";
import { scopeKey } from "../../scene/scope";
import { createCameraNearClipVolume } from "../portal/portal-near-plane";
import type { TerrainSurfaceDrawUnit } from "../../terrain/types";
import { retainsRetailGeometry } from "../retail-geometry-visibility";
import type {
	FrameInput,
	FrameSettings,
	FrameViewInput,
	ResolvedResourceInvalidation,
} from "../renderer";
import { renderCullingGroupFilter } from "../render-layer-visibility";
import { landblockVec3 } from "../../../assets/ac-frame";
import type {
	ObjectPresentationFootprint,
	RenderContribution,
	RenderWorld,
} from "../render-world";
import { retainsProjectedObjectFootprint } from "../object-footprint";
import type { GeometryResourceKey } from "../resource-manager";
import type {
	ActiveDynamicPart,
	VisibleDynamicPresentation,
} from "../../systems/components";
import { LandblockLayerKind } from "../../runtime/scene-interest";
import type { RenderExtent } from "../render-extent";
import {
	createEntityGroundingSelection,
	createIndoorGroundingCell,
	createOutdoorDirectionalShadowCaster,
	createOutdoorDirectionalShadowSelection,
	createOutdoorDirectionalShadowTerrain,
	resolveEntityShadowCaster,
	selectIndoorGroundingCasters,
	selectOutdoorDirectionalShadowCasters,
} from "../overlays/entity-grounding";
import {
	isEntityShadowCasterClass,
	isOutdoorPssmReceiverFootprint,
} from "../shadows/entity-shadow-policy";
import type { LandblockOwnerId } from "../../game-types";
import {
	bucketObjectSubmissions,
	dynamicObjectPhase,
	EMPTY_DYNAMIC_RANGE_ADMISSION,
	summarizeDynamicRangeAdmission,
} from "./object-rendering-policy";
import { createObjectMaterialTable } from "./object-material-table";
import { compileStaticMaterialSpans } from "./static-material-spans";
import { CompiledObjectDrawStore } from "./compiled-object-draws";
import type { PortalScopeWindowCullInput } from "../portal/portal-scope-window-culler";
import {
	assertSelectedDynamicRenderDomain,
	type DynamicRenderDomainSelection,
} from "./dynamic-render-scopes";
import type { TextureFilteringPolicy } from "./texture-filtering-policy";
import {
	EXTERIOR_PARTICLE_RENDER_OWNER,
	SKY_PARTICLE_RENDER_OWNER,
} from "../../systems/particle-system";
import { ViewSubmissionStoragePool } from "../view-submission-storage";
import { WebGL2ObjectDrawCompiler } from "./webgl2-object-draw-compiler";
import {
	selectOpaqueDynamicAppearanceVariant,
	WebGL2DynamicAppearances,
} from "./webgl2-dynamic-appearances";
import { DynamicBatchedRanges } from "./dynamic-batched-ranges";
import { WebGL2DynamicPosePages } from "./webgl2-dynamic-pose-pages";
import { DynamicDepthPreparations } from "./dynamic-depth-preparation";
import type { DynamicLayout } from "../../geometry/dynamic-layout";
import type { DynamicAppearance } from "../../systems/dynamic-appearance";
import type { WebGL2PortalScopeAtlasFrame } from "../portal/webgl2-portal-scope-atlas-pipeline";
import {
	composeEntityOverlays,
	maximumLegibleOverlayDepth,
	retainLegibleOverlays,
	retainOverlayBudget,
} from "../overlays/entity-overlay-selection";
import type { WebGL2DeviceAndTargetPool } from "./webgl2-device-targets";
import type { RendererFrameDiagnosticsAndProfiler } from "./webgl2-frame-diagnostics";
import type { ObjectAndShadowPassExecutor } from "./webgl2-object-shadow-pass";
import type { SkyParticleOverlayAndSelectionPasses } from "./webgl2-overlay-particle-sky-passes";
import {
	anchorRelativePosition,
	createObjectSubmission,
	FLAT_PARTICLE_DOMAIN,
	FLAT_SKY_PARTICLE_DOMAIN,
	type CompiledStaticNodeSubmissions,
	type LandblockRenderOffset,
	type ObjectColorSubmission,
	type ObjectFrameInput,
	type PreparedBarComponent,
	type PreparedDynamicBlended,
	type PreparedDynamicOpaque,
	type PreparedEntityBeacon,
	type PreparedLabelComponent,
	type PreparedObjectDrawCompatibility,
	type PreparedObjectFrameInput,
	type PreparedOutdoorShadowView,
	type PreparedPortalView,
	type PreparedSceneContributions,
	type PreparedViewGeometry,
	type TerrainFrameInput,
} from "./webgl2-renderer-types";

export class SceneContributionCompilerAndSelector {
	readonly #world: RenderWorld;
	readonly #deviceTargets: WebGL2DeviceAndTargetPool;
	readonly #diagnostics: RendererFrameDiagnosticsAndProfiler;
	/** Reusable CPU outputs that remain independent while several cameras are prepared. */
	readonly #viewSubmissions = new ViewSubmissionStoragePool();
	readonly offsetScratch = new Vec3(0, 0, 0);
	/** Reused while deriving transparent range distances before sorting a view. */
	readonly transparentCenterScratch = new Vec3(0, 0, 0);
	/** Portal footprint cutoff resolved to drawing-buffer pixels once at frame entry. */
	#minimumPortalFootprintDevicePixelArea = 0;
	/** Object-presentation footprint cutoff resolved to drawing-buffer pixels at frame entry. */
	#minimumObjectFootprintDevicePixelArea = 0;
	/**
	 * Draw facts compiled once per draw unit instead of once per frame.
	 *
	 * Keyed by artifact draw units and shared instance source draws, so entries become collectable
	 * with the publication that owns them; the named flushes cover the events that invalidate
	 * every entry at once.
	 */
	readonly #compiledDraws = new CompiledObjectDrawStore<
		CompiledStaticNodeSubmissions,
		PreparedObjectDrawCompatibility
	>();
	/** Terrain programs resolved once per stable surface draw; see resolveTerrainFrameInput. */
	readonly #terrainFrameInputs = new WeakMap<
		TerrainSurfaceDrawUnit,
		TerrainFrameInput
	>();
	/** Frame settings that select compiled facts, retained to detect a change between frames. */
	#compiledTextureFiltering: TextureFilteringPolicy | null = null;
	#compiledEnvCellRenderMode: FrameSettings["envCellRenderMode"] | null = null;
	/** Context-local object compiler shared by world and isolated renderer implementations. */
	readonly #objectDrawCompiler: WebGL2ObjectDrawCompiler;
	/** Appearance resources follow template leases, not current visibility. */
	readonly #dynamicAppearances: WebGL2DynamicAppearances;
	/** Shared current-frame pose addresses, uploaded before executing any prepared camera. */
	readonly #dynamicPosePages: WebGL2DynamicPosePages<SceneNodeId>;
	/** One material-free geometry decision shared across selection and every mapped-shadow view. */
	readonly #dynamicDepths: DynamicDepthPreparations;
	/** Frame-current opaque eligibility, shared across all selected camera domains. */
	readonly #dynamicOpaqueRanges = new DynamicBatchedRanges("opaque");
	/** Additive spans share appearance batches without entering the depth-writing opaque pass. */
	readonly #dynamicAdditiveRanges = new DynamicBatchedRanges("additive");
	/** Compact root publication shared by every merged consumer. */
	readonly #dynamicPresentations = new Map<
		SceneNodeId,
		VisibleDynamicPresentation | null
	>();
	/** Only roots selected by a merged draw consumer require GPU pose rows. */
	readonly #poseUploadParts = new Map<
		SceneNodeId,
		readonly Pick<ActiveDynamicPart, "frameInstance" | "renderState">[]
	>();
	/** Dynamic roots selected in any view of the frame, retained as production feedback. */
	readonly #selectedDynamicNodeIds = new Set<SceneNodeId>();
	readonly #visibleStaticLayers = new Set<string>();
	readonly #visibleEnvCellScopes = new Set<string>();

	constructor(
		world: RenderWorld,
		deviceTargets: WebGL2DeviceAndTargetPool,
		diagnostics: RendererFrameDiagnosticsAndProfiler,
	) {
		this.#world = world;
		this.#deviceTargets = deviceTargets;
		this.#diagnostics = diagnostics;
		const { gl, resources, textureSamplers } = deviceTargets;
		this.#objectDrawCompiler = new WebGL2ObjectDrawCompiler({
			resources,
			resolveAtlasTexture: (key) => world.resolveAtlasTexture(key),
			resolveStaticDetail: (role) =>
				world.resolveActiveRegionStaticDetail(role),
			resolveTexture2D: (key) => world.resolveTexture2D(key),
			samplers: textureSamplers,
			textureFiltering: () => deviceTargets.frameTextureFiltering,
		});
		this.#dynamicAppearances = new WebGL2DynamicAppearances(
			gl,
			(material, ordering) =>
				this.#objectDrawCompiler.prepareSurface(material, ordering),
		);
		this.#dynamicPosePages = new WebGL2DynamicPosePages(gl);
		this.#dynamicDepths = new DynamicDepthPreparations(
			(nodeId) => this.publishDynamicPresentation(nodeId),
			(appearance) => this.#dynamicAppearances.get(appearance),
		);
	}

	get viewSubmissions(): ViewSubmissionStoragePool {
		return this.#viewSubmissions;
	}

	get compiledDraws(): CompiledObjectDrawStore<
		CompiledStaticNodeSubmissions,
		PreparedObjectDrawCompatibility
	> {
		return this.#compiledDraws;
	}

	get dynamicAppearances(): WebGL2DynamicAppearances {
		return this.#dynamicAppearances;
	}

	get dynamicPosePages(): WebGL2DynamicPosePages<SceneNodeId> {
		return this.#dynamicPosePages;
	}

	get dynamicDepths(): DynamicDepthPreparations {
		return this.#dynamicDepths;
	}

	get poseUploadParts(): Map<
		SceneNodeId,
		readonly Pick<ActiveDynamicPart, "frameInstance" | "renderState">[]
	> {
		return this.#poseUploadParts;
	}

	get selectedDynamicNodeIds(): Set<SceneNodeId> {
		return this.#selectedDynamicNodeIds;
	}

	get visibleStaticLayerCount(): number {
		return this.#visibleStaticLayers.size;
	}

	get visibleEnvCellScopeCount(): number {
		return this.#visibleEnvCellScopes.size;
	}

	resolveGeometry(
		key: Parameters<RenderWorld["resolveGeometry"]>[0],
	): GeometryResourceKey {
		return this.#world.resolveGeometry(key);
	}

	setMinimumFootprintAreas(
		minimumPortalFootprintDevicePixelArea: number,
		minimumObjectFootprintDevicePixelArea: number,
	): void {
		this.#minimumPortalFootprintDevicePixelArea =
			minimumPortalFootprintDevicePixelArea;
		this.#minimumObjectFootprintDevicePixelArea =
			minimumObjectFootprintDevicePixelArea;
	}

	syncCompiledSettings(
		textureFiltering: TextureFilteringPolicy,
		envCellRenderMode?: FrameSettings["envCellRenderMode"],
	): void {
		// Compiled facts embed the samplers filtering selects and the cull-face override the
		// env-cell mode selects, so a change to either invalidates every compiled entry. Both
		// arrive as frame settings, which is the only place the renderer can observe them change.
		if (this.#compiledTextureFiltering !== textureFiltering) {
			this.#dynamicAppearances.rebuild();
			if (this.#compiledTextureFiltering !== null) {
				this.#compiledDraws.flush("texture-filtering");
			}
			this.#compiledTextureFiltering = textureFiltering;
		}
		if (
			envCellRenderMode !== undefined &&
			this.#compiledEnvCellRenderMode !== envCellRenderMode
		) {
			if (this.#compiledEnvCellRenderMode !== null) {
				this.#compiledDraws.flush("env-cell-render-mode");
			}
			this.#compiledEnvCellRenderMode = envCellRenderMode;
		}
	}

	/**
	 * Drop compiled draw facts because a runtime event invalidated them.
	 *
	 * Implements the shared renderer contract: the events that move atlas placements or replace
	 * active-region detail are owned by the runtime and cannot be observed from inside a frame.
	 */
	invalidateResolvedResources(reason: ResolvedResourceInvalidation): void {
		this.#compiledDraws.flush(reason);
		if (reason === "atlas-publication") this.#dynamicAppearances.rebuild();
	}

	retainDynamicAppearance(
		layout: DynamicLayout,
		appearance: DynamicAppearance,
	): () => void {
		return this.#dynamicAppearances.retain(layout, appearance);
	}

	uploadDynamicPoses(clockSeconds: number): void {
		this.#dynamicPosePages.upload(this.#poseUploadParts, clockSeconds);
	}

	beginFrame(): void {
		this.#viewSubmissions.beginFrame();
		this.#visibleStaticLayers.clear();
		this.#visibleEnvCellScopes.clear();
		this.#dynamicPresentations.clear();
		this.#dynamicDepths.beginFrame();
		this.#dynamicOpaqueRanges.beginFrame();
		this.#dynamicAdditiveRanges.beginFrame();
		this.#poseUploadParts.clear();
		this.#selectedDynamicNodeIds.clear();
	}

	resetDynamicFrameState(): void {
		this.#dynamicDepths.beginFrame();
		this.#dynamicOpaqueRanges.beginFrame();
		this.#dynamicAdditiveRanges.beginFrame();
	}

	clearDynamicFrameCaches(): void {
		this.#dynamicPresentations.clear();
		this.#poseUploadParts.clear();
	}

	destroyDynamicResources(): void {
		this.#dynamicAppearances.destroy();
		this.#dynamicPosePages.destroy();
	}

	prepareViewGeometry(
		anchorLandblockId: FrameInput["anchorLandblockId"],
		input: FrameViewInput,
		extent: RenderExtent = {
			width: this.#deviceTargets.frameWidth,
			height: this.#deviceTargets.frameHeight,
		},
	): PreparedViewGeometry {
		const camera = input.camera;
		const anchorCoordinates = getLandblockCoordinates(anchorLandblockId);
		const cameraPosition = anchorRelativePosition(
			camera.placement.position,
			anchorLandblockId,
		);
		const aspectRatio = extent.width / Math.max(1, extent.height);
		const projection = createPerspectiveMat4(
			camera.fov,
			aspectRatio,
			camera.near,
			camera.far,
		);
		const view = createViewMat4(cameraPosition, camera.placement.rotation);
		const clipFromAnchor = multiplyMat4(projection, view);
		return {
			submissionStorage: this.#viewSubmissions.acquire(),
			anchorCoordinates,
			anchorLandblockId,
			camera,
			cameraInsideSealedCell: input.cameraInsideSealedCell,
			cameraPosition,
			clipFromAnchor,
			frustum: createFrustumFromClipMatrix(clipFromAnchor, cameraPosition),
			projection,
			view,
		};
	}

	createPortalScopeWindowCullInput(
		prepared: PreparedViewGeometry,
		viewInput: FrameViewInput,
		rootScope: SceneScope,
	): PortalScopeWindowCullInput {
		const frameWidth = this.#deviceTargets.frameWidth;
		const frameHeight = this.#deviceTargets.frameHeight;
		const aspectRatio = frameWidth / Math.max(1, frameHeight);
		return {
			anchorCoordinates: prepared.anchorCoordinates,
			clipFromAnchor: prepared.clipFromAnchor,
			nearClipVolume: createCameraNearClipVolume(
				viewInput.camera,
				// Anchor-relative, matching the view matrix this volume is compared against.
				{
					position: prepared.cameraPosition,
					rotation: viewInput.camera.placement.rotation,
				},
				aspectRatio,
			),
			portalFootprint: {
				drawingBuffer: {
					height: frameHeight,
					width: frameWidth,
				},
				minimumPixelArea: this.#minimumPortalFootprintDevicePixelArea,
			},
			rootScope,
		};
	}

	collectScene(
		prepared: PreparedViewGeometry,
		frameSettings: FrameSettings,
		shadows: PreparedOutdoorShadowView | null,
		objectShadowPass: ObjectAndShadowPassExecutor,
		overlayPasses: SkyParticleOverlayAndSelectionPasses,
	): PreparedSceneContributions {
		const visible = this.#world.queryFlatScene(
			prepared.frustum,
			prepared.anchorLandblockId,
			renderCullingGroupFilter(frameSettings.layerVisibility),
		);

		const contributions = this.resolveSceneContributions(
			prepared,
			visible.entries,
			frameSettings,
			null,
			shadows,
			objectShadowPass,
			overlayPasses,
		);
		const routed = prepared.submissionStorage.particles.route(
			FLAT_PARTICLE_DOMAIN,
			overlayPasses.particleSources,
			(owner) =>
				owner === SKY_PARTICLE_RENDER_OWNER
					? FLAT_SKY_PARTICLE_DOMAIN
					: FLAT_PARTICLE_DOMAIN,
		);
		return {
			...contributions,
			particles: routed.get(FLAT_PARTICLE_DOMAIN) ?? [],
			skyParticles: routed.get(FLAT_SKY_PARTICLE_DOMAIN) ?? [],
		};
	}

	/**
	 * Resolve already-selected scene identities without importing flat or portal topology policy.
	 *
	 * Callers must consume a SceneGraph query's reused entry buffer before issuing another query.
	 */
	resolveSceneContributions(
		prepared: PreparedViewGeometry,
		visibleEntries: readonly SceneNodeId[],
		frameSettings: FrameSettings,
		portalVisibility: DynamicRenderDomainSelection | null,
		shadows: PreparedOutdoorShadowView | null,
		objectShadowPass: ObjectAndShadowPassExecutor,
		overlayPasses: SkyParticleOverlayAndSelectionPasses,
	): PreparedSceneContributions {
		this.#diagnostics.profiler?.setCpuPhase("transparencyAndOverlays");
		overlayPasses.reconcileNameplateTextureCache(
			frameSettings.nameplates.appearance,
			frameSettings.quality.renderScale,
			overlayPasses.frameViewerEntityIdentity,
		);
		this.#diagnostics.profiler?.setCpuPhase("sceneSelection");
		const terrain: TerrainFrameInput[] = [];
		const objectBuckets: {
			opaque: ObjectColorSubmission[];
			additive: ObjectColorSubmission[];
			transparent: ObjectColorSubmission[];
		} = { opaque: [], additive: [], transparent: [] };
		const dynamicOpaque: PreparedDynamicOpaque[] = [];
		const labels: PreparedLabelComponent[] = [];
		const bars: PreparedBarComponent[] = [];
		const beacons: PreparedEntityBeacon[] = [];
		const entityShadowsEnabled = frameSettings.entityShadows.mode !== "none";
		const simpleOutdoorShadows = frameSettings.entityShadows.mode === "simple";
		const storage = prepared.submissionStorage;
		objectShadowPass.entityGroundingCasters.length = 0;
		objectShadowPass.outdoorDirectionalCasters.length = 0;
		objectShadowPass.indoorGroundingCells.clear();
		if (entityShadowsEnabled) {
			objectShadowPass.ensureIndoorVisibilityTopology(
				this.#world.getPortalTopologyView(),
			);
		}

		// One offset per visible landblock, not one per object: it is the same value for every
		// object in a landblock. Submissions carry only their landblock id, so a cached static
		// submission stays valid across re-anchoring and the frame never rewrites it.
		const landblockOffsets = new Map<LandblockOwnerId, LandblockRenderOffset>();
		const retainOffset = (landblockId: LandblockOwnerId): void => {
			if (landblockOffsets.has(landblockId)) return;
			const offset = createLandblockOffset(
				getLandblockCoordinates(landblockId),
				prepared.anchorCoordinates,
			);
			landblockOffsets.set(landblockId, [offset.x, offset.y, offset.z]);
		};
		this.#diagnostics.metrics.visibleSceneEntries += visibleEntries.length;
		for (const nodeId of visibleEntries) {
			const contribution = this.#world.readRenderContribution(nodeId);
			if (!contribution) continue;
			if (contribution.kind === "static-object") {
				if (!this.retainsObjectFootprint(contribution.footprint, prepared)) {
					continue;
				}
				// A static publication has exactly one submission set; its culling group is fixed
				// for the renderable's lifetime and serves as the variant name.
				const compiled = this.#compiledDraws.resolveNodeSubmissions(
					contribution.renderable,
					contribution.cullingGroup,
					() => this.compileStaticNodeSubmissions(nodeId, contribution),
				);
				this.#diagnostics.metrics.visibleStaticNodeCount += 1;
				if (compiled.source === "env-cell-resident") {
					this.#diagnostics.metrics.visibleEnvCellResidentNodes += 1;
				}
				this.#visibleStaticLayers.add(compiled.visibleLayerKey);
				if (compiled.envCellScopeKey !== null) {
					this.#visibleEnvCellScopes.add(compiled.envCellScopeKey);
				}
				retainOffset(compiled.landblockId);
				for (const phase of ["opaque", "additive", "transparent"] as const)
					for (const object of compiled.objectBuckets[phase])
						if (
							retainsRetailGeometry(
								object.retailVisibility,
								frameSettings.showRetailHiddenGeometry,
							)
						)
							objectBuckets[phase].push(object);
				continue;
			}
			if (contribution.kind === "dynamic") {
				if (!this.retainsObjectFootprint(contribution.footprint, prepared)) {
					const tinyOverlay =
						overlayPasses.frameEntityOverlays.presentation(nodeId);
					if (tinyOverlay?.beacon != null) {
						const tinyTarget = this.publishDynamicPresentation(nodeId);
						if (
							tinyTarget !== null &&
							this.#hasVisibleDynamicGeometry(
								tinyTarget,
								frameSettings.showRetailHiddenGeometry,
							)
						) {
							overlayPasses.prepareEntityBeacon(
								nodeId,
								tinyTarget,
								contribution,
								prepared,
								frameSettings.entityBeacons,
								portalVisibility,
								beacons,
							);
						}
					}
					continue;
				}
				const renderTarget = this.publishDynamicPresentation(nodeId);
				let admission = EMPTY_DYNAMIC_RANGE_ADMISSION;
				if (renderTarget !== null) {
					assertSelectedDynamicRenderDomain(
						renderTarget.renderScopes,
						portalVisibility,
					);
					retainOffset(renderTarget.landblockId);
					const presentation = renderTarget;
					const appearance = this.#dynamicAppearances.get(
						presentation.visual.appearance,
					);
					const opaqueVariant = selectOpaqueDynamicAppearanceVariant(
						appearance,
						presentation.visual.parts.length,
						presentation.allPartsOpaque,
						frameSettings.showRetailHiddenGeometry,
					);
					admission = opaqueVariant
						? opaqueVariant.admission
						: summarizeDynamicRangeAdmission(
								appearance.rangeGroupsByPart,
								presentation.visual.parts,
								frameSettings.showRetailHiddenGeometry,
							);
					if (appearance.kind === "drawable") {
						const ranges = opaqueVariant
							? opaqueVariant.opaqueSpans
							: this.#dynamicOpaqueRanges.prepare(
									nodeId,
									appearance.plan,
									presentation.visual.parts,
									frameSettings.showRetailHiddenGeometry,
								);
						if (ranges.length > 0) {
							objectShadowPass.requireDynamicOpaqueProgram();
							const geometry = this.#deviceTargets.resources.getGeometry(
								this.#world.resolveGeometry(presentation.visual.layout.key),
							);
							this.#poseUploadParts.set(nodeId, presentation.visual.parts);
							dynamicOpaque.push({
								source: "dynamic",
								nodeId,
								landblockId: presentation.landblockId,
								geometry,
								appearance,
								ranges,
							});
						}
						const appendBlended = (
							range: PreparedDynamicBlended["range"],
							indexCount: number,
							ordering: PreparedDynamicBlended["ordering"],
						): void => {
							const part = presentation.visual.parts[range.source.partSelector];
							if (part === undefined)
								throw new Error(
									"Merged ordered range references a missing part.",
								);
							const program = objectShadowPass.requireDynamicBlendedProgram();
							const transparentSort =
								ordering === "transparent"
									? {
											center: landblockVec3(
												transformPoint3(
													part.frameInstance.sourceToLandblock,
													range.source.transparentSort.center,
													landblockVec3(Vec3.zero()),
												),
											),
											stableId: `${presentation.identity}/part:${part.partIndex}/${range.source.transparentSort.key}`,
										}
									: null;
							const geometry = this.#deviceTargets.resources.getGeometry(
								this.#world.resolveGeometry(presentation.visual.layout.key),
							);
							this.#poseUploadParts.set(nodeId, presentation.visual.parts);
							objectBuckets[ordering].push({
								source: "dynamic",
								drawKind: "merged",
								nodeId,
								landblockId: presentation.landblockId,
								geometry,
								appearance,
								range,
								indexCount,
								ordering,
								transparentSort,
								program,
								transparentCohortKey: `${presentation.landblockId}/${range.source.transparentSort.key}`,
							});
						};
						for (const span of opaqueVariant
							? opaqueVariant.additiveSpans
							: this.#dynamicAdditiveRanges.prepare(
									nodeId,
									appearance.plan,
									presentation.visual.parts,
									frameSettings.showRetailHiddenGeometry,
								)) {
							const range = appearance.plan.physicalRanges[span.rangeIndex];
							if (range === undefined)
								throw new Error("Additive span lost its physical range.");
							appendBlended(range, span.indexCount, "additive");
						}
						for (const range of opaqueVariant
							? opaqueVariant.transparentRanges
							: appearance.plan.ranges) {
							const part = presentation.visual.parts[range.source.partSelector];
							if (part === undefined)
								throw new Error("Ordered range references a missing part.");
							const ordering = dynamicObjectPhase(
								range.source.ordering,
								part.frameInstance.color.a,
								range.source.retailVisibility,
								frameSettings.showRetailHiddenGeometry,
							);
							if (ordering !== "transparent") continue;

							appendBlended(range, range.source.indexCount, ordering);
						}
					}
				}
				if (
					entityShadowsEnabled &&
					isEntityShadowCasterClass(contribution.entityClass) &&
					admission.hasMaterialFreeShadowGeometry &&
					(simpleOutdoorShadows || this.#world.hasIndoorShadowScope(nodeId))
				) {
					const facts = this.#world.getEntityShadowDynamicFacts(nodeId);
					const reachesIndoor = facts.spatialMembership.scopes.some(
						(scope) => scope.kind === "env-cell",
					);
					const reachesOutdoors = facts.spatialMembership.scopes.some(
						(scope) => scope.kind === "outdoor",
					);
					const caster =
						reachesIndoor || (simpleOutdoorShadows && reachesOutdoors)
							? resolveEntityShadowCaster(
									{
										identity: facts.identity,
										rigidBounds: facts.rigidBounds,
										placement: contribution.footprint.placement,
										spatialMembership: facts.spatialMembership,
									},
									objectShadowPass.indoorVisibilityIslands,
									frameSettings.entityShadows.indoorGrounding,
								)
							: null;
					if (caster?.indoorGrounding) {
						objectShadowPass.entityGroundingCasters.push(
							caster.indoorGrounding,
						);
					}
					if (caster?.reachesOutdoors && shadows) {
						objectShadowPass.outdoorDirectionalCasters.push(
							createOutdoorDirectionalShadowCaster(
								caster.shape,
								shadows.projection,
								frameSettings.entityShadows.outdoorDirectional,
							),
						);
					}
				}
				const overlay =
					renderTarget !== null && admission.sourceRangeGroupCount > 0
						? overlayPasses.frameEntityOverlays.presentation(nodeId)
						: null;
				if (overlay !== null && renderTarget !== null) {
					overlayPasses.prepareEntityOverlay(
						nodeId,
						overlay,
						renderTarget,
						contribution,
						prepared,
						frameSettings.entityOverlays,
						portalVisibility,
						labels,
						bars,
					);
					if (overlay.beacon != null) {
						overlayPasses.prepareEntityBeacon(
							nodeId,
							renderTarget,
							contribution,
							prepared,
							frameSettings.entityBeacons,
							portalVisibility,
							beacons,
						);
					}
				}
				this.#selectedDynamicNodeIds.add(nodeId);
				this.#diagnostics.metrics.visibleDynamicEntityCount += 1;
				this.#diagnostics.metrics.visibleDynamicSourceRangeCount +=
					admission.sourceRangeGroupCount;
				continue;
			}
			if (contribution.kind === "env-cell") {
				if (entityShadowsEnabled) {
					const facts = this.#world.getIndoorGroundingEnvCellFacts(nodeId);
					const cell = createIndoorGroundingCell(
						facts.scope,
						facts.bounds,
						objectShadowPass.indoorVisibilityIslands,
					);
					objectShadowPass.indoorGroundingCells.set(cell.scopeKey, cell);
				}
				this.#diagnostics.metrics.visibleEnvCellShells += 1;
				const compiled = this.#compiledDraws.resolveNodeSubmissions(
					contribution.renderable,
					frameSettings.envCellRenderMode,
					() =>
						this.compileShellNodeSubmissions(
							nodeId,
							contribution,
							frameSettings.envCellRenderMode,
						),
				);
				if (compiled.envCellScopeKey !== null) {
					this.#visibleEnvCellScopes.add(compiled.envCellScopeKey);
				}
				this.#visibleStaticLayers.add(compiled.visibleLayerKey);
				retainOffset(compiled.landblockId);

				for (const phase of ["opaque", "additive", "transparent"] as const)
					objectBuckets[phase].push(...compiled.objectBuckets[phase]);
				continue;
			}
			terrain.push(this.resolveTerrainFrameInput(contribution.drawUnit));
			this.#diagnostics.metrics.terrainFrameInputs += 1;
		}
		// Admit through-wall overlays for realized entities whose EnvCell was portal-culled
		// or whose body fell below the object footprint cutoff, clipped to the camera frustum.
		overlayPasses.frameEntityOverlays.forEachOverlayOccluded(
			(nodeId, overlay) => {
				if (this.#selectedDynamicNodeIds.has(nodeId)) return;
				const contribution = this.#world.readRenderContribution(nodeId);
				if (contribution?.kind !== "dynamic") return;
				const renderTarget = this.publishDynamicPresentation(nodeId);
				if (
					renderTarget === null ||
					!this.#hasVisibleDynamicGeometry(
						renderTarget,
						frameSettings.showRetailHiddenGeometry,
					)
				)
					return;
				overlayPasses.prepareEntityOverlay(
					nodeId,
					overlay,
					renderTarget,
					contribution,
					prepared,
					frameSettings.entityOverlays,
					portalVisibility,
					labels,
					bars,
					true,
				);
			},
		);
		if (
			frameSettings.layerVisibility.terrain &&
			(portalVisibility === null ||
				portalVisibility.selectedRenderDomainOrdinal("outdoor") !== null)
		) {
			for (const drawUnit of this.#world.readOceanBackdropDrawUnits()) {
				const offset = createLandblockOffset(
					drawUnit.coordinates,
					prepared.anchorCoordinates,
					this.offsetScratch,
				);
				if (
					!frustumIntersectsAABB(
						prepared.frustum,
						OCEAN_BACKDROP_BOUNDS,
						offset.x,
						offset.y,
						offset.z,
					)
				)
					continue;
				terrain.push(this.resolveTerrainFrameInput(drawUnit));
				this.#diagnostics.metrics.terrainFrameInputs += 1;
			}
		}
		let outdoorDirectionalEnabled = false;
		if (entityShadowsEnabled) {
			const cameraPosition = new Vec3(
				prepared.camera.placement.position.x,
				prepared.camera.placement.position.y,
				prepared.camera.placement.position.z,
			);
			const anchorOrigin = createLandblockWorldOrigin(
				prepared.anchorLandblockId,
			);
			let selectionIndex = 0;
			for (const cell of objectShadowPass.indoorGroundingCells.values()) {
				const selection = (storage.indoorSelections[selectionIndex] ??=
					createEntityGroundingSelection());
				selectIndoorGroundingCasters(
					cell,
					objectShadowPass.entityGroundingCasters,
					cameraPosition,
					anchorOrigin,
					selection,
					objectShadowPass.entityGroundingSelectionScratch,
				);
				storage.indoorByScopeKey.set(cell.scopeKey, selection);
				selectionIndex += 1;
			}
			if (shadows) {
				for (const shape of shadows.analyticCasters) {
					objectShadowPass.outdoorDirectionalCasters.push(
						createOutdoorDirectionalShadowCaster(
							shape,
							shadows.projection,
							frameSettings.entityShadows.outdoorDirectional,
						),
					);
				}
			}
			if (objectShadowPass.outdoorDirectionalCasters.length > 0) {
				let outdoorSelectionIndex = 0;
				for (const terrainInput of terrain) {
					if (terrainInput.drawUnit.kind !== "landblock") continue;
					const landblock = createOutdoorDirectionalShadowTerrain(
						terrainInput.drawUnit.landblockId,
					);
					const selection = (storage.outdoorSelections[
						outdoorSelectionIndex
					] ??= createOutdoorDirectionalShadowSelection());
					selectOutdoorDirectionalShadowCasters(
						landblock,
						objectShadowPass.outdoorDirectionalCasters,
						cameraPosition,
						anchorOrigin,
						selection,
						objectShadowPass.outdoorDirectionalSelectionScratch,
					);
					storage.outdoorByLandblockId.set(landblock.landblockId, selection);
					outdoorDirectionalEnabled ||= selection.count > 0;
					outdoorSelectionIndex += 1;
				}
			}
		}

		const { referenceDistance } = frameSettings.entityOverlays;
		retainLegibleOverlays(
			labels,
			prepared.clipFromAnchor,
			maximumLegibleOverlayDepth(
				referenceDistance,
				frameSettings.nameplates.appearance.name.fontSizePixels,
				frameSettings.nameplates.minimumLegibleNamePixels,
			),
			true,
		);
		const eligibleLabelCount = labels.length;
		retainOverlayBudget(labels, frameSettings.nameplates.maximumVisible);
		this.#diagnostics.eligibleNameplateCandidateCount += eligibleLabelCount;
		this.#diagnostics.budgetRejectedNameplateCandidateCount +=
			eligibleLabelCount - labels.length;
		retainLegibleOverlays(
			bars,
			prepared.clipFromAnchor,
			maximumLegibleOverlayDepth(
				referenceDistance,
				frameSettings.healthBars.heightCssPixels,
				frameSettings.healthBars.minimumLegibleBarPixels,
			),
			false,
		);
		const eligibleBarCount = bars.length;
		retainOverlayBudget(bars, frameSettings.healthBars.maximumVisible);
		this.#diagnostics.eligibleHealthBarCandidateCount += eligibleBarCount;
		this.#diagnostics.budgetRejectedHealthBarCandidateCount +=
			eligibleBarCount - bars.length;
		// Keep adjacent roots in the same landblock and physical appearance so their
		// landblock uniform, material table, and VAO-local index binding stay resident.
		const appearanceOrder = new Map<WebGLBuffer, number>();
		for (const object of dynamicOpaque) {
			const buffer = object.appearance.indexBuffer;
			if (!appearanceOrder.has(buffer))
				appearanceOrder.set(buffer, appearanceOrder.size);
		}
		const appearanceRank = (buffer: WebGLBuffer): number => {
			const rank = appearanceOrder.get(buffer);
			if (rank === undefined)
				throw new Error("Dynamic appearance was not ranked before sorting.");
			return rank;
		};
		dynamicOpaque.sort(
			(left, right) =>
				(left.landblockId < right.landblockId
					? -1
					: left.landblockId > right.landblockId
						? 1
						: 0) ||
				appearanceRank(left.appearance.indexBuffer) -
					appearanceRank(right.appearance.indexBuffer) ||
				(left.nodeId < right.nodeId ? -1 : left.nodeId > right.nodeId ? 1 : 0),
		);

		beacons.sort(
			(left, right) =>
				right.distanceSquared - left.distanceSquared ||
				right.identity.localeCompare(left.identity),
		);

		return {
			entityAnalyticShadows: entityShadowsEnabled
				? {
						indoorByScopeKey: storage.indoorByScopeKey,
						outdoorByLandblockId: storage.outdoorByLandblockId,
						outdoorEnabled: outdoorDirectionalEnabled,
						outdoorSettings: frameSettings.entityShadows.outdoorDirectional,
						indoorSettings: frameSettings.entityShadows.indoorGrounding,
					}
				: null,
			dynamicOpaque,
			landblockOffsets,
			entityBeacons: beacons,
			entityBeaconSettings: frameSettings.entityBeacons,
			entityOverlays: composeEntityOverlays(labels, bars),
			entityOverlaySettings: frameSettings.entityOverlays,
			healthBars: frameSettings.healthBars,
			objectBuckets,
			particles: [],
			skyParticles: [],
			terrain,
		};
	}

	retainsObjectFootprint(
		footprint: ObjectPresentationFootprint,
		prepared: PreparedViewGeometry,
	): boolean {
		if (footprint.kind === "ineligible")
			return retainsProjectedObjectFootprint(
				null,
				this.#minimumObjectFootprintDevicePixelArea,
			);
		const landblockOffset = createLandblockOffset(
			getLandblockCoordinates(footprint.placement.landblockId),
			prepared.anchorCoordinates,
		);
		const retained = retainsProjectedObjectFootprint(
			{
				bounds: footprint.localBounds,
				clipFromAnchor: prepared.clipFromAnchor,
				landblockOffsetX: landblockOffset.x,
				landblockOffsetY: landblockOffset.y,
				landblockOffsetZ: landblockOffset.z,
				localToLandblock: footprint.placement.localToLandblock,
				viewportHeight: this.#deviceTargets.frameHeight,
				viewportWidth: this.#deviceTargets.frameWidth,
			},
			this.#minimumObjectFootprintDevicePixelArea,
		);
		if (this.#minimumObjectFootprintDevicePixelArea > 0) {
			this.#diagnostics.metrics.testedObjectPresentationCount += 1;
			if (retained)
				this.#diagnostics.metrics.retainedObjectPresentationCount += 1;
			else this.#diagnostics.metrics.rejectedObjectPresentationCount += 1;
		}
		return retained;
	}

	/**
	 * Resolve a terrain surface program once, against the draw unit that owns it.
	 *
	 * Terrain draw units are built when their landblock realizes and live until it is removed, and
	 * every resource they name is immutable for its key: texture arrays are created once per key
	 * and generated surfaces once per source. There is therefore no invalidation event to ride —
	 * an entry simply becomes collectable with the installation that produced its draw unit.
	 */
	resolveTerrainFrameInput(
		drawUnit: TerrainSurfaceDrawUnit,
	): TerrainFrameInput {
		const existing = this.#terrainFrameInputs.get(drawUnit);
		if (existing !== undefined) return existing;
		const resolved: TerrainFrameInput = {
			drawUnit,
			program: {
				geometry: this.#world.resolveGeometry(drawUnit.geometry),
				composition: this.#world.resolveTexture2D(drawUnit.composition),
				surfaceField: this.#world.resolveTexture2D(drawUnit.surfaceField),
				textures: {
					blendMasks: this.#world.resolveTextureArray(
						drawUnit.textures.blendMasks,
					),
					colors: this.#world.resolveTerrainColorTextureArray(
						drawUnit.textures.colors,
					),
					detail: this.#world.resolveTexture2D(drawUnit.textures.detail),
					roadMasks: this.#world.resolveTextureArray(
						drawUnit.textures.roadMasks,
					),
				},
			},
		};
		this.#terrainFrameInputs.set(drawUnit, resolved);
		return resolved;
	}

	/**
	 * Build one shell publication's submission set for one env-cell render mode, once per mode.
	 *
	 * Like static publications, shell submissions hold nothing frame-variant; the render mode is
	 * part of the cache variant because it selects the cull-face override.
	 */
	compileShellNodeSubmissions(
		nodeId: SceneNodeId,
		contribution: Extract<RenderContribution, { kind: "env-cell" }>,
		envCellRenderMode: FrameSettings["envCellRenderMode"],
	): CompiledStaticNodeSubmissions {
		const objects: PreparedObjectFrameInput[] = [];

		const node = this.#world.resolveEnvCellNode(
			nodeId,
			contribution.renderable,
		);
		if (node.placement.scope.kind !== "env-cell") {
			throw new Error(`EnvCell shell ${nodeId} has outdoor residency.`);
		}
		const scope = node.placement.scope;
		for (const resolved of node.drawUnits) {
			objects.push(
				this.compileStaticSubmission(resolved.drawUnit, {
					cullFaceOverride: envCellRenderMode === "flat" ? "back" : null,
					drawKind: "single",
					geometry: resolved.geometry,
					indexCount: resolved.drawUnit.indexCount,
					indexStart: resolved.drawUnit.indexStart,
					instances: null,
					landblockId: node.placement.landblockId,
					localToLandblock: node.placement.localToLandblock,
					material: resolved.drawUnit.material,
					ordering: resolved.drawUnit.ordering,
					receivesOutdoorPssm: false,
					retailVisibility: "normally-visible",
					renderScopeKey: scopeKey(scope),
					source: "env-cell-shell",
					transparentSort: resolved.drawUnit.transparentSort,
				}),
			);
		}
		const envCellScopeKey = `${scope.landblockId}/${scope.envCellId}`;
		return {
			envCellScopeKey,
			landblockId: node.placement.landblockId,
			objectBuckets: bucketObjectSubmissions(objects),
			source: "env-cell-shell",
			visibleLayerKey: `${envCellScopeKey}/env-cell-shell`,
		};
	}

	/**
	 * Build one static publication's complete submission set, once for its lifetime.
	 *
	 * Static submissions hold nothing that varies between frames: placement, geometry, material,
	 * ordering and sort facts are all fixed when the publication commits, and the one
	 * anchor-relative fact is looked up per frame from the landblock offsets instead of stored
	 * here. A visible node therefore costs one cache lookup and an array append per frame.
	 */
	compileStaticNodeSubmissions(
		nodeId: SceneNodeId,
		contribution: Extract<RenderContribution, { kind: "static-object" }>,
	): CompiledStaticNodeSubmissions {
		let objects: PreparedObjectFrameInput[] = [];
		const materialRows = new Map<
			GeometryResourceKey,
			Map<number, PreparedObjectDrawCompatibility>
		>();
		const source =
			contribution.cullingGroup === "env-cell-static-residents"
				? "env-cell-resident"
				: contribution.cullingGroup === LandblockLayerKind.Generated
					? "generated"
					: "outdoor";
		const node = this.#world.resolveStaticObjectNode(
			nodeId,
			contribution.renderable,
		);
		const scope = node.placement.scope;
		const renderScopeKey = scopeKey(scope);
		const receivesOutdoorPssm = isOutdoorPssmReceiverFootprint(
			contribution.footprint,
		);
		for (const resolved of node.drawUnits) {
			const { drawUnit } = resolved;
			const object = this.compileStaticSubmission(drawUnit, {
				cullFaceOverride: null,
				drawKind: "single",
				geometry: resolved.geometry,
				indexCount: drawUnit.indexCount,
				indexStart: drawUnit.indexStart,
				instances: null,
				landblockId: node.placement.landblockId,
				localToLandblock: node.placement.localToLandblock,
				material: drawUnit.material,
				ordering: drawUnit.ordering,
				receivesOutdoorPssm,
				retailVisibility: drawUnit.retailVisibility,
				renderScopeKey,
				source,
				transparentSort: drawUnit.transparentSort,
			});
			objects.push(object);
			let rows = materialRows.get(resolved.geometry);
			if (!rows) {
				rows = new Map();
				materialRows.set(resolved.geometry, rows);
			}
			if (rows.has(drawUnit.materialSelector))
				throw new Error("Static material row was published twice.");
			rows.set(drawUnit.materialSelector, object.compatibility);
		}
		for (const [geometry, rows] of materialRows) {
			const table =
				this.#deviceTargets.resources.getGeometry(geometry).staticMaterials;
			if (!table || rows.size !== table.rowCount)
				throw new Error(
					"Static publication material rows do not cover its geometry table.",
				);
			const surfaces = Array.from({ length: table.rowCount }, (_, selector) => {
				const surface = rows.get(selector);
				if (!surface)
					throw new Error(`Static material row ${selector} is missing.`);
				return surface;
			});
			this.#deviceTargets.resources.updateGeometryMaterials(
				geometry,
				createObjectMaterialTable(surfaces),
			);
			// Cold resource uploads bind textures outside the draw-state applicator.
			this.#deviceTargets.deviceState.invalidate();
		}
		objects = compileStaticMaterialSpans(objects);
		for (const resolved of node.frameStreamedInstances) {
			const { template } = resolved;
			const { draw } = template;
			// Placement and sort facts stay per instance; immutable draw facts compile once per
			// source partition and are invalidated with the existing publication/resource cache.
			objects.push(
				this.compileStaticSubmission(draw, {
					cullFaceOverride: null,
					drawKind: "instanced",
					geometry: resolved.geometry,
					indexCount: draw.indexCount,
					indexStart: draw.indexStart,
					instances: {
						transparentCohortKey: draw.cohortKey,
						instance: template.instance,
						kind: "frame-template",
					},
					landblockId: node.placement.landblockId,
					localToLandblock: node.placement.localToLandblock,
					material: draw.material,
					ordering: "transparent",
					receivesOutdoorPssm,
					retailVisibility: draw.retailVisibility,
					renderScopeKey,
					source,
					transparentSort: template.transparentSort,
				}),
			);
		}
		return {
			envCellScopeKey:
				scope.kind === "env-cell"
					? `${scope.landblockId}/${scope.envCellId}`
					: null,
			landblockId: node.placement.landblockId,
			objectBuckets: bucketObjectSubmissions(objects),
			source,
			visibleLayerKey:
				scope.kind === "outdoor"
					? `outdoor/${contribution.cullingGroup}`
					: `${scope.landblockId}/${scope.envCellId}/${contribution.cullingGroup}`,
		};
	}

	/** Pair one static contribution with its compiled draw facts, both retained for its lifetime. */
	compileStaticSubmission(
		key: object,
		object: ObjectFrameInput,
	): PreparedObjectFrameInput {
		const compiled = this.#compiledDraws.resolveDraw(key, object.ordering, () =>
			this.#objectDrawCompiler.compile(object),
		);
		return createObjectSubmission(object, compiled);
	}

	/** A frame's consumers all borrow the same composed matrices and installed appearance. */
	publishDynamicPresentation(
		nodeId: SceneNodeId,
	): VisibleDynamicPresentation | null {
		const existing = this.#dynamicPresentations.get(nodeId);
		if (existing !== undefined) return existing;
		const presentation = this.#world.getVisibleDynamicPresentation(nodeId);
		this.#dynamicPresentations.set(nodeId, presentation);
		return presentation;
	}

	/** Keep tiny-footprint beacons and portal-bypass overlays aligned with normal visible-range gating. */
	#hasVisibleDynamicGeometry(
		presentation: VisibleDynamicPresentation,
		showRetailHiddenGeometry: boolean,
	): boolean {
		const appearance = this.#dynamicAppearances.get(
			presentation.visual.appearance,
		);
		const opaqueVariant = selectOpaqueDynamicAppearanceVariant(
			appearance,
			presentation.visual.parts.length,
			presentation.allPartsOpaque,
			showRetailHiddenGeometry,
		);
		const admission = opaqueVariant
			? opaqueVariant.admission
			: summarizeDynamicRangeAdmission(
					appearance.rangeGroupsByPart,
					presentation.visual.parts,
					showRetailHiddenGeometry,
				);
		return admission.sourceRangeGroupCount > 0;
	}

	/** Resolve selected scene and particle inputs before any view begins dynamic execution. */
	preparePortalContributions(
		prepared: PreparedViewGeometry,
		frame: WebGL2PortalScopeAtlasFrame,
		frameSettings: FrameSettings,
		shadows: PreparedOutdoorShadowView | null,
		objectShadowPass: ObjectAndShadowPassExecutor,
		overlayPasses: SkyParticleOverlayAndSelectionPasses,
	): PreparedPortalView {
		const visible = this.#world.queryScopeWindowSelectionScene(
			prepared.clipFromAnchor,
			prepared.frustum.cameraPosition,
			prepared.anchorLandblockId,
			frame,
			renderCullingGroupFilter(frameSettings.layerVisibility),
		);

		const contributions = this.resolveSceneContributions(
			prepared,
			visible.entries,
			frameSettings,
			frame.atlas.visibility,
			shadows,
			objectShadowPass,
			overlayPasses,
		);
		const particlesByScope = prepared.submissionStorage.particles.route(
			`scope-atlas:${frame.atlas.visibility.topologyRevision}`,
			overlayPasses.particleSources,
			(owner) => {
				if (owner === SKY_PARTICLE_RENDER_OWNER) return "sky";
				const renderScopeKey =
					owner === EXTERIOR_PARTICLE_RENDER_OWNER
						? "outdoor"
						: this.#world.getRenderScopeKey(owner);
				if (renderScopeKey === null) return null;
				return frame.atlas.visibility.selectedScopeOrdinal(renderScopeKey) ===
					null
					? null
					: renderScopeKey;
			},
		);
		return {
			view: { ...prepared, ...contributions },
			frame,
			particlesByScope,
			shadows,
		};
	}
}
