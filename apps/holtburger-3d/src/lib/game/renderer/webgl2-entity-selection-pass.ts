import { createLandblockOffset, getLandblockCoordinates } from "../landblocks";
import { mat4ToFloat32Array, multiplyMat4 } from "../math/matrices";
import { Mat4 } from "../math/types";
import type { ObjectGeometryKey } from "../geometry/types";
import type { SceneNodeId } from "../scene";
import type { PreparedDynamicDepth } from "./dynamic-depth-preparation";
import type { WebGL2DynamicPosePages } from "./webgl2-dynamic-pose-pages";
import type { WebGL2GeometryBinding } from "./webgl2-resource-manager";
import type { EntitySelectionTarget } from "./renderer";
import {
	linkWebGL2Program,
	requireWebGL2Uniform,
} from "../webgl/shader-program";
import { withPreservedWebGL2AllocationBindings } from "./webgl2-render-target";
import { DYNAMIC_POSE_GLSL } from "./dynamic-pose-shader";

const EMPTY_MASK_COLOR = new Float32Array([0, 0, 0, 0]);
const MASK_RIGID_VERTEX_SHADER = `#version 300 es
precision highp float;
precision highp int;
layout(location = 0) in vec3 aPosition;
layout(location = 3) in uint aPartSelector;

${DYNAMIC_POSE_GLSL}
uniform mat4 uClipFromAnchor;
uniform vec3 uLandblockOffset;

void main() {
	mat4 sourceToLandblock = dynamicSourceToLandblock(aPartSelector);
	vec3 anchorPosition = (sourceToLandblock * vec4(aPosition, 1.0)).xyz + uLandblockOffset;
	gl_Position = uClipFromAnchor * vec4(anchorPosition, 1.0);
}
`;

const MASK_SPHERE_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 aPosition;

uniform mat4 uSourceToLandblock;
uniform mat4 uClipFromAnchor;
uniform vec3 uLandblockOffset;

void main() {
	vec3 anchorPosition = (uSourceToLandblock * vec4(aPosition, 1.0)).xyz + uLandblockOffset;
	gl_Position = uClipFromAnchor * vec4(anchorPosition, 1.0);
}
`;

const MASK_FRAGMENT_SHADER = `#version 300 es
precision highp float;

layout(location = 0) out float outMask;

void main() {
	outMask = 1.0;
}
`;

/** Texture sampled by the sole fullscreen presenter after one current-pose mask draw. */
export interface WebGL2EntitySelectionMask {
	readonly texture: WebGLTexture;
	readonly width: number;
	readonly height: number;
}

/** Exact selected-geometry work submitted by one frame. */
export interface WebGL2EntitySelectionPassWork {
	readonly maskDrawCount: number;
	readonly selectedSphereProxyCount: number;
	readonly selectedPartCount: number;
	readonly selectedTriangleCount: number;
}

/** Lifetime storage facts exposed through renderer diagnostics. */
export interface WebGL2EntitySelectionPassDiagnostics {
	readonly activeMaskBytes: number;
	readonly allocatedTargetGenerationCount: number;
	readonly disposedTargetGenerationCount: number;
}

/** Current primary-view and dynamic-pose facts required by the x-ray mask pass. */
export interface WebGL2EntitySelectionPassInput {
	readonly anchorCoordinates: { readonly x: number; readonly y: number };
	readonly clipFromAnchor: Mat4;
	/** Geometry eligibility is resolved once before any view executes. */
	readonly selection: PreparedEntitySelection;
	readonly height: number;
	readonly width: number;
}

/** One frame's selected geometry, shared by all camera masks until the next preparation. */
export type PreparedEntitySelection =
	| ({ readonly kind: "rigid" } & PreparedDynamicDepth)
	| {
			/** Analytic proxy uses its own transform and has no rigid pose rows. */
			readonly kind: "sphere-proxy";
			/** Root identity shared with the selection target. */
			readonly nodeId: SceneNodeId;
			/** Runtime-resolved geometry for planar particle carriers. */
			readonly shape: Extract<
				EntitySelectionTarget["shape"],
				{ kind: "sphere-proxy" }
			>;
	  };

interface WebGL2EntitySelectionProgram {
	readonly program: WebGLProgram;
	readonly uniforms: {
		readonly clipFromAnchor: WebGLUniformLocation;
		readonly landblockOffset: WebGLUniformLocation;
	};
}

interface WebGL2EntitySelectionSphereGeometry {
	readonly indexBuffer: WebGLBuffer;
	readonly indexCount: number;
	readonly positionBuffer: WebGLBuffer;
	readonly vertexArray: WebGLVertexArrayObject;
}

interface WebGL2EntitySelectionTargetSet extends WebGL2EntitySelectionMask {
	readonly framebuffer: WebGLFramebuffer;
}

interface EntitySelectionGeometryResources {
	readonly getGeometry: (key: ObjectGeometryKey) => WebGL2GeometryBinding;
	/** Every rigid mask reads an address uploaded by the renderer before view execution. */
	readonly getPose: WebGL2DynamicPosePages<SceneNodeId>["get"];
}

/**
 * Material-free current-pose mask pass for one selected dynamic root.
 *
 * It deliberately ignores scene depth and portal routing: the final presenter consumes only the
 * mask's outer edge, so the selected entity's ordinary interior, materials, and depth remain intact.
 */
export class WebGL2EntitySelectionPass {
	readonly #gl: WebGL2RenderingContext;
	readonly #resources: EntitySelectionGeometryResources;
	readonly #matrixScratch = new Float32Array(16);
	readonly #sphereLocalTransform = Mat4.identity();
	readonly #sphereToLandblock = Mat4.identity();
	/** Merged rigid vertices read the shared pose page using their integer selector. */
	#rigidProgram:
		| (WebGL2EntitySelectionProgram & {
				readonly poses: WebGLUniformLocation;
				readonly firstPoseRow: WebGLUniformLocation;
		  })
		| null = null;
	/** Analytic proxies use a uniform transform and do not consume a rigid pose row. */
	#sphereProgram:
		| (WebGL2EntitySelectionProgram & {
				readonly sourceToLandblock: WebGLUniformLocation;
		  })
		| null = null;
	#sphereGeometry: WebGL2EntitySelectionSphereGeometry | null = null;
	#target: WebGL2EntitySelectionTargetSet | null = null;
	#allocatedTargetGenerationCount = 0;
	#disposedTargetGenerationCount = 0;
	#destroyed = false;

	constructor(
		gl: WebGL2RenderingContext,
		resources: EntitySelectionGeometryResources,
	) {
		this.#gl = gl;
		this.#resources = resources;
	}

	/** Resolve the proxy/rigid choice over frame-cached depth geometry without GPU work. */
	prepare(
		target: EntitySelectionTarget,
		depth: PreparedDynamicDepth | null,
	): PreparedEntitySelection | null {
		this.#requireAlive();
		if (target.shape.kind === "sphere-proxy")
			return {
				kind: "sphere-proxy",
				nodeId: target.nodeId,
				shape: target.shape,
			};
		return depth === null ? null : { kind: "rigid", ...depth };
	}

	/** Draw one previously prepared depth-independent current-pose mask. */
	render(input: WebGL2EntitySelectionPassInput): {
		readonly mask: WebGL2EntitySelectionMask;
		readonly work: WebGL2EntitySelectionPassWork;
	} {
		this.#requireAlive();
		const target = this.#resizeTarget(input.width, input.height);
		const work = this.#draw(input, target);
		return {
			mask: {
				height: target.height,
				texture: target.texture,
				width: target.width,
			},
			work,
		};
	}

	getDiagnostics(): WebGL2EntitySelectionPassDiagnostics {
		return {
			activeMaskBytes:
				this.#target === null ? 0 : this.#target.width * this.#target.height,
			allocatedTargetGenerationCount: this.#allocatedTargetGenerationCount,
			disposedTargetGenerationCount: this.#disposedTargetGenerationCount,
		};
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#releaseTarget();
		if (this.#rigidProgram) this.#gl.deleteProgram(this.#rigidProgram.program);
		if (this.#sphereProgram)
			this.#gl.deleteProgram(this.#sphereProgram.program);
		this.#rigidProgram = null;
		this.#sphereProgram = null;
		if (this.#sphereGeometry) {
			this.#gl.deleteBuffer(this.#sphereGeometry.indexBuffer);
			this.#gl.deleteBuffer(this.#sphereGeometry.positionBuffer);
			this.#gl.deleteVertexArray(this.#sphereGeometry.vertexArray);
		}
		this.#sphereGeometry = null;
	}

	/** Compose the analytic proxy independently from rigid entity pose pages. */
	#prepareSphereTransform(
		shape: Extract<
			EntitySelectionTarget["shape"],
			{ readonly kind: "sphere-proxy" }
		>,
	): void {
		const local = this.#sphereLocalTransform;
		local.m11 = shape.sphere.radius;
		local.m22 = shape.sphere.radius;
		local.m33 = shape.sphere.radius;
		local.m41 = shape.sphere.center.x;
		local.m42 = shape.sphere.center.y;
		local.m43 = shape.sphere.center.z;
		multiplyMat4(
			shape.placement.localToLandblock,
			local,
			this.#sphereToLandblock,
		);
	}

	#draw(
		input: WebGL2EntitySelectionPassInput,
		target: WebGL2EntitySelectionTargetSet,
	): WebGL2EntitySelectionPassWork {
		const gl = this.#gl;
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target.framebuffer);
		gl.viewport(0, 0, target.width, target.height);
		gl.colorMask(true, false, false, false);
		gl.depthMask(false);
		gl.disable(gl.DEPTH_TEST);
		gl.disable(gl.BLEND);
		gl.disable(gl.SCISSOR_TEST);
		gl.disable(gl.STENCIL_TEST);
		gl.clearBufferfv(gl.COLOR, 0, EMPTY_MASK_COLOR);
		const selection = input.selection;
		if (selection.kind === "rigid") {
			const program = (this.#rigidProgram ??= createSelectionProgram(
				gl,
				MASK_RIGID_VERTEX_SHADER,
				(program) => ({
					poses: requireWebGL2Uniform(gl, program, "uPoses"),
					firstPoseRow: requireWebGL2Uniform(gl, program, "uFirstPoseRow"),
				}),
			));
			gl.useProgram(program.program);
			gl.uniformMatrix4fv(
				program.uniforms.clipFromAnchor,
				false,
				mat4ToFloat32Array(input.clipFromAnchor, this.#matrixScratch),
			);
			const landblockOffset = createLandblockOffset(
				getLandblockCoordinates(selection.landblockId),
				input.anchorCoordinates,
			);
			gl.uniform3f(
				program.uniforms.landblockOffset,
				landblockOffset.x,
				landblockOffset.y,
				landblockOffset.z,
			);
			const pose = this.#resources.getPose(selection.nodeId);
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, pose.texture);
			gl.bindSampler(0, null);
			gl.uniform1i(program.poses, 0);
			gl.uniform1i(program.firstPoseRow, pose.firstRow);
			const geometry = this.#resources.getGeometry(selection.geometry);
			gl.bindVertexArray(geometry.vertexArray);
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, selection.appearance.indexBuffer);
			gl.enable(gl.CULL_FACE);
			for (const range of selection.ranges) {
				gl.cullFace(range.cullFace === "front" ? gl.FRONT : gl.BACK);
				gl.drawElements(
					gl.TRIANGLES,
					range.indexCount,
					gl.UNSIGNED_INT,
					range.indexStart * Uint32Array.BYTES_PER_ELEMENT,
				);
			}
		}
		const sphereProxyCount = this.#drawSphereProxy(input);
		gl.bindVertexArray(null);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
		gl.colorMask(true, true, true, true);
		gl.depthMask(true);
		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.LEQUAL);
		return {
			maskDrawCount:
				selection.kind === "rigid" ? selection.ranges.length : sphereProxyCount,
			selectedSphereProxyCount: sphereProxyCount,
			selectedPartCount:
				selection.kind === "rigid" ? selection.selectedPartCount : 0,
			selectedTriangleCount:
				selection.kind === "rigid" ? selection.selectedTriangleCount : 0,
		};
	}

	/** Draw the runtime-resolved proxy that replaces a planar particle carrier's rigid geometry. */
	#drawSphereProxy(input: WebGL2EntitySelectionPassInput): number {
		if (input.selection.kind === "rigid") return 0;
		const shape = input.selection.shape;
		const gl = this.#gl;
		const program = (this.#sphereProgram ??= createSelectionProgram(
			gl,
			MASK_SPHERE_VERTEX_SHADER,
			(program) => ({
				sourceToLandblock: requireWebGL2Uniform(
					gl,
					program,
					"uSourceToLandblock",
				),
			}),
		));
		const geometry = (this.#sphereGeometry ??= createSelectionSphere(gl));
		gl.useProgram(program.program);
		this.#prepareSphereTransform(shape);
		gl.uniformMatrix4fv(
			program.sourceToLandblock,
			false,
			mat4ToFloat32Array(this.#sphereToLandblock, this.#matrixScratch),
		);
		gl.uniformMatrix4fv(
			program.uniforms.clipFromAnchor,
			false,
			mat4ToFloat32Array(input.clipFromAnchor, this.#matrixScratch),
		);
		const landblockOffset = createLandblockOffset(
			getLandblockCoordinates(shape.placement.landblockId),
			input.anchorCoordinates,
		);
		gl.uniform3f(
			program.uniforms.landblockOffset,
			landblockOffset.x,
			landblockOffset.y,
			landblockOffset.z,
		);
		gl.enable(gl.CULL_FACE);
		gl.cullFace(gl.BACK);
		gl.bindVertexArray(geometry.vertexArray);
		gl.drawElements(gl.TRIANGLES, geometry.indexCount, gl.UNSIGNED_SHORT, 0);
		return 1;
	}

	#resizeTarget(width: number, height: number): WebGL2EntitySelectionTargetSet {
		requirePositiveInteger(width, "Selection mask width");
		requirePositiveInteger(height, "Selection mask height");
		if (this.#target?.width === width && this.#target.height === height) {
			return this.#target;
		}
		const replacement = allocateSelectionTarget(this.#gl, width, height);
		this.#releaseTarget();
		this.#target = replacement;
		this.#allocatedTargetGenerationCount += 1;
		return replacement;
	}

	#releaseTarget(): void {
		const target = this.#target;
		if (target === null) return;
		this.#target = null;
		this.#gl.deleteFramebuffer(target.framebuffer);
		this.#gl.deleteTexture(target.texture);
		this.#disposedTargetGenerationCount += 1;
	}

	#requireAlive(): void {
		if (this.#destroyed) throw new Error("Entity selection pass is destroyed.");
	}
}

function allocateSelectionTarget(
	gl: WebGL2RenderingContext,
	width: number,
	height: number,
): WebGL2EntitySelectionTargetSet {
	return withPreservedWebGL2AllocationBindings(gl, () => {
		const texture = gl.createTexture();
		if (!texture)
			throw new Error("Failed to allocate entity selection texture.");
		const framebuffer = gl.createFramebuffer();
		if (!framebuffer) {
			gl.deleteTexture(texture);
			throw new Error("Failed to allocate entity selection framebuffer.");
		}
		try {
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, width, height);
			gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
			gl.framebufferTexture2D(
				gl.FRAMEBUFFER,
				gl.COLOR_ATTACHMENT0,
				gl.TEXTURE_2D,
				texture,
				0,
			);
			const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
			if (status !== gl.FRAMEBUFFER_COMPLETE) {
				throw new Error(
					`Entity selection framebuffer is incomplete with status ${status}.`,
				);
			}
			return { framebuffer, height, texture, width };
		} catch (cause) {
			gl.deleteFramebuffer(framebuffer);
			gl.deleteTexture(texture);
			throw cause;
		}
	});
}

function createSelectionProgram<T extends Record<string, WebGLUniformLocation>>(
	gl: WebGL2RenderingContext,
	vertexSource: string,
	resolveTransformUniforms: (program: WebGLProgram) => T,
): WebGL2EntitySelectionProgram & T {
	const program = linkWebGL2Program(
		gl,
		"entity selection",
		vertexSource,
		MASK_FRAGMENT_SHADER,
	);
	try {
		return {
			...resolveTransformUniforms(program),
			program,
			uniforms: {
				clipFromAnchor: requireWebGL2Uniform(gl, program, "uClipFromAnchor"),
				landblockOffset: requireWebGL2Uniform(gl, program, "uLandblockOffset"),
			},
		};
	} catch (cause) {
		gl.deleteProgram(program);
		throw cause;
	}
}

/** Build one modest unit sphere; the selection pass needs its silhouette, not surface fidelity. */
function createSelectionSphere(
	gl: WebGL2RenderingContext,
): WebGL2EntitySelectionSphereGeometry {
	return withPreservedWebGL2AllocationBindings(gl, () => {
		const latitudeSegments = 8;
		const longitudeSegments = 16;
		const positions: number[] = [];
		const indices: number[] = [];
		for (let latitude = 0; latitude <= latitudeSegments; latitude += 1) {
			const phi = (latitude / latitudeSegments - 0.5) * Math.PI;
			const ringRadius = Math.cos(phi);
			const y = Math.sin(phi);
			for (let longitude = 0; longitude <= longitudeSegments; longitude += 1) {
				const theta = (longitude / longitudeSegments) * Math.PI * 2;
				positions.push(
					Math.cos(theta) * ringRadius,
					y,
					Math.sin(theta) * ringRadius,
				);
			}
		}
		const stride = longitudeSegments + 1;
		for (let latitude = 0; latitude < latitudeSegments; latitude += 1) {
			for (let longitude = 0; longitude < longitudeSegments; longitude += 1) {
				const lowerLeft = latitude * stride + longitude;
				const upperLeft = lowerLeft + stride;
				indices.push(
					lowerLeft,
					upperLeft,
					lowerLeft + 1,
					lowerLeft + 1,
					upperLeft,
					upperLeft + 1,
				);
			}
		}
		const vertexArray = gl.createVertexArray();
		const positionBuffer = gl.createBuffer();
		const indexBuffer = gl.createBuffer();
		if (!vertexArray || !positionBuffer || !indexBuffer) {
			if (vertexArray) gl.deleteVertexArray(vertexArray);
			if (positionBuffer) gl.deleteBuffer(positionBuffer);
			if (indexBuffer) gl.deleteBuffer(indexBuffer);
			throw new Error("Failed to allocate entity-selection sphere.");
		}
		gl.bindVertexArray(vertexArray);
		gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
		gl.bufferData(
			gl.ELEMENT_ARRAY_BUFFER,
			new Uint16Array(indices),
			gl.STATIC_DRAW,
		);
		return {
			indexBuffer,
			indexCount: indices.length,
			positionBuffer,
			vertexArray,
		};
	});
}

function requirePositiveInteger(value: number, subject: string): void {
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(`${subject} must be a positive integer.`);
	}
}
