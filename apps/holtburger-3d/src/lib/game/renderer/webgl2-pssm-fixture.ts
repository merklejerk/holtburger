import {
	createWebGL2PssmCasterProgram,
	type WebGL2PssmCasterProgram,
} from "./webgl2-pssm-caster-program";
import { Mat4 } from "../math/types";
import { mat4ToFloat32Array } from "../math/matrices";
import {
	compileWebGL2Shader,
	requireWebGL2Uniform,
} from "../webgl/shader-program";
import { WebGL2DynamicPosePages } from "./webgl2-dynamic-pose-pages";
import { WebGL2FlatSceneTarget } from "./webgl2-flat-scene-target";
import { WebGL2OutdoorPssmReceiverPrograms } from "./webgl2-pssm-receiver-programs";
import { WebGL2EntityGroundingPrograms } from "./webgl2-entity-grounding-programs";
import {
	WebGL2PssmShadowTargets,
	type WebGL2PssmShadowTargetDiagnostics,
} from "./webgl2-pssm-shadow-targets";

const INITIAL_CONFIGURATION = { cascadeCount: 1, resolution: 256 } as const;
const RESIZED_CONFIGURATION = { cascadeCount: 2, resolution: 512 } as const;

/** Real-browser evidence for the outdoor depth-array format, lifecycle, and caster shader. */
export interface WebGL2PssmFixtureResult {
	/** Shadow comparison samples prove pose-row addressing and matrix changes reach depth pixels. */
	readonly posedDepthPixels: {
		readonly before: number;
		readonly vacated: number;
		readonly moved: number;
	};
	readonly casterProgramLinked: boolean;
	readonly groundingProgramsLinked: boolean;
	readonly receiverProgramsLinked: boolean;
	readonly disposedDiagnostics: WebGL2PssmShadowTargetDiagnostics;
	readonly initialDiagnostics: WebGL2PssmShadowTargetDiagnostics;
	readonly initialLayersComplete: boolean;
	readonly initialResourcesValid: boolean;
	readonly resizedDiagnostics: WebGL2PssmShadowTargetDiagnostics;
	readonly resizedLayersComplete: boolean;
	readonly resizedResourcesValid: boolean;
	readonly resizedTargetReplaced: boolean;
	readonly sameConfigurationReused: boolean;
}

/** Compile and validate the production PSSM resources directly against one browser context. */
export function runWebGL2PssmFixture(
	gl: WebGL2RenderingContext,
): WebGL2PssmFixtureResult {
	requireNoWebGL2Error(gl, "before outdoor PSSM fixture");
	const previousDraw = gl.getParameter(
		gl.DRAW_FRAMEBUFFER_BINDING,
	) as WebGLFramebuffer | null;
	const previousRead = gl.getParameter(
		gl.READ_FRAMEBUFFER_BINDING,
	) as WebGLFramebuffer | null;
	const targets = new WebGL2PssmShadowTargets(gl);
	const receiverPrograms = new WebGL2OutdoorPssmReceiverPrograms(gl);
	const groundingPrograms = new WebGL2EntityGroundingPrograms(gl);
	let casterProgram: WebGLProgram | null = null;
	try {
		const initial = targets.resize(
			INITIAL_CONFIGURATION.resolution,
			INITIAL_CONFIGURATION.cascadeCount,
		);
		const initialDiagnostics = targets.getDiagnostics();
		const initialLayersComplete = layersComplete(
			gl,
			targets,
			initial.cascadeCount,
		);
		const initialResourcesValid = resourcesValid(gl, initial);
		const sameConfigurationReused =
			targets.resize(
				INITIAL_CONFIGURATION.resolution,
				INITIAL_CONFIGURATION.cascadeCount,
			) === initial;
		const resized = targets.resize(
			RESIZED_CONFIGURATION.resolution,
			RESIZED_CONFIGURATION.cascadeCount,
		);
		const resizedDiagnostics = targets.getDiagnostics();
		const resizedLayersComplete = layersComplete(
			gl,
			targets,
			resized.cascadeCount,
		);
		const resizedResourcesValid = resourcesValid(gl, resized);
		const compiled = createWebGL2PssmCasterProgram(gl);
		casterProgram = compiled.program;
		const casterProgramLinked =
			gl.isProgram(casterProgram) &&
			Boolean(gl.getProgramParameter(casterProgram, gl.LINK_STATUS));
		const posedDepthPixels = verifyPosedDepthPixels(
			gl,
			targets,
			compiled,
			resized.resolution,
			resized.depth,
		);
		const receivers = [
			receiverPrograms.terrain(),
			receiverPrograms.directionalTerrain(),
			receiverPrograms.hybridTerrain(),
			receiverPrograms.foggedBaked(),
			receiverPrograms.foggedInstanced(),
			receiverPrograms.blendedBaked(false),
			receiverPrograms.blendedInstanced(false),
			receiverPrograms.blendedBaked(true),
			receiverPrograms.blendedInstanced(true),
		];
		const receiverProgramsLinked = receivers.every(
			(receiver) =>
				gl.isProgram(receiver.program) &&
				Boolean(gl.getProgramParameter(receiver.program, gl.LINK_STATUS)),
		);
		const groundingReceivers = [
			groundingPrograms.fogged(),
			groundingPrograms.blended(false),
			groundingPrograms.blended(true),
		];
		const groundingProgramsLinked = groundingReceivers.every(
			(receiver) =>
				gl.isProgram(receiver.program) &&
				Boolean(gl.getProgramParameter(receiver.program, gl.LINK_STATUS)),
		);
		requireNoWebGL2Error(gl, "after outdoor PSSM fixture");
		targets.disable();
		return {
			posedDepthPixels,
			casterProgramLinked,
			groundingProgramsLinked,
			receiverProgramsLinked,
			disposedDiagnostics: targets.getDiagnostics(),
			initialDiagnostics,
			initialLayersComplete,
			initialResourcesValid,
			resizedDiagnostics,
			resizedLayersComplete,
			resizedResourcesValid,
			resizedTargetReplaced: resized !== initial,
			sameConfigurationReused,
		};
	} finally {
		if (casterProgram) gl.deleteProgram(casterProgram);
		groundingPrograms.destroy();
		receiverPrograms.destroy();
		targets.destroy();
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, previousDraw);
		gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previousRead);
	}
}

/** Exercise the production caster shader against depth-array storage, then sample its comparison result. */
function verifyPosedDepthPixels(
	gl: WebGL2RenderingContext,
	targets: WebGL2PssmShadowTargets,
	caster: WebGL2PssmCasterProgram,
	resolution: number,
	depth: WebGLTexture,
): WebGL2PssmFixtureResult["posedDepthPixels"] {
	const poses = new WebGL2DynamicPosePages<string>(gl);
	const output = new WebGL2FlatSceneTarget(gl);
	const vertices = gl.createBuffer();
	const indices = gl.createBuffer();
	const vao = gl.createVertexArray();
	if (vertices === null || indices === null || vao === null)
		throw new Error("PSSM pixel fixture could not allocate triangle geometry.");
	const vertex = compileWebGL2Shader(
		gl,
		gl.VERTEX_SHADER,
		`#version 300 es
void main() {
	vec2 position = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
	gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}`,
	);
	const fragment = compileWebGL2Shader(
		gl,
		gl.FRAGMENT_SHADER,
		`#version 300 es
precision highp float;
uniform highp sampler2DArrayShadow uDepth;
uniform vec2 uSample;
out vec4 outColor;
void main() { outColor = vec4(vec3(texture(uDepth, vec4(uSample, 0.0, 0.75))), 1.0); }
`,
	);
	const program = gl.createProgram();
	if (program === null)
		throw new Error(
			"PSSM pixel fixture could not allocate comparison program.",
		);
	try {
		gl.attachShader(program, vertex);
		gl.attachShader(program, fragment);
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS))
			throw new Error(
				`PSSM comparison program failed: ${gl.getProgramInfoLog(program)}`,
			);
		const sampleUniform = requireWebGL2Uniform(gl, program, "uSample");
		const depthUniform = requireWebGL2Uniform(gl, program, "uDepth");
		const target = output.resizeDimensions(1, 1);
		gl.bindVertexArray(vao);
		gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
		gl.bufferData(
			gl.ARRAY_BUFFER,
			new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]),
			gl.STATIC_DRAW,
		);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
		gl.disableVertexAttribArray(3);
		gl.vertexAttribI4ui(3, 0, 0, 0, 0);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
		gl.bufferData(
			gl.ELEMENT_ARRAY_BUFFER,
			new Uint32Array([0, 1, 2]),
			gl.STATIC_DRAW,
		);
		const matrix = Mat4.identity();
		const part = {
			frameInstance: {
				sourceToLandblock: matrix,
				color: { a: 1, b: 1, g: 1, r: 1 },
			},
		};
		const draw = (translation: number) => {
			matrix.m41 = translation;
			// A padding entity forces the actual caster's matrix to start at row one.
			poses.upload(
				new Map([
					["padding", [part]],
					["caster", [part]],
				]),
			);
			const pose = poses.get("caster");
			targets.attachLayer(0);
			gl.viewport(0, 0, resolution, resolution);
			gl.disable(gl.BLEND);
			gl.disable(gl.SCISSOR_TEST);
			gl.disable(gl.STENCIL_TEST);
			gl.disable(gl.POLYGON_OFFSET_FILL);
			gl.enable(gl.DEPTH_TEST);
			gl.depthFunc(gl.LEQUAL);
			gl.depthMask(true);
			gl.enable(gl.CULL_FACE);
			gl.cullFace(gl.BACK);
			gl.clearDepth(1);
			gl.clear(gl.DEPTH_BUFFER_BIT);
			gl.useProgram(caster.program);
			gl.uniformMatrix4fv(
				caster.uniforms.lightClip,
				false,
				mat4ToFloat32Array(Mat4.identity()),
			);
			gl.uniform3f(caster.uniforms.landblockOffset, 0, 0, 0);
			gl.uniform1i(caster.uniforms.poses, 0);
			gl.uniform1i(caster.uniforms.firstPoseRow, pose.firstRow);
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, pose.texture);
			gl.bindSampler(0, null);
			gl.bindVertexArray(vao);
			gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_INT, 0);
		};
		const sample = (x: number) => {
			gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
			gl.viewport(0, 0, 1, 1);
			gl.colorMask(true, true, true, true);
			gl.disable(gl.DEPTH_TEST);
			gl.disable(gl.CULL_FACE);
			gl.useProgram(program);
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D_ARRAY, depth);
			gl.bindSampler(0, null);
			gl.uniform1i(depthUniform, 0);
			gl.uniform2f(sampleUniform, x, 0.375);
			gl.bindVertexArray(null);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
			const pixel = new Uint8Array(4);
			gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
			const red = pixel[0];
			if (red === undefined)
				throw new Error("PSSM readback has no red component.");
			return red;
		};
		draw(0);
		const before = sample(0.5);
		draw(0.75);
		const vacated = sample(0.5);
		const moved = sample(0.875);
		if (before !== 0 || vacated !== 255 || moved !== 0)
			throw new Error(
				`PSSM posed depth pixels differ: ${before}/${vacated}/${moved}.`,
			);
		return { before, vacated, moved };
	} finally {
		poses.destroy();
		output.destroy();
		gl.deleteProgram(program);
		gl.deleteShader(vertex);
		gl.deleteShader(fragment);
		gl.deleteBuffer(vertices);
		gl.deleteBuffer(indices);
		gl.deleteVertexArray(vao);
		gl.bindVertexArray(null);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
		gl.colorMask(true, true, true, true);
		gl.depthMask(true);
		gl.enable(gl.DEPTH_TEST);
	}
}

function layersComplete(
	gl: WebGL2RenderingContext,
	targets: WebGL2PssmShadowTargets,
	cascadeCount: number,
): boolean {
	for (let layer = 0; layer < cascadeCount; layer += 1) {
		targets.attachLayer(layer);
		if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
			return false;
		}
	}
	return true;
}

function resourcesValid(
	gl: WebGL2RenderingContext,
	targets: ReturnType<WebGL2PssmShadowTargets["resize"]>,
): boolean {
	return gl.isFramebuffer(targets.framebuffer) && gl.isTexture(targets.depth);
}

function requireNoWebGL2Error(
	gl: WebGL2RenderingContext,
	checkpoint: string,
): void {
	const error = gl.getError();
	if (error !== gl.NO_ERROR) {
		throw new Error(`WebGL2 error ${error} observed ${checkpoint}.`);
	}
}
