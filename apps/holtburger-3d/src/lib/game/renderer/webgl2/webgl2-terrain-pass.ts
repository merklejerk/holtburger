import {
	createLandblockOffset,
	landblockChebyshevDistance,
} from "../../landblocks";
import { farTerrainCutoffLandblocks } from "../../environment/terrain-fog";
import { mat4ToFloat32Array } from "../../math/matrices";
import type { Vec3 } from "../../math/types";
import { TextureWrapMode } from "../../textures/types";
import { SHARED_FRONTEND_TUNING } from "../../../frontend-tuning";
import { assertSharedTerrainRegion } from "./terrain-program-input";
import type { GeometryResourceKey } from "../resource-manager";
import type {
	WebGL2Texture2DBinding,
	WebGL2TextureArrayBinding,
} from "./webgl2-resource-manager";
import {
	createWebGL2NearTerrainProgram,
	type WebGL2NearTerrainProgram,
} from "./webgl2-terrain-program";
import {
	createWebGL2FarTerrainProgram,
	type WebGL2FarTerrainProgram,
} from "./webgl2-far-terrain-program";
import { terrainLandblockIntersectsShadowDistance } from "../shadows/outdoor-pssm";
import {
	bindWebGL2OutdoorPssmUniforms,
	OUTDOOR_PSSM_TEXTURE_UNIT,
} from "../shadows/webgl2-pssm-receiver";
import { bindWebGL2OutdoorDirectionalShadowUniforms } from "../shadows/webgl2-outdoor-directional-shadow";
import type { LandblockLights } from "../../environment/outdoor-light-index";
import {
	createWebGL2TerrainLightMaskTexture,
	destroyWebGL2TerrainLightMaskTexture,
	uploadWebGL2TerrainLightMask,
	type WebGL2TerrainLightMaskTexture,
} from "./webgl2-terrain-light-mask";
import { bindWebGL2DistanceFog } from "../passes/webgl2-fog";
import {
	bindWebGL2DynamicLights,
	bindWebGL2SceneLighting,
	bindWebGL2StaticLights,
} from "../passes/webgl2-lighting";
import type { TextureSamplingClass } from "./webgl2-texture-sampler-catalog";
import type { WebGL2PortalScopeAtlasPipeline } from "../portal/webgl2-portal-scope-atlas-pipeline";
import type { WebGL2DeviceAndTargetPool } from "./webgl2-device-targets";
import type { RendererFrameDiagnosticsAndProfiler } from "./webgl2-frame-diagnostics";
import { ObjectAndShadowPassExecutor } from "./webgl2-object-shadow-pass";
import type { SceneContributionCompilerAndSelector } from "./webgl2-scene-compiler";
import {
	EMPTY_LANDBLOCK_LIGHTS,
	TERRAIN_DEPTH_OFFSET,
	TERRAIN_LIGHT_MASK_TEXTURE_UNIT,
	type PreparedView,
	type SceneShading,
	type TerrainFrameInput,
	type TerrainGroupUniforms,
} from "./webgl2-renderer-types";

export class TerrainPassExecutor {
	readonly #deviceTargets: WebGL2DeviceAndTargetPool;
	readonly #diagnostics: RendererFrameDiagnosticsAndProfiler;
	readonly #objectShadowPass: ObjectAndShadowPassExecutor;
	readonly #sceneCompiler: SceneContributionCompilerAndSelector;

	readonly #nearTerrainProgram: WebGL2NearTerrainProgram;
	readonly #farTerrainProgram: WebGL2FarTerrainProgram;
	readonly #terrainLightMask: WebGL2TerrainLightMaskTexture;

	constructor(
		deviceTargets: WebGL2DeviceAndTargetPool,
		diagnostics: RendererFrameDiagnosticsAndProfiler,
		objectShadowPass: ObjectAndShadowPassExecutor,
		sceneCompiler: SceneContributionCompilerAndSelector,
	) {
		this.#deviceTargets = deviceTargets;
		this.#diagnostics = diagnostics;
		this.#objectShadowPass = objectShadowPass;
		this.#sceneCompiler = sceneCompiler;

		const { gl } = deviceTargets;
		this.#terrainLightMask = createWebGL2TerrainLightMaskTexture(gl);
		this.#nearTerrainProgram = createWebGL2NearTerrainProgram(gl);
		this.#farTerrainProgram = createWebGL2FarTerrainProgram(gl);
	}

	drawTerrain(
		view: PreparedView,
		shading: SceneShading,
		portalPipeline: WebGL2PortalScopeAtlasPipeline | null,
	): void {
		const [passResources] = view.terrain;
		if (!passResources) {
			portalPipeline?.routeTerrainPass(
				0,
				this.#nearTerrainProgram.uniforms.clipTransform,
			);
			return;
		}
		this.#diagnostics.profiler?.setGpuSystem("terrain");
		const farCutoff = farTerrainCutoffLandblocks(shading.fog);
		this.#diagnostics.metrics.farTerrainCutoffLandblocks = farCutoff;
		let nearCount = 0;
		let directionalCount = 0;
		let farCount = 0;
		for (const terrain of view.terrain) {
			assertSharedTerrainRegion(
				passResources.program,
				terrain.program,
				terrain.drawUnit.kind === "landblock"
					? terrain.drawUnit.landblockId
					: "ocean-backdrop",
			);
			if (this.#isFarTerrain(terrain, view, farCutoff)) farCount += 1;
			else {
				nearCount += 1;
				if (this.#hasTerrainDirectionalShadow(terrain, view)) {
					directionalCount += 1;
				}
			}
		}
		const gl = this.#deviceTargets.gl;
		gl.enable(gl.DEPTH_TEST);
		// Opaque objects have already written depth; strict LESS keeps objects winning exact ties
		// against offset terrain depth just as LEQUAL did when terrain drew first.
		gl.depthFunc(gl.LESS);
		gl.depthMask(true);
		gl.disable(gl.BLEND);
		gl.enable(gl.CULL_FACE);
		gl.cullFace(gl.BACK);
		gl.enable(gl.POLYGON_OFFSET_FILL);
		gl.polygonOffset(TERRAIN_DEPTH_OFFSET.factor, TERRAIN_DEPTH_OFFSET.units);
		try {
			let routedTerrainPass = false;
			if (nearCount > 0) {
				for (const directional of [false, true]) {
					const count = directional
						? directionalCount
						: nearCount - directionalCount;
					if (count === 0) continue;
					const nearProgram = this.#beginNearTerrainGroup(
						view,
						shading,
						passResources,
						portalPipeline,
						routedTerrainPass ? null : view.terrain.length,
						directional,
					);
					routedTerrainPass = true;
					this.#drawNearTerrainGroup(
						view,
						shading,
						farCutoff,
						nearProgram,
						directional,
					);
				}
			}
			if (farCount > 0) {
				this.#beginFarTerrainGroup(
					view,
					shading,
					passResources,
					portalPipeline,
					routedTerrainPass ? null : view.terrain.length,
				);
				this.#drawFarTerrainGroup(view, farCutoff);
			}
		} finally {
			gl.depthFunc(gl.LEQUAL);
			gl.disable(gl.CULL_FACE);
			gl.disable(gl.POLYGON_OFFSET_FILL);
			// Terrain mutates raw WebGL program, VAO, texture, and cull-face bindings outside #deviceState.
			this.#deviceTargets.deviceState.invalidate();
			this.#diagnostics.profiler?.setGpuSystem("other");
		}
	}

	#beginTerrainGroup(
		view: PreparedView,
		shading: SceneShading,
		program: WebGLProgram,
		uniforms: TerrainGroupUniforms,
		portalPipeline: WebGL2PortalScopeAtlasPipeline | null,
		routeSubmissionCount: number | null,
	): void {
		const gl = this.#deviceTargets.gl;
		const matrixScratch = this.#objectShadowPass.matrixScratch;
		gl.useProgram(program);
		gl.uniform4f(uniforms.clipTransform, 1, 1, 0, 0);
		if (portalPipeline) {
			if (routeSubmissionCount === null) {
				portalPipeline.routeOutdoorOpaqueSubmission(uniforms.clipTransform);
			} else {
				portalPipeline.routeTerrainPass(
					routeSubmissionCount,
					uniforms.clipTransform,
				);
			}
		}
		gl.uniformMatrix4fv(
			uniforms.projection,
			false,
			mat4ToFloat32Array(view.projection, matrixScratch),
		);
		gl.uniform3f(
			uniforms.cameraPosition,
			view.cameraPosition.x,
			view.cameraPosition.y,
			view.cameraPosition.z,
		);
		gl.uniformMatrix4fv(
			uniforms.view,
			false,
			mat4ToFloat32Array(view.view, matrixScratch),
		);
		gl.uniformMatrix4fv(
			uniforms.localToLandblock,
			false,
			mat4ToFloat32Array(ObjectAndShadowPassExecutor.identityMatrix),
		);
		bindWebGL2DistanceFog(gl, uniforms, shading.fog);
		bindWebGL2SceneLighting(gl, uniforms, shading.lighting.terrain);
	}

	#beginNearTerrainGroup(
		view: PreparedView,
		shading: SceneShading,
		passResources: TerrainFrameInput,
		portalPipeline: WebGL2PortalScopeAtlasPipeline | null,
		routeSubmissionCount: number | null,
		directional: boolean,
	): WebGL2NearTerrainProgram {
		const outdoorPssm = this.#objectShadowPass.activeOutdoorPssmFrame;
		const mapped = outdoorPssm !== null;
		const receiverPrograms = this.#objectShadowPass.outdoorPssmReceiverPrograms;
		const selected = mapped
			? directional
				? receiverPrograms.hybridTerrain()
				: receiverPrograms.terrain()
			: directional
				? receiverPrograms.directionalTerrain()
				: this.#nearTerrainProgram;
		const { program, uniforms } = selected;
		this.#beginTerrainGroup(
			view,
			shading,
			program,
			uniforms,
			portalPipeline,
			routeSubmissionCount,
		);
		const gl = this.#deviceTargets.gl;
		gl.uniform1f(
			uniforms.detailFadeNear,
			SHARED_FRONTEND_TUNING.rendering.terrainDetailFade.near,
		);
		gl.uniform1f(
			uniforms.detailFadeFar,
			SHARED_FRONTEND_TUNING.rendering.terrainDetailFade.far,
		);
		gl.uniform1f(
			uniforms.terrainPointLightIntensityScale,
			SHARED_FRONTEND_TUNING.rendering.terrainPointLightIntensityScale,
		);
		bindWebGL2DynamicLights(
			gl,
			uniforms,
			shading.dynamicLights,
			shading.anchorOrigin,
			this.#objectShadowPass.dynamicLightScratch,
		);
		if (outdoorPssm) {
			const pssmUniforms = selected.outdoorPssmUniforms;
			if (!pssmUniforms) {
				throw new Error("Active outdoor PSSM selected plain terrain program.");
			}
			bindWebGL2OutdoorPssmUniforms(
				gl,
				pssmUniforms,
				outdoorPssm,
				this.#objectShadowPass.outdoorPssmUniformScratch,
			);
			gl.activeTexture(gl.TEXTURE0 + OUTDOOR_PSSM_TEXTURE_UNIT);
			gl.bindTexture(gl.TEXTURE_2D_ARRAY, outdoorPssm.targets.depth);
			gl.bindSampler(OUTDOOR_PSSM_TEXTURE_UNIT, null);
			gl.activeTexture(gl.TEXTURE0);
		}
		this.#beginTerrainLightMasks(selected);
		this.#beginTerrainPassResources(passResources, selected);
		return selected;
	}

	#beginFarTerrainGroup(
		view: PreparedView,
		shading: SceneShading,
		passResources: TerrainFrameInput,
		portalPipeline: WebGL2PortalScopeAtlasPipeline | null,
		routeSubmissionCount: number | null,
	): void {
		const { program, uniforms } = this.#farTerrainProgram;
		this.#beginTerrainGroup(
			view,
			shading,
			program,
			uniforms,
			portalPipeline,
			routeSubmissionCount,
		);
		this.#deviceTargets.gl.uniform3fv(
			uniforms.palette,
			passResources.program.textures.colors.palette.colors,
		);
		this.#diagnostics.metrics.farTerrainPaletteUploads += 1;
	}

	#drawNearTerrainGroup(
		view: PreparedView,
		shading: SceneShading,
		farCutoff: number | null,
		program: WebGL2NearTerrainProgram,
		directional: boolean,
	): void {
		let previousStaticLightsEmpty = false;
		const gl = this.#deviceTargets.gl;
		const offsetScratch = this.#sceneCompiler.offsetScratch;
		const dynamicLightScratch = this.#objectShadowPass.dynamicLightScratch;
		for (const terrain of view.terrain) {
			if (this.#isFarTerrain(terrain, view, farCutoff)) continue;
			if (this.#hasTerrainDirectionalShadow(terrain, view) !== directional)
				continue;
			const landblockOffset = createLandblockOffset(
				terrain.drawUnit.coordinates,
				view.anchorCoordinates,
				offsetScratch,
			);
			this.#bindTerrainSurfaceField(terrain);
			const landblockLights =
				terrain.drawUnit.kind === "landblock"
					? shading.staticLights(terrain.drawUnit.landblockId)
					: EMPTY_LANDBLOCK_LIGHTS;
			const hasActiveStaticLights =
				shading.authoredLightResponse > 0 && landblockLights.lights.length > 0;
			if (hasActiveStaticLights || !previousStaticLightsEmpty) {
				bindWebGL2StaticLights(
					gl,
					program.uniforms,
					landblockLights.lights,
					shading.anchorOrigin,
					shading.authoredLightResponse,
					dynamicLightScratch,
				);
				this.#diagnostics.metrics.staticLightBinds += 1;
			}
			if (hasActiveStaticLights) {
				this.#uploadTerrainLightMask(landblockLights);
			}
			previousStaticLightsEmpty = !hasActiveStaticLights;
			if (directional) {
				this.#applyTerrainDirectionalShadow(program, terrain, view);
			}
			this.#drawTerrainGeometry(
				terrain.program.geometry,
				program.uniforms.landblockOffset,
				landblockOffset,
			);
		}
	}

	#hasTerrainDirectionalShadow(
		terrain: TerrainFrameInput,
		view: PreparedView,
	): boolean {
		return (
			terrain.drawUnit.kind === "landblock" &&
			(view.entityAnalyticShadows?.outdoorByLandblockId.get(
				terrain.drawUnit.landblockId,
			)?.count ?? 0) > 0
		);
	}

	#drawFarTerrainGroup(view: PreparedView, farCutoff: number | null): void {
		const offsetScratch = this.#sceneCompiler.offsetScratch;
		for (const terrain of view.terrain) {
			if (!this.#isFarTerrain(terrain, view, farCutoff)) continue;
			const landblockOffset = createLandblockOffset(
				terrain.drawUnit.coordinates,
				view.anchorCoordinates,
				offsetScratch,
			);
			this.#drawTerrainGeometry(
				terrain.program.geometry,
				this.#farTerrainProgram.uniforms.landblockOffset,
				landblockOffset,
			);
			this.#diagnostics.metrics.farTerrainDraws += 1;
		}
	}

	#isFarTerrain(
		terrain: TerrainFrameInput,
		view: PreparedView,
		farCutoff: number | null,
	): boolean {
		const outdoorDirectional =
			terrain.drawUnit.kind === "landblock"
				? view.entityAnalyticShadows?.outdoorByLandblockId.get(
						terrain.drawUnit.landblockId,
					)
				: undefined;
		if (outdoorDirectional && outdoorDirectional.count > 0) return false;
		const activePssm = this.#objectShadowPass.activeOutdoorPssmFrame;
		if (
			activePssm &&
			terrainLandblockIntersectsShadowDistance(
				terrain.drawUnit.coordinates,
				view.anchorCoordinates,
				view.cameraPosition,
				activePssm.settings.maximumDistance,
			)
		) {
			return false;
		}
		return (
			farCutoff !== null &&
			landblockChebyshevDistance(
				terrain.drawUnit.coordinates,
				view.anchorCoordinates,
			) >= farCutoff
		);
	}

	/** Bind one terrain landblock's directional analytic records before its existing draw. */
	#applyTerrainDirectionalShadow(
		program: WebGL2NearTerrainProgram,
		terrain: TerrainFrameInput,
		view: PreparedView,
	): void {
		const uniforms = program.outdoorDirectionalShadowUniforms;
		const active = view.entityAnalyticShadows;
		if (terrain.drawUnit.kind !== "landblock")
			throw new Error("Ocean backdrop cannot receive authored entity shadows.");
		const selection = active?.outdoorByLandblockId.get(
			terrain.drawUnit.landblockId,
		);
		if (!uniforms) {
			if (active?.outdoorEnabled && selection !== undefined) {
				throw new Error(
					"Active directional-shadow draw selected an ordinary terrain program.",
				);
			}
			return;
		}
		if (!active?.outdoorEnabled || selection === undefined) {
			throw new Error(
				"Directional-shadow program selected without an active landblock record set.",
			);
		}
		bindWebGL2OutdoorDirectionalShadowUniforms(
			this.#deviceTargets.gl,
			uniforms,
			selection,
			active.outdoorSettings,
		);
	}

	/**
	 * Bind every region-constant terrain texture once for the whole pass.
	 *
	 * `composition`, `colors`, `blendMasks`, `roadMasks`, and `detail` are all keyed on
	 * `activeRegionKey`, which takes no landblock input, and exactly one `ActiveRegionSource` is
	 * live per content source. They are therefore identical for every landblock in the pass, and
	 * rebinding them per landblock was pure waste. `assertSharedTerrainRegion` keeps that true.
	 *
	 * Bound per pass rather than once at program build because other passes own these texture
	 * units between terrain passes.
	 */
	#beginTerrainPassResources(
		input: TerrainFrameInput,
		program: WebGL2NearTerrainProgram,
	): void {
		const resources = this.#deviceTargets.resources;
		const { textures } = input.program;
		const composition = resources.getTexture2D(input.program.composition);
		const colors = resources.getTextureArray(textures.colors.resource);
		const blendMasks = resources.getTextureArray(textures.blendMasks.resource);
		const roadMasks = resources.getTextureArray(textures.roadMasks.resource);
		const detail = resources.getTexture2D(textures.detail);
		const gl = this.#deviceTargets.gl;
		this.#bindTexture2D(
			1,
			composition,
			program.uniforms.composition,
			"exact",
			TextureWrapMode.Clamp,
		);
		this.#bindTextureArray(
			2,
			colors,
			program.uniforms.colors,
			"filterable",
			TextureWrapMode.Repeat,
		);
		// Both mask arrays are addressed with cell-local UVs that reach exactly 0 and 1 at a cell
		// boundary, and each cell's mask is independent of its neighbor's. Repeat wrapping would
		// make the boundary texel blend against the opposite edge of the same mask, bleeding an
		// unrelated corner's alpha into a half-texel band along every cell edge.
		this.#bindTextureArray(
			3,
			blendMasks,
			program.uniforms.blendMasks,
			"filterable",
			TextureWrapMode.Clamp,
		);
		this.#bindTextureArray(
			4,
			roadMasks,
			program.uniforms.roadMasks,
			"filterable",
			TextureWrapMode.Clamp,
		);
		this.#bindTexture2D(
			5,
			detail,
			program.uniforms.detail,
			"filterable",
			TextureWrapMode.Repeat,
		);
		gl.activeTexture(gl.TEXTURE0);
		this.#deviceTargets.textureSamplers.bind(0, {
			mipLevels: 1,
			policy: this.#deviceTargets.frameTextureFiltering,
			samplingClass: "exact",
			wrap: TextureWrapMode.Clamp,
		});
		gl.uniform1i(program.uniforms.surfaceField, 0);
	}

	/**
	 * Bind the one genuinely per-landblock terrain texture on already-configured unit 0.
	 *
	 * Everything else the terrain shader samples, including unit 0's sampler and uniform, is
	 * region-constant and already bound for the pass by `#beginTerrainPassResources`.
	 */
	#bindTerrainSurfaceField(input: TerrainFrameInput): void {
		const surfaceField = this.#deviceTargets.resources.getTexture2D(
			input.program.surfaceField,
		);
		const gl = this.#deviceTargets.gl;
		gl.bindTexture(gl.TEXTURE_2D, surfaceField.texture);
	}

	/**
	 * Bind the shared mask texture for the terrain pass.
	 *
	 * Uses an `exact` sampler because integer textures are not filterable. Bound once per pass so
	 * each landblock pays only its table upload, and only when it has lights to name.
	 */
	#beginTerrainLightMasks(program: WebGL2NearTerrainProgram): void {
		const gl = this.#deviceTargets.gl;
		gl.activeTexture(gl.TEXTURE0 + TERRAIN_LIGHT_MASK_TEXTURE_UNIT);
		gl.bindTexture(gl.TEXTURE_2D, this.#terrainLightMask.texture);
		this.#deviceTargets.textureSamplers.bind(TERRAIN_LIGHT_MASK_TEXTURE_UNIT, {
			mipLevels: 1,
			policy: this.#deviceTargets.frameTextureFiltering,
			samplingClass: "exact",
			wrap: TextureWrapMode.Clamp,
		});
		gl.uniform1i(
			program.uniforms.staticLightMask,
			TERRAIN_LIGHT_MASK_TEXTURE_UNIT,
		);
		gl.activeTexture(gl.TEXTURE0);
	}

	/**
	 * Upload one landblock's mask table, unless it has no lights for the mask to name.
	 *
	 * An unlit landblock leaves whatever the previous one uploaded in place. That cannot leak
	 * light: the masked loop bounds every index by the live light count, which is zero here, so it
	 * exits before reading any light slot. Skipping the upload is what keeps tiling free on the
	 * majority of landblocks, only 629 of 5346 of which carry an authored light at all.
	 */
	#uploadTerrainLightMask(landblockLights: LandblockLights): void {
		if (landblockLights.lights.length === 0) return;
		const gl = this.#deviceTargets.gl;
		gl.activeTexture(gl.TEXTURE0 + TERRAIN_LIGHT_MASK_TEXTURE_UNIT);
		uploadWebGL2TerrainLightMask(gl, landblockLights.cellMasks);
		gl.activeTexture(gl.TEXTURE0);
		this.#diagnostics.metrics.terrainLightMaskUploads += 1;
	}

	#bindTexture2D(
		unit: number,
		resource: WebGL2Texture2DBinding,
		uniform: WebGLUniformLocation,
		samplingClass: TextureSamplingClass,
		wrap: TextureWrapMode,
	): void {
		const gl = this.#deviceTargets.gl;
		gl.activeTexture(gl.TEXTURE0 + unit);
		gl.bindTexture(gl.TEXTURE_2D, resource.texture);
		this.#deviceTargets.textureSamplers.bind(unit, {
			mipLevels: resource.mipLevels,
			policy: this.#deviceTargets.frameTextureFiltering,
			samplingClass,
			wrap,
		});
		gl.uniform1i(uniform, unit);
	}

	#bindTextureArray(
		unit: number,
		resource: WebGL2TextureArrayBinding,
		uniform: WebGLUniformLocation,
		samplingClass: TextureSamplingClass,
		wrap: TextureWrapMode,
	): void {
		const gl = this.#deviceTargets.gl;
		gl.activeTexture(gl.TEXTURE0 + unit);
		gl.bindTexture(gl.TEXTURE_2D_ARRAY, resource.texture);
		this.#deviceTargets.textureSamplers.bind(unit, {
			mipLevels: resource.description.mipLevels,
			policy: this.#deviceTargets.frameTextureFiltering,
			samplingClass,
			wrap,
		});
		gl.uniform1i(uniform, unit);
	}

	/** Draw one landblock's whole terrain mesh; a landblock has exactly one. */
	#drawTerrainGeometry(
		geometryKey: GeometryResourceKey,
		landblockOffsetUniform: WebGLUniformLocation,
		landblockOffset: Vec3,
	): void {
		const binding = this.#deviceTargets.resources.getGeometry(geometryKey);
		const gl = this.#deviceTargets.gl;
		gl.uniform3f(
			landblockOffsetUniform,
			landblockOffset.x,
			landblockOffset.y,
			landblockOffset.z,
		);
		gl.bindVertexArray(binding.vertexArray);
		gl.drawElements(gl.TRIANGLES, binding.indexCount, binding.indexType, 0);
	}

	destroyLightMask(): void {
		destroyWebGL2TerrainLightMaskTexture(
			this.#deviceTargets.gl,
			this.#terrainLightMask,
		);
	}

	destroyPrograms(): void {
		const gl = this.#deviceTargets.gl;
		gl.deleteProgram(this.#nearTerrainProgram.program);
		gl.deleteProgram(this.#farTerrainProgram.program);
	}
}
