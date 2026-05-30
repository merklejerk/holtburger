import { multiplyMat4, type RenderMat4 } from "./render-math";
import type { StagedWorldFrame } from "./staged-world-frame";
import type { Webgl2ProgramResource } from "./webgl2-gl";
import type { Webgl2StateCache } from "./webgl2-state-cache";
import type { Webgl2WorldDrawUnit } from "./webgl2-world-resources";

export type Webgl2FlatWorldProgram = Webgl2ProgramResource<
	"position",
	"uModelViewProjection" | "uColor"
>;
export type Webgl2TexturedWorldProgram = Webgl2ProgramResource<
	"position" | "uv",
	"uModelViewProjection" | "uColor" | "uAlphaTest" | "uTexture"
>;
export type Webgl2TerrainBlendWorldProgram = Webgl2ProgramResource<
	"position" | "uv",
	| "uModelViewProjection"
	| "uBaseTexture"
	| "uBaseTiling"
	| "uOverlay0"
	| "uOverlay1"
	| "uOverlay2"
	| "uOverlayAlpha0"
	| "uOverlayAlpha1"
	| "uOverlayAlpha2"
	| "uOverlayTiling0"
	| "uOverlayTiling1"
	| "uOverlayTiling2"
	| "uOverlayRotation0"
	| "uOverlayRotation1"
	| "uOverlayRotation2"
	| "uOverlayCount"
	| "uRoadTexture"
	| "uRoadTiling"
	| "uRoadAlpha0"
	| "uRoadAlpha1"
	| "uRoadRotation0"
	| "uRoadRotation1"
	| "uRoadCount"
>;

export interface Webgl2WorldSubmitMetrics {
	visibleDrawUnitCount: number;
	drawCallCount: number;
	programSwitchCount: number;
	vertexArrayBindCount: number;
	uniformUploadCount: number;
	stateChangeCount: number;
	triangleCount: number;
	visibleDrawUnitCountsByMaterialKind: Readonly<Record<string, number>>;
}

const EMPTY_SUBMIT_METRICS: Webgl2WorldSubmitMetrics = {
	visibleDrawUnitCount: 0,
	drawCallCount: 0,
	programSwitchCount: 0,
	vertexArrayBindCount: 0,
	uniformUploadCount: 0,
	stateChangeCount: 0,
	triangleCount: 0,
	visibleDrawUnitCountsByMaterialKind: {},
};

export function createEmptyWebgl2WorldSubmitMetrics(): Webgl2WorldSubmitMetrics {
	return {
		...EMPTY_SUBMIT_METRICS,
		visibleDrawUnitCountsByMaterialKind: {},
	};
}

export function submitWebgl2FlatWorldFrame({
	gl,
	stateCache,
	program,
	texturedProgram,
	terrainBlendProgram,
	drawUnitsById,
	frame,
}: {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
	program: Webgl2FlatWorldProgram;
	texturedProgram: Webgl2TexturedWorldProgram;
	terrainBlendProgram: Webgl2TerrainBlendWorldProgram;
	drawUnitsById: ReadonlyMap<string, Webgl2WorldDrawUnit>;
	frame: StagedWorldFrame;
}): Webgl2WorldSubmitMetrics {
	const drawUnits = planWebgl2FlatWorldSubmitOrder(frame, drawUnitsById);
	const metrics: Webgl2WorldSubmitMetrics = {
		...EMPTY_SUBMIT_METRICS,
		visibleDrawUnitCount: drawUnits.length,
		visibleDrawUnitCountsByMaterialKind: countDrawUnitsByMaterialKind(drawUnits),
	};
	if (drawUnits.length === 0) {
		return metrics;
	}

	metrics.stateChangeCount += stateCache.setDepthState({
		enabled: true,
		write: true,
		func: gl.LEQUAL,
	});
	metrics.stateChangeCount += stateCache.setBlendState({
		enabled: false,
		srcRgb: gl.ONE,
		dstRgb: gl.ZERO,
		srcAlpha: gl.ONE,
		dstAlpha: gl.ZERO,
		equationRgb: gl.FUNC_ADD,
		equationAlpha: gl.FUNC_ADD,
	});
	metrics.stateChangeCount += stateCache.setCullState({
		enabled: false,
		mode: gl.BACK,
	});
	metrics.stateChangeCount += stateCache.setStencilState({
		enabled: false,
		writeMask: 0xff,
		func: gl.ALWAYS,
		ref: 0,
		readMask: 0xff,
		fail: gl.KEEP,
		zfail: gl.KEEP,
		zpass: gl.KEEP,
	});

	let previousModelViewProjection: RenderMat4 | null = null;
	let previousColor: Float32Array | null = null;
	let previousAlphaTest: number | null = null;
	let previousTextureProgram = false;
	for (const drawUnit of drawUnits) {
		const texture = drawUnit.texture;
		const useTerrainBlend = drawUnit.terrainBlend !== null;
		const useTexture = texture !== null && !useTerrainBlend;
		const activeProgram = useTerrainBlend
			? terrainBlendProgram
			: useTexture
				? texturedProgram
				: program;
		if (stateCache.useProgram(activeProgram.program)) {
			metrics.programSwitchCount += 1;
			metrics.stateChangeCount += 1;
			previousModelViewProjection = null;
			previousColor = null;
			previousAlphaTest = null;
			previousTextureProgram = useTexture;
			if (useTexture) {
				gl.uniform1i(texturedProgram.uniforms.uTexture, 0);
				metrics.uniformUploadCount += 1;
			}
			if (useTerrainBlend) {
				uploadTerrainBlendSamplerUniforms(gl, terrainBlendProgram);
				metrics.uniformUploadCount += TERRAIN_BLEND_SAMPLER_UNIFORM_COUNT;
			}
		} else if (previousTextureProgram !== useTexture) {
			previousModelViewProjection = null;
			previousColor = null;
			previousAlphaTest = null;
			previousTextureProgram = useTexture;
		}
		metrics.stateChangeCount += applyDrawUnitRenderState({
			gl,
			stateCache,
			drawUnit,
		});
		if (texture && stateCache.bindTexture2D(0, texture.texture)) {
			metrics.stateChangeCount += 1;
		}
		if (drawUnit.terrainBlend) {
			metrics.stateChangeCount += bindTerrainBlendTextures({
				stateCache,
				terrainBlend: drawUnit.terrainBlend,
			});
		}
		if (stateCache.bindVertexArray(drawUnit.vertexArray.vertexArray)) {
			metrics.vertexArrayBindCount += 1;
			metrics.stateChangeCount += 1;
		}

		const modelViewProjection = multiplyMat4(
			frame.viewProjectionMatrix,
			drawUnit.modelMatrix,
		);
		if (
			!previousModelViewProjection ||
			!arraysEqual(previousModelViewProjection, modelViewProjection)
		) {
			gl.uniformMatrix4fv(
				activeProgram.uniforms.uModelViewProjection,
				false,
				modelViewProjection,
			);
			previousModelViewProjection = modelViewProjection;
			metrics.uniformUploadCount += 1;
		}
		if (
			!useTerrainBlend &&
			(!previousColor || !arraysEqual(previousColor, drawUnit.color))
		) {
			const colorProgram = useTexture ? texturedProgram : program;
			gl.uniform4fv(colorProgram.uniforms.uColor, drawUnit.color);
			previousColor = drawUnit.color;
			metrics.uniformUploadCount += 1;
		}
		if (useTexture) {
			const alphaTest = drawUnit.materialBehavior?.alphaTest ?? 0;
			if (previousAlphaTest !== alphaTest) {
				gl.uniform1f(texturedProgram.uniforms.uAlphaTest, alphaTest);
				previousAlphaTest = alphaTest;
				metrics.uniformUploadCount += 1;
			}
		}
		if (drawUnit.terrainBlend) {
			uploadTerrainBlendUniforms(gl, terrainBlendProgram, drawUnit.terrainBlend);
			metrics.uniformUploadCount += TERRAIN_BLEND_DYNAMIC_UNIFORM_COUNT;
		}

		gl.drawElements(
			gl.TRIANGLES,
			drawUnit.vertexCount,
			drawUnit.indexType,
			0,
		);
		metrics.drawCallCount += 1;
		metrics.triangleCount += drawUnit.triangleCount;
	}
	return metrics;
}

const TERRAIN_BLEND_SAMPLER_UNIFORM_COUNT = 10;
const TERRAIN_BLEND_DYNAMIC_UNIFORM_COUNT = 13;

function uploadTerrainBlendSamplerUniforms(
	gl: WebGL2RenderingContext,
	program: Webgl2TerrainBlendWorldProgram,
): void {
	gl.uniform1i(program.uniforms.uBaseTexture, 0);
	gl.uniform1i(program.uniforms.uOverlay0, 1);
	gl.uniform1i(program.uniforms.uOverlay1, 2);
	gl.uniform1i(program.uniforms.uOverlay2, 3);
	gl.uniform1i(program.uniforms.uOverlayAlpha0, 4);
	gl.uniform1i(program.uniforms.uOverlayAlpha1, 5);
	gl.uniform1i(program.uniforms.uOverlayAlpha2, 6);
	gl.uniform1i(program.uniforms.uRoadTexture, 7);
	gl.uniform1i(program.uniforms.uRoadAlpha0, 8);
	gl.uniform1i(program.uniforms.uRoadAlpha1, 9);
}

function bindTerrainBlendTextures({
	stateCache,
	terrainBlend,
}: {
	stateCache: Webgl2StateCache;
	terrainBlend: NonNullable<Webgl2WorldDrawUnit["terrainBlend"]>;
}): number {
	let changeCount = 0;
	const base = terrainBlend.base.texture.texture;
	const overlay0 = terrainBlend.overlays[0];
	const overlay1 = terrainBlend.overlays[1];
	const overlay2 = terrainBlend.overlays[2];
	const road0 = terrainBlend.roads[0];
	const road1 = terrainBlend.roads[1];
	const bindings = [
		terrainBlend.base.texture.texture,
		overlay0?.terrain.texture.texture ?? base,
		overlay1?.terrain.texture.texture ?? base,
		overlay2?.terrain.texture.texture ?? base,
		overlay0?.alpha.texture.texture ?? base,
		overlay1?.alpha.texture.texture ?? base,
		overlay2?.alpha.texture.texture ?? base,
		road0?.road.texture.texture ?? base,
		road0?.alpha.texture.texture ?? base,
		road1?.alpha.texture.texture ?? base,
	];
	for (const [unit, texture] of bindings.entries()) {
		if (stateCache.bindTexture2D(unit, texture)) {
			changeCount += 1;
		}
	}
	return changeCount;
}

function uploadTerrainBlendUniforms(
	gl: WebGL2RenderingContext,
	program: Webgl2TerrainBlendWorldProgram,
	terrainBlend: NonNullable<Webgl2WorldDrawUnit["terrainBlend"]>,
): void {
	const overlay0 = terrainBlend.overlays[0];
	const overlay1 = terrainBlend.overlays[1];
	const overlay2 = terrainBlend.overlays[2];
	const road0 = terrainBlend.roads[0];
	const road1 = terrainBlend.roads[1];
	gl.uniform1f(program.uniforms.uBaseTiling, terrainBlend.base.tiling);
	gl.uniform1f(program.uniforms.uOverlayTiling0, overlay0?.terrain.tiling ?? 1);
	gl.uniform1f(program.uniforms.uOverlayTiling1, overlay1?.terrain.tiling ?? 1);
	gl.uniform1f(program.uniforms.uOverlayTiling2, overlay2?.terrain.tiling ?? 1);
	gl.uniform1i(program.uniforms.uOverlayRotation0, overlay0?.rotation ?? 0);
	gl.uniform1i(program.uniforms.uOverlayRotation1, overlay1?.rotation ?? 0);
	gl.uniform1i(program.uniforms.uOverlayRotation2, overlay2?.rotation ?? 0);
	gl.uniform1i(program.uniforms.uOverlayCount, terrainBlend.overlays.length);
	gl.uniform1f(program.uniforms.uRoadTiling, road0?.road.tiling ?? 1);
	gl.uniform1i(program.uniforms.uRoadRotation0, road0?.rotation ?? 0);
	gl.uniform1i(program.uniforms.uRoadRotation1, road1?.rotation ?? 0);
	gl.uniform1i(program.uniforms.uRoadCount, terrainBlend.roads.length);
}

export function planWebgl2FlatWorldSubmitOrder(
	frame: StagedWorldFrame,
	drawUnitsById: ReadonlyMap<string, Webgl2WorldDrawUnit>,
): Webgl2WorldDrawUnit[] {
	const visibleDrawUnits: Webgl2WorldDrawUnit[] = [];
	for (const draw of frame.passes.flatMap((pass) => pass.draws)) {
		const drawUnit = drawUnitsById.get(draw.drawUnitId);
		if (!drawUnit) {
			throw new Error(
				`Staged world frame referenced missing WebGL2 draw unit ${draw.drawUnitId}.`,
			);
		}
		visibleDrawUnits.push(drawUnit);
	}
	return visibleDrawUnits.sort(compareWebgl2FlatWorldDrawUnits);
}

function compareWebgl2FlatWorldDrawUnits(
	left: Webgl2WorldDrawUnit,
	right: Webgl2WorldDrawUnit,
): number {
	return (
		Number(left.texture === null) - Number(right.texture === null) ||
		left.materialKind.localeCompare(right.materialKind) ||
		left.materialKey.localeCompare(right.materialKey) ||
		(left.textureKey ?? "").localeCompare(right.textureKey ?? "") ||
		left.geometrySignature.localeCompare(right.geometrySignature) ||
		left.id.localeCompare(right.id)
	);
}

function applyDrawUnitRenderState({
	gl,
	stateCache,
	drawUnit,
}: {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
	drawUnit: Webgl2WorldDrawUnit;
}): number {
	const behavior = drawUnit.materialBehavior;
	const blend = behavior?.blend;
	let changeCount = stateCache.setDepthState({
		enabled: true,
		write: blend?.depthWrite ?? true,
		func: gl.LEQUAL,
	});
	if (blend?.enabled) {
		changeCount += stateCache.setBlendState({
			enabled: true,
			srcRgb: toWebgl2BlendFactor(gl, blend.srcFactor),
			dstRgb: toWebgl2BlendFactor(gl, blend.dstFactor),
			srcAlpha: toWebgl2BlendFactor(gl, blend.srcFactor),
			dstAlpha: toWebgl2BlendFactor(gl, blend.dstFactor),
			equationRgb: gl.FUNC_ADD,
			equationAlpha: gl.FUNC_ADD,
		});
		return changeCount;
	}
	changeCount += stateCache.setBlendState({
		enabled: false,
		srcRgb: gl.ONE,
		dstRgb: gl.ZERO,
		srcAlpha: gl.ONE,
		dstAlpha: gl.ZERO,
		equationRgb: gl.FUNC_ADD,
		equationAlpha: gl.FUNC_ADD,
	});
	return changeCount;
}

function toWebgl2BlendFactor(
	gl: WebGL2RenderingContext,
	factor: string | null | undefined,
): GLenum {
	switch (factor) {
		case "one":
			return gl.ONE;
		case "src-alpha":
			return gl.SRC_ALPHA;
		case "one-minus-src-alpha":
			return gl.ONE_MINUS_SRC_ALPHA;
		case null:
		case undefined:
			return gl.ONE;
		default:
			throw new Error(`Unsupported WebGL2 blend factor ${factor}.`);
	}
}

function countDrawUnitsByMaterialKind(
	drawUnits: readonly Webgl2WorldDrawUnit[],
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const drawUnit of drawUnits) {
		counts[drawUnit.materialKind] = (counts[drawUnit.materialKind] ?? 0) + 1;
	}
	return counts;
}

function arraysEqual(left: ArrayLike<number>, right: ArrayLike<number>): boolean {
	if (left.length !== right.length) {
		return false;
	}
	for (let index = 0; index < left.length; index += 1) {
		if (left[index] !== right[index]) {
			return false;
		}
	}
	return true;
}
