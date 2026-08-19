import { PARTICLE_TYPE } from "../behavior/particle-motion";
import {
	PARTICLE_RECORD_TEXELS,
	PARTICLE_RECORD_TEXTURE_WIDTH,
} from "./particle-record-layout";
import {
	compileWebGL2Shader,
	requireWebGL2Uniform,
} from "./webgl2-shader-utils";
import {
	bindWebGL2PortalDeferredVisibilityProgram,
	PORTAL_DEFERRED_VISIBILITY_GLSL,
	type WebGL2PortalDeferredVisibilityUniforms,
} from "./portal-deferred-visibility-glsl";

/** Sampler units bound once for the particle program's lifetime. */
export const PARTICLE_TEXTURE_UNITS = {
	base: 0,
	palette: 1,
	records: 2,
} as const;

/**
 * How a particle mesh is oriented at draw time.
 *
 * Retail resolves this from the mesh's `DegradeInfo` band, not from the emitter
 * (`CPhysicsPart::calc_draw_frame`, acclient.c:319260-319290). Orientation is therefore a per-mesh
 * fact, and batches are keyed by mesh, so it binds as a per-batch constant and never as a
 * per-instance attribute.
 */
export const PARTICLE_ORIENTATION = {
	/** Band mode 1: keep the authored spawn frame, including any `GR`/`LR` spin. */
	authored: 0,
	/** Band mode 2: full viewer-facing billboard. Retail re-heads the draw frame to the viewer. */
	viewerFacing: 1,
	/** Band modes 3/4/5: viewer alignment locked about one axis. */
	axisLocked: 2,
} as const;

/**
 * Particle vertex stage.
 *
 * Evaluates the closed-form motion of `Particle::Update` (acclient.c:317446-317664) on the GPU. Its
 * CPU twin is `game/behavior/particle-motion.ts`, which is unit-tested per formula family; the two
 * must stay in step, and the CPU side is the reference when they disagree.
 *
 * A particle carries only spawn constants and a birth time, so there is no simulation here — the
 * whole trajectory is a function of elapsed time. That is what keeps per-particle CPU work to
 * emission and expiry bookkeeping regardless of particle count.
 *
 * The 13 authored `ParticleType` values reduce to seven position formulas: the `Local`/`Global`
 * split is resolved at spawn (the constants arrive already rotated into world space) and `GR`/`LR`
 * selects a spin axis space rather than a trajectory.
 */
const PARTICLE_VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aTextureCoordinate;

/**
 * Spawn constants live in a data texture, not in instance attributes.
 *
 * The draw path addresses *ranges* of records, and pointing six attribute pointers at a range costs
 * about twenty GL calls where a texture range costs one uniform. Reading here keeps that cost off
 * the frame regardless of how many ranges are drawn.
 */
uniform highp sampler2D uParticleRecords;
/** First record this draw range covers; the record index is this plus gl_InstanceID. */
uniform int uInstanceBase;

/** Spawn constants for one particle, unpacked from its texels. */
struct ParticleRecord {
	/** Spawn origin within its landblock, kept small so float32 holds it precisely. */
	vec3 localOrigin;
	float birthTime;
	vec3 offset;
	float lifespan;
	vec3 motionA;
	vec3 motionB;
	vec3 motionC;
	vec4 appearance;   // startScale, finalScale, startTrans, finalTrans
	/** Scene origin of the record's landblock; an exact multiple of the landblock size. */
	vec3 landblockOrigin;
};

ParticleRecord readParticleRecord(int recordIndex) {
	int firstTexel = recordIndex * ${PARTICLE_RECORD_TEXELS};
	int row = firstTexel / ${PARTICLE_RECORD_TEXTURE_WIDTH};
	int column = firstTexel - row * ${PARTICLE_RECORD_TEXTURE_WIDTH};
	vec4 t0 = texelFetch(uParticleRecords, ivec2(column, row), 0);
	vec4 t1 = texelFetch(uParticleRecords, ivec2(column + 1, row), 0);
	vec4 t2 = texelFetch(uParticleRecords, ivec2(column + 2, row), 0);
	vec4 t3 = texelFetch(uParticleRecords, ivec2(column + 3, row), 0);
	vec4 t4 = texelFetch(uParticleRecords, ivec2(column + 4, row), 0);
	vec4 t5 = texelFetch(uParticleRecords, ivec2(column + 5, row), 0);
	return ParticleRecord(
		t0.xyz, t0.w,
		t1.xyz, t1.w,
		t2.xyz,
		vec3(t2.w, t3.xy),
		vec3(t3.zw, t4.x),
		vec4(t4.yzw, t5.x),
		t5.yzw
	);
}

uniform mat4 uProjection;
uniform mat4 uView;
/** Shared runtime clock; every particle derives its own elapsed time from its birth stamp. */
uniform float uClockSeconds;
/** One of PARTICLE_ORIENTATION, constant per drawn range because it is a per-mesh fact. */
uniform int uOrientation;
/** Axis held fixed when uOrientation is axis-locked. */
uniform vec3 uLockedAxis;
/** World-space camera position; retail bills board to the eye, not to the screen plane. */
uniform vec3 uCameraPosition;
/**
 * Scene origin of this frame's render anchor, an exact multiple of the landblock size.
 *
 * Records store a landblock origin of the same form, so the difference below is exact rather than
 * merely close: subtracting two nearby scene-magnitude values would otherwise lose millimetres to
 * cancellation, and that error would land on every particle.
 */
uniform vec3 uAnchorOrigin;
/** Authored ParticleType, constant per drawn range. */
uniform int uMotionType;

out vec2 vTextureCoordinate;
out float vTranslucency;

/**
 * Displacement from the parent origin at elapsed time t, in AC's authored axes.
 *
 * Component meaning here is AC's: x, then north, then **up**. The record's constants are stored
 * unconverted for exactly this reason — Swarm and Explode read axis meaning from the component, so
 * evaluating them against converted vectors applies each rule to the wrong axis.
 */
vec3 acDisplacement(ParticleRecord record, float t) {
	// Formula families, in the same order and with the same quirks as the CPU evaluator.
	if (uMotionType == ${PARTICLE_TYPE.still}) {
		return record.offset;
	}
	if (uMotionType == ${PARTICLE_TYPE.localVelocity} || uMotionType == ${PARTICLE_TYPE.globalVelocity}) {
		return record.offset + record.motionA * t;
	}
	if (uMotionType == ${PARTICLE_TYPE.parabolicLvga} || uMotionType == ${PARTICLE_TYPE.parabolicLvla}
		|| uMotionType == ${PARTICLE_TYPE.parabolicGvga} || uMotionType == ${PARTICLE_TYPE.parabolicLvgaGr}
		|| uMotionType == ${PARTICLE_TYPE.parabolicLvlaLr} || uMotionType == ${PARTICLE_TYPE.parabolicGvgaGr}) {
		return record.offset + record.motionA * t + 0.5 * record.motionB * t * t;
	}
	if (uMotionType == ${PARTICLE_TYPE.swarm}) {
		// RETAIL QUIRK: sin on AC's y, cos on AC's x and z. Do not make this uniform, and do
		// not evaluate it against converted vectors, which swaps which axis gets the sine.
		return record.offset + vec3(
			cos(record.motionB.x * t) * record.motionC.x + record.motionA.x * t,
			sin(record.motionB.y * t) * record.motionC.y + record.motionA.y * t,
			cos(record.motionB.z * t) * record.motionC.z + record.motionA.z * t
		);
	}
	if (uMotionType == ${PARTICLE_TYPE.explode}) {
		// RETAIL QUIRK: both Explode quirks. Every axis multiplies by motionA.x rather than its own
		// component, and AC's z -- up -- carries an extra + motionA.z inside the parenthesis.
		return record.offset + vec3(
			(record.motionB.x * t + record.motionC.x * record.motionA.x) * t,
			(record.motionB.y * t + record.motionC.y * record.motionA.x) * t,
			(record.motionB.z * t + record.motionC.z * record.motionA.x + record.motionA.z) * t
		);
	}
	if (uMotionType == ${PARTICLE_TYPE.implode}) {
		// RETAIL QUIRK: one scalar cosine driven by motionA.x, applied to all three axes.
		float wave = cos(record.motionA.x * t);
		return record.offset + wave * record.motionC + record.motionB * t * t;
	}
	return record.offset;
}

/** AC authors Z-up with +Y north; the renderer is Y-up with -Z north. */
vec3 acToRender(vec3 v) {
	return vec3(v.x, v.z, -v.y);
}

/** Basis that turns the particle mesh to face the viewer, or the authored identity. */
mat3 orientationBasis(vec3 worldPosition) {
	if (uOrientation == ${PARTICLE_ORIENTATION.authored}) {
		return mat3(1.0);
	}
	// Retail heads the draw frame at the viewer position, so the facing axis is toward the eye
	// rather than along the camera's forward vector; the two differ off the screen centre.
	vec3 forward = normalize(uCameraPosition - worldPosition);
	// World up in *render* axes. Using AC's up here would roll the sprite as the camera moves,
	// because the geometry has already been converted out of AC's Z-up frame.
	vec3 reference = uOrientation == ${PARTICLE_ORIENTATION.axisLocked}
		? normalize(uLockedAxis)
		: vec3(0.0, 1.0, 0.0);
	vec3 right = cross(reference, forward);
	float rightLength = length(right);
	// Degenerate when the particle sits on the locked axis; keep the authored frame rather than
	// producing a NaN basis.
	if (rightLength < 1e-5) {
		return mat3(1.0);
	}
	right /= rightLength;
	vec3 up = cross(forward, right);
	return mat3(right, up, forward);
}

void main() {
	ParticleRecord record = readParticleRecord(uInstanceBase + gl_InstanceID);
	float elapsed = max(uClockSeconds - record.birthTime, 0.0);
	float lifespan = record.lifespan;
	// Clamped, matching retail: a particle past its lifespan holds its final appearance.
	float progress = lifespan > 0.0 ? min(elapsed / lifespan, 1.0) : 1.0;

	// Re-anchor exactly: the coarse difference cancels on the landblock grid, then the precise
	// landblock-local part is added. Only the authored displacement needs converting, and it is
	// converted exactly once here.
	vec3 anchoredOrigin =
		(record.landblockOrigin - uAnchorOrigin) + record.localOrigin;
	vec3 worldPosition =
		anchoredOrigin + acToRender(acDisplacement(record, elapsed));
	float scale = mix(record.appearance.x, record.appearance.y, progress);

	// The mesh's authored plane faces its own +Z after conversion, so the basis maps local x/y to
	// screen right/up and local z to the facing axis.
	vec3 local = orientationBasis(worldPosition) * (aPosition * scale);
	vTextureCoordinate = aTextureCoordinate;
	vTranslucency = mix(record.appearance.z, record.appearance.w, progress);
	// The normal attribute is bound by the shared object geometry layout but unused: particles draw
	// unlit, exactly as retail draws them.
	gl_Position = uProjection * uView * vec4(worldPosition + local, 1.0);
}
`;

/**
 * Particle fragment stage.
 *
 * Composes the same material reads the object program uses rather than growing a parallel "simple"
 * particle shader: particles are ordinary in-world GfxObj meshes drawn through the same
 * surface-derived blend staging, so a separate path would drift back toward this one anyway.
 * Per-particle animated translucency modulates alpha on top of that.
 */
export function createParticleFragmentShader(
	portalVisibility: boolean,
): string {
	const portalDeclarations = portalVisibility
		? PORTAL_DEFERRED_VISIBILITY_GLSL
		: "";
	const portalApplication = portalVisibility
		? "if (!portalDeferredFragmentVisible()) discard;"
		: "";
	return `#version 300 es
precision highp float;
precision highp int;

${portalDeclarations}

in vec2 vTextureCoordinate;
in float vTranslucency;

uniform sampler2D uBase;
uniform sampler2D uPalette;
/** Shared encoding with the object program: 0 solid colour, 1 direct colour, 2 index8, 3 index16. */
uniform int uMaterialKind;
/**
 * The authored colour of an untextured surface, already carrying its translucency as alpha.
 *
 * Only kind 0 reads it. Retail has no solid-colour path at all: it writes the colour into a 1x1
 * texture and binds that (SetSolidColorTextureColor, acclient.c:437178). Sampling a one-texel
 * texture to recover a value we already hold would be strictly worse, and the object program
 * already carries the colour as a uniform, so this matches our own convention rather than retail's
 * workaround. The visible result is identical.
 */
uniform vec4 uMaterialColor;
uniform int uPalettedClipMap;
uniform float uAlphaTest;
uniform float uOpacityScale;

out vec4 outColor;

/**
 * Decode one palette index from the base texture at an exact texel coordinate.
 *
 * Uses texelFetch rather than texture: indices must not be filtered directly, since interpolating
 * two palette indices produces a third unrelated colour.
 */
float paletteIndexAt(ivec2 texel) {
	ivec2 size = textureSize(uBase, 0);
	texel = clamp(texel, ivec2(0), size - ivec2(1));
	vec4 encoded = texelFetch(uBase, texel, 0) * 255.0;
	return uMaterialKind == 3
		? floor(encoded.r + 0.5) + floor(encoded.g + 0.5) * 256.0
		: floor(encoded.r + 0.5);
}

vec4 paletteColor(float index) {
	// Retail's indexed clip map: the first eight entries are cutout, not colour. Without this an
	// alpha-tested sprite has no alpha to test and draws its backing opaque.
	if (uPalettedClipMap != 0 && index < 8.0) return vec4(0.0);
	ivec2 size = textureSize(uPalette, 0);
	if (index >= float(size.x * size.y)) return vec4(0.0);
	return texelFetch(
		uPalette,
		ivec2(int(mod(index, float(size.x))), int(index) / size.x),
		0
	);
}

vec4 indexedColorAt(ivec2 texel) {
	return paletteColor(paletteIndexAt(texel));
}

vec4 sampleIndexedPaletteLinear(vec2 uv) {
	ivec2 sourceSize = textureSize(uBase, 0);
	// Match normalized hardware bilinear sampling, whose texel centers lie at n + 0.5.
	vec2 texelPosition = uv * vec2(sourceSize) - vec2(0.5);
	ivec2 baseCoordinate = ivec2(floor(texelPosition));
	vec2 blend = fract(texelPosition);
	vec4 top = mix(
		indexedColorAt(baseCoordinate),
		indexedColorAt(baseCoordinate + ivec2(1, 0)),
		blend.x
	);
	vec4 bottom = mix(
		indexedColorAt(baseCoordinate + ivec2(0, 1)),
		indexedColorAt(baseCoordinate + ivec2(1, 1)),
		blend.x
	);
	return mix(top, bottom, blend.y);
}

vec4 sampleMaterial() {
	if (uMaterialKind == 0) {
		return uMaterialColor;
	}
	if (uMaterialKind == 1) {
		return texture(uBase, vTextureCoordinate);
	}
	return sampleIndexedPaletteLinear(vTextureCoordinate);
}

void main() {
	${portalApplication}
	vec4 color = sampleMaterial();
	// Translucency is retail's sense: 1 is fully transparent, so alpha is its complement.
	color.a *= (1.0 - clamp(vTranslucency, 0.0, 1.0)) * uOpacityScale;
	if (color.a < uAlphaTest) discard;
	outColor = color;
}
`;
}

export interface WebGL2ParticleProgram {
	readonly program: WebGLProgram;
	/** Null for ordinary draws; otherwise the sole per-draw authored-scope selector. */
	readonly portalVisibilityUniforms: WebGL2PortalDeferredVisibilityUniforms | null;
	readonly uniforms: {
		readonly alphaTest: WebGLUniformLocation;
		readonly anchorOrigin: WebGLUniformLocation;
		readonly base: WebGLUniformLocation;
		readonly cameraPosition: WebGLUniformLocation;
		readonly clockSeconds: WebGLUniformLocation;
		readonly lockedAxis: WebGLUniformLocation;
		readonly materialKind: WebGLUniformLocation;
		readonly materialColor: WebGLUniformLocation;
		readonly palettedClipMap: WebGLUniformLocation;
		readonly instanceBase: WebGLUniformLocation;
		readonly motionType: WebGLUniformLocation;
		readonly particleRecords: WebGLUniformLocation;
		readonly opacityScale: WebGLUniformLocation;
		readonly orientation: WebGLUniformLocation;
		readonly palette: WebGLUniformLocation;
		readonly projection: WebGLUniformLocation;
		readonly view: WebGLUniformLocation;
	};
}

/** Compile and link the particle program, binding its sampler units once. */
export function createWebGL2ParticleProgram(
	gl: WebGL2RenderingContext,
	portalVisibility = false,
): WebGL2ParticleProgram {
	const vertex = compileWebGL2Shader(
		gl,
		gl.VERTEX_SHADER,
		PARTICLE_VERTEX_SHADER,
	);
	const fragment = compileWebGL2Shader(
		gl,
		gl.FRAGMENT_SHADER,
		createParticleFragmentShader(portalVisibility),
	);
	const program = gl.createProgram();
	gl.attachShader(program, vertex);
	gl.attachShader(program, fragment);
	gl.linkProgram(program);
	gl.deleteShader(vertex);
	gl.deleteShader(fragment);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const log = gl.getProgramInfoLog(program);
		gl.deleteProgram(program);
		throw new Error(`Particle program failed to link: ${log ?? "unknown"}`);
	}
	const uniforms: WebGL2ParticleProgram["uniforms"] = {
		alphaTest: requireWebGL2Uniform(gl, program, "uAlphaTest"),
		anchorOrigin: requireWebGL2Uniform(gl, program, "uAnchorOrigin"),
		base: requireWebGL2Uniform(gl, program, "uBase"),
		cameraPosition: requireWebGL2Uniform(gl, program, "uCameraPosition"),
		clockSeconds: requireWebGL2Uniform(gl, program, "uClockSeconds"),
		lockedAxis: requireWebGL2Uniform(gl, program, "uLockedAxis"),
		materialKind: requireWebGL2Uniform(gl, program, "uMaterialKind"),
		materialColor: requireWebGL2Uniform(gl, program, "uMaterialColor"),
		palettedClipMap: requireWebGL2Uniform(gl, program, "uPalettedClipMap"),
		instanceBase: requireWebGL2Uniform(gl, program, "uInstanceBase"),
		motionType: requireWebGL2Uniform(gl, program, "uMotionType"),
		particleRecords: requireWebGL2Uniform(gl, program, "uParticleRecords"),
		opacityScale: requireWebGL2Uniform(gl, program, "uOpacityScale"),
		orientation: requireWebGL2Uniform(gl, program, "uOrientation"),
		palette: requireWebGL2Uniform(gl, program, "uPalette"),
		projection: requireWebGL2Uniform(gl, program, "uProjection"),
		view: requireWebGL2Uniform(gl, program, "uView"),
	};
	// Sampler units are invariant for the program's lifetime, so bind them once at creation.
	gl.useProgram(program);
	gl.uniform1i(uniforms.base, PARTICLE_TEXTURE_UNITS.base);
	gl.uniform1i(uniforms.palette, PARTICLE_TEXTURE_UNITS.palette);
	gl.uniform1i(uniforms.particleRecords, PARTICLE_TEXTURE_UNITS.records);
	const portalVisibilityUniforms = portalVisibility
		? bindWebGL2PortalDeferredVisibilityProgram(gl, program)
		: null;
	return { portalVisibilityUniforms, program, uniforms };
}
