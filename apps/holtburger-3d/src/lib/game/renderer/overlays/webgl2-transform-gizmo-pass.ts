import { mat4ToFloat32Array } from "../../math/matrices";
import type { Mat4, Vec3 } from "../../math/types";
import {
	linkWebGL2Program,
	requireWebGL2Uniform,
} from "../../webgl/shader-program";
import {
	sameTransformGizmoHandle,
	TRANSFORM_GIZMO_GEOMETRY,
	type TransformGizmoAxis,
	type TransformGizmoHandle,
	type TransformGizmoVisual,
} from "./transform-gizmo-contract";

const POSITION_ATTRIBUTE = 0;
const NORMAL_ATTRIBUTE = 1;
const FLOATS_PER_VERTEX = 6;
const BYTES_PER_VERTEX = FLOATS_PER_VERTEX * Float32Array.BYTES_PER_ELEMENT;

const SHAFT_RADIAL_SEGMENTS = 12;
const CONE_RADIAL_SEGMENTS = 16;
const RING_TUBE_SEGMENTS = 8;
const SPHERE_STACKS = 10;
const SPHERE_SLICES = 16;

const AXES: readonly TransformGizmoAxis[] = ["x", "y", "z"];

const ROTATE_HANDLES: readonly TransformGizmoHandle[] = [
	{ kind: "rotate", axis: "x" },
	{ kind: "rotate", axis: "y" },
	{ kind: "rotate", axis: "z" },
];

const TRANSLATE_HANDLES: readonly TransformGizmoHandle[] = [
	{ kind: "translate", axis: "x" },
	{ kind: "translate", axis: "y" },
	{ kind: "translate", axis: "z" },
];

const AXIS_COLORS: Readonly<
	Record<TransformGizmoAxis, readonly [number, number, number]>
> = {
	x: [0.95, 0.27, 0.25],
	y: [0.25, 0.86, 0.36],
	z: [0.27, 0.56, 0.98],
};

const HOVER_TINT: readonly [number, number, number] = [1.0, 0.98, 0.85];

const HOVER_AXIS_COLORS: Readonly<
	Record<TransformGizmoAxis, readonly [number, number, number]>
> = {
	x: [
		AXIS_COLORS.x[0] * 0.55 + HOVER_TINT[0] * 0.45,
		AXIS_COLORS.x[1] * 0.55 + HOVER_TINT[1] * 0.45,
		AXIS_COLORS.x[2] * 0.55 + HOVER_TINT[2] * 0.45,
	],
	y: [
		AXIS_COLORS.y[0] * 0.55 + HOVER_TINT[0] * 0.45,
		AXIS_COLORS.y[1] * 0.55 + HOVER_TINT[1] * 0.45,
		AXIS_COLORS.y[2] * 0.55 + HOVER_TINT[2] * 0.45,
	],
	z: [
		AXIS_COLORS.z[0] * 0.55 + HOVER_TINT[0] * 0.45,
		AXIS_COLORS.z[1] * 0.55 + HOVER_TINT[1] * 0.45,
		AXIS_COLORS.z[2] * 0.55 + HOVER_TINT[2] * 0.45,
	],
};

const CENTER_COLOR: readonly [number, number, number] = [0.92, 0.92, 0.94];
const ACTIVE_COLOR: readonly [number, number, number] = [1.0, 0.88, 0.24];

const IDLE_ALPHA = 0.94;
const DIMMED_ALPHA = 0.32;
const RING_BACK_HEMISPHERE_ALPHA = 0.28;

interface MeshRange {
	readonly firstVertex: number;
	readonly vertexCount: number;
}

interface GizmoMeshLayout {
	readonly center: MeshRange;
	readonly translate: Readonly<Record<TransformGizmoAxis, MeshRange>>;
	readonly rotate: Readonly<Record<TransformGizmoAxis, MeshRange>>;
	readonly vertices: Float32Array;
}

interface GizmoProgram {
	readonly program: WebGLProgram;
	readonly uniforms: {
		readonly clipFromAnchor: WebGLUniformLocation;
		readonly origin: WebGLUniformLocation;
		readonly scale: WebGLUniformLocation;
		readonly color: WebGLUniformLocation;
		readonly viewDir: WebGLUniformLocation;
		readonly ringBackAlpha: WebGLUniformLocation;
	};
}

/**
 * Lazily initialized WebGL2 pass rendering the Explorer 6-DOF transform gizmo.
 *
 * All sub-meshes are baked once into a single static vertex buffer at construction so per-frame
 * rendering allocates zero GPU or JS heap resources. Client mode never constructs this pass.
 */
export class WebGL2TransformGizmoPass {
	readonly #gl: WebGL2RenderingContext;
	readonly #matrix = new Float32Array(16);
	readonly #vertexArray: WebGLVertexArrayObject;
	readonly #vertexBuffer: WebGLBuffer;
	readonly #program: GizmoProgram;
	readonly #layout: GizmoMeshLayout;

	constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl;
		this.#layout = buildGizmoMeshLayout();
		const vertexArray = gl.createVertexArray();
		if (!vertexArray) {
			throw new Error("Failed to allocate transform-gizmo vertex array.");
		}
		const vertexBuffer = gl.createBuffer();
		if (!vertexBuffer) {
			gl.deleteVertexArray(vertexArray);
			throw new Error("Failed to allocate transform-gizmo vertex buffer.");
		}
		this.#vertexArray = vertexArray;
		this.#vertexBuffer = vertexBuffer;

		gl.bindVertexArray(vertexArray);
		gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, this.#layout.vertices, gl.STATIC_DRAW);
		gl.enableVertexAttribArray(POSITION_ATTRIBUTE);
		gl.vertexAttribPointer(
			POSITION_ATTRIBUTE,
			3,
			gl.FLOAT,
			false,
			BYTES_PER_VERTEX,
			0,
		);
		gl.enableVertexAttribArray(NORMAL_ATTRIBUTE);
		gl.vertexAttribPointer(
			NORMAL_ATTRIBUTE,
			3,
			gl.FLOAT,
			false,
			BYTES_PER_VERTEX,
			3 * Float32Array.BYTES_PER_ELEMENT,
		);
		gl.bindVertexArray(null);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);

		try {
			this.#program = createGizmoProgram(gl);
		} catch (error) {
			gl.deleteBuffer(vertexBuffer);
			gl.deleteVertexArray(vertexArray);
			throw error;
		}
	}

	/**
	 * Draw the gizmo at an anchor-relative render `origin` with zero per-frame allocations.
	 */
	draw(
		visual: TransformGizmoVisual,
		origin: Vec3,
		cameraPosition: Vec3,
		clipFromAnchor: Mat4,
	): void {
		if (!Number.isFinite(visual.scale) || visual.scale <= 0) return;

		const gl = this.#gl;
		const uniforms = this.#program.uniforms;
		const viewOffsetX = cameraPosition.x - origin.x;
		const viewOffsetY = cameraPosition.y - origin.y;
		const viewOffsetZ = cameraPosition.z - origin.z;
		const viewLen = Math.hypot(viewOffsetX, viewOffsetY, viewOffsetZ);
		const viewDirX = viewLen > 1e-5 ? viewOffsetX / viewLen : 0;
		const viewDirY = viewLen > 1e-5 ? viewOffsetY / viewLen : 0;
		const viewDirZ = viewLen > 1e-5 ? viewOffsetZ / viewLen : 1;

		gl.useProgram(this.#program.program);
		gl.uniformMatrix4fv(
			uniforms.clipFromAnchor,
			false,
			mat4ToFloat32Array(clipFromAnchor, this.#matrix),
		);
		gl.uniform3f(uniforms.origin, origin.x, origin.y, origin.z);
		gl.uniform1f(uniforms.scale, visual.scale);
		gl.uniform3f(uniforms.viewDir, viewDirX, viewDirY, viewDirZ);

		gl.disable(gl.DEPTH_TEST);
		gl.depthMask(false);
		gl.enable(gl.CULL_FACE);
		gl.cullFace(gl.BACK);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.bindVertexArray(this.#vertexArray);

		const hasActive = visual.active !== null;
		const inactiveAlpha = hasActive ? DIMMED_ALPHA : IDLE_ALPHA;

		// 1. Inactive rotation rings first.
		for (const handle of ROTATE_HANDLES) {
			if (
				sameTransformGizmoHandle(handle, visual.active) ||
				sameTransformGizmoHandle(handle, visual.hovered)
			) {
				continue;
			}
			this.#drawHandle(handle, AXIS_COLORS[handle.axis], inactiveAlpha, true);
		}

		// 2. Inactive translate shafts + cones.
		for (const handle of TRANSLATE_HANDLES) {
			if (
				sameTransformGizmoHandle(handle, visual.active) ||
				sameTransformGizmoHandle(handle, visual.hovered)
			) {
				continue;
			}
			this.#drawHandle(handle, AXIS_COLORS[handle.axis], inactiveAlpha, false);
		}

		// 3. Center origin hub sits beneath hovered/active highlights so highlights stay crisp.
		gl.uniform4f(
			uniforms.color,
			CENTER_COLOR[0],
			CENTER_COLOR[1],
			CENTER_COLOR[2],
			inactiveAlpha,
		);
		gl.uniform1f(uniforms.ringBackAlpha, 1.0);
		gl.drawArrays(
			gl.TRIANGLES,
			this.#layout.center.firstVertex,
			this.#layout.center.vertexCount,
		);

		// 4. Hovered handle (if distinct from active).
		if (
			visual.hovered !== null &&
			!sameTransformGizmoHandle(visual.hovered, visual.active)
		) {
			this.#drawHandle(
				visual.hovered,
				HOVER_AXIS_COLORS[visual.hovered.axis],
				1.0,
				visual.hovered.kind === "rotate",
			);
		}

		// 5. Active dragged handle last (full alpha, no back-hemisphere dimming on rings).
		if (visual.active !== null) {
			this.#drawHandle(visual.active, ACTIVE_COLOR, 1.0, false);
		}

		gl.bindVertexArray(null);
		gl.enable(gl.DEPTH_TEST);
		gl.depthMask(true);
		gl.disable(gl.CULL_FACE);
		gl.disable(gl.BLEND);
	}

	destroy(): void {
		this.#gl.deleteProgram(this.#program.program);
		this.#gl.deleteBuffer(this.#vertexBuffer);
		this.#gl.deleteVertexArray(this.#vertexArray);
	}

	#drawHandle(
		handle: TransformGizmoHandle,
		color: readonly [number, number, number],
		alpha: number,
		dimRingBack: boolean,
	): void {
		const gl = this.#gl;
		const uniforms = this.#program.uniforms;
		const range =
			handle.kind === "rotate"
				? this.#layout.rotate[handle.axis]
				: this.#layout.translate[handle.axis];
		gl.uniform4f(uniforms.color, color[0], color[1], color[2], alpha);
		gl.uniform1f(
			uniforms.ringBackAlpha,
			dimRingBack ? RING_BACK_HEMISPHERE_ALPHA : 1.0,
		);
		gl.drawArrays(gl.TRIANGLES, range.firstVertex, range.vertexCount);
	}
}

interface AxisBasis {
	readonly dir: readonly [number, number, number];
	readonly u: readonly [number, number, number];
	readonly v: readonly [number, number, number];
}

/**
 * Right-handed basis `(u, v, dir)` with `u × v = dir` for each AC world axis in WebGL Y-up space:
 * AC +X (East) -> render +X, AC +Y (North) -> render -Z, AC +Z (Up) -> render +Y.
 */
function axisBasis(axis: TransformGizmoAxis): AxisBasis {
	if (axis === "x") {
		return { dir: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] };
	}
	if (axis === "y") {
		return { dir: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0] };
	}
	return { dir: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] };
}

function buildGizmoMeshLayout(): GizmoMeshLayout {
	const data: number[] = [];
	const pushVertex = (
		px: number,
		py: number,
		pz: number,
		nx: number,
		ny: number,
		nz: number,
	): void => {
		data.push(px, py, pz, nx, ny, nz);
	};

	const recordRange = (build: () => void): MeshRange => {
		const firstVertex = data.length / FLOATS_PER_VERTEX;
		build();
		const vertexCount = data.length / FLOATS_PER_VERTEX - firstVertex;
		return { firstVertex, vertexCount };
	};

	const center = recordRange(() => {
		appendSphere(
			pushVertex,
			TRANSFORM_GIZMO_GEOMETRY.centerRadius,
			SPHERE_STACKS,
			SPHERE_SLICES,
		);
	});

	const translateRanges: Record<TransformGizmoAxis, MeshRange> = {
		x: { firstVertex: 0, vertexCount: 0 },
		y: { firstVertex: 0, vertexCount: 0 },
		z: { firstVertex: 0, vertexCount: 0 },
	};
	for (const axis of AXES) {
		const basis = axisBasis(axis);
		translateRanges[axis] = recordRange(() => {
			appendCylinder(
				pushVertex,
				basis,
				TRANSFORM_GIZMO_GEOMETRY.shaftStart,
				TRANSFORM_GIZMO_GEOMETRY.shaftEnd,
				TRANSFORM_GIZMO_GEOMETRY.shaftRadius,
				SHAFT_RADIAL_SEGMENTS,
			);
			appendCone(
				pushVertex,
				basis,
				TRANSFORM_GIZMO_GEOMETRY.coneStart,
				TRANSFORM_GIZMO_GEOMETRY.coneEnd,
				TRANSFORM_GIZMO_GEOMETRY.coneRadius,
				CONE_RADIAL_SEGMENTS,
			);
		});
	}

	const rotateRanges: Record<TransformGizmoAxis, MeshRange> = {
		x: { firstVertex: 0, vertexCount: 0 },
		y: { firstVertex: 0, vertexCount: 0 },
		z: { firstVertex: 0, vertexCount: 0 },
	};
	for (const axis of AXES) {
		const basis = axisBasis(axis);
		rotateRanges[axis] = recordRange(() => {
			appendTorus(
				pushVertex,
				basis,
				TRANSFORM_GIZMO_GEOMETRY.ringRadius,
				TRANSFORM_GIZMO_GEOMETRY.ringTubeRadius,
				TRANSFORM_GIZMO_GEOMETRY.ringSegments,
				RING_TUBE_SEGMENTS,
			);
		});
	}

	return {
		center,
		translate: translateRanges,
		rotate: rotateRanges,
		vertices: new Float32Array(data),
	};
}

type VertexPusher = (
	px: number,
	py: number,
	pz: number,
	nx: number,
	ny: number,
	nz: number,
) => void;

function appendSphere(
	push: VertexPusher,
	radius: number,
	stacks: number,
	slices: number,
): void {
	const point = (
		phi: number,
		theta: number,
	): readonly [number, number, number] => [
		Math.cos(phi) * Math.cos(theta),
		Math.sin(phi),
		Math.cos(phi) * Math.sin(theta),
	];
	for (let s = 0; s < stacks; s += 1) {
		const phi0 = -Math.PI / 2 + (s / stacks) * Math.PI;
		const phi1 = -Math.PI / 2 + ((s + 1) / stacks) * Math.PI;
		for (let i = 0; i < slices; i += 1) {
			const t0 = (i / slices) * Math.PI * 2;
			const t1 = ((i + 1) / slices) * Math.PI * 2;
			const n00 = point(phi0, t0);
			const n10 = point(phi1, t0);
			const n11 = point(phi1, t1);
			const n01 = point(phi0, t1);
			const emit = (n: readonly [number, number, number]) =>
				push(n[0] * radius, n[1] * radius, n[2] * radius, n[0], n[1], n[2]);
			emit(n00);
			emit(n10);
			emit(n11);
			emit(n00);
			emit(n11);
			emit(n01);
		}
	}
}

function appendCylinder(
	push: VertexPusher,
	basis: AxisBasis,
	start: number,
	end: number,
	radius: number,
	segments: number,
): void {
	const { dir, u, v } = basis;
	for (let i = 0; i < segments; i += 1) {
		const a0 = (i / segments) * Math.PI * 2;
		const a1 = ((i + 1) / segments) * Math.PI * 2;
		const c0 = Math.cos(a0);
		const s0 = Math.sin(a0);
		const c1 = Math.cos(a1);
		const s1 = Math.sin(a1);
		const n0x = c0 * u[0] + s0 * v[0];
		const n0y = c0 * u[1] + s0 * v[1];
		const n0z = c0 * u[2] + s0 * v[2];
		const n1x = c1 * u[0] + s1 * v[0];
		const n1y = c1 * u[1] + s1 * v[1];
		const n1z = c1 * u[2] + s1 * v[2];

		const p00x = dir[0] * start + n0x * radius;
		const p00y = dir[1] * start + n0y * radius;
		const p00z = dir[2] * start + n0z * radius;
		const p01x = dir[0] * start + n1x * radius;
		const p01y = dir[1] * start + n1y * radius;
		const p01z = dir[2] * start + n1z * radius;
		const p10x = dir[0] * end + n0x * radius;
		const p10y = dir[1] * end + n0y * radius;
		const p10z = dir[2] * end + n0z * radius;
		const p11x = dir[0] * end + n1x * radius;
		const p11y = dir[1] * end + n1y * radius;
		const p11z = dir[2] * end + n1z * radius;

		push(p00x, p00y, p00z, n0x, n0y, n0z);
		push(p01x, p01y, p01z, n1x, n1y, n1z);
		push(p11x, p11y, p11z, n1x, n1y, n1z);

		push(p00x, p00y, p00z, n0x, n0y, n0z);
		push(p11x, p11y, p11z, n1x, n1y, n1z);
		push(p10x, p10y, p10z, n0x, n0y, n0z);
	}
}

function appendCone(
	push: VertexPusher,
	basis: AxisBasis,
	base: number,
	tip: number,
	radius: number,
	segments: number,
): void {
	const { dir, u, v } = basis;
	const height = tip - base;
	const slopeLen = Math.hypot(height, radius);
	const radialWeight = height / slopeLen;
	const axialWeight = radius / slopeLen;
	const tipX = dir[0] * tip;
	const tipY = dir[1] * tip;
	const tipZ = dir[2] * tip;
	const baseCenterX = dir[0] * base;
	const baseCenterY = dir[1] * base;
	const baseCenterZ = dir[2] * base;

	for (let i = 0; i < segments; i += 1) {
		const a0 = (i / segments) * Math.PI * 2;
		const a1 = ((i + 1) / segments) * Math.PI * 2;
		const aMid = (a0 + a1) * 0.5;
		const r0x = Math.cos(a0) * u[0] + Math.sin(a0) * v[0];
		const r0y = Math.cos(a0) * u[1] + Math.sin(a0) * v[1];
		const r0z = Math.cos(a0) * u[2] + Math.sin(a0) * v[2];
		const r1x = Math.cos(a1) * u[0] + Math.sin(a1) * v[0];
		const r1y = Math.cos(a1) * u[1] + Math.sin(a1) * v[1];
		const r1z = Math.cos(a1) * u[2] + Math.sin(a1) * v[2];
		const rmX = Math.cos(aMid) * u[0] + Math.sin(aMid) * v[0];
		const rmY = Math.cos(aMid) * u[1] + Math.sin(aMid) * v[1];
		const rmZ = Math.cos(aMid) * u[2] + Math.sin(aMid) * v[2];

		const n0x = r0x * radialWeight + dir[0] * axialWeight;
		const n0y = r0y * radialWeight + dir[1] * axialWeight;
		const n0z = r0z * radialWeight + dir[2] * axialWeight;
		const n1x = r1x * radialWeight + dir[0] * axialWeight;
		const n1y = r1y * radialWeight + dir[1] * axialWeight;
		const n1z = r1z * radialWeight + dir[2] * axialWeight;
		const nmX = rmX * radialWeight + dir[0] * axialWeight;
		const nmY = rmY * radialWeight + dir[1] * axialWeight;
		const nmZ = rmZ * radialWeight + dir[2] * axialWeight;

		const b0x = baseCenterX + r0x * radius;
		const b0y = baseCenterY + r0y * radius;
		const b0z = baseCenterZ + r0z * radius;
		const b1x = baseCenterX + r1x * radius;
		const b1y = baseCenterY + r1y * radius;
		const b1z = baseCenterZ + r1z * radius;

		// Cone side triangle.
		push(b0x, b0y, b0z, n0x, n0y, n0z);
		push(b1x, b1y, b1z, n1x, n1y, n1z);
		push(tipX, tipY, tipZ, nmX, nmY, nmZ);

		// Cone base cap (outward normal is -dir).
		push(baseCenterX, baseCenterY, baseCenterZ, -dir[0], -dir[1], -dir[2]);
		push(b1x, b1y, b1z, -dir[0], -dir[1], -dir[2]);
		push(b0x, b0y, b0z, -dir[0], -dir[1], -dir[2]);
	}
}

function appendTorus(
	push: VertexPusher,
	basis: AxisBasis,
	majorRadius: number,
	minorRadius: number,
	majorSegments: number,
	minorSegments: number,
): void {
	const { dir, u, v } = basis;
	const emit = (theta: number, phi: number): void => {
		const ct = Math.cos(theta);
		const st = Math.sin(theta);
		const cp = Math.cos(phi);
		const sp = Math.sin(phi);
		const radX = ct * u[0] + st * v[0];
		const radY = ct * u[1] + st * v[1];
		const radZ = ct * u[2] + st * v[2];
		const nx = cp * radX + sp * dir[0];
		const ny = cp * radY + sp * dir[1];
		const nz = cp * radZ + sp * dir[2];
		push(
			radX * majorRadius + nx * minorRadius,
			radY * majorRadius + ny * minorRadius,
			radZ * majorRadius + nz * minorRadius,
			nx,
			ny,
			nz,
		);
	};

	for (let i = 0; i < majorSegments; i += 1) {
		const t0 = (i / majorSegments) * Math.PI * 2;
		const t1 = ((i + 1) / majorSegments) * Math.PI * 2;
		for (let j = 0; j < minorSegments; j += 1) {
			const p0 = (j / minorSegments) * Math.PI * 2;
			const p1 = ((j + 1) / minorSegments) * Math.PI * 2;
			emit(t0, p0);
			emit(t1, p0);
			emit(t1, p1);
			emit(t0, p0);
			emit(t1, p1);
			emit(t0, p1);
		}
	}
}

function createGizmoProgram(gl: WebGL2RenderingContext): GizmoProgram {
	const vertex = `#version 300 es
precision highp float;
layout(location = ${POSITION_ATTRIBUTE}) in vec3 aPosition;
layout(location = ${NORMAL_ATTRIBUTE}) in vec3 aNormal;
uniform mat4 uClipFromAnchor;
uniform vec3 uOrigin;
uniform float uScale;
out vec3 vLocalOffset;
out vec3 vNormal;
void main() {
	vLocalOffset = aPosition;
	vNormal = aNormal;
	vec3 worldPos = uOrigin + aPosition * uScale;
	gl_Position = uClipFromAnchor * vec4(worldPos, 1.0);
}`;
	const fragment = `#version 300 es
precision highp float;
uniform vec4 uColor;
uniform vec3 uViewDir;
uniform float uRingBackAlpha;
in vec3 vLocalOffset;
in vec3 vNormal;
out vec4 outColor;
void main() {
	vec3 n = normalize(vNormal);
	float shade = 0.62 + 0.38 * abs(dot(n, uViewDir));
	float frontMix = smoothstep(-0.10, 0.04, dot(vLocalOffset, uViewDir));
	float alpha = uColor.a * mix(uRingBackAlpha, 1.0, frontMix);
	outColor = vec4(uColor.rgb * shade, alpha);
}`;
	const program = linkWebGL2Program(gl, "transform gizmo", vertex, fragment);
	return {
		program,
		uniforms: {
			clipFromAnchor: requireWebGL2Uniform(gl, program, "uClipFromAnchor"),
			origin: requireWebGL2Uniform(gl, program, "uOrigin"),
			scale: requireWebGL2Uniform(gl, program, "uScale"),
			color: requireWebGL2Uniform(gl, program, "uColor"),
			viewDir: requireWebGL2Uniform(gl, program, "uViewDir"),
			ringBackAlpha: requireWebGL2Uniform(gl, program, "uRingBackAlpha"),
		},
	};
}
