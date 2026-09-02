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
import type { PortalTransitionComposition } from "./portal-transition-composition";
import {
	validatePortalWarpDriveTuning,
	type PortalWarpDriveTuning,
} from "./portal-warp-drive-tuning";

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
const PRESENTATION_SCENE_TEXTURE_UNITS = [
	SCENE_COLOR_TEXTURE_UNIT,
	OUTGOING_SCENE_TEXTURE_UNIT,
	TUNNEL_SCENE_TEXTURE_UNIT,
] as const;

/** Exhaustive WebGL specialization of the pure flat-scene composition contract. */
export type FlatScenePresentationInput =
	PortalTransitionComposition<WebGLTexture>;

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
uniform int uColorGradeEnabled;
uniform int uCompositionKind;
uniform int uTunnelEnabled;
uniform float uWarpAccelerationExponent;
uniform float uWarpMaximumZoom;
uniform vec2 uWarpRadialSmear;
uniform float uWarpStreakIntensity;
uniform float uWarpWorldOpacityExponent;
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

/** Sample the origin on entry and the settled destination on the exact reverse exit path. */
vec4 sampleTransitionWorld(vec2 uv) {
	return
		uCompositionKind == 1
			? texture(uOutgoingScene, uv)
			: texture(uSceneColor, uv);
}

vec2 warpDriveSourceUv(
	vec2 radialPosition,
	vec2 textureExtent,
	float zoom
) {
	float minimumExtent = min(textureExtent.x, textureExtent.y);
	return
		0.5 + radialPosition / zoom * (minimumExtent * 0.5) / textureExtent;
}

/** Forward zoom plus radial sample history, evaluated backward for destination reveal. */
vec4 sampleWarpDriveWorld(vec2 textureExtent, float acceleration) {
	float minimumExtent = min(textureExtent.x, textureExtent.y);
	vec2 radialPosition =
		(gl_FragCoord.xy - textureExtent * 0.5) / (minimumExtent * 0.5);
	float radius = length(radialPosition);
	float easedAcceleration = acceleration * acceleration * (3.0 - 2.0 * acceleration);
	float motion = pow(easedAcceleration, uWarpAccelerationExponent);
	float radialWeight = smoothstep(uWarpRadialSmear.x, uWarpRadialSmear.y, radius);
	float currentZoom = 1.0 + motion * radialWeight * (uWarpMaximumZoom - 1.0);
	vec4 base = sampleTransitionWorld(
		warpDriveSourceUv(radialPosition, textureExtent, currentZoom)
	);
	vec3 streak = vec3(0.0);
	for (int sampleIndex = 0; sampleIndex < 12; sampleIndex += 1) {
		float history = float(sampleIndex + 1) / 12.0;
		float historyZoom = mix(1.0, currentZoom, history);
		vec3 sampleColor = sampleTransitionWorld(
			warpDriveSourceUv(radialPosition, textureExtent, historyZoom)
		).rgb;
		float luminance = dot(sampleColor, LUMA_WEIGHTS);
		float highlight = smoothstep(0.65, 0.95, luminance);
		streak += sampleColor * highlight;
	}
	float streakEnvelope = 4.0 * acceleration * (1.0 - acceleration);
	return vec4(
		base.rgb + streak / 12.0 * streakEnvelope * radialWeight * uWarpStreakIntensity,
		base.a
	);
}

void main() {
	vec2 textureExtent = vec2(textureSize(uSceneColor, 0));
	vec2 uv = gl_FragCoord.xy / textureExtent;
	vec4 scene = texture(uSceneColor, uv);
	if (uCompositionKind == 1 || uCompositionKind == 2) {
		// RETAIL DIVERGENCE: retail drives portal entry/exit through viewport-distance changes
		// (acclient.c:252720-252752); this client uses a bounded radial zoom-history smear so the
		// effect works on both a retained origin and the settled destination. Replacing it with the
		// retail projection change would alter only portal presentation. The blast radius is this pass,
		// one optional origin texture, and one destination texture; world/camera state is untouched.
		// The outgoing capture may retain the previous drawing-buffer extent during a resize. Sample
		// by normalized screen coordinates so that old-sized frames remain valid warp sources.
		float progress = clamp(uTransitionProgress, 0.0, 1.0);
		float acceleration = uCompositionKind == 1 ? progress : 1.0 - progress;
		float easedAcceleration = acceleration * acceleration * (3.0 - 2.0 * acceleration);
		float motion = pow(easedAcceleration, uWarpAccelerationExponent);
		vec4 world = sampleWarpDriveWorld(textureExtent, acceleration);
		float worldOpacity = 1.0 - pow(motion, uWarpWorldOpacityExponent);
		vec4 tunnelLayer = vec4(0.0, 0.0, 0.0, 1.0);
		if (uTunnelEnabled != 0) {
			vec4 tunnel = texture(uTunnelScene, uv);
			tunnelLayer = mix(
				tunnelLayer,
				vec4(tunnel.rgb, 1.0),
				clamp(tunnel.a, 0.0, 1.0)
			);
		}
		scene = mix(tunnelLayer, world, worldOpacity);
	} else if (uTunnelEnabled != 0) {
		vec4 tunnel = texture(uTunnelScene, uv);
		scene = mix(scene, tunnel, clamp(tunnel.a, 0.0, 1.0));
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
	/** Linear clamp sampler owning the scene, transition-origin, and transition-tunnel reads. */
	readonly #sceneSampler: WebGLSampler;
	readonly #stripBuffer = new Float32Array(COLOR_GRADE_STRIP_LENGTH);
	readonly #uniforms: {
		readonly whiteBalance: WebGLUniformLocation;
		readonly saturation: WebGLUniformLocation;
		readonly transitionProgress: WebGLUniformLocation;
		readonly compositionKind: WebGLUniformLocation;
		readonly tunnelEnabled: WebGLUniformLocation;
		readonly warpAccelerationExponent: WebGLUniformLocation;
		readonly warpMaximumZoom: WebGLUniformLocation;
		readonly warpRadialSmear: WebGLUniformLocation;
		readonly warpStreakIntensity: WebGLUniformLocation;
		readonly warpWorldOpacityExponent: WebGLUniformLocation;
		readonly enabled: WebGLUniformLocation;
	};
	/** Parameters the resident strip and gains were derived from; identity-compared for staleness. */
	#bakedParameters: ColorGradeParameters | null = null;
	/** White balance resolved alongside the bake, so a steady frame allocates nothing. */
	#whiteBalance: ColorGradeChannelGains = NEUTRAL_WHITE_BALANCE;
	#destroyed = false;

	constructor(
		gl: WebGL2RenderingContext,
		warpDriveTuning: PortalWarpDriveTuning,
	) {
		validatePortalWarpDriveTuning(warpDriveTuning);
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
				compositionKind: requireWebGL2Uniform(gl, program, "uCompositionKind"),
				tunnelEnabled: requireWebGL2Uniform(gl, program, "uTunnelEnabled"),
				warpAccelerationExponent: requireWebGL2Uniform(
					gl,
					program,
					"uWarpAccelerationExponent",
				),
				warpMaximumZoom: requireWebGL2Uniform(gl, program, "uWarpMaximumZoom"),
				warpRadialSmear: requireWebGL2Uniform(gl, program, "uWarpRadialSmear"),
				warpStreakIntensity: requireWebGL2Uniform(
					gl,
					program,
					"uWarpStreakIntensity",
				),
				warpWorldOpacityExponent: requireWebGL2Uniform(
					gl,
					program,
					"uWarpWorldOpacityExponent",
				),
				enabled: requireWebGL2Uniform(gl, program, "uColorGradeEnabled"),
			};
			gl.uniform1f(
				this.#uniforms.warpAccelerationExponent,
				warpDriveTuning.accelerationExponent,
			);
			gl.uniform1f(this.#uniforms.warpMaximumZoom, warpDriveTuning.maximumZoom);
			gl.uniform2f(
				this.#uniforms.warpRadialSmear,
				warpDriveTuning.radialSmear.startRadius,
				warpDriveTuning.radialSmear.fullRadius,
			);
			gl.uniform1f(
				this.#uniforms.warpStreakIntensity,
				warpDriveTuning.streakIntensity,
			);
			gl.uniform1f(
				this.#uniforms.warpWorldOpacityExponent,
				warpDriveTuning.worldOpacityExponent,
			);
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
		let sceneSampler: WebGLSampler | null = null;
		try {
			sceneSampler = allocatePresentationSceneSampler(gl);
			this.#stripTexture = allocateColorGradeStrip(gl);
			this.#sceneSampler = sceneSampler;
		} catch (cause) {
			if (sceneSampler) gl.deleteSampler(sceneSampler);
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
		composition: FlatScenePresentationInput = { kind: "scene-only" },
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
		for (const unit of PRESENTATION_SCENE_TEXTURE_UNITS) {
			gl.bindSampler(unit, this.#sceneSampler);
		}
		try {
			this.#applyColorGrade(colorGrade);
			if (
				composition.kind === "origin-to-tunnel" ||
				composition.kind === "tunnel-to-destination"
			) {
				gl.uniform1i(
					this.#uniforms.compositionKind,
					composition.kind === "origin-to-tunnel" ? 1 : 2,
				);
				gl.uniform1f(this.#uniforms.transitionProgress, composition.progress);
				gl.uniform1i(this.#uniforms.tunnelEnabled, 1);
				gl.activeTexture(gl.TEXTURE0 + OUTGOING_SCENE_TEXTURE_UNIT);
				gl.bindTexture(
					gl.TEXTURE_2D,
					composition.kind === "origin-to-tunnel" ? composition.origin : null,
				);
				gl.activeTexture(gl.TEXTURE0 + TUNNEL_SCENE_TEXTURE_UNIT);
				gl.bindTexture(gl.TEXTURE_2D, composition.tunnel);
			} else if (composition.kind === "tunnel-only") {
				gl.uniform1i(this.#uniforms.compositionKind, 0);
				gl.uniform1f(this.#uniforms.transitionProgress, 0);
				gl.uniform1i(this.#uniforms.tunnelEnabled, 1);
				gl.activeTexture(gl.TEXTURE0 + OUTGOING_SCENE_TEXTURE_UNIT);
				gl.bindTexture(gl.TEXTURE_2D, null);
				gl.activeTexture(gl.TEXTURE0 + TUNNEL_SCENE_TEXTURE_UNIT);
				gl.bindTexture(gl.TEXTURE_2D, composition.tunnel);
			} else {
				gl.uniform1i(this.#uniforms.compositionKind, 0);
				gl.uniform1f(this.#uniforms.transitionProgress, 1);
				gl.uniform1i(this.#uniforms.tunnelEnabled, 0);
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
		} finally {
			for (const unit of PRESENTATION_SCENE_TEXTURE_UNITS) {
				gl.bindSampler(unit, null);
			}
			gl.depthFunc(gl.LEQUAL);
		}
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

	/** Release the renderer-local program, vertex array, sampler, and strip texture exactly once. */
	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#gl.deleteVertexArray(this.#vertexArray);
		this.#gl.deleteProgram(this.#program);
		this.#gl.deleteSampler(this.#sceneSampler);
		this.#gl.deleteTexture(this.#stripTexture);
	}
}

/** Allocate the pass-owned sampler that isolates presentation from preceding material state. */
function allocatePresentationSceneSampler(
	gl: WebGL2RenderingContext,
): WebGLSampler {
	const sampler = gl.createSampler();
	if (!sampler) {
		throw new Error("Failed to allocate flat scene presentation sampler.");
	}
	try {
		gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		return sampler;
	} catch (cause) {
		gl.deleteSampler(sampler);
		throw cause;
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
