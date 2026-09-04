import { createLandblockOffset, getLandblockCoordinates } from "../landblocks";
import { mat4ToFloat32Array, multiplyMat4 } from "../math/matrices";
import { Mat4 } from "../math/types";
import type { ObjectGeometryKey } from "../geometry/types";
import type { SceneNodeId } from "../scene";
import type {
	VisibleDynamicContributions,
	VisibleRigidDepthContribution,
} from "../systems/components";
import type { ObjectInstanceData } from "../systems/static-resources";
import {
	compileWebGL2Shader,
	requireWebGL2Uniform,
} from "../webgl/shader-program";
import { retainsRetailGeometry } from "./retail-geometry-visibility";
import { withPreservedWebGL2AllocationBindings } from "./webgl2-render-target";
import {
	WebGL2InstanceBuffer,
	bindWebGL2ObjectInstanceRange,
} from "./webgl2-instance-buffer";
import type { WebGL2GeometryBinding } from "./webgl2-resource-manager";
import type { EntitySelectionTarget } from "./renderer";

const EMPTY_MASK_COLOR = new Float32Array([0, 0, 0, 0]);

const MASK_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 3) in mat4 aSourceToLandblock;

uniform mat4 uClipFromAnchor;
uniform vec3 uLandblockOffset;

void main() {
	vec3 anchorPosition = (aSourceToLandblock * vec4(aPosition, 1.0)).xyz + uLandblockOffset;
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
	readonly contributions: VisibleDynamicContributions;
	readonly height: number;
	readonly nodeId: SceneNodeId;
	readonly shape: EntitySelectionTarget["shape"];
	readonly showRetailHiddenGeometry: boolean;
	readonly width: number;
}

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
	readonly #instances: ObjectInstanceData[] = [];
	readonly #instanceIndices = new Map<ObjectInstanceData, number>();
	readonly #retainedContributions: VisibleRigidDepthContribution[] = [];
	readonly #submittedPartInstances = new Set<ObjectInstanceData>();
	#instanceBuffer: WebGL2InstanceBuffer | null = null;
	#program: WebGL2EntitySelectionProgram | null = null;
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

	/** Draw one depth-independent current-pose mask, allocating nothing for empty geometry. */
	render(input: WebGL2EntitySelectionPassInput): {
		readonly mask: WebGL2EntitySelectionMask;
		readonly work: WebGL2EntitySelectionPassWork;
	} | null {
		this.#requireAlive();
		const visible = input.contributions;
		const retained = this.#retainedContributions;
		retained.length = 0;
		if (input.shape.kind === "rigid" && visible.kind === "visible") {
			for (const contribution of visible.depth) {
				if (
					retainsRetailGeometry(
						contribution.drawUnit.retailVisibility,
						input.showRetailHiddenGeometry,
					)
				) {
					retained.push(contribution);
				}
			}
		}
		if (retained.length === 0 && input.shape.kind === "rigid") return null;

		const target = this.#resizeTarget(input.width, input.height);
		const program = (this.#program ??= createSelectionProgram(this.#gl));
		const instanceBuffer = (this.#instanceBuffer ??= new WebGL2InstanceBuffer(
			this.#gl,
		));
		if (input.shape.kind === "rigid")
			this.#prepareInstances(retained, instanceBuffer);
		else this.#prepareSphereInstance(input.shape, instanceBuffer);
		const work = this.#draw(
			input,
			visible,
			retained,
			target,
			program,
			instanceBuffer,
		);
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
		this.#instanceBuffer?.destroy();
		this.#instanceBuffer = null;
		if (this.#program) this.#gl.deleteProgram(this.#program.program);
		this.#program = null;
		if (this.#sphereGeometry) {
			this.#gl.deleteBuffer(this.#sphereGeometry.indexBuffer);
			this.#gl.deleteBuffer(this.#sphereGeometry.positionBuffer);
			this.#gl.deleteVertexArray(this.#sphereGeometry.vertexArray);
		}
		this.#sphereGeometry = null;
		this.#instances.length = 0;
		this.#instanceIndices.clear();
		this.#retainedContributions.length = 0;
		this.#submittedPartInstances.clear();
	}

	#prepareInstances(
		contributions: readonly VisibleRigidDepthContribution[],
		buffer: WebGL2InstanceBuffer,
	): void {
		this.#instances.length = 0;
		this.#instanceIndices.clear();
		for (const contribution of contributions) {
			if (this.#instanceIndices.has(contribution.instance)) continue;
			this.#instanceIndices.set(contribution.instance, this.#instances.length);
			this.#instances.push(contribution.instance);
		}
		buffer.resetFrame(this.#instances.length);
		buffer.updateRange(0, this.#instances);
	}

	/** Upload the one analytic proxy through the same transform stream as rigid parts. */
	#prepareSphereInstance(
		shape: Extract<
			EntitySelectionTarget["shape"],
			{ readonly kind: "sphere-proxy" }
		>,
		buffer: WebGL2InstanceBuffer,
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
		this.#instances.length = 0;
		this.#instances.push({
			color: { a: 1, b: 1, g: 1, r: 1 },
			sourceToLandblock: this.#sphereToLandblock,
		});
		buffer.resetFrame(1);
		buffer.updateRange(0, this.#instances);
	}

	#draw(
		input: WebGL2EntitySelectionPassInput,
		visible: VisibleDynamicContributions,
		contributions: readonly VisibleRigidDepthContribution[],
		target: WebGL2EntitySelectionTargetSet,
		program: WebGL2EntitySelectionProgram,
		instanceBuffer: WebGL2InstanceBuffer,
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
		const partInstances = this.#submittedPartInstances;
		partInstances.clear();
		let selectedTriangleCount = 0;
		if (contributions.length > 0) {
			if (visible.kind !== "visible")
				throw new Error("Selection rigid geometry lost its visible frame.");
			gl.useProgram(program.program);
			gl.uniformMatrix4fv(
				program.uniforms.clipFromAnchor,
				false,
				mat4ToFloat32Array(input.clipFromAnchor, this.#matrixScratch),
			);
			const landblockOffset = createLandblockOffset(
				getLandblockCoordinates(visible.landblockId),
				input.anchorCoordinates,
			);
			gl.uniform3f(
				program.uniforms.landblockOffset,
				landblockOffset.x,
				landblockOffset.y,
				landblockOffset.z,
			);
		}
		for (const contribution of contributions) {
			const geometry = this.#resources.getGeometry(
				contribution.drawUnit.geometry,
			);
			validateSelectionDrawRange(
				geometry,
				contribution.drawUnit.indexStart,
				contribution.drawUnit.indexCount,
			);
			gl.enable(gl.CULL_FACE);
			gl.cullFace(
				contribution.drawUnit.cullFace === "front" ? gl.FRONT : gl.BACK,
			);
			gl.bindVertexArray(geometry.vertexArray);
			const instanceIndex = this.#instanceIndices.get(contribution.instance);
			if (instanceIndex === undefined) {
				throw new Error(`Selection instance vanished for ${input.nodeId}.`);
			}
			bindWebGL2ObjectInstanceRange(
				gl,
				instanceBuffer.getBinding(),
				instanceIndex,
				1,
			);
			gl.drawElementsInstanced(
				gl.TRIANGLES,
				contribution.drawUnit.indexCount,
				geometry.indexType,
				contribution.drawUnit.indexStart * geometry.indexElementBytes,
				1,
			);
			partInstances.add(contribution.instance);
			selectedTriangleCount += contribution.drawUnit.indexCount / 3;
		}
		const sphereProxyCount = this.#drawSphereProxy(
			input,
			program,
			instanceBuffer,
		);
		gl.bindVertexArray(null);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
		gl.colorMask(true, true, true, true);
		gl.depthMask(true);
		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.LEQUAL);
		return {
			maskDrawCount: contributions.length + sphereProxyCount,
			selectedSphereProxyCount: sphereProxyCount,
			selectedPartCount: partInstances.size,
			selectedTriangleCount,
		};
	}

	/** Draw the runtime-resolved proxy that replaces a planar particle carrier's rigid geometry. */
	#drawSphereProxy(
		input: WebGL2EntitySelectionPassInput,
		program: WebGL2EntitySelectionProgram,
		instanceBuffer: WebGL2InstanceBuffer,
	): number {
		const shape = input.shape;
		if (shape.kind === "rigid") return 0;
		const gl = this.#gl;
		const geometry = (this.#sphereGeometry ??= createSelectionSphere(gl));
		gl.useProgram(program.program);
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
		bindWebGL2ObjectInstanceRange(gl, instanceBuffer.getBinding(), 0, 1);
		gl.drawElementsInstanced(
			gl.TRIANGLES,
			geometry.indexCount,
			gl.UNSIGNED_SHORT,
			0,
			1,
		);
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

function createSelectionProgram(
	gl: WebGL2RenderingContext,
): WebGL2EntitySelectionProgram {
	const vertexShader = compileWebGL2Shader(
		gl,
		gl.VERTEX_SHADER,
		MASK_VERTEX_SHADER,
	);
	const fragmentShader = compileWebGL2Shader(
		gl,
		gl.FRAGMENT_SHADER,
		MASK_FRAGMENT_SHADER,
	);
	const program = gl.createProgram();
	if (!program) {
		gl.deleteShader(vertexShader);
		gl.deleteShader(fragmentShader);
		throw new Error("Failed to allocate entity selection program.");
	}
	try {
		gl.attachShader(program, vertexShader);
		gl.attachShader(program, fragmentShader);
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			throw new Error(
				`Failed to link entity selection program: ${gl.getProgramInfoLog(program) ?? "unknown error"}`,
			);
		}
		return {
			program,
			uniforms: {
				clipFromAnchor: requireWebGL2Uniform(gl, program, "uClipFromAnchor"),
				landblockOffset: requireWebGL2Uniform(gl, program, "uLandblockOffset"),
			},
		};
	} catch (cause) {
		gl.deleteProgram(program);
		throw cause;
	} finally {
		gl.deleteShader(vertexShader);
		gl.deleteShader(fragmentShader);
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

function validateSelectionDrawRange(
	binding: WebGL2GeometryBinding,
	indexStart: number,
	indexCount: number,
): void {
	if (
		!Number.isInteger(indexStart) ||
		!Number.isInteger(indexCount) ||
		indexStart < 0 ||
		indexCount <= 0 ||
		indexStart + indexCount > binding.indexCount
	) {
		throw new Error(
			`Invalid entity selection draw range ${indexStart}+${indexCount}/${binding.indexCount}.`,
		);
	}
}

function requirePositiveInteger(value: number, subject: string): void {
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(`${subject} must be a positive integer.`);
	}
}
