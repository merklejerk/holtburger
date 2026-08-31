import { mat4ToFloat32Array } from "../math/matrices";
import type { Mat4, Vec3 } from "../math/types";
import {
	linkWebGL2Program,
	requireWebGL2Uniform,
} from "../webgl/shader-program";
import type { WorldTrajectoryInput } from "./renderer";
import {
	bindWebGL2PortalDeferredVisibilityProgram,
	PORTAL_DEFERRED_VISIBILITY_GLSL,
	type WebGL2PortalDeferredVisibilityUniforms,
} from "./portal-deferred-visibility-glsl";

const START_ATTRIBUTE = 0;
const END_ATTRIBUTE = 1;
const DISTANCE_ATTRIBUTE = 2;
const RECORD_FLOATS = 8;
const RECORD_BYTES = RECORD_FLOATS * Float32Array.BYTES_PER_ELEMENT;
const CURVE_ERROR_METERS = 0.04;
const MAXIMUM_CURVE_SEGMENTS = 128;
const LINE_WIDTH_PIXELS = 3;
const DASH_PERIOD_METERS = 0.72;
const DASH_DUTY = 0.58;

interface TrajectoryProgram {
	readonly program: WebGLProgram;
	readonly portal: WebGL2PortalDeferredVisibilityUniforms | null;
	readonly uniforms: {
		readonly anchorOrigin: WebGLUniformLocation;
		readonly clipFromAnchor: WebGLUniformLocation;
		readonly color: WebGLUniformLocation;
		readonly dashDuty: WebGLUniformLocation;
		readonly dashPeriod: WebGLUniformLocation;
		readonly lineWidth: WebGLUniformLocation;
		readonly viewport: WebGLUniformLocation;
	};
}

interface TrajectoryDrawRange {
	readonly renderScopeKey: string;
	readonly firstInstance: number;
	readonly instanceCount: number;
}

export interface WorldTrajectoryDrawInput {
	readonly anchorOrigin: Vec3;
	readonly clipFromAnchor: Mat4;
	readonly color: readonly [number, number, number, number];
	readonly viewportHeight: number;
	readonly viewportWidth: number;
}

export interface WorldTrajectoryPortalDraw {
	readonly visibility: {
		selectedScopeOrdinal(renderScopeKey: string): number | null;
	};
	readonly routing: {
		routeDeferredSubmission(
			renderScopeKey: string,
			uniforms: WebGL2PortalDeferredVisibilityUniforms,
		): void;
	};
}

/** Renderer-owned tessellation and dashed ribbon for one compact semantic jump curve. */
export class WebGL2WorldTrajectoryPass {
	readonly #gl: WebGL2RenderingContext;
	readonly #matrix = new Float32Array(16);
	readonly #vertexArray: WebGLVertexArrayObject;
	readonly #segmentBuffer: WebGLBuffer;
	readonly #flatProgram: TrajectoryProgram;
	readonly #portalProgram: TrajectoryProgram;
	#revision: number | null = null;
	#ranges: readonly TrajectoryDrawRange[] = [];

	constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl;
		const vertexArray = gl.createVertexArray();
		if (!vertexArray)
			throw new Error("Failed to allocate world-trajectory vertex array.");
		const segmentBuffer = gl.createBuffer();
		if (!segmentBuffer) {
			gl.deleteVertexArray(vertexArray);
			throw new Error("Failed to allocate world-trajectory segment buffer.");
		}
		this.#vertexArray = vertexArray;
		this.#segmentBuffer = segmentBuffer;
		gl.bindVertexArray(vertexArray);
		gl.bindBuffer(gl.ARRAY_BUFFER, segmentBuffer);
		configureAttribute(gl, START_ATTRIBUTE, 3, 0);
		configureAttribute(
			gl,
			END_ATTRIBUTE,
			3,
			3 * Float32Array.BYTES_PER_ELEMENT,
		);
		configureAttribute(
			gl,
			DISTANCE_ATTRIBUTE,
			2,
			6 * Float32Array.BYTES_PER_ELEMENT,
		);
		gl.bindVertexArray(null);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
		let flatProgram: TrajectoryProgram | null = null;
		let portalProgram: TrajectoryProgram | null = null;
		try {
			flatProgram = createTrajectoryProgram(gl, false);
			portalProgram = createTrajectoryProgram(gl, true);
		} catch (error) {
			if (flatProgram) gl.deleteProgram(flatProgram.program);
			if (portalProgram) gl.deleteProgram(portalProgram.program);
			gl.deleteBuffer(segmentBuffer);
			gl.deleteVertexArray(vertexArray);
			throw error;
		}
		this.#flatProgram = flatProgram;
		this.#portalProgram = portalProgram;
	}

	draw(
		trajectory: WorldTrajectoryInput,
		input: WorldTrajectoryDrawInput,
		portal: WorldTrajectoryPortalDraw | null,
	): void {
		this.#prepare(trajectory);
		if (this.#ranges.length === 0) return;
		const gl = this.#gl;
		const selectedProgram = portal ? this.#portalProgram : this.#flatProgram;
		gl.useProgram(selectedProgram.program);
		gl.uniformMatrix4fv(
			selectedProgram.uniforms.clipFromAnchor,
			false,
			mat4ToFloat32Array(input.clipFromAnchor, this.#matrix),
		);
		gl.uniform3f(
			selectedProgram.uniforms.anchorOrigin,
			input.anchorOrigin.x,
			input.anchorOrigin.y,
			input.anchorOrigin.z,
		);
		gl.uniform2f(
			selectedProgram.uniforms.viewport,
			input.viewportWidth,
			input.viewportHeight,
		);
		gl.uniform1f(selectedProgram.uniforms.lineWidth, LINE_WIDTH_PIXELS);
		gl.uniform1f(selectedProgram.uniforms.dashPeriod, DASH_PERIOD_METERS);
		gl.uniform1f(selectedProgram.uniforms.dashDuty, DASH_DUTY);
		gl.uniform4f(selectedProgram.uniforms.color, ...input.color);
		gl.enable(gl.DEPTH_TEST);
		gl.depthMask(false);
		gl.disable(gl.CULL_FACE);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		for (const range of this.#ranges) {
			if (portal) {
				if (
					portal.visibility.selectedScopeOrdinal(range.renderScopeKey) === null
				)
					continue;
				if (!selectedProgram.portal)
					throw new Error(
						"Portal world-trajectory program has no visibility uniforms.",
					);
				portal.routing.routeDeferredSubmission(
					range.renderScopeKey,
					selectedProgram.portal,
				);
			}
			this.#bindRange(range.firstInstance);
			gl.bindVertexArray(this.#vertexArray);
			gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, range.instanceCount);
		}
		gl.bindVertexArray(null);
		gl.depthMask(true);
		gl.disable(gl.BLEND);
	}

	destroy(): void {
		this.#gl.deleteProgram(this.#flatProgram.program);
		this.#gl.deleteProgram(this.#portalProgram.program);
		this.#gl.deleteBuffer(this.#segmentBuffer);
		this.#gl.deleteVertexArray(this.#vertexArray);
	}

	#prepare(trajectory: WorldTrajectoryInput): void {
		if (this.#revision === trajectory.revision) return;
		const geometry = buildTrajectoryGeometry(trajectory);
		this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, this.#segmentBuffer);
		this.#gl.bufferData(
			this.#gl.ARRAY_BUFFER,
			geometry.records,
			this.#gl.DYNAMIC_DRAW,
		);
		this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, null);
		this.#revision = trajectory.revision;
		this.#ranges = geometry.ranges;
		this.#bindRange(0);
	}

	#bindRange(firstInstance: number): void {
		const gl = this.#gl;
		const byteOffset = firstInstance * RECORD_BYTES;
		gl.bindVertexArray(this.#vertexArray);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.#segmentBuffer);
		gl.vertexAttribPointer(
			START_ATTRIBUTE,
			3,
			gl.FLOAT,
			false,
			RECORD_BYTES,
			byteOffset,
		);
		gl.vertexAttribPointer(
			END_ATTRIBUTE,
			3,
			gl.FLOAT,
			false,
			RECORD_BYTES,
			byteOffset + 3 * Float32Array.BYTES_PER_ELEMENT,
		);
		gl.vertexAttribPointer(
			DISTANCE_ATTRIBUTE,
			2,
			gl.FLOAT,
			false,
			RECORD_BYTES,
			byteOffset + 6 * Float32Array.BYTES_PER_ELEMENT,
		);
		gl.bindVertexArray(null);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
	}
}

function configureAttribute(
	gl: WebGL2RenderingContext,
	location: number,
	components: number,
	byteOffset: number,
): void {
	gl.enableVertexAttribArray(location);
	gl.vertexAttribPointer(
		location,
		components,
		gl.FLOAT,
		false,
		RECORD_BYTES,
		byteOffset,
	);
	gl.vertexAttribDivisor(location, 1);
}

interface BuiltTrajectoryGeometry {
	readonly records: Float32Array;
	readonly ranges: readonly TrajectoryDrawRange[];
}

/** Pure renderer-owned curve approximation, exported for focused geometry tests. */
export function buildTrajectoryGeometry(
	trajectory: WorldTrajectoryInput,
): BuiltTrajectoryGeometry {
	const accelerationMagnitude = Math.hypot(...trajectory.acceleration);
	const curvatureScale =
		accelerationMagnitude *
		trajectory.durationSeconds *
		trajectory.durationSeconds;
	const totalSegments = Math.min(
		MAXIMUM_CURVE_SEGMENTS,
		Math.max(
			1,
			Math.ceil(Math.sqrt(curvatureScale / (8 * CURVE_ERROR_METERS))),
		),
	);
	const byScope = new Map<string, number[]>();
	let cumulativeDistance = 0;
	for (const placement of trajectory.placements) {
		const span = placement.endFraction - placement.startFraction;
		const segmentCount = Math.max(1, Math.ceil(totalSegments * span));
		let start = evaluateTrajectory(trajectory, placement.startFraction);
		for (let index = 1; index <= segmentCount; index += 1) {
			const fraction = placement.startFraction + (span * index) / segmentCount;
			const end = evaluateTrajectory(trajectory, fraction);
			const endDistance =
				cumulativeDistance +
				Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
			const records = byScope.get(placement.renderScopeKey) ?? [];
			if (!byScope.has(placement.renderScopeKey))
				byScope.set(placement.renderScopeKey, records);
			records.push(...start, ...end, cumulativeDistance, endDistance);
			cumulativeDistance = endDistance;
			start = end;
		}
	}
	const flat = new Float32Array(
		[...byScope.values()].reduce((count, records) => count + records.length, 0),
	);
	const ranges: TrajectoryDrawRange[] = [];
	let floatOffset = 0;
	for (const [renderScopeKey, records] of byScope) {
		flat.set(records, floatOffset);
		ranges.push({
			renderScopeKey,
			firstInstance: floatOffset / RECORD_FLOATS,
			instanceCount: records.length / RECORD_FLOATS,
		});
		floatOffset += records.length;
	}
	return { records: flat, ranges };
}

function evaluateTrajectory(
	trajectory: WorldTrajectoryInput,
	fraction: number,
): readonly [number, number, number] {
	const seconds = trajectory.durationSeconds * fraction;
	const halfSquared = 0.5 * seconds * seconds;
	return [
		trajectory.origin.x +
			trajectory.velocity[0] * seconds +
			trajectory.acceleration[0] * halfSquared,
		trajectory.origin.y +
			trajectory.velocity[1] * seconds +
			trajectory.acceleration[1] * halfSquared,
		trajectory.origin.z +
			trajectory.velocity[2] * seconds +
			trajectory.acceleration[2] * halfSquared,
	];
}

function createTrajectoryProgram(
	gl: WebGL2RenderingContext,
	portal: boolean,
): TrajectoryProgram {
	const vertex = `#version 300 es
precision highp float;
layout(location = ${START_ATTRIBUTE}) in vec3 aStart;
layout(location = ${END_ATTRIBUTE}) in vec3 aEnd;
layout(location = ${DISTANCE_ATTRIBUTE}) in vec2 aDistance;
uniform mat4 uTrajectoryClipFromAnchor;
uniform vec3 uAnchorOrigin;
uniform vec2 uViewport;
uniform float uLineWidth;
out float vArcDistance;
void main() {
	vec2 corner = vec2(
		gl_VertexID == 0 || gl_VertexID == 1 || gl_VertexID == 4 ? 0.0 : 1.0,
		gl_VertexID == 1 || gl_VertexID == 4 || gl_VertexID == 5 ? 1.0 : -1.0
	);
	vec4 startClip = uTrajectoryClipFromAnchor * vec4(aStart - uAnchorOrigin, 1.0);
	vec4 endClip = uTrajectoryClipFromAnchor * vec4(aEnd - uAnchorOrigin, 1.0);
	vec2 startNdc = startClip.xy / startClip.w;
	vec2 endNdc = endClip.xy / endClip.w;
	vec2 pixelDirection = (endNdc - startNdc) * uViewport;
	vec2 perpendicular = length(pixelDirection) > 0.0001
		? normalize(vec2(-pixelDirection.y, pixelDirection.x))
		: vec2(0.0, 1.0);
	vec4 position = mix(startClip, endClip, corner.x);
	position.xy += perpendicular * corner.y * uLineWidth / uViewport * position.w;
	gl_Position = position;
	vArcDistance = mix(aDistance.x, aDistance.y, corner.x);
}`;
	const fragment = `#version 300 es
precision highp float;
precision highp int;
${portal ? PORTAL_DEFERRED_VISIBILITY_GLSL : ""}
uniform vec4 uColor;
uniform float uDashPeriod;
uniform float uDashDuty;
in float vArcDistance;
out vec4 outColor;
void main() {
	${portal ? "if (!portalDeferredFragmentVisible()) discard;" : ""}
	if (mod(vArcDistance, uDashPeriod) > uDashPeriod * uDashDuty) discard;
	outColor = uColor;
}`;
	const program = linkWebGL2Program(gl, "world trajectory", vertex, fragment);
	return {
		program,
		portal: portal
			? bindWebGL2PortalDeferredVisibilityProgram(gl, program)
			: null,
		uniforms: {
			anchorOrigin: requireWebGL2Uniform(gl, program, "uAnchorOrigin"),
			clipFromAnchor: requireWebGL2Uniform(
				gl,
				program,
				"uTrajectoryClipFromAnchor",
			),
			color: requireWebGL2Uniform(gl, program, "uColor"),
			dashDuty: requireWebGL2Uniform(gl, program, "uDashDuty"),
			dashPeriod: requireWebGL2Uniform(gl, program, "uDashPeriod"),
			lineWidth: requireWebGL2Uniform(gl, program, "uLineWidth"),
			viewport: requireWebGL2Uniform(gl, program, "uViewport"),
		},
	};
}
