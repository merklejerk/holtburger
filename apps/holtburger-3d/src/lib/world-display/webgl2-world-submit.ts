import { multiplyMat4, type LumaMat4, type LumaVec4 } from "./luma-math";
import type { StagedWorldFrame } from "./staged-world-frame";
import type { Webgl2ProgramResource } from "./webgl2-gl";
import type { Webgl2StateCache } from "./webgl2-state-cache";
import type { Webgl2WorldDrawUnit } from "./webgl2-world-resources";

export type Webgl2FlatWorldProgram = Webgl2ProgramResource<
	"position",
	"uModelViewProjection" | "uColor"
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
	drawUnitsById,
	frame,
}: {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
	program: Webgl2FlatWorldProgram;
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

	if (stateCache.useProgram(program.program)) {
		metrics.programSwitchCount += 1;
		metrics.stateChangeCount += 1;
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

	let previousModelViewProjection: LumaMat4 | null = null;
	let previousColor: LumaVec4 | null = null;
	for (const drawUnit of drawUnits) {
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
				program.uniforms.uModelViewProjection,
				false,
				modelViewProjection,
			);
			previousModelViewProjection = modelViewProjection;
			metrics.uniformUploadCount += 1;
		}
		if (!previousColor || !arraysEqual(previousColor, drawUnit.color)) {
			gl.uniform4fv(program.uniforms.uColor, drawUnit.color);
			previousColor = drawUnit.color;
			metrics.uniformUploadCount += 1;
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
		left.materialKind.localeCompare(right.materialKind) ||
		left.materialKey.localeCompare(right.materialKey) ||
		left.geometrySignature.localeCompare(right.geometrySignature) ||
		left.id.localeCompare(right.id)
	);
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
