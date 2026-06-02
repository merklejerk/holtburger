import type { Webgl2StateCache } from "../../webgl2-state-cache";

export function applyOpaqueCompactedFamilyRenderState({
	gl,
	stateCache,
}: {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
}): number {
	let changeCount = stateCache.setDepthState({
		enabled: true,
		write: true,
		func: gl.LEQUAL,
	});
	changeCount += stateCache.setBlendState({
		enabled: false,
		srcRgb: gl.ONE,
		dstRgb: gl.ZERO,
		srcAlpha: gl.ONE,
		dstAlpha: gl.ZERO,
		equationRgb: gl.FUNC_ADD,
		equationAlpha: gl.FUNC_ADD,
	});
	changeCount += stateCache.setCullState({
		enabled: false,
		mode: gl.BACK,
	});
	return changeCount;
}
