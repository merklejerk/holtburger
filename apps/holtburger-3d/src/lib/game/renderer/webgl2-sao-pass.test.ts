import { describe, expect, it } from "vitest";
import { SHARED_FRONTEND_TUNING } from "../../frontend-tuning";
import {
	WebGL2SaoScratchTargets,
	saoBlurNeutralLinearDepthCutoff,
	saoScratchByteLength,
	scaledSaoExtent,
	scaledSaoInterval,
} from "./webgl2-sao-pass";

const INITIAL_EXTENT = { height: 3, width: 4 } as const;
const RESIZED_EXTENT = { height: 6, width: 8 } as const;

describe("WebGL2 SAO scratch policy", () => {
	it("scales each axis independently and retains a positive minimum extent", () => {
		const scale =
			SHARED_FRONTEND_TUNING.rendering.ambientOcclusion.resolutionScale;
		expect(scaledSaoExtent({ height: 721, width: 1_281 }, scale)).toEqual({
			height: Math.floor(721 * scale),
			width: Math.floor(1_281 * scale),
		});
		expect(scaledSaoExtent({ height: 1, width: 1 }, scale)).toEqual({
			height: 1,
			width: 1,
		});
	});

	it("reports the exact two-R8 allocation", () => {
		const extent = scaledSaoExtent(
			{ height: 1_080, width: 1_920 },
			SHARED_FRONTEND_TUNING.rendering.ambientOcclusion.resolutionScale,
		);
		expect(saoScratchByteLength(extent)).toBe(extent.width * extent.height * 2);
	});

	it("rejects malformed source extents and scales", () => {
		expect(() => scaledSaoExtent({ height: 0, width: 1 }, 0.5)).toThrow(
			"positive source dimensions",
		);
		expect(() => scaledSaoExtent({ height: 1, width: 1 }, 0)).toThrow(
			"scale in (0, 1]",
		);
	});

	it("covers adjacent scaled tiles exactly across fractional edge rounding", () => {
		const left = scaledSaoInterval(0, 5, 0.5);
		const right = scaledSaoInterval(5, 7, 0.5);

		expect(left).toEqual({ end: 2, extent: 2, origin: 0 });
		expect(right).toEqual({ end: 6, extent: 4, origin: 2 });
		expect(left.end).toBe(right.origin);
	});

	it("leaves atlas gaps outside every scaled tile and retains one-pixel tiles", () => {
		const left = scaledSaoInterval(0, 3, 0.5);
		const right = scaledSaoInterval(6, 3, 0.5);
		const tiny = scaledSaoInterval(11, 1, 0.25);

		expect(left.end).toBeLessThan(right.origin);
		expect(tiny).toEqual({ end: 3, extent: 1, origin: 2 });
	});

	it("transactionally replaces, disables, and destroys complete generations", () => {
		const state = createFakeWebGL2();
		const owner = new WebGL2SaoScratchTargets(state.gl);
		const first = owner.resize(INITIAL_EXTENT);
		expect(
			owner.resizeDimensions(INITIAL_EXTENT.width, INITIAL_EXTENT.height),
		).toBe(first);
		owner.resize(RESIZED_EXTENT);
		expect(state.deleted).toEqual({ framebuffers: 2, textures: 2 });
		expect(owner.getDiagnostics()).toEqual({
			activeBytes: saoScratchByteLength(RESIZED_EXTENT),
			allocatedGenerationCount: 2,
			disposedGenerationCount: 1,
			extent: RESIZED_EXTENT,
		});
		owner.disable();
		expect(owner.getDiagnostics()).toMatchObject({
			activeBytes: 0,
			disposedGenerationCount: 2,
			extent: null,
		});
		owner.destroy();
		owner.destroy();
		expect(() => owner.resize(INITIAL_EXTENT)).toThrow("have been destroyed");
	});

	it("retains its generation and caller bindings after allocation failure", () => {
		const state = createFakeWebGL2();
		const owner = new WebGL2SaoScratchTargets(state.gl);
		const first = owner.resize(INITIAL_EXTENT);
		const unrelated = installUnrelatedBindings(state.gl);
		state.framebufferComplete = false;

		expect(() => owner.resize(RESIZED_EXTENT)).toThrow(
			"first SAO framebuffer is incomplete",
		);
		expect(owner.resize(INITIAL_EXTENT)).toBe(first);
		expect(owner.getDiagnostics()).toMatchObject({
			allocatedGenerationCount: 1,
			disposedGenerationCount: 0,
			extent: INITIAL_EXTENT,
		});
		expect(readBindings(state.gl)).toEqual(unrelated);
	});

	it("places each blur pass far-cutoff strictly past every bilaterally reachable non-neutral tap", () => {
		const { bilateralDepthThreshold, distanceFade } =
			SHARED_FRONTEND_TUNING.rendering.ambientOcclusion;
		const distanceFadeEnd = distanceFade.disabledAt;
		const firstPassCutoff = saoBlurNeutralLinearDepthCutoff(
			distanceFadeEnd,
			bilateralDepthThreshold,
			1,
		);
		const secondPassCutoff = saoBlurNeutralLinearDepthCutoff(
			distanceFadeEnd,
			bilateralDepthThreshold,
			2,
		);

		expect(Math.fround(firstPassCutoff)).toBe(firstPassCutoff);
		expect(Math.fround(secondPassCutoff)).toBe(secondPassCutoff);
		expect(firstPassCutoff).toBeGreaterThan(
			distanceFadeEnd + bilateralDepthThreshold,
		);
		expect(secondPassCutoff).toBeGreaterThan(
			distanceFadeEnd + 2 * bilateralDepthThreshold,
		);
		expect(firstPassCutoff - bilateralDepthThreshold).toBeGreaterThan(
			distanceFadeEnd,
		);
		expect(secondPassCutoff - bilateralDepthThreshold).toBeGreaterThan(
			firstPassCutoff - 1e-3,
		);

		expect(() => saoBlurNeutralLinearDepthCutoff(0, 1, 1)).toThrow(
			"positive finite distance",
		);
		expect(() =>
			saoBlurNeutralLinearDepthCutoff(distanceFadeEnd, 0, 1),
		).toThrow("positive finite bilateral threshold");
		expect(() =>
			saoBlurNeutralLinearDepthCutoff(
				distanceFadeEnd,
				bilateralDepthThreshold,
				3 as never,
			),
		).toThrow("pass ordinal 1 or 2");
	});

	it("preserves exact R8 two-pass bilateral output across the fade boundary while a shared 1x cutoff truncates Pass 2", () => {
		const { bilateralDepthThreshold, distanceFade } =
			SHARED_FRONTEND_TUNING.rendering.ambientOcclusion;
		const fadeEnd = distanceFade.disabledAt;
		const width = 5;
		const height = 5;
		const linearDepthGrid = new Float32Array(width * height).fill(
			Math.fround(fadeEnd + 3 * bilateralDepthThreshold),
		);
		const rawR8 = new Uint8Array(width * height).fill(255);
		// Foreground occluding shelf just inside fadeEnd at (0, 1) and (1, 1), stepping across a
		// sloped ramp through (2, 1) (fadeEnd + 0.55 * T) to (2, 2) (fadeEnd + 1.05 * T).
		for (const x of [0, 1]) {
			const index = 1 * width + x;
			linearDepthGrid[index] = Math.fround(
				fadeEnd - 0.01 * bilateralDepthThreshold,
			);
			rawR8[index] = 0;
		}
		linearDepthGrid[1 * width + 2] = Math.fround(
			fadeEnd + 0.55 * bilateralDepthThreshold,
		);
		linearDepthGrid[2 * width + 2] = Math.fround(
			fadeEnd + 1.05 * bilateralDepthThreshold,
		);

		const referencePass1 = runQuantizedBilateralBlurPass(
			rawR8,
			linearDepthGrid,
			width,
			height,
			1,
			0,
			bilateralDepthThreshold,
			Number.POSITIVE_INFINITY,
		);
		const referencePass2 = runQuantizedBilateralBlurPass(
			referencePass1,
			linearDepthGrid,
			width,
			height,
			0,
			1,
			bilateralDepthThreshold,
			Number.POSITIVE_INFINITY,
		);

		const pass1Cutoff = saoBlurNeutralLinearDepthCutoff(
			fadeEnd,
			bilateralDepthThreshold,
			1,
		);
		const pass2Cutoff = saoBlurNeutralLinearDepthCutoff(
			fadeEnd,
			bilateralDepthThreshold,
			2,
		);
		const guardedPass1 = runQuantizedBilateralBlurPass(
			rawR8,
			linearDepthGrid,
			width,
			height,
			1,
			0,
			bilateralDepthThreshold,
			pass1Cutoff,
		);
		const guardedPass2 = runQuantizedBilateralBlurPass(
			guardedPass1,
			linearDepthGrid,
			width,
			height,
			0,
			1,
			bilateralDepthThreshold,
			pass2Cutoff,
		);
		expect(guardedPass1).toEqual(referencePass1);
		expect(guardedPass2).toEqual(referencePass2);

		const prematureSharedCutoffPass2 = runQuantizedBilateralBlurPass(
			guardedPass1,
			linearDepthGrid,
			width,
			height,
			0,
			1,
			bilateralDepthThreshold,
			pass1Cutoff,
		);
		const straddlingIndex = 2 * width + 2;
		expect(linearDepthGrid[straddlingIndex]).toBeGreaterThan(pass1Cutoff);
		expect(linearDepthGrid[straddlingIndex]).toBeLessThan(pass2Cutoff);
		expect(
			prematureSharedCutoffPass2[straddlingIndex]! -
				referencePass2[straddlingIndex]!,
		).toBeGreaterThanOrEqual(10);
	});
});

interface ResourceCounts {
	framebuffers: number;
	textures: number;
}

interface FakeWebGL2State {
	readonly deleted: ResourceCounts;
	framebufferComplete: boolean;
	readonly gl: WebGL2RenderingContext;
}

interface BindingSnapshot {
	readonly activeTexture: GLenum;
	readonly activeTextureBinding: WebGLTexture | null;
	readonly drawFramebuffer: WebGLFramebuffer | null;
	readonly readFramebuffer: WebGLFramebuffer | null;
	readonly texture0Binding: WebGLTexture | null;
}

function createFakeWebGL2(): FakeWebGL2State {
	const constants = {
		ACTIVE_TEXTURE: 0x84e0,
		CLAMP_TO_EDGE: 0x812f,
		COLOR_ATTACHMENT0: 0x8ce0,
		DRAW_FRAMEBUFFER: 0x8ca9,
		DRAW_FRAMEBUFFER_BINDING: 0x8ca6,
		FRAMEBUFFER: 0x8d40,
		FRAMEBUFFER_COMPLETE: 0x8cd5,
		NEAREST: 0x2600,
		R8: 0x8229,
		READ_FRAMEBUFFER: 0x8ca8,
		READ_FRAMEBUFFER_BINDING: 0x8caa,
		TEXTURE0: 0x84c0,
		TEXTURE_2D: 0x0de1,
		TEXTURE_BINDING_2D: 0x8069,
		TEXTURE_MAG_FILTER: 0x2800,
		TEXTURE_MIN_FILTER: 0x2801,
		TEXTURE_WRAP_S: 0x2802,
		TEXTURE_WRAP_T: 0x2803,
	} as const;
	const deleted = { framebuffers: 0, textures: 0 };
	const textureBindings = new Map<GLenum, WebGLTexture | null>();
	let activeTexture: GLenum = constants.TEXTURE0;
	let createdFramebuffers = 0;
	let createdTextures = 0;
	let drawFramebuffer: WebGLFramebuffer | null = null;
	let framebufferComplete = true;
	let readFramebuffer: WebGLFramebuffer | null = null;
	const gl = {
		...constants,
		activeTexture: (texture: GLenum) => {
			activeTexture = texture;
		},
		bindFramebuffer: (target: GLenum, framebuffer: WebGLFramebuffer | null) => {
			if (
				target === constants.FRAMEBUFFER ||
				target === constants.DRAW_FRAMEBUFFER
			) {
				drawFramebuffer = framebuffer;
			}
			if (
				target === constants.FRAMEBUFFER ||
				target === constants.READ_FRAMEBUFFER
			) {
				readFramebuffer = framebuffer;
			}
		},
		bindTexture: (_target: GLenum, texture: WebGLTexture | null) => {
			textureBindings.set(activeTexture, texture);
		},
		checkFramebufferStatus: () =>
			framebufferComplete ? constants.FRAMEBUFFER_COMPLETE : 0x8cd6,
		createFramebuffer: () =>
			fakeResource<WebGLFramebuffer>("framebuffer", ++createdFramebuffers),
		createTexture: () =>
			fakeResource<WebGLTexture>("texture", ++createdTextures),
		deleteFramebuffer: () => {
			deleted.framebuffers += 1;
		},
		deleteTexture: () => {
			deleted.textures += 1;
		},
		drawBuffers: () => undefined,
		framebufferTexture2D: () => undefined,
		getParameter: (parameter: GLenum): unknown => {
			switch (parameter) {
				case constants.ACTIVE_TEXTURE:
					return activeTexture;
				case constants.DRAW_FRAMEBUFFER_BINDING:
					return drawFramebuffer;
				case constants.READ_FRAMEBUFFER_BINDING:
					return readFramebuffer;
				case constants.TEXTURE_BINDING_2D:
					return textureBindings.get(activeTexture) ?? null;
				default:
					throw new Error(`Unexpected fake WebGL parameter ${parameter}.`);
			}
		},
		readBuffer: () => undefined,
		texParameteri: () => undefined,
		texStorage2D: () => undefined,
	} as unknown as WebGL2RenderingContext;
	return {
		deleted,
		get framebufferComplete() {
			return framebufferComplete;
		},
		set framebufferComplete(value: boolean) {
			framebufferComplete = value;
		},
		gl,
	};
}

function installUnrelatedBindings(gl: WebGL2RenderingContext): BindingSnapshot {
	const drawFramebuffer = fakeResource<WebGLFramebuffer>("draw", 1);
	const readFramebuffer = fakeResource<WebGLFramebuffer>("read", 1);
	const texture0Binding = fakeResource<WebGLTexture>("texture0", 1);
	const activeTextureBinding = fakeResource<WebGLTexture>("texture3", 1);
	gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, drawFramebuffer);
	gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFramebuffer);
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, texture0Binding);
	gl.activeTexture(gl.TEXTURE0 + 3);
	gl.bindTexture(gl.TEXTURE_2D, activeTextureBinding);
	return {
		activeTexture: gl.TEXTURE0 + 3,
		activeTextureBinding,
		drawFramebuffer,
		readFramebuffer,
		texture0Binding,
	};
}

function readBindings(gl: WebGL2RenderingContext): BindingSnapshot {
	const activeTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as GLenum;
	const activeTextureBinding = gl.getParameter(
		gl.TEXTURE_BINDING_2D,
	) as WebGLTexture | null;
	gl.activeTexture(gl.TEXTURE0);
	const texture0Binding = gl.getParameter(
		gl.TEXTURE_BINDING_2D,
	) as WebGLTexture | null;
	gl.activeTexture(activeTexture);
	return {
		activeTexture,
		activeTextureBinding,
		drawFramebuffer: gl.getParameter(
			gl.DRAW_FRAMEBUFFER_BINDING,
		) as WebGLFramebuffer | null,
		readFramebuffer: gl.getParameter(
			gl.READ_FRAMEBUFFER_BINDING,
		) as WebGLFramebuffer | null,
		texture0Binding,
	};
}

function fakeResource<T>(kind: string, ordinal: number): T {
	return { kind, ordinal } as T;
}

const SPATIAL_WEIGHTS = [1, 4, 6, 4, 1] as const;

function runQuantizedBilateralBlurPass(
	inputR8: Uint8Array,
	linearDepthGrid: Float32Array,
	width: number,
	height: number,
	directionX: number,
	directionY: number,
	bilateralDepthThreshold: number,
	neutralLinearDepthCutoff: number,
): Uint8Array {
	const threshold = Math.fround(bilateralDepthThreshold);
	const cutoff = Math.fround(neutralLinearDepthCutoff);
	const outputR8 = new Uint8Array(width * height);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const centerIndex = y * width + x;
			const centerLinearDepth = linearDepthGrid[centerIndex]!;
			if (centerLinearDepth >= cutoff) {
				outputR8[centerIndex] = 255;
				continue;
			}
			let weightedOcclusion = 0;
			let totalWeight = 0;
			for (let tap = -2; tap <= 2; tap += 1) {
				const sampleX = Math.min(width - 1, Math.max(0, x + directionX * tap));
				const sampleY = Math.min(height - 1, Math.max(0, y + directionY * tap));
				const sampleIndex = sampleY * width + sampleX;
				const sampleLinearDepth = linearDepthGrid[sampleIndex]!;
				const depthWeight = Math.max(
					0,
					Math.fround(
						1 -
							Math.fround(Math.abs(sampleLinearDepth - centerLinearDepth)) /
								threshold,
					),
				);
				const weight = Math.fround(SPATIAL_WEIGHTS[tap + 2]! * depthWeight);
				const sampleValue = Math.fround(inputR8[sampleIndex]! / 255);
				weightedOcclusion = Math.fround(
					weightedOcclusion + Math.fround(sampleValue * weight),
				);
				totalWeight = Math.fround(totalWeight + weight);
			}
			const normalized =
				totalWeight > 0 ? Math.fround(weightedOcclusion / totalWeight) : 1;
			outputR8[centerIndex] = Math.min(
				255,
				Math.max(0, Math.round(normalized * 255)),
			);
		}
	}
	return outputR8;
}
