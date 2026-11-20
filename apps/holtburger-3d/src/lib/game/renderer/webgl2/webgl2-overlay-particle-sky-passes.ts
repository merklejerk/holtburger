import {
	createLandblockOffset,
	createLandblockWorldOrigin,
	getLandblockCoordinates,
} from "../../landblocks";
import { createPerspectiveMat4, mat4ToFloat32Array } from "../../math/matrices";
import type { SceneNodeId } from "../../scene";
import { scopeKey } from "../../scene/scope";
import { TextureWrapMode } from "../../textures/types";
import type {
	EntitySelectionTarget,
	RendererParticleCapability,
	RendererSkyCapability,
	WorldIndicatorInput,
	WorldMarkerInput,
} from "../renderer";
import type { RenderContribution, RenderWorld } from "../render-world";
import type { VisibleDynamicPresentation } from "../../systems/components";
import { WebGL2SummonChainPass } from "../overlays/webgl2-summon-chain-pass";
import type { SummonLeashInput } from "../../runtime/summon-presentation";
import { WebGL2CombatEffects } from "../overlays/webgl2-combat-effects";
import type { RendererCombatEffectsCapability } from "../../systems/combat-effects-system";
import { WebGL2WorldMarkerPass } from "../overlays/webgl2-world-marker-pass";
import { WebGL2WorldTrajectoryPass } from "../overlays/webgl2-world-trajectory-pass";
import {
	WebGL2EntitySelectionPass,
	type PreparedEntitySelection,
	type WebGL2EntitySelectionMask,
} from "../overlays/webgl2-entity-selection-pass";
import { WebGL2EntityOverlayPass } from "../overlays/webgl2-entity-overlay-pass";
import { WebGL2EntityBeaconPass } from "../overlays/webgl2-entity-beacon-pass";
import {
	resolveEntityBeaconGeometry,
	type EntityBeaconSettings,
} from "../overlays/entity-beacon-policy";
import {
	Canvas2DNameplateRasterizer,
	type NameplateTextureBinding,
	WebGL2NameplateTextureCache,
} from "../overlays/webgl2-nameplate-texture-cache";
import {
	browserNameplateIconServices,
	NameplateIconRepository,
} from "../overlays/nameplate-icon-repository";
import { NAMEPLATE_ICON_CATALOG } from "../overlays/nameplate-icon-source";
import type { NameplateIconId } from "../../systems/dynamic-presentation-source";
import { resolveEntityOverlayAnchor } from "../overlays/entity-overlay-anchor";
import { isOverlayAnchorInFrustum } from "../overlays/entity-overlay-selection";
import type {
	EntityOverlayLookup,
	EntityOverlaySettings,
} from "../overlays/entity-overlay-policy";
import {
	resolveNameplateCategory,
	type NameplateAppearance,
	type NameplateVisual,
} from "../overlays/nameplate-policy";
import {
	selectedDynamicRenderScopeKeys,
	type DynamicRenderDomainSelection,
} from "./dynamic-render-scopes";
import {
	SKY_FAR_PLANE,
	skyViewMatrix,
	WebGL2SkyPass,
} from "../passes/webgl2-sky-pass";
import type { SkyDrawPass } from "../../environment/sky-state";
import {
	createWebGL2SkyProgram,
	type WebGL2SkyProgram,
} from "../passes/webgl2-sky-program";
import { ParticleMeshResidency } from "../passes/particle-mesh-residency";
import {
	type ParticleDrawContext,
	type ParticleRecordFrame,
	WebGL2ParticlePass,
} from "../passes/webgl2-particle-pass";
import type { ParticleSourceRange } from "../../systems/particle-system";
import type { ParticleDrawRange } from "../passes/particle-render-routing";
import type {
	WebGL2PortalScopeAtlasFrame,
	WebGL2PortalScopeAtlasPipeline,
} from "../portal/webgl2-portal-scope-atlas-pipeline";
import type { WebGL2DeviceAndTargetPool } from "./webgl2-device-targets";
import type { RendererFrameDiagnosticsAndProfiler } from "./webgl2-frame-diagnostics";
import type { SceneContributionCompilerAndSelector } from "./webgl2-scene-compiler";
import type { ObjectAndShadowPassExecutor } from "./webgl2-object-shadow-pass";
import {
	anchorRelativePosition,
	EMPTY_PARTICLE_RECORDS,
	NO_ENTITY_OVERLAYS,
	OVERLAY_ROUTE,
	type MutableEntityBeaconDrawInstance,
	type MutableEntityBeaconScopedDrawInstance,
	type MutableEntityOverlayDrawInstance,
	type MutableEntityOverlayScopedDrawInstance,
	type PreparedBarComponent,
	type PreparedEntityBeacon,
	type PreparedEntityOverlay,
	type PreparedLabelComponent,
	type PreparedOverlayEntity,
	type PreparedView,
	type PreparedViewGeometry,
	type SceneShading,
} from "./webgl2-renderer-types";

export class SkyParticleOverlayAndSelectionPasses {
	readonly #world: RenderWorld;
	readonly #deviceTargets: WebGL2DeviceAndTargetPool;
	readonly #diagnostics: RendererFrameDiagnosticsAndProfiler;
	readonly #sceneCompiler: SceneContributionCompilerAndSelector;
	readonly #objectShadowPass: ObjectAndShadowPassExecutor;

	#skyPass: WebGL2SkyPass | null = null;
	#skyProgram: WebGL2SkyProgram | null = null;
	/** Lazy sky variant routing celestial and weather geometry into the packed outdoor tile. */
	#portalAtlasSkyProgram: WebGL2SkyProgram | null = null;
	/** Reusable sky matrices; the pass runs every frame and must not allocate in it. */
	readonly #skyMatrixScratch = new Float32Array(16);
	readonly #skyProjectionScratch = new Float32Array(16);
	readonly #skyViewScratch = new Float32Array(16);

	#particleResidency: ParticleMeshResidency | null = null;
	#particlePass: WebGL2ParticlePass | null = null;
	/** This frame's owner-local sources, replaced every submission rather than retained. */
	#particleSources: readonly ParticleSourceRange[] = [];
	/** Record storage published with the ranges that index into it. */
	#particleRecords: ParticleRecordFrame = EMPTY_PARTICLE_RECORDS;
	/** Reusable particle matrices; the pass runs every frame and must not allocate in it. */
	readonly #particleProjectionScratch = new Float32Array(16);
	readonly #particleViewScratch = new Float32Array(16);

	/** Lazily allocated procedural geometry shared by all summon relationships. */
	#summonChainPass: WebGL2SummonChainPass | null = null;
	#frameSummonLeashes: readonly SummonLeashInput[] = [];
	readonly #combatEffectAdapters = new Set<WebGL2CombatEffects>();

	readonly #worldMarkerPass: WebGL2WorldMarkerPass;
	readonly #worldTrajectoryPass: WebGL2WorldTrajectoryPass;
	readonly #desiredTrajectoryPass: WebGL2WorldTrajectoryPass;
	#frameWorldIndicator: WorldIndicatorInput | null = null;
	/** Current realized selected root, resolved by the runtime rather than retained by the renderer. */
	#frameSelectionTarget: EntitySelectionTarget | null = null;
	/** Frame-global mask geometry prepared before any camera draws. */
	#preparedSelection: {
		readonly pass: WebGL2EntitySelectionPass;
		readonly geometry: PreparedEntitySelection;
	} | null = null;
	/** Lazy material-free selected-entity mask owner. */
	#entitySelectionPass: WebGL2EntitySelectionPass | null = null;

	readonly #entityOverlayPass: WebGL2EntityOverlayPass;
	#entityBeaconPass: WebGL2EntityBeaconPass | null = null;
	readonly #entityBeaconDrawScratch: MutableEntityBeaconDrawInstance[] = [];
	readonly #scopedEntityBeaconDrawScratch: MutableEntityBeaconScopedDrawInstance[] =
		[];
	readonly #nameplateIconRepository: NameplateIconRepository;
	readonly #nameplateTextureCache: WebGL2NameplateTextureCache;
	readonly #entityOverlayDrawScratch: MutableEntityOverlayDrawInstance[] = [];
	readonly #scopedEntityOverlayDrawScratch: MutableEntityOverlayScopedDrawInstance[] =
		[];
	readonly #nameplatePopulationScratch: NameplateVisual[] = [];
	readonly #nameplateIconScratch: NameplateIconId[] = [];
	#reconciledNameplateAppearance: NameplateAppearance | null = null;
	#reconciledNameplatePopulationRevision = -1;
	#reconciledNameplateDensity = Number.NaN;
	#reconciledNameplateViewerIdentity: string | null | undefined = undefined;
	/** Final per-node overlay decisions borrowed for the current frame. */
	#frameEntityOverlays: EntityOverlayLookup = NO_ENTITY_OVERLAYS;
	#frameViewerEntityIdentity: string | null = null;

	/** Each combat subsystem leases one independently disposable draw adapter. */
	readonly combatEffects: RendererCombatEffectsCapability;
	/**
	 * Authored particle residency and per-frame source submission.
	 *
	 * Meshes accumulate across batches rather than being replaced, because one script closure names
	 * a few emitters and different residents keep naming the same meshes.
	 */
	readonly particles: RendererParticleCapability;
	/**
	 * Region-scoped celestial sky residency.
	 *
	 * Installed once per region load; the resource set is fixed for that region's lifetime, so
	 * there is no incremental path and no per-frame residency work.
	 */
	readonly sky: RendererSkyCapability;

	constructor(
		world: RenderWorld,
		deviceTargets: WebGL2DeviceAndTargetPool,
		diagnostics: RendererFrameDiagnosticsAndProfiler,
		sceneCompiler: SceneContributionCompilerAndSelector,
		objectShadowPass: ObjectAndShadowPassExecutor,
	) {
		this.#world = world;
		this.#deviceTargets = deviceTargets;
		this.#diagnostics = diagnostics;
		this.#sceneCompiler = sceneCompiler;
		this.#objectShadowPass = objectShadowPass;

		const { gl, resources, textureSamplers } = deviceTargets;
		this.#worldMarkerPass = new WebGL2WorldMarkerPass(gl);
		this.#worldTrajectoryPass = new WebGL2WorldTrajectoryPass(gl);
		this.#desiredTrajectoryPass = new WebGL2WorldTrajectoryPass(gl);
		this.#nameplateIconRepository = new NameplateIconRepository(
			NAMEPLATE_ICON_CATALOG,
			browserNameplateIconServices(),
		);
		this.#nameplateTextureCache = new WebGL2NameplateTextureCache(
			gl,
			new Canvas2DNameplateRasterizer(this.#nameplateIconRepository),
		);
		this.#entityOverlayPass = new WebGL2EntityOverlayPass(
			gl,
			textureSamplers.getSampler({
				mipLevels: 1,
				policy: "linear",
				samplingClass: "filterable",
				wrap: TextureWrapMode.Clamp,
			}),
			objectShadowPass.objectFallbackBinding.texture,
		);

		this.combatEffects = {
			create: (tuning) => {
				const adapter = new WebGL2CombatEffects(this.#deviceTargets.gl, tuning);
				this.#combatEffectAdapters.add(adapter);
				return {
					setAppearance: (appearance) => adapter.setAppearance(appearance),
					refreshFontAtlas: () => adapter.refreshFontAtlas(),
					submit: (instances) => adapter.submit(instances),
					clear: () => adapter.clear(),
					release: () => {
						adapter.release();
						this.#combatEffectAdapters.delete(adapter);
					},
				};
			},
		};

		this.particles = {
			clear: () => {
				this.#particleResidency?.destroy();
				this.#particleResidency = null;
				this.#particlePass?.destroy();
				this.#particlePass = null;
				this.#particleSources = [];
				this.#particleRecords = EMPTY_PARTICLE_RECORDS;
				this.#sceneCompiler.viewSubmissions.clearParticles();
			},
			install: async (source, preparer) => {
				const residency = (this.#particleResidency ??=
					new ParticleMeshResidency(resources));
				await residency.install(source, preparer);
				// Linked on first residency rather than at construction: a scene with no authored
				// particles never pays for a program it cannot draw with.
				this.#particlePass ??= new WebGL2ParticlePass(
					(hwGfxObjId) => this.#particleResidency?.resolve(hwGfxObjId) ?? null,
				);
			},
			submit: (sources, records) => {
				this.#particleSources = sources;
				this.#particleRecords = records;
			},
		};

		this.sky = {
			clear: () => {
				this.#skyPass?.destroy();
				this.#skyPass = null;
			},
			install: async (source, preparer) => {
				const pass = await WebGL2SkyPass.prepare(resources, preparer, source);
				this.#skyPass?.destroy();
				this.#skyPass = pass;
				// Linked on first use rather than at construction: a region without authored sky
				// objects never pays for a program it cannot draw with.
				this.#skyProgram ??= createWebGL2SkyProgram(this.#deviceTargets.gl);
			},
		};
	}

	get particleSources(): readonly ParticleSourceRange[] {
		return this.#particleSources;
	}

	get frameEntityOverlays(): EntityOverlayLookup {
		return this.#frameEntityOverlays;
	}

	get frameViewerEntityIdentity(): string | null {
		return this.#frameViewerEntityIdentity;
	}

	get entitySelectionPass(): WebGL2EntitySelectionPass | null {
		return this.#entitySelectionPass;
	}

	get nameplateTextureCache(): WebGL2NameplateTextureCache {
		return this.#nameplateTextureCache;
	}

	get nameplateIconRepository(): NameplateIconRepository {
		return this.#nameplateIconRepository;
	}

	setFrameInputs(
		worldIndicator: WorldIndicatorInput | null,
		summonLeashes: readonly SummonLeashInput[],
		selectionTarget: EntitySelectionTarget | null,
		entityOverlays: EntityOverlayLookup,
		viewerEntityIdentity: string | null,
	): void {
		this.#frameWorldIndicator = worldIndicator;
		this.#frameSummonLeashes = summonLeashes;
		this.#frameSelectionTarget = selectionTarget;
		this.#frameEntityOverlays = entityOverlays;
		this.#frameViewerEntityIdentity = viewerEntityIdentity;
	}

	beginParticleFrame(): void {
		this.#particlePass?.beginFrame(this.#particleRecords);
	}

	drawCombatEffectLanes(): void {
		if (this.#combatEffectAdapters.size > 0) {
			this.#diagnostics.profiler?.setCpuPhase("transparencyAndOverlays");
			this.#diagnostics.profiler?.setGpuSystem("transparencyAndEffects");
		}
		const { canvas, renderScale } = this.#deviceTargets;
		for (const adapter of this.#combatEffectAdapters) {
			adapter.drawLane(canvas.width, canvas.height, renderScale);
		}
	}

	/**
	 * Draw one of the sky's two passes.
	 *
	 * The before pass runs into an untouched depth buffer with depth-always and depth writes
	 * off, so the world pass that follows simply paints over it wherever geometry exists. That
	 * ordering is why the sky needs no visibility test of its own, indoors or out.
	 *
	 * The after pass carries the authored weather that retail draws once the landscape is
	 * down, under the same depth-always state — which is what keeps terrain from occluding
	 * rain. It is gated outdoors here rather than inside the pass, because whether the viewer
	 * is outside is a property of the view, not of the sky.
	 */
	drawSky(
		view: PreparedView,
		shading: SceneShading,
		skyPass: SkyDrawPass,
		portalPipeline: WebGL2PortalScopeAtlasPipeline | null,
	): void {
		const pass = this.#skyPass;
		const sky = shading.sky;
		if (!pass || !sky || !this.#skyProgram) return;
		// Retail viewer is player outside tests only that the viewer's cell is a landcell
		// rather than an EnvCell. Deliberately not our sealed-cell test: retail suppresses the
		// after pass from inside any EnvCell, including one that can see outdoors.
		if (
			skyPass === "after-landscape" &&
			view.camera.placement.envCellId !== null
		) {
			return;
		}
		const gl = this.#deviceTargets.gl;
		const program = portalPipeline
			? (this.#portalAtlasSkyProgram ??= createWebGL2SkyProgram(gl, {
					portalAtlas: true,
				}))
			: this.#skyProgram;
		// Program selection lives here because atlas routing writes a uniform owned by that variant.
		// Uploading the tile before binding its program is INVALID_OPERATION and leaves the transform
		// zeroed, collapsing every sky vertex without making the subsequent draw itself fail.
		gl.useProgram(program.program);
		if (portalPipeline) {
			const clipTransform = program.clipTransformUniform;
			if (!clipTransform) {
				throw new Error(
					"Portal sky draw selected a program without an atlas transform.",
				);
			}
			portalPipeline.routeOutdoorOpaqueSubmission(clipTransform);
		}
		pass.draw(
			{
				clockSeconds: this.#deviceTargets.frameClockSeconds,
				gl,
				matrixScratch: this.#skyMatrixScratch,
				program,
				// The frame anchor translates horizontally only, so this render-frame height is
				// already the absolute AC height the authored weather clamp is expressed in.
				viewerHeight: view.cameraPosition.y,
				weatherEnabled: shading.weatherEnabled,
				// Retail rebuilds the projection with `zfar * 4` for the pass and restores it
				// after; the world pass never sees this matrix.
				projection: mat4ToFloat32Array(
					createPerspectiveMat4(
						view.camera.fov,
						this.#deviceTargets.frameWidth /
							Math.max(1, this.#deviceTargets.frameHeight),
						view.camera.near,
						SKY_FAR_PLANE,
					),
					this.#skyProjectionScratch,
				),
				samplers: this.#deviceTargets.textureSamplers,
				textureFiltering: this.#deviceTargets.frameTextureFiltering,
				view: skyViewMatrix(view.view, this.#skyViewScratch),
			},
			sky,
			skyPass,
		);
	}

	#createParticleDrawContext(
		view: PreparedViewGeometry,
		clockSeconds: number,
		opacityScale: number,
	): ParticleDrawContext {
		// The view names its own anchor landblock, so the origin records re-anchor against comes
		// from the same place the view transform did.
		const anchor = createLandblockWorldOrigin(view.anchorLandblockId);
		return {
			anchorOrigin: [anchor.x, anchor.y, anchor.z],
			cameraPosition: [
				view.cameraPosition.x,
				view.cameraPosition.y,
				view.cameraPosition.z,
			],
			clockSeconds,
			gl: this.#deviceTargets.gl,
			opacityScale,
			projection: mat4ToFloat32Array(
				view.projection,
				this.#particleProjectionScratch,
			),
			samplers: this.#deviceTargets.textureSamplers,
			state: this.#deviceTargets.deviceState,
			textureFiltering: this.#deviceTargets.frameTextureFiltering,
			view: mat4ToFloat32Array(view.view, this.#particleViewScratch),
		};
	}

	#executeParticlePass(execute: (pass: WebGL2ParticlePass) => void): void {
		const pass = this.#particlePass;
		if (!pass) return;

		this.#diagnostics.profiler?.setGpuSystem("transparencyAndEffects");
		execute(pass);
		const diagnostics = pass.getDiagnostics();
		this.#diagnostics.metrics.submittedParticleBatchCount +=
			diagnostics.drawnBatchCount;
		this.#diagnostics.metrics.submittedParticleInstanceCount +=
			diagnostics.drawnParticleCount;
		this.#diagnostics.metrics.unresolvedParticleBatchCount +=
			diagnostics.unresolvedBatchCount;
		this.#diagnostics.metrics.uploadedParticleRecordRowCount +=
			diagnostics.uploadedRecordRowCount;
		this.#diagnostics.profiler?.setGpuSystem("other");
	}

	drawParticleBatches(
		view: PreparedView,
		batches: readonly ParticleDrawRange[],
		clockSeconds: number,
		opacityScale: number,
	): void {
		if (batches.length === 0 || opacityScale <= 0) return;
		this.#executeParticlePass((pass) => {
			const context = this.#createParticleDrawContext(
				view,
				clockSeconds,
				opacityScale,
			);
			pass.draw(context, batches);
		});
	}

	drawWorldParticles(
		view: PreparedView,
		particlesByScope: ReadonlyMap<string, readonly ParticleDrawRange[]>,
	): void {
		this.#executeParticlePass((pass) => {
			const context = this.#createParticleDrawContext(
				view,
				this.#deviceTargets.frameClockSeconds,
				1.0,
			);
			pass.drawWorld(context, particlesByScope);
		});
	}

	/** Like particles, spanning leashes use composed scene depth without per-domain duplication. */
	drawSummonLeashes(view: PreparedView): void {
		if (this.#frameSummonLeashes.length === 0) return;
		this.#summonChainPass ??= new WebGL2SummonChainPass(this.#deviceTargets.gl);
		const anchor = createLandblockWorldOrigin(view.anchorLandblockId);
		for (const leash of this.#frameSummonLeashes)
			this.#summonChainPass.draw(leash, anchor, view.clipFromAnchor);
	}

	drawCombatEffects(
		view: PreparedView,
		routing: WebGL2PortalScopeAtlasPipeline | null,
		visibility: DynamicRenderDomainSelection | null,
	): void {
		if (this.#combatEffectAdapters.size === 0) return;
		this.#diagnostics.profiler?.setGpuSystem("transparencyAndEffects");
		for (const adapter of this.#combatEffectAdapters)
			adapter.drawWorld({
				clipFromAnchor: mat4ToFloat32Array(
					view.clipFromAnchor,
					this.#objectShadowPass.matrixScratch,
				),
				anchorLandblockId: view.anchorLandblockId,
				width: this.#deviceTargets.frameWidth,
				height: this.#deviceTargets.frameHeight,
				density: this.#deviceTargets.renderScale,
				routing,
				selectedScope: (scope) =>
					visibility
						? visibility.selectedRenderDomainOrdinal(scopeKey(scope))
						: scope.kind === "outdoor" ||
							  scope.envCellId === view.camera.placement.envCellId
							? 0
							: null,
			});
		this.#diagnostics.profiler?.setGpuSystem("other");
	}

	reconcileNameplateTextureCache(
		appearance: NameplateAppearance,
		density: number,
		viewerEntityIdentity: string | null,
	): void {
		this.#nameplateTextureCache.invalidateIcons(
			this.#nameplateIconRepository.takeChanged(),
		);
		const revision = this.#world.getNameplatePopulationRevision();
		if (
			revision === this.#reconciledNameplatePopulationRevision &&
			appearance === this.#reconciledNameplateAppearance &&
			density === this.#reconciledNameplateDensity &&
			viewerEntityIdentity === this.#reconciledNameplateViewerIdentity
		)
			return;
		this.#nameplatePopulationScratch.length = 0;
		this.#nameplateIconScratch.length = 0;
		this.#world.forEachNameplateVisual((identity, visual) => {
			const classified = {
				...visual,
				category: resolveNameplateCategory(
					visual.entityClass,
					identity === viewerEntityIdentity,
				),
			};
			this.#nameplatePopulationScratch.push(classified);
			for (const { iconId } of classified.content.indicators)
				this.#nameplateIconScratch.push(iconId);
		});
		this.#nameplateIconRepository.reconcile(this.#nameplateIconScratch);
		this.#nameplateTextureCache.reconcile(
			this.#nameplatePopulationScratch,
			appearance,
			density,
		);
		this.#reconciledNameplatePopulationRevision = revision;
		this.#reconciledNameplateAppearance = appearance;
		this.#reconciledNameplateDensity = density;
		this.#reconciledNameplateViewerIdentity = viewerEntityIdentity;
	}

	/**
	 * Resolve one visible entity's shared anchor and enqueue its independently admitted components.
	 *
	 * Entity visibility, depth, and portal domains still apply; the decision of which components
	 * exist was made upstream and is never reinterpreted here.
	 */
	prepareEntityOverlay(
		nodeId: SceneNodeId,
		overlay: NonNullable<ReturnType<EntityOverlayLookup["presentation"]>>,
		renderTarget: VisibleDynamicPresentation,
		contribution: Extract<RenderContribution, { kind: "dynamic" }>,
		prepared: PreparedViewGeometry,
		settings: EntityOverlaySettings,
		portalVisibility: DynamicRenderDomainSelection | null,
		labels: PreparedLabelComponent[],
		bars: PreparedBarComponent[],
		requireAnchorInFrustum = false,
	): void {
		const facts = this.#world.getEntityOverlayFacts(nodeId);
		if (facts === null) return;
		const content = overlay.nameplate === null ? null : facts.content;
		if (content === null && overlay.healthBar === null) return;
		const landblockOffset = createLandblockOffset(
			getLandblockCoordinates(renderTarget.landblockId),
			prepared.anchorCoordinates,
		);
		const { anchor, distanceSquared } = resolveEntityOverlayAnchor(
			facts.rigidBounds,
			contribution.footprint.placement.localToLandblock,
			landblockOffset,
			prepared.cameraPosition,
			settings.anchorPaddingWorldUnits,
		);
		if (
			requireAnchorInFrustum &&
			!isOverlayAnchorInFrustum(anchor, prepared.clipFromAnchor)
		)
			return;
		const entity: PreparedOverlayEntity = {
			anchor,
			distanceSquared,
			identity: facts.identity,
			route:
				overlay.occlusion === "overlay"
					? OVERLAY_ROUTE
					: {
							kind: "scene",
							renderScopeKeys: selectedDynamicRenderScopeKeys(
								renderTarget.renderScopes,
								portalVisibility,
							),
						},
		};
		if (content !== null && overlay.nameplate !== null)
			labels.push({
				entity,
				anchor,
				distanceSquared,
				identity: facts.identity,
				priority: overlay.nameplate,
				label: {
					category: resolveNameplateCategory(
						contribution.entityClass,
						facts.identity === this.#frameViewerEntityIdentity,
					),
					content,
				},
			});
		if (overlay.healthBar !== null)
			bars.push({
				entity,
				anchor,
				distanceSquared,
				identity: facts.identity,
				priority: overlay.healthBar.priority,
				fraction: overlay.healthBar.fraction,
			});
	}

	/** Resolve one visible entity's depth-tested beacon base, scenario height, and portal scopes. */
	prepareEntityBeacon(
		nodeId: SceneNodeId,
		renderTarget: VisibleDynamicPresentation,
		contribution: Extract<RenderContribution, { kind: "dynamic" }>,
		prepared: PreparedViewGeometry,
		settings: EntityBeaconSettings,
		portalVisibility: DynamicRenderDomainSelection | null,
		beacons: PreparedEntityBeacon[],
	): void {
		const facts = this.#world.getEntityOverlayFacts(nodeId);
		if (facts === null) return;
		const landblockOffset = createLandblockOffset(
			getLandblockCoordinates(renderTarget.landblockId),
			prepared.anchorCoordinates,
		);
		const isIndoor = renderTarget.renderScopes.some(
			(scope) => scope.kind === "env-cell",
		);
		const { base, height, radius, distanceSquared } =
			resolveEntityBeaconGeometry(
				facts.rigidBounds,
				contribution.footprint.placement.localToLandblock,
				landblockOffset,
				prepared.cameraPosition,
				isIndoor,
				settings,
			);
		beacons.push({
			base,
			height,
			radius,
			distanceSquared,
			identity: facts.identity,
			renderScopeKeys: selectedDynamicRenderScopeKeys(
				renderTarget.renderScopes,
				portalVisibility,
			),
		});
	}

	/** Draw depth-tested, portal-clipped in-scene beacons before entity nameplates and health bars. */
	drawEntityBeacons(
		view: PreparedView,
		portalRouting: WebGL2PortalScopeAtlasPipeline | null,
	): void {
		if (view.entityBeacons.length === 0) return;
		const pass = (this.#entityBeaconPass ??= new WebGL2EntityBeaconPass(
			this.#deviceTargets.gl,
		));
		const viewMat = view.view;
		const context = {
			clipFromAnchor: mat4ToFloat32Array(
				view.clipFromAnchor,
				this.#objectShadowPass.matrixScratch,
			),
			cameraPosition: view.cameraPosition,
			cameraRight: [viewMat.m11, viewMat.m21, viewMat.m31] as const,
			viewportWidth: this.#deviceTargets.frameWidth,
			viewportHeight: this.#deviceTargets.frameHeight,
			renderScale: this.#deviceTargets.renderScale,
			timeSeconds: this.#deviceTargets.frameClockSeconds,
			settings: view.entityBeaconSettings,
		};
		if (portalRouting) {
			let instanceCount = 0;
			for (const beacon of view.entityBeacons) {
				for (const renderScopeKey of beacon.renderScopeKeys) {
					const slot = this.#scopedEntityBeaconDrawScratch[instanceCount];
					if (slot === undefined) {
						this.#scopedEntityBeaconDrawScratch.push({
							base: beacon.base,
							height: beacon.height,
							radius: beacon.radius,
							renderScopeKey,
						});
					} else {
						slot.base = beacon.base;
						slot.height = beacon.height;
						slot.radius = beacon.radius;
						slot.renderScopeKey = renderScopeKey;
					}
					instanceCount += 1;
				}
			}
			this.#scopedEntityBeaconDrawScratch.length = instanceCount;
			pass.drawScoped(
				context,
				this.#scopedEntityBeaconDrawScratch,
				portalRouting,
			);
			return;
		}
		let instanceCount = 0;
		for (const beacon of view.entityBeacons) {
			const slot = this.#entityBeaconDrawScratch[instanceCount];
			if (slot === undefined) {
				this.#entityBeaconDrawScratch.push({
					base: beacon.base,
					height: beacon.height,
					radius: beacon.radius,
				});
			} else {
				slot.base = beacon.base;
				slot.height = beacon.height;
				slot.radius = beacon.radius;
			}
			instanceCount += 1;
		}
		this.#entityBeaconDrawScratch.length = instanceCount;
		pass.draw(context, this.#entityBeaconDrawScratch);
	}

	#acquireOverlayTexture(
		overlay: PreparedEntityOverlay,
	): NameplateTextureBinding | null {
		return overlay.label === null
			? null
			: this.#nameplateTextureCache.acquire(overlay.label);
	}

	drawEntityOverlays(
		view: PreparedView,
		portalRouting: WebGL2PortalScopeAtlasPipeline | null,
	): void {
		const bar = view.healthBars;
		const density = this.#deviceTargets.renderScale;
		const context = {
			clipFromAnchor: mat4ToFloat32Array(
				view.clipFromAnchor,
				this.#objectShadowPass.matrixScratch,
			),
			healthBar: {
				sizePixels: [
					bar.widthCssPixels * density,
					bar.heightCssPixels * density,
				] as const,
				gapPixels: bar.gapCssPixels * density,
				borderWidthPixels: bar.borderWidthCssPixels * density,
				fillColor: bar.fillColor,
				backgroundColor: bar.backgroundColor,
				borderColor: bar.borderColor,
			},
			referenceDistance: view.entityOverlaySettings.referenceDistance,
			viewportHeight: this.#deviceTargets.frameHeight,
			viewportWidth: this.#deviceTargets.frameWidth,
		};
		if (view.entityOverlays.length === 0) {
			if (portalRouting)
				this.#entityOverlayPass.drawScoped(context, [], portalRouting);
			else this.#entityOverlayPass.draw(context, []);
			return;
		}
		this.#nameplateTextureCache.beginDraw();
		if (portalRouting) {
			let instanceCount = 0;
			for (const overlay of view.entityOverlays) {
				const { route } = overlay.entity;
				if (route.kind === "overlay") continue;
				const binding = this.#acquireOverlayTexture(overlay);
				for (const renderScopeKey of route.renderScopeKeys) {
					const instance = this.#scopedEntityOverlayDrawScratch[instanceCount];
					if (instance === undefined) {
						this.#scopedEntityOverlayDrawScratch.push({
							anchor: overlay.entity.anchor,
							depthTest: true,
							binding,
							healthFraction: overlay.healthFraction,
							renderScopeKey,
						});
					} else {
						instance.anchor = overlay.entity.anchor;
						instance.depthTest = true;
						instance.binding = binding;
						instance.healthFraction = overlay.healthFraction;
						instance.renderScopeKey = renderScopeKey;
					}
					instanceCount += 1;
				}
			}
			this.#scopedEntityOverlayDrawScratch.length = instanceCount;
			this.#entityOverlayPass.drawScoped(
				context,
				this.#scopedEntityOverlayDrawScratch,
				portalRouting,
			);
			const scopedDiagnostics = this.#entityOverlayPass.diagnostics();
			this.#diagnostics.submittedEntityOverlayDrawCount +=
				scopedDiagnostics.drawCount;
			this.#diagnostics.submittedEntityOverlayInstanceCount +=
				scopedDiagnostics.instanceCount;
		}
		let instanceCount = 0;
		for (const overlay of view.entityOverlays) {
			const { route } = overlay.entity;
			// Overlay-route entities draw once, unscoped, after ordinary scoped overlays.
			if (portalRouting !== null && route.kind === "scene") continue;
			const binding = this.#acquireOverlayTexture(overlay);
			const depthTest = route.kind === "scene";
			const instance = this.#entityOverlayDrawScratch[instanceCount];
			if (instance === undefined) {
				this.#entityOverlayDrawScratch.push({
					anchor: overlay.entity.anchor,
					depthTest,
					binding,
					healthFraction: overlay.healthFraction,
				});
			} else {
				instance.anchor = overlay.entity.anchor;
				instance.depthTest = depthTest;
				instance.binding = binding;
				instance.healthFraction = overlay.healthFraction;
			}
			instanceCount += 1;
		}
		this.#entityOverlayDrawScratch.length = instanceCount;
		this.#entityOverlayPass.draw(context, this.#entityOverlayDrawScratch);
		const diagnostics = this.#entityOverlayPass.diagnostics();
		this.#diagnostics.submittedEntityOverlayDrawCount += diagnostics.drawCount;
		this.#diagnostics.submittedEntityOverlayInstanceCount +=
			diagnostics.instanceCount;
	}

	drawWorldIndicator(
		view: PreparedViewGeometry,
		portal: {
			readonly visibility: WebGL2PortalScopeAtlasFrame["atlas"]["visibility"];
			readonly routing: WebGL2PortalScopeAtlasPipeline;
		} | null,
	): void {
		const indicator = this.#frameWorldIndicator;
		if (indicator === null) return;
		if (indicator.desiredTrajectory) {
			this.drawWorldTrajectory(
				view,
				indicator.desiredTrajectory,
				portal,
				this.#desiredTrajectoryPass,
			);
		}
		if (indicator.trajectory) {
			this.drawWorldTrajectory(
				view,
				indicator.trajectory,
				portal,
				this.#worldTrajectoryPass,
			);
		}
		if (portal !== null) {
			for (const marker of [indicator.marker, indicator.landingMarker]) {
				if (
					marker &&
					portal.visibility.selectedScopeOrdinal(marker.renderScopeKey) !== null
				) {
					this.drawWorldMarker(view, marker, {
						key: marker.renderScopeKey,
						routing: portal.routing,
					});
				}
			}
		} else {
			this.drawWorldMarker(view, indicator.marker, null);
			if (indicator.landingMarker) {
				this.drawWorldMarker(view, indicator.landingMarker, null);
			}
		}
	}

	drawWorldMarker(
		view: PreparedViewGeometry,
		marker: WorldMarkerInput,
		portal: Parameters<WebGL2WorldMarkerPass["draw"]>[1],
	): void {
		const center = anchorRelativePosition(
			marker.position,
			view.anchorLandblockId,
		);
		const cameraDistance = Math.sqrt(
			center.distanceSquaredTo(view.cameraPosition),
		);
		this.#worldMarkerPass.draw(
			{
				center,
				clipFromAnchor: view.clipFromAnchor,
				color: marker.color,
				normal: marker.normal,
				radius: Math.min(2.4, Math.max(marker.radius, cameraDistance * 0.012)),
				shape: marker.shape,
				spinAngle: marker.pending
					? (this.#deviceTargets.frameClockSeconds % 1) * Math.PI * 2
					: null,
			},
			portal,
		);
	}

	drawWorldTrajectory(
		view: PreparedViewGeometry,
		trajectory: NonNullable<WorldIndicatorInput["trajectory"]>,
		portal: Parameters<WebGL2WorldTrajectoryPass["draw"]>[2],
		pass: WebGL2WorldTrajectoryPass,
	): void {
		pass.draw(
			trajectory,
			{
				anchorOrigin: createLandblockWorldOrigin(view.anchorLandblockId),
				clipFromAnchor: view.clipFromAnchor,
				color: trajectory.color,
				viewportHeight: this.#deviceTargets.frameHeight,
				viewportWidth: this.#deviceTargets.frameWidth,
			},
			portal,
		);
	}

	/** Resolve the x-ray selection independently of ordinary camera/portal visibility. */
	prepareEntitySelection(showRetailHiddenGeometry: boolean): void {
		const target = this.#frameSelectionTarget;
		if (target === null) return;
		const depth =
			target.shape.kind === "rigid"
				? this.#sceneCompiler.dynamicDepths.prepareSelection(
						target.nodeId,
						showRetailHiddenGeometry,
					)
				: null;
		const pass = (this.#entitySelectionPass ??= new WebGL2EntitySelectionPass(
			this.#deviceTargets.gl,
			{
				getGeometry: (key) =>
					this.#deviceTargets.resources.getGeometry(
						this.#world.resolveGeometry(key),
					),
				getPose: (nodeId) => this.#sceneCompiler.dynamicPosePages.get(nodeId),
			},
		));
		const geometry = pass.prepare(target, depth);
		this.#preparedSelection = geometry === null ? null : { pass, geometry };
		if (geometry?.kind === "rigid") {
			this.#sceneCompiler.poseUploadParts.set(target.nodeId, geometry.parts);
			this.#sceneCompiler.selectedDynamicNodeIds.add(target.nodeId);
		}
	}

	drawEntitySelectionMask(
		view: PreparedViewGeometry,
	): WebGL2EntitySelectionMask | null {
		const target = this.#frameSelectionTarget;
		if (target === null) {
			this.#diagnostics.metrics.entitySelection.skippedReason = "no-target";
			return null;
		}
		const selection = this.#preparedSelection;
		if (selection === null) {
			this.#diagnostics.metrics.entitySelection.skippedReason =
				"hidden-or-empty";
			return null;
		}
		const rendered = selection.pass.render({
			anchorCoordinates: view.anchorCoordinates,
			clipFromAnchor: view.clipFromAnchor,
			selection: selection.geometry,
			height: this.#deviceTargets.frameHeight,
			width: this.#deviceTargets.frameWidth,
		});
		const metrics = this.#diagnostics.metrics.entitySelection;
		metrics.compositeDrawCount += 1;
		metrics.maskDrawCount += rendered.work.maskDrawCount;
		metrics.selectedSphereProxyCount += rendered.work.selectedSphereProxyCount;
		metrics.selectedPartCount += rendered.work.selectedPartCount;
		metrics.selectedTriangleCount += rendered.work.selectedTriangleCount;
		metrics.skippedReason = null;
		return rendered.mask;
	}

	destroyParticlesAndCombatEffects(): void {
		this.particles.clear();
		for (const adapter of this.#combatEffectAdapters) adapter.release();
		this.#combatEffectAdapters.clear();
	}

	clearPreparedSelection(): void {
		this.#preparedSelection = null;
	}

	destroyEntitySelectionPass(): void {
		this.#entitySelectionPass?.destroy();
		this.#entitySelectionPass = null;
	}

	destroyPassesAndNameplates(): void {
		this.#skyPass?.destroy();
		this.#skyPass = null;
		this.#summonChainPass?.destroy();
		this.#worldMarkerPass.destroy();
		this.#worldTrajectoryPass.destroy();
		this.#desiredTrajectoryPass.destroy();
		this.#entityOverlayPass.destroy();
		this.#entityBeaconPass?.destroy();
		this.#entityBeaconPass = null;
		this.#nameplateTextureCache.destroy();
		this.#nameplateIconRepository.destroy();
	}

	destroySkyPrograms(): void {
		const gl = this.#deviceTargets.gl;
		if (this.#skyProgram) gl.deleteProgram(this.#skyProgram.program);
		this.#skyProgram = null;
		if (this.#portalAtlasSkyProgram) {
			gl.deleteProgram(this.#portalAtlasSkyProgram.program);
		}
		this.#portalAtlasSkyProgram = null;
	}
}
