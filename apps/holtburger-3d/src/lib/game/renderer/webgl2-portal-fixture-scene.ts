import {
	compileWebGL2Shader,
	requireWebGL2Uniform,
} from "./webgl2-shader-utils";

/** Minimal production-WebGL scene program shared by opt-in portal browser fixtures. */
export interface PortalFixtureSceneProgram {
	readonly color: WebGLUniformLocation;
	readonly depth: WebGLUniformLocation;
	readonly maximum: WebGLUniformLocation;
	readonly minimum: WebGLUniformLocation;
	readonly program: WebGLProgram;
	readonly vertexArray: WebGLVertexArrayObject;
}

/** One rectangle draw using the material-class depth/blend policy under test. */
export interface PortalFixtureSceneDraw {
	readonly color: readonly [number, number, number, number];
	readonly depth: number;
	readonly kind: "additive" | "alpha-test" | "opaque" | "transparent";
	readonly maximum: readonly [number, number];
	readonly minimum: readonly [number, number];
}

/** Draw one fixture rectangle through ordinary WebGL depth and material-class state. */
export function drawPortalFixtureScene(
	gl: WebGL2RenderingContext,
	program: PortalFixtureSceneProgram,
	draw: PortalFixtureSceneDraw,
): void {
	gl.enable(gl.DEPTH_TEST);
	gl.depthFunc(gl.LEQUAL);
	gl.depthMask(draw.kind === "opaque" || draw.kind === "alpha-test");
	if (draw.kind === "opaque" || draw.kind === "alpha-test") {
		gl.disable(gl.BLEND);
	} else {
		gl.enable(gl.BLEND);
		gl.blendFunc(
			draw.kind === "transparent" ? gl.SRC_ALPHA : gl.ONE,
			draw.kind === "transparent" ? gl.ONE_MINUS_SRC_ALPHA : gl.ONE,
		);
	}
	gl.useProgram(program.program);
	gl.uniform4fv(program.color, draw.color);
	gl.uniform1f(program.depth, draw.depth);
	gl.uniform2fv(program.minimum, draw.minimum);
	gl.uniform2fv(program.maximum, draw.maximum);
	gl.bindVertexArray(program.vertexArray);
	gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/** Build the shared fixture-only rectangle program; production pass state remains caller-owned. */
export function createPortalFixtureSceneProgram(
	gl: WebGL2RenderingContext,
): PortalFixtureSceneProgram {
	const vertexArray = requireResource(
		gl.createVertexArray(),
		"portal fixture vertex array",
	);
	let vertex: WebGLShader | null = null;
	let fragment: WebGLShader | null = null;
	let program: WebGLProgram | null = null;
	try {
		vertex = compileWebGL2Shader(
			gl,
			gl.VERTEX_SHADER,
			`#version 300 es
uniform vec2 u_minimum;
uniform vec2 u_maximum;
void main() {
	vec2 corner = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
	gl_Position = vec4(u_minimum + corner * (u_maximum - u_minimum), 0.0, 1.0);
}`,
		);
		fragment = compileWebGL2Shader(
			gl,
			gl.FRAGMENT_SHADER,
			`#version 300 es
precision highp float;
uniform vec4 u_color;
uniform float u_depth;
out vec4 outColor;
void main() {
	if (u_color.a < 0.0) discard;
	outColor = vec4(u_color.rgb, abs(u_color.a));
	gl_FragDepth = u_depth;
}`,
		);
		program = requireResource(
			gl.createProgram(),
			"portal fixture shader program",
		);
		gl.attachShader(program, vertex);
		gl.attachShader(program, fragment);
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			throw new Error(
				`Failed to link portal fixture shader: ${gl.getProgramInfoLog(program) ?? "unknown error"}.`,
			);
		}
		return {
			color: requireWebGL2Uniform(gl, program, "u_color"),
			depth: requireWebGL2Uniform(gl, program, "u_depth"),
			maximum: requireWebGL2Uniform(gl, program, "u_maximum"),
			minimum: requireWebGL2Uniform(gl, program, "u_minimum"),
			program,
			vertexArray,
		};
	} catch (cause) {
		if (program) gl.deleteProgram(program);
		gl.deleteVertexArray(vertexArray);
		throw cause;
	} finally {
		if (fragment) gl.deleteShader(fragment);
		if (vertex) gl.deleteShader(vertex);
	}
}

/** Release every object owned by one fixture scene program. */
export function destroyPortalFixtureSceneProgram(
	gl: WebGL2RenderingContext,
	program: PortalFixtureSceneProgram,
): void {
	gl.deleteProgram(program.program);
	gl.deleteVertexArray(program.vertexArray);
}

export function normalizedFixtureColor(
	color: readonly [number, number, number, number],
): [number, number, number, number] {
	return [color[0] / 255, color[1] / 255, color[2] / 255, color[3] / 255];
}

export function readFixturePixel(
	gl: WebGL2RenderingContext,
	x: number,
	y: number,
): Uint8Array {
	const pixel = new Uint8Array(4);
	gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
	return pixel;
}

export function fixturePixelMatches(
	actual: Uint8Array,
	expected: readonly [number, number, number, number],
): boolean {
	return expected.every(
		(component, index) => Math.abs(actual[index]! - component) <= 2,
	);
}

function requireResource<T>(value: T | null, label: string): T {
	if (value === null) throw new Error(`Failed to create ${label}.`);
	return value;
}
