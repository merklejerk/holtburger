import type { NormalizedRgbaColor } from "../../../frontend-color";
import type { Vec3 } from "../../math/types";
import {
	linkWebGL2Program,
	requireWebGL2Uniform,
} from "../../webgl/shader-program";
import {
	bindWebGL2PortalDeferredVisibilityInstanceProgram,
	PORTAL_DEFERRED_VISIBILITY_INSTANCE_GLSL,
} from "../portal/portal-deferred-visibility-glsl";
import type { EntityBeaconSettings } from "./entity-beacon-policy";
import type { EntityOverlayInstanceScopeRouting } from "./webgl2-entity-overlay-pass";

const VERTEX_ATTRIBUTE = 0;
const BASE_ATTRIBUTE = 1;
const HEIGHT_ATTRIBUTE = 2;
const RADIUS_ATTRIBUTE = 3;
const PORTAL_DOMAIN_ATTRIBUTE = 4;
const COLOR_ATTRIBUTE = 5;
const INSTANCE_FLOATS = 10;
const INSTANCE_STRIDE_BYTES = INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
const CYLINDER_SEGMENT_COUNT = 32;
export const BEACON_CYLINDER_VERTEX_COUNT = CYLINDER_SEGMENT_COUNT * 6;
export const BEACON_BASE_VERTEX_COUNT = 6;

const INSTANCE_ATTRIBUTES = [
	[BASE_ATTRIBUTE, 3, 0],
	[HEIGHT_ATTRIBUTE, 1, 3],
	[RADIUS_ATTRIBUTE, 1, 4],
	[PORTAL_DOMAIN_ATTRIBUTE, 1, 5],
	[COLOR_ATTRIBUTE, 4, 6],
] as const;

/** One depth-tested in-scene 3D hollow cylinder beacon submitted to the GPU pass. */
export interface EntityBeaconDrawInstance {
	/** Anchor-relative entity base center. */
	readonly base: Vec3;
	/** Vertical cylinder height in world meters. */
	readonly height: number;
	/** Horizontal cylinder and glowing base-disc radius in world meters. */
	readonly radius: number;
	/** Optional per-instance RGBA color override; null/undefined uses the theme alert color. */
	readonly color?: NormalizedRgbaColor | null;
}

export interface EntityBeaconScopedDrawInstance extends EntityBeaconDrawInstance {
	/** Admitted portal visibility domain for this ordered instance. */
	readonly renderScopeKey: string;
}

export interface EntityBeaconDrawContext {
	readonly clipFromAnchor: Float32Array;
	readonly cameraPosition: Vec3;
	readonly cameraRight: readonly [number, number, number];
	readonly viewportWidth: number;
	readonly viewportHeight: number;
	readonly renderScale: number;
	readonly timeSeconds: number;
	readonly settings: EntityBeaconSettings;
}

interface BeaconCylinderProgram {
	readonly program: WebGLProgram;
	readonly uniforms: {
		readonly clipFromAnchor: WebGLUniformLocation;
		readonly cameraPosition: WebGLUniformLocation;
		readonly cameraRight: WebGLUniformLocation;
		readonly viewportSize: WebGLUniformLocation;
		readonly minRadiusPx: WebGLUniformLocation;
		readonly sparkleAlpha: WebGLUniformLocation;
		readonly shimmer: WebGLUniformLocation;
	};
}

interface BeaconBaseProgram {
	readonly program: WebGLProgram;
	readonly uniforms: {
		readonly clipFromAnchor: WebGLUniformLocation;
	};
}

/**
 * Instanced depth-tested WebGL2 pass for 3D hollow entity light cylinders and glowing base rings.
 *
 * Always respects scene depth and (when portal-scoped) portal-deferred visibility windows so
 * beacons never bleed through walls or closed dungeon rooms.
 */
export class WebGL2EntityBeaconPass {
	readonly #gl: WebGL2RenderingContext;
	readonly #vertexArray: WebGLVertexArrayObject;
	readonly #meshBuffer: WebGLBuffer;
	readonly #instanceBuffer: WebGLBuffer;
	readonly #flatCylinderProgram: BeaconCylinderProgram;
	readonly #portalCylinderProgram: BeaconCylinderProgram;
	readonly #flatBaseProgram: BeaconBaseProgram;
	readonly #portalBaseProgram: BeaconBaseProgram;
	#instanceScratch = new Float32Array(0);
	#instanceCapacityFloats = 0;
	#destroyed = false;

	constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl;
		const vertexArray = gl.createVertexArray();
		const meshBuffer = gl.createBuffer();
		const instanceBuffer = gl.createBuffer();
		if (!vertexArray || !meshBuffer || !instanceBuffer) {
			if (vertexArray) gl.deleteVertexArray(vertexArray);
			if (meshBuffer) gl.deleteBuffer(meshBuffer);
			if (instanceBuffer) gl.deleteBuffer(instanceBuffer);
			throw new Error("Failed to allocate entity beacon pass geometry.");
		}
		this.#vertexArray = vertexArray;
		this.#meshBuffer = meshBuffer;
		this.#instanceBuffer = instanceBuffer;

		gl.bindVertexArray(vertexArray);
		gl.bindBuffer(gl.ARRAY_BUFFER, meshBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, createBeaconMeshVertices(), gl.STATIC_DRAW);
		gl.enableVertexAttribArray(VERTEX_ATTRIBUTE);
		gl.vertexAttribPointer(VERTEX_ATTRIBUTE, 3, gl.FLOAT, false, 0, 0);
		gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
		for (const [attribute, size, floatOffset] of INSTANCE_ATTRIBUTES) {
			gl.enableVertexAttribArray(attribute);
			gl.vertexAttribPointer(
				attribute,
				size,
				gl.FLOAT,
				false,
				INSTANCE_STRIDE_BYTES,
				floatOffset * Float32Array.BYTES_PER_ELEMENT,
			);
			gl.vertexAttribDivisor(attribute, 1);
		}
		gl.bindVertexArray(null);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);

		let flatCylinderProgram: BeaconCylinderProgram | null = null;
		let portalCylinderProgram: BeaconCylinderProgram | null = null;
		let flatBaseProgram: BeaconBaseProgram | null = null;
		let portalBaseProgram: BeaconBaseProgram | null = null;
		try {
			flatCylinderProgram = createBeaconCylinderProgram(gl, false);
			portalCylinderProgram = createBeaconCylinderProgram(gl, true);
			flatBaseProgram = createBeaconBaseProgram(gl, false);
			portalBaseProgram = createBeaconBaseProgram(gl, true);
		} catch (error) {
			if (flatCylinderProgram) gl.deleteProgram(flatCylinderProgram.program);
			if (portalCylinderProgram)
				gl.deleteProgram(portalCylinderProgram.program);
			if (flatBaseProgram) gl.deleteProgram(flatBaseProgram.program);
			if (portalBaseProgram) gl.deleteProgram(portalBaseProgram.program);
			gl.deleteBuffer(instanceBuffer);
			gl.deleteBuffer(meshBuffer);
			gl.deleteVertexArray(vertexArray);
			throw error;
		}
		this.#flatCylinderProgram = flatCylinderProgram;
		this.#portalCylinderProgram = portalCylinderProgram;
		this.#flatBaseProgram = flatBaseProgram;
		this.#portalBaseProgram = portalBaseProgram;
	}

	draw(
		context: EntityBeaconDrawContext,
		instances: readonly EntityBeaconDrawInstance[],
	): void {
		this.#drawInternal(context, instances, null);
	}

	drawScoped(
		context: EntityBeaconDrawContext,
		instances: readonly EntityBeaconScopedDrawInstance[],
		routing: EntityOverlayInstanceScopeRouting,
	): void {
		this.#drawInternal(context, instances, routing);
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		const gl = this.#gl;
		gl.deleteProgram(this.#flatCylinderProgram.program);
		gl.deleteProgram(this.#portalCylinderProgram.program);
		gl.deleteProgram(this.#flatBaseProgram.program);
		gl.deleteProgram(this.#portalBaseProgram.program);
		gl.deleteBuffer(this.#instanceBuffer);
		gl.deleteBuffer(this.#meshBuffer);
		gl.deleteVertexArray(this.#vertexArray);
	}

	#drawInternal(
		context: EntityBeaconDrawContext,
		instances: readonly (
			EntityBeaconDrawInstance | EntityBeaconScopedDrawInstance
		)[],
		routing: EntityOverlayInstanceScopeRouting | null,
	): void {
		if (this.#destroyed) throw new Error("Entity beacon pass is destroyed.");
		const count = instances.length;
		if (count === 0) return;
		const color = context.settings.color;
		const sparkleColor = context.settings.sparkleColor;
		if (color === null || sparkleColor === null)
			throw new Error("Entity beacon draw requires resolved theme colors.");

		const floatCount = count * INSTANCE_FLOATS;
		if (this.#instanceScratch.length < floatCount)
			this.#instanceScratch = new Float32Array(floatCount);
		let offset = 0;
		for (const instance of instances) {
			const instanceColor = instance.color ?? color;
			this.#instanceScratch[offset] = instance.base.x;
			this.#instanceScratch[offset + 1] = instance.base.y;
			this.#instanceScratch[offset + 2] = instance.base.z;
			this.#instanceScratch[offset + 3] = instance.height;
			this.#instanceScratch[offset + 4] = instance.radius;
			this.#instanceScratch[offset + 5] =
				routing && "renderScopeKey" in instance
					? routing.deferredRenderDomainOrdinal(instance.renderScopeKey)
					: 0;
			this.#instanceScratch[offset + 6] = instanceColor.red;
			this.#instanceScratch[offset + 7] = instanceColor.green;
			this.#instanceScratch[offset + 8] = instanceColor.blue;
			this.#instanceScratch[offset + 9] = instanceColor.alpha;
			offset += INSTANCE_FLOATS;
		}

		const gl = this.#gl;
		gl.bindVertexArray(this.#vertexArray);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.#instanceBuffer);
		if (this.#instanceCapacityFloats < floatCount) {
			this.#instanceCapacityFloats = Math.max(
				floatCount,
				this.#instanceCapacityFloats * 2,
			);
			gl.bufferData(
				gl.ARRAY_BUFFER,
				this.#instanceCapacityFloats * Float32Array.BYTES_PER_ELEMENT,
				gl.STREAM_DRAW,
			);
		}
		gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.#instanceScratch, 0, floatCount);

		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.LEQUAL);
		gl.depthMask(false);
		gl.disable(gl.CULL_FACE);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

		// Pass 1: Bright horizontal base ring + soft inner glow flush with the hollow cylinder base.
		const baseProgram = routing
			? this.#portalBaseProgram
			: this.#flatBaseProgram;
		gl.useProgram(baseProgram.program);
		gl.uniformMatrix4fv(
			baseProgram.uniforms.clipFromAnchor,
			false,
			context.clipFromAnchor,
		);
		gl.drawArraysInstanced(
			gl.TRIANGLES,
			BEACON_CYLINDER_VERTEX_COUNT,
			BEACON_BASE_VERTEX_COUNT,
			count,
		);

		// Pass 2: Open 3D hollow light cylinder wrapping around the entity with Fresnel rim glow.
		const cylinderProgram = routing
			? this.#portalCylinderProgram
			: this.#flatCylinderProgram;
		const shimmerRate = context.settings.shimmerCyclesPerSecond;
		gl.useProgram(cylinderProgram.program);
		gl.uniformMatrix4fv(
			cylinderProgram.uniforms.clipFromAnchor,
			false,
			context.clipFromAnchor,
		);
		gl.uniform3f(
			cylinderProgram.uniforms.cameraPosition,
			context.cameraPosition.x,
			context.cameraPosition.y,
			context.cameraPosition.z,
		);
		gl.uniform3f(
			cylinderProgram.uniforms.cameraRight,
			context.cameraRight[0],
			context.cameraRight[1],
			context.cameraRight[2],
		);
		gl.uniform2f(
			cylinderProgram.uniforms.viewportSize,
			context.viewportWidth,
			context.viewportHeight,
		);
		gl.uniform1f(
			cylinderProgram.uniforms.minRadiusPx,
			context.settings.minimumRadiusCssPixels * context.renderScale,
		);
		gl.uniform1f(cylinderProgram.uniforms.sparkleAlpha, sparkleColor.alpha);
		gl.uniform2f(
			cylinderProgram.uniforms.shimmer,
			shimmerRate > 0 ? 1 : 0,
			shimmerRate > 0 ? (context.timeSeconds * shimmerRate) % 4096 : 0,
		);
		gl.drawArraysInstanced(
			gl.TRIANGLES,
			0,
			BEACON_CYLINDER_VERTEX_COUNT,
			count,
		);

		gl.bindVertexArray(null);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
		gl.depthMask(true);
		gl.disable(gl.BLEND);
	}
}

/** Build unit open cylinder vertices `(cos, yFraction, sin)` followed by the horizontal XZ base quad. */
function createBeaconMeshVertices(): Float32Array {
	const vertices = new Float32Array(
		(BEACON_CYLINDER_VERTEX_COUNT + BEACON_BASE_VERTEX_COUNT) * 3,
	);
	let offset = 0;
	for (let segment = 0; segment < CYLINDER_SEGMENT_COUNT; segment += 1) {
		const a0 = (segment * Math.PI * 2) / CYLINDER_SEGMENT_COUNT;
		const a1 = ((segment + 1) * Math.PI * 2) / CYLINDER_SEGMENT_COUNT;
		const x0 = Math.cos(a0);
		const z0 = Math.sin(a0);
		const x1 = Math.cos(a1);
		const z1 = Math.sin(a1);
		vertices[offset++] = x0;
		vertices[offset++] = 0;
		vertices[offset++] = z0;
		vertices[offset++] = x1;
		vertices[offset++] = 0;
		vertices[offset++] = z1;
		vertices[offset++] = x1;
		vertices[offset++] = 1;
		vertices[offset++] = z1;
		vertices[offset++] = x0;
		vertices[offset++] = 0;
		vertices[offset++] = z0;
		vertices[offset++] = x1;
		vertices[offset++] = 1;
		vertices[offset++] = z1;
		vertices[offset++] = x0;
		vertices[offset++] = 1;
		vertices[offset++] = z0;
	}
	const baseQuad = [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, -1, 1, 0, 1, -1, 0, 1];
	vertices.set(baseQuad, offset);
	return vertices;
}

function createBeaconCylinderProgram(
	gl: WebGL2RenderingContext,
	portal: boolean,
): BeaconCylinderProgram {
	const vertex = `#version 300 es
precision highp float;
layout(location = ${VERTEX_ATTRIBUTE}) in vec3 aVertex;
layout(location = ${BASE_ATTRIBUTE}) in vec3 aBase;
layout(location = ${HEIGHT_ATTRIBUTE}) in float aHeight;
layout(location = ${RADIUS_ATTRIBUTE}) in float aRadius;
layout(location = ${PORTAL_DOMAIN_ATTRIBUTE}) in float aPortalRenderDomain;
layout(location = ${COLOR_ATTRIBUTE}) in vec4 aColor;
uniform mat4 uBeaconClipFromAnchor;
uniform vec3 uCameraRight;
uniform vec2 uViewportSize;
uniform float uMinRadiusPx;
out vec3 vNormal;
out vec3 vWorldPosition;
out float vHeightFraction;
out float vHeightMeters;
flat out float vRadius;
flat out uint vPortalRenderDomain;
flat out vec4 vColor;
void main() {
	vec3 radial = vec3(aVertex.x, 0.0, aVertex.z);
	float heightMeters = aVertex.y * aHeight;
	vec3 centerPoint = aBase + vec3(0.0, heightMeters, 0.0);
	vec4 centerClip = uBeaconClipFromAnchor * vec4(centerPoint, 1.0);
	vec4 offsetClip = uBeaconClipFromAnchor * vec4(centerPoint + uCameraRight * aRadius, 1.0);
	float scaleBoost = 1.0;
	if (centerClip.w > 0.0 && offsetClip.w > 0.0) {
		vec2 screenDeltaPx = (
			offsetClip.xy / max(offsetClip.w, 1e-4) -
			centerClip.xy / max(centerClip.w, 1e-4)
		) * uViewportSize * 0.5;
		float projectedRadiusPx = length(screenDeltaPx);
		if (projectedRadiusPx > 1e-4) {
			scaleBoost = max(1.0, uMinRadiusPx / projectedRadiusPx);
		}
	}
	vec3 worldPoint = centerPoint + radial * (aRadius * scaleBoost);
	gl_Position = uBeaconClipFromAnchor * vec4(worldPoint, 1.0);
	vNormal = radial;
	vWorldPosition = worldPoint;
	vHeightFraction = aVertex.y;
	vHeightMeters = heightMeters;
	vRadius = aRadius;
	vPortalRenderDomain = uint(aPortalRenderDomain);
	vColor = aColor;
}`;
	const fragment = `#version 300 es
precision highp float;
precision highp int;
${portal ? PORTAL_DEFERRED_VISIBILITY_INSTANCE_GLSL : ""}
uniform vec3 uCameraPosition;
uniform float uSparkleAlpha;
uniform vec2 uShimmer;
in vec3 vNormal;
in vec3 vWorldPosition;
in float vHeightFraction;
in float vHeightMeters;
flat in float vRadius;
flat in uint vPortalRenderDomain;
flat in vec4 vColor;
out vec4 outColor;

vec3 hash32(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
	p3 += dot(p3, p3.yxz + 33.33);
	return fract((p3.xxy + p3.yzz) * p3.zyx);
}

float sparkleLayer(
	float angleUnit,
	float heightMeters,
	float radius,
	float cellSize,
	float riseOffset,
	float twinklePhase,
	float animate,
	float densityThreshold,
	float flareStrength
) {
	float circumference = max(6.2831853 * radius, 0.5);
	float cols = max(6.0, floor(circumference / cellSize + 0.5));
	float vCoord = (heightMeters - riseOffset) / cellSize;
	vec2 cell = vec2(floor(angleUnit * cols), floor(vCoord));
	vec2 local = vec2(fract(angleUnit * cols), fract(vCoord));
	vec3 h = hash32(cell);
	if (h.z < densityThreshold) return 0.0;
	vec2 center = vec2(0.22 + h.x * 0.56, 0.22 + h.y * 0.56);
	vec2 delta = local - center;
	float distSq = dot(delta, delta);
	float dotGlow = exp(-distSq * 65.0);
	float crossFlare = (
		exp(-(abs(delta.x) * 28.0 + abs(delta.y) * 8.0)) +
		exp(-(abs(delta.y) * 28.0 + abs(delta.x) * 8.0))
	) * 0.45 * flareStrength;
	float twinkle = mix(
		0.85,
		0.25 + 0.75 * (0.5 + 0.5 * sin((twinklePhase * (1.2 + h.x) + h.y) * 6.2831853)),
		animate
	);
	return clamp((dotGlow + crossFlare) * twinkle, 0.0, 1.0);
}

void main() {
	vec3 normal = normalize(vNormal);
	vec3 viewDir = normalize(uCameraPosition - vWorldPosition);
	float ndotv = abs(dot(normal, viewDir));
	float rim = pow(clamp(1.0 - ndotv, 0.0, 1.0), 1.6);
	float wallPresence = 0.14 + 0.72 * rim;
	float verticalFade = pow(max(0.0, 1.0 - vHeightFraction), 1.35);
	// World-meter decay keeps the glowing base lip crisp across both short indoor and tall outdoor spires.
	float baseRingBoost = exp(-vHeightMeters * 2.5);
	float phase = uShimmer.y;
	float animate = uShimmer.x;
	float wave = 0.5 + 0.5 * sin((vHeightMeters * 0.5 - phase) * 6.2831853);
	float shimmer = mix(1.0, 0.85 + 0.25 * wave, animate);
	float sparkleAlpha = 0.0;
	if (uSparkleAlpha > 0.001) {
		float angleUnit = fract(atan(normal.z, normal.x) / 6.2831853 + 1.0);
		float baseLaunchFade = smoothstep(0.05, 0.3, vHeightMeters);
		float primarySparkles = sparkleLayer(
			angleUnit,
			vHeightMeters,
			vRadius,
			0.65,
			phase * 3.2,
			phase * 1.4,
			animate,
			0.56,
			1.0
		);
		float fineMotes = sparkleLayer(
			fract(angleUnit + 0.37 + phase * 0.04 * animate),
			vHeightMeters + 1.3,
			vRadius,
			0.38,
			phase * 4.8,
			phase * 2.1,
			animate,
			0.64,
			0.35
		);
		float sparkle = clamp(primarySparkles + fineMotes * 0.75, 0.0, 1.0) * verticalFade * baseLaunchFade;
		sparkleAlpha = sparkle * uSparkleAlpha * vColor.a;
	}
	float wallAlpha = (wallPresence * verticalFade * shimmer + baseRingBoost * 0.65) * 0.62 * vColor.a;
	float alpha = clamp(wallAlpha + sparkleAlpha * (1.0 - wallAlpha), 0.0, 0.98);
	if (alpha <= 0.01) discard;
	${portal ? "if (!portalDeferredFragmentVisible(vPortalRenderDomain)) discard;" : ""}
	vec3 wallRgb = mix(vColor.rgb, vec3(1.0), clamp(rim * 0.35 + baseRingBoost * 0.55, 0.0, 1.0));
	// Matches --ui-entity-alert-beacon-sparkle-color: 40% beacon color mixed with 60% white.
	vec3 sparkleRgb = mix(vColor.rgb, vec3(1.0), 0.6);
	float sparkleBlend = sparkleAlpha / max(wallAlpha + sparkleAlpha, 1e-4);
	vec3 rgb = mix(wallRgb, sparkleRgb, sparkleBlend);
	outColor = vec4(rgb, alpha);
}`;
	const program = linkWebGL2Program(
		gl,
		portal ? "portal entity beacon cylinder" : "entity beacon cylinder",
		vertex,
		fragment,
	);
	if (portal) bindWebGL2PortalDeferredVisibilityInstanceProgram(gl, program);
	return {
		program,
		uniforms: {
			clipFromAnchor: requireWebGL2Uniform(
				gl,
				program,
				"uBeaconClipFromAnchor",
			),
			cameraPosition: requireWebGL2Uniform(gl, program, "uCameraPosition"),
			cameraRight: requireWebGL2Uniform(gl, program, "uCameraRight"),
			viewportSize: requireWebGL2Uniform(gl, program, "uViewportSize"),
			minRadiusPx: requireWebGL2Uniform(gl, program, "uMinRadiusPx"),
			sparkleAlpha: requireWebGL2Uniform(gl, program, "uSparkleAlpha"),
			shimmer: requireWebGL2Uniform(gl, program, "uShimmer"),
		},
	};
}

function createBeaconBaseProgram(
	gl: WebGL2RenderingContext,
	portal: boolean,
): BeaconBaseProgram {
	const vertex = `#version 300 es
precision highp float;
layout(location = ${VERTEX_ATTRIBUTE}) in vec3 aVertex;
layout(location = ${BASE_ATTRIBUTE}) in vec3 aBase;
layout(location = ${RADIUS_ATTRIBUTE}) in float aRadius;
layout(location = ${PORTAL_DOMAIN_ATTRIBUTE}) in float aPortalRenderDomain;
layout(location = ${COLOR_ATTRIBUTE}) in vec4 aColor;
uniform mat4 uBeaconClipFromAnchor;
out vec2 vLocalXZ;
flat out uint vPortalRenderDomain;
flat out vec4 vColor;
void main() {
	vec3 worldPoint = aBase + vec3(aVertex.x, 0.0, aVertex.z) * aRadius;
	gl_Position = uBeaconClipFromAnchor * vec4(worldPoint, 1.0);
	vLocalXZ = aVertex.xz;
	vPortalRenderDomain = uint(aPortalRenderDomain);
	vColor = aColor;
}`;
	const fragment = `#version 300 es
precision highp float;
precision highp int;
${portal ? PORTAL_DEFERRED_VISIBILITY_INSTANCE_GLSL : ""}
in vec2 vLocalXZ;
flat in uint vPortalRenderDomain;
flat in vec4 vColor;
out vec4 outColor;
void main() {
	float r = length(vLocalXZ);
	if (r > 1.0) discard;
	float ring = smoothstep(0.82, 0.94, r) * (1.0 - smoothstep(0.96, 1.0, r));
	float innerGlow = (0.16 + 0.24 * (1.0 - r * r)) * smoothstep(1.0, 0.84, r);
	float alpha = clamp((ring * 0.9 + innerGlow) * vColor.a, 0.0, 1.0);
	if (alpha <= 0.01) discard;
	${portal ? "if (!portalDeferredFragmentVisible(vPortalRenderDomain)) discard;" : ""}
	vec3 rgb = mix(vColor.rgb, vec3(1.0), clamp(ring * 0.55 + (1.0 - r) * 0.2, 0.0, 1.0));
	outColor = vec4(rgb, alpha);
}`;
	const program = linkWebGL2Program(
		gl,
		portal ? "portal entity beacon base" : "entity beacon base",
		vertex,
		fragment,
	);
	if (portal) bindWebGL2PortalDeferredVisibilityInstanceProgram(gl, program);
	return {
		program,
		uniforms: {
			clipFromAnchor: requireWebGL2Uniform(
				gl,
				program,
				"uBeaconClipFromAnchor",
			),
		},
	};
}
