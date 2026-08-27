import {
	compileWebGL2Shader,
	requireWebGL2Uniform,
} from "../webgl/shader-program";
import type { WebGL2FlatSceneTargetSet } from "./webgl2-flat-scene-target";
import { REC_601_LUMA_WEIGHTS } from "../environment/scene-lighting";
import {
	COLOR_GRADE_STRIP_ENTRY_COUNT,
	COLOR_GRADE_STRIP_LENGTH,
	bakeColorGradeStrip,
	createColorGradeParameters,
	temperatureTintToGains,
	type ColorGradeChannelGains,
	type ColorGradeParameters,
	type ColorGradeSettings,
} from "./color-grade-policy";

/** Stand-in until the first enabled frame bakes real gains; never reaches a graded draw. */
const NEUTRAL_WHITE_BALANCE: ColorGradeChannelGains = {
	red: 1,
	green: 1,
	blue: 1,
};

const SCENE_COLOR_TEXTURE_UNIT = 0;
const COLOR_GRADE_STRIP_TEXTURE_UNIT = 1;
const OUTGOING_SCENE_TEXTURE_UNIT = 2;
const TUNNEL_SCENE_TEXTURE_UNIT = 3;

/** Renderer-owned outgoing snapshot fed into the final transition composite. */
export interface FlatSceneTransitionInput {
	readonly outgoingScene: WebGLTexture | null;
	readonly progress: number;
	/** Optional authored tunnel target composited after the outgoing-world blend. */
	readonly tunnelScene?: WebGLTexture | null;
	readonly tunnelOpacity?: number;
}

const PRESENTATION_VERTEX_SHADER = `#version 300 es
precision highp float;

void main() {
	const vec2 positions[3] = vec2[3](
		vec2(-1.0, -1.0),
		vec2(3.0, -1.0),
		vec2(-1.0, 3.0)
	);
	vec2 position = positions[gl_VertexID];
	gl_Position = vec4(position, 0.0, 1.0);
}
`;

const PRESENTATION_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uSceneColor;
uniform sampler2D uColorGradeStrip;
uniform sampler2D uOutgoingScene;
uniform sampler2D uTunnelScene;
uniform vec3 uWhiteBalance;
uniform float uSaturation;
uniform float uTransitionProgress;
uniform float uTunnelOpacity;
uniform int uColorGradeEnabled;
uniform int uTransitionEnabled;
uniform int uTunnelEnabled;
layout(location = 0) out vec4 outColor;

const vec3 LUMA_WEIGHTS = vec3(
	${REC_601_LUMA_WEIGHTS.red},
	${REC_601_LUMA_WEIGHTS.green},
	${REC_601_LUMA_WEIGHTS.blue}
);
const float STRIP_ENTRIES = ${COLOR_GRADE_STRIP_ENTRY_COUNT}.0;

/**
 * Sample one baked curve strip at a normalized source level.
 *
 * Maps onto texel centers rather than the [0, 1] edge span, so an identity curve reads back as
 * an identity instead of drifting by half a texel.
 */
vec3 sampleColorGradeStrip(vec3 source) {
	vec3 coordinate = (source * (STRIP_ENTRIES - 1.0) + 0.5) / STRIP_ENTRIES;
	return vec3(
		texture(uColorGradeStrip, vec2(coordinate.r, 0.5)).r,
		texture(uColorGradeStrip, vec2(coordinate.g, 0.5)).g,
		texture(uColorGradeStrip, vec2(coordinate.b, 0.5)).b
	);
}

/** Deterministic interleaved-gradient noise, so repeated captures of one frame agree. */
float ditherAmount(vec2 pixel) {
	return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
}

vec3 applyColorGrade(vec3 color, vec2 pixel) {
	vec3 balanced = clamp(color * uWhiteBalance, 0.0, 1.0);
	vec3 curved = sampleColorGradeStrip(balanced);
	vec3 saturated = clamp(
		mix(vec3(dot(curved, LUMA_WEIGHTS)), curved, uSaturation),
		0.0,
		1.0
	);
	// The grade is the only stage that reshapes an already-quantized 8-bit scene, so it is also
	// the only stage that can turn a smooth sky gradient into visible bands. Dithering by half a
	// code shapes the one quantization that follows.
	return saturated + (ditherAmount(pixel) - 0.5) / 255.0;
}

void main() {
	vec4 scene = texelFetch(uSceneColor, ivec2(gl_FragCoord.xy), 0);
	if (uTransitionEnabled != 0) {
		// RETAIL DIVERGENCE: the first pass keeps the compositor as a normalized screen-space
		// blend; retail swaps viewport/FOV state while the portal is open
		// (acclient.c:252638-252799). Correcting this would affect only the portal presentation
		// pass, not activation or world state. The current census is one snapshot texture and this
		// shader, so an authored tunnel can replace this seam without widening the state contract.
		// The outgoing capture may retain the previous drawing-buffer extent during a resize. Sample
		// by normalized screen coordinates so that old-sized frames remain valid warp sources.
		vec2 outgoingUv = gl_FragCoord.xy / vec2(textureSize(uSceneColor, 0));
		vec4 outgoing = texture(uOutgoingScene, outgoingUv);
		scene = mix(outgoing, scene, clamp(uTransitionProgress, 0.0, 1.0));
	}
	if (uTunnelEnabled != 0) {
		vec2 tunnelUv = gl_FragCoord.xy / vec2(textureSize(uSceneColor, 0));
		vec4 tunnel = texture(uTunnelScene, tunnelUv);
		scene = mix(scene, tunnel, clamp(uTunnelOpacity * tunnel.a, 0.0, 1.0));
	}
	outColor =
		uColorGradeEnabled != 0
			? vec4(applyColorGrade(scene.rgb, gl_FragCoord.xy), scene.a)
			: scene;
}
`;

/** Full-drawing-buffer color/depth presenter for the unconditional flat-scene target. */
export class WebGL2FlatScenePresentation {
	readonly #gl: WebGL2RenderingContext;
	readonly #program: WebGLProgram;
	readonly #vertexArray: WebGLVertexArrayObject;
	readonly #stripTexture: WebGLTexture;
	readonly #stripBuffer = new Float32Array(COLOR_GRADE_STRIP_LENGTH);
	readonly #uniforms: {
		readonly whiteBalance: WebGLUniformLocation;
		readonly saturation: WebGLUniformLocation;
		readonly transitionProgress: WebGLUniformLocation;
		readonly tunnelOpacity: WebGLUniformLocation;
		readonly transitionEnabled: WebGLUniformLocation;
		readonly tunnelEnabled: WebGLUniformLocation;
		readonly enabled: WebGLUniformLocation;
	};
	/** Parameters the resident strip and gains were derived from; identity-compared for staleness. */
	#bakedParameters: ColorGradeParameters | null = null;
	/** White balance resolved alongside the bake, so a steady frame allocates nothing. */
	#whiteBalance: ColorGradeChannelGains = NEUTRAL_WHITE_BALANCE;
	#destroyed = false;

	constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl;
		const previousProgram = gl.getParameter(
			gl.CURRENT_PROGRAM,
		) as WebGLProgram | null;
		let vertexShader: WebGLShader | null = null;
		let fragmentShader: WebGLShader | null = null;
		let program: WebGLProgram | null = null;
		try {
			vertexShader = compileWebGL2Shader(
				gl,
				gl.VERTEX_SHADER,
				PRESENTATION_VERTEX_SHADER,
			);
			fragmentShader = compileWebGL2Shader(
				gl,
				gl.FRAGMENT_SHADER,
				PRESENTATION_FRAGMENT_SHADER,
			);
			program = gl.createProgram();
			if (!program) {
				throw new Error("Failed to allocate flat scene presentation program.");
			}
			gl.attachShader(program, vertexShader);
			gl.attachShader(program, fragmentShader);
			gl.linkProgram(program);
			if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
				throw new Error(
					`Failed to link flat scene presentation program: ${gl.getProgramInfoLog(program) ?? "unknown error"}`,
				);
			}
			gl.useProgram(program);
			gl.uniform1i(
				requireWebGL2Uniform(gl, program, "uSceneColor"),
				SCENE_COLOR_TEXTURE_UNIT,
			);
			gl.uniform1i(
				requireWebGL2Uniform(gl, program, "uColorGradeStrip"),
				COLOR_GRADE_STRIP_TEXTURE_UNIT,
			);
			gl.uniform1i(
				requireWebGL2Uniform(gl, program, "uOutgoingScene"),
				OUTGOING_SCENE_TEXTURE_UNIT,
			);
			gl.uniform1i(
				requireWebGL2Uniform(gl, program, "uTunnelScene"),
				TUNNEL_SCENE_TEXTURE_UNIT,
			);
			this.#uniforms = {
				whiteBalance: requireWebGL2Uniform(gl, program, "uWhiteBalance"),
				saturation: requireWebGL2Uniform(gl, program, "uSaturation"),
				transitionProgress: requireWebGL2Uniform(
					gl,
					program,
					"uTransitionProgress",
				),
				tunnelOpacity: requireWebGL2Uniform(gl, program, "uTunnelOpacity"),
				transitionEnabled: requireWebGL2Uniform(
					gl,
					program,
					"uTransitionEnabled",
				),
				tunnelEnabled: requireWebGL2Uniform(gl, program, "uTunnelEnabled"),
				enabled: requireWebGL2Uniform(gl, program, "uColorGradeEnabled"),
			};
			this.#program = program;
		} catch (cause) {
			if (program) gl.deleteProgram(program);
			throw cause;
		} finally {
			if (vertexShader) gl.deleteShader(vertexShader);
			if (fragmentShader) gl.deleteShader(fragmentShader);
			gl.useProgram(previousProgram);
		}
		const vertexArray = gl.createVertexArray();
		if (!vertexArray) {
			gl.deleteProgram(this.#program);
			throw new Error(
				"Failed to allocate flat scene presentation vertex array.",
			);
		}
		this.#vertexArray = vertexArray;
		try {
			this.#stripTexture = allocateColorGradeStrip(gl);
		} catch (cause) {
			gl.deleteVertexArray(vertexArray);
			gl.deleteProgram(this.#program);
			throw cause;
		}
	}

	/**
	 * Replace the default framebuffer with the finished scene, graded if a grade is enabled.
	 *
	 * Depth is deliberately not republished: nothing draws or reads there after this call, so
	 * the copy had no consumer. The depth *state* below still matters — `DEPTH_TEST` is enabled
	 * once for the renderer's lifetime rather than per frame, so disabling it here would leave
	 * every later frame drawing without a depth test.
	 */
	present(
		target: WebGL2FlatSceneTargetSet,
		colorGrade: ColorGradeSettings,
		transition: FlatSceneTransitionInput | undefined = undefined,
	): void {
		if (this.#destroyed) {
			throw new Error("Flat scene presentation has been destroyed.");
		}
		const gl = this.#gl;
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
		gl.viewport(0, 0, target.extent.width, target.extent.height);
		gl.disable(gl.BLEND);
		gl.disable(gl.CULL_FACE);
		gl.disable(gl.SCISSOR_TEST);
		gl.disable(gl.STENCIL_TEST);
		gl.stencilMask(0xff);
		gl.clearStencil(0);
		gl.clear(gl.STENCIL_BUFFER_BIT);
		gl.colorMask(true, true, true, true);
		gl.depthMask(true);
		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.ALWAYS);
		gl.useProgram(this.#program);
		this.#applyColorGrade(colorGrade);
		if (transition !== undefined) {
			if (
				!Number.isFinite(transition.progress) ||
				transition.progress < 0 ||
				transition.progress > 1
			) {
				throw new Error(
					"Flat scene transition progress must be within [0, 1].",
				);
			}
			const tunnelOpacity = transition.tunnelOpacity ?? 0;
			if (
				!Number.isFinite(tunnelOpacity) ||
				tunnelOpacity < 0 ||
				tunnelOpacity > 1
			) {
				throw new Error("Flat scene tunnel opacity must be within [0, 1].");
			}
			gl.uniform1i(
				this.#uniforms.transitionEnabled,
				transition.outgoingScene === null ? 0 : 1,
			);
			gl.uniform1f(this.#uniforms.transitionProgress, transition.progress);
			gl.uniform1i(
				this.#uniforms.tunnelEnabled,
				transition.tunnelScene === null || transition.tunnelScene === undefined
					? 0
					: 1,
			);
			gl.uniform1f(this.#uniforms.tunnelOpacity, tunnelOpacity);
			gl.activeTexture(gl.TEXTURE0 + OUTGOING_SCENE_TEXTURE_UNIT);
			gl.bindTexture(gl.TEXTURE_2D, transition.outgoingScene);
			gl.activeTexture(gl.TEXTURE0 + TUNNEL_SCENE_TEXTURE_UNIT);
			gl.bindTexture(gl.TEXTURE_2D, transition.tunnelScene ?? null);
		} else {
			gl.uniform1i(this.#uniforms.transitionEnabled, 0);
			gl.uniform1f(this.#uniforms.transitionProgress, 1);
			gl.uniform1i(this.#uniforms.tunnelEnabled, 0);
			gl.uniform1f(this.#uniforms.tunnelOpacity, 0);
			gl.activeTexture(gl.TEXTURE0 + OUTGOING_SCENE_TEXTURE_UNIT);
			gl.bindTexture(gl.TEXTURE_2D, null);
			gl.activeTexture(gl.TEXTURE0 + TUNNEL_SCENE_TEXTURE_UNIT);
			gl.bindTexture(gl.TEXTURE_2D, null);
		}
		gl.bindVertexArray(this.#vertexArray);
		gl.activeTexture(gl.TEXTURE0 + SCENE_COLOR_TEXTURE_UNIT);
		gl.bindTexture(gl.TEXTURE_2D, target.color);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		gl.bindVertexArray(null);
		gl.depthFunc(gl.LEQUAL);
	}

	/**
	 * Publish this frame's grade, rebaking the strip only when the authored look changed.
	 *
	 * A disabled grade binds nothing and rebakes nothing: the shader takes its untouched copy
	 * path, so presentation output stays exactly what it was before grading existed.
	 */
	#applyColorGrade(colorGrade: ColorGradeSettings): void {
		const gl = this.#gl;
		gl.uniform1i(this.#uniforms.enabled, colorGrade.enabled ? 1 : 0);
		if (!colorGrade.enabled) return;
		const parameters = colorGrade.parameters;
		if (parameters !== this.#bakedParameters) {
			createColorGradeParameters(parameters);
			bakeColorGradeStrip(parameters, this.#stripBuffer);
			gl.activeTexture(gl.TEXTURE0 + COLOR_GRADE_STRIP_TEXTURE_UNIT);
			gl.bindTexture(gl.TEXTURE_2D, this.#stripTexture);
			gl.texSubImage2D(
				gl.TEXTURE_2D,
				0,
				0,
				0,
				COLOR_GRADE_STRIP_ENTRY_COUNT,
				1,
				gl.RGBA,
				gl.FLOAT,
				this.#stripBuffer,
			);
			this.#whiteBalance = temperatureTintToGains(
				parameters.temperature,
				parameters.tint,
			);
			this.#bakedParameters = parameters;
		}
		gl.uniform3f(
			this.#uniforms.whiteBalance,
			this.#whiteBalance.red,
			this.#whiteBalance.green,
			this.#whiteBalance.blue,
		);
		gl.uniform1f(this.#uniforms.saturation, parameters.saturation);
		gl.activeTexture(gl.TEXTURE0 + COLOR_GRADE_STRIP_TEXTURE_UNIT);
		gl.bindSampler(COLOR_GRADE_STRIP_TEXTURE_UNIT, null);
		gl.bindTexture(gl.TEXTURE_2D, this.#stripTexture);
	}

	/** Release the renderer-local program, vertex array, and strip texture exactly once. */
	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#gl.deleteVertexArray(this.#vertexArray);
		this.#gl.deleteProgram(this.#program);
		this.#gl.deleteTexture(this.#stripTexture);
	}
}

/**
 * Allocate the resident curve strip.
 *
 * RGBA16F rather than RGBA8 so the baked curves do not quantize before the single 8-bit
 * quantization the dither is there to shape. Linear filtering interpolates between entries,
 * which matters because white balance moves values off the source's 1/255 grid.
 */
function allocateColorGradeStrip(gl: WebGL2RenderingContext): WebGLTexture {
	const texture = gl.createTexture();
	if (!texture) {
		throw new Error("Failed to allocate color grade strip texture.");
	}
	const previous = gl.getParameter(
		gl.TEXTURE_BINDING_2D,
	) as WebGLTexture | null;
	try {
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texStorage2D(
			gl.TEXTURE_2D,
			1,
			gl.RGBA16F,
			COLOR_GRADE_STRIP_ENTRY_COUNT,
			1,
		);
	} catch (cause) {
		gl.deleteTexture(texture);
		throw cause;
	} finally {
		gl.bindTexture(gl.TEXTURE_2D, previous);
	}
	return texture;
}
