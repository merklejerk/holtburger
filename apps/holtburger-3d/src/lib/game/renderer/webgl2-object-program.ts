import {
	compileWebGL2Shader,
	requireWebGL2Uniform,
} from "../webgl/shader-program";
import { WEBGL2_DISTANCE_FOG_GLSL } from "./webgl2-fog";
import { WEBGL2_SCENE_LIGHTING_GLSL } from "./webgl2-lighting";
import {
	bindWebGL2PortalDeferredVisibilityProgram,
	PORTAL_DEFERRED_VISIBILITY_GLSL,
	type WebGL2PortalDeferredVisibilityUniforms,
} from "./portal-deferred-visibility-glsl";

/**
 * Where a vertex shader reads its object transform, selected at shader compilation rather than
 * through nullable uniforms.
 *
 * Named for the GLSL storage the transform arrives in, not for how its geometry was produced.
 * The earlier "baked"/"instanced" spelling described geometry and was read that way, which is a
 * different question: a `uniform` draw does read merged geometry, but that is a fact about
 * `prepareBakedStaticObjectGeometry`, not about this field.
 */
export type ObjectVertexTransformSource = "uniform" | "attribute";

/**
 * Vertex attribute carrying burned-in interior static light.
 *
 * Locations 0-2 are geometry and 3-7 are the instanced transform and color, so this follows
 * them. Geometry without authored static lighting simply leaves the attribute disabled, and
 * WebGL2's default generic value contributes nothing.
 */
export const OBJECT_BAKED_LIGHT_ATTRIBUTE = 8;

/** Fixed sampler units shared by every linked object-program variant. */
export const OBJECT_TEXTURE_UNITS = {
	base: 0,
	palette: 1,
	detail: 2,
} as const;

/** Build one object vertex variant with explicit fog and transform contracts. */
export function createObjectVertexShader(
	distanceFog: boolean,
	transformSource: ObjectVertexTransformSource = "uniform",
): string {
	const fogDeclarations = distanceFog
		? `
uniform vec3 uCameraPosition;
out float vViewerDistance;`
		: "";
	const fogCalculation = distanceFog
		? "vViewerDistance = length(anchoredPosition - uCameraPosition);"
		: "";
	const transformDeclarations =
		transformSource === "attribute"
			? `
layout(location = 3) in mat4 aSourceToLandblock;
layout(location = 7) in vec4 aInstanceColor;`
			: "uniform mat4 uLocalToLandblock;";
	const transform =
		transformSource === "attribute"
			? "aSourceToLandblock"
			: "uLocalToLandblock";
	const instanceColor =
		transformSource === "attribute" ? "aInstanceColor" : "vec4(1.0)";
	return `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aTextureCoordinate;
layout(location = ${OBJECT_BAKED_LIGHT_ATTRIBUTE}) in vec3 aBakedLight;

uniform mat4 uProjection;
uniform mat4 uView;
uniform vec3 uLandblockOffset;
// Maps ordinary camera clip coordinates into the active scope-atlas tile. Flat rendering uses
// (1, 1, 0, 0); the viewport supplies the tile's hard raster boundary in portal mode.
uniform vec4 uClipTransform;
${transformDeclarations}
${fogDeclarations}

${WEBGL2_SCENE_LIGHTING_GLSL}

out vec2 vTextureCoordinate;
out vec4 vInstanceColor;
out vec3 vLighting;

void main() {
	vec3 landblockPosition = (${transform} * vec4(aPosition, 1.0)).xyz;
	vec3 anchoredPosition = landblockPosition + uLandblockOffset;
	vTextureCoordinate = aTextureCoordinate;
	vInstanceColor = ${instanceColor};
	// Retail's fixed-function pipeline lights meshes per vertex; the emissive term is added
	// in the fragment stage where the per-draw surface luminosity lives.
	vLighting = evaluateSceneLighting(
		anchoredPosition,
		mat3(${transform}) * aNormal,
		aBakedLight
	);
	${fogCalculation}
	vec4 clipPosition = uProjection * uView * vec4(anchoredPosition, 1.0);
	clipPosition.xy = clipPosition.xy * uClipTransform.xy
		+ clipPosition.ww * uClipTransform.zw;
	gl_Position = clipPosition;
}
`;
}

/** Build the object fragment variant; the unfogged variant omits fog uniforms entirely. */
export function createObjectFragmentShader(distanceFog: boolean): string {
	return createObjectFragmentShaderVariant(distanceFog, false);
}

/** Build the deferred object variant that rejects fragments outside one authored scope envelope. */
export function createPortalObjectFragmentShader(distanceFog: boolean): string {
	return createObjectFragmentShaderVariant(distanceFog, true);
}

function createObjectFragmentShaderVariant(
	distanceFog: boolean,
	portalVisibility: boolean,
): string {
	const fogDeclarations = distanceFog
		? `
uniform int uFogEnabled;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uFogColor;

${WEBGL2_DISTANCE_FOG_GLSL}`
		: "";
	const fogApplication = distanceFog
		? "color.rgb = applyDistanceFog(color.rgb, vViewerDistance);"
		: "";
	const portalDeclarations = portalVisibility
		? PORTAL_DEFERRED_VISIBILITY_GLSL
		: "";
	const portalApplication = portalVisibility
		? "if (!portalDeferredFragmentVisible()) discard;"
		: "";
	return `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

${portalDeclarations}

uniform sampler2D uBase;
uniform sampler2D uPalette;
uniform sampler2D uDetail;
uniform float uAlphaTest;
uniform int uMaterialKind;
uniform int uWrapRepeat;
uniform int uPalettedClipMap;
uniform int uUseDetail;
// Packed object rects use pixel-space x, y, width, height for exact texel addressing.
uniform vec4 uBaseRect;
uniform vec4 uPaletteRect;
uniform vec4 uDetailRect;
uniform vec4 uMaterialColor;
uniform float uDetailTiling;
uniform float uLuminosity;
${fogDeclarations}

in vec2 vTextureCoordinate;
in vec4 vInstanceColor;
in vec3 vLighting;
${distanceFog ? "in float vViewerDistance;" : ""}
out vec4 fragmentColor;

vec2 sourceUv() {
	return uWrapRepeat != 0 ? fract(vTextureCoordinate) : clamp(vTextureCoordinate, 0.0, 1.0);
}

vec2 pixelRectUv(vec2 source, vec4 rect, vec2 atlasSize) {
	return (rect.xy + source * rect.zw) / atlasSize;
}

vec4 sampleRepeatingAtlasRect(
	sampler2D atlasTexture,
	vec2 continuousSource,
	vec2 rectOrigin,
	vec2 rectExtent
) {
	// Preserve the continuous footprint across virtual repeat seams; fract derivatives
	// would otherwise select coarse atlas mips even when the surface is viewed up close.
	vec2 atlasUv = rectOrigin + fract(continuousSource) * rectExtent;
	vec2 atlasGradientX = dFdx(continuousSource) * rectExtent;
	vec2 atlasGradientY = dFdy(continuousSource) * rectExtent;
	return textureGrad(atlasTexture, atlasUv, atlasGradientX, atlasGradientY);
}

vec4 sampleRepeatingPixelRect(
	sampler2D atlasTexture,
	vec2 continuousSource,
	vec4 rect
) {
	vec2 atlasSize = vec2(textureSize(atlasTexture, 0));
	return sampleRepeatingAtlasRect(
		atlasTexture,
		continuousSource,
		rect.xy / atlasSize,
		rect.zw / atlasSize
	);
}

ivec2 resolveIndexedCoordinate(ivec2 coordinate, ivec2 size) {
	if (uWrapRepeat != 0) {
		return ivec2(
			((coordinate.x % size.x) + size.x) % size.x,
			((coordinate.y % size.y) + size.y) % size.y
		);
	}
	return clamp(coordinate, ivec2(0), size - ivec2(1));
}

float paletteIndexAt(ivec2 sourceCoordinate) {
	ivec2 atlasCoordinate = ivec2(uBaseRect.xy) + sourceCoordinate;
	vec4 encoded = texelFetch(uBase, atlasCoordinate, 0) * 255.0;
	return uMaterialKind == 2
		? floor(encoded.r + 0.5)
		: floor(encoded.r + 0.5) + floor(encoded.g + 0.5) * 256.0;
}

vec4 paletteColor(float index) {
	if (uPalettedClipMap != 0 && index < 8.0) return vec4(0.0);
	vec2 paletteSize = max(uPaletteRect.zw, vec2(1.0));
	if (index >= paletteSize.x * paletteSize.y) return vec4(0.0);
	vec2 paletteCoordinate = vec2(
		mod(index, paletteSize.x),
		floor(index / paletteSize.x)
	);
	return texelFetch(
		uPalette,
		ivec2(uPaletteRect.xy + paletteCoordinate),
		0
	);
}

vec4 indexedColorAt(ivec2 coordinate, ivec2 sourceSize) {
	return paletteColor(
		paletteIndexAt(resolveIndexedCoordinate(coordinate, sourceSize))
	);
}

vec4 sampleIndexedPaletteLinear(vec2 uv) {
	ivec2 sourceSize = ivec2(uBaseRect.zw);
	// Match normalized hardware bilinear sampling, whose texel centers lie at n + 0.5.
	vec2 texelPosition = uv * vec2(sourceSize) - vec2(0.5);
	ivec2 baseCoordinate = ivec2(floor(texelPosition));
	vec2 blend = fract(texelPosition);
	vec4 top = mix(
		indexedColorAt(baseCoordinate, sourceSize),
		indexedColorAt(baseCoordinate + ivec2(1, 0), sourceSize),
		blend.x
	);
	vec4 bottom = mix(
		indexedColorAt(baseCoordinate + ivec2(0, 1), sourceSize),
		indexedColorAt(baseCoordinate + ivec2(1, 1), sourceSize),
		blend.x
	);
	return mix(top, bottom, blend.y);
}

vec4 sampleMaterial() {
	if (uMaterialKind == 0) return uMaterialColor;
	vec2 uv = sourceUv();
	if (uMaterialKind == 1) {
		vec4 direct = (
			uWrapRepeat != 0
				? sampleRepeatingPixelRect(uBase, vTextureCoordinate, uBaseRect)
				: texture(
					uBase,
					pixelRectUv(uv, uBaseRect, vec2(textureSize(uBase, 0)))
				)
		) * uMaterialColor;
		if (direct.a < uAlphaTest) discard;
		return direct;
	}
	vec4 indexed = sampleIndexedPaletteLinear(uv) * uMaterialColor;
	if (indexed.a < uAlphaTest) discard;
	return indexed;
}

void main() {
	${portalApplication}
	vec4 color = sampleMaterial() * vInstanceColor;
	// Retail builds one clamped vertex color from emissive plus the lit terms, then the
	// texture stage modulates it (acclient.c:345688 sets Emissive = surface luminosity).
	// Luminosity therefore scales the surface rather than washing it out additively.
	color.rgb *= min(vLighting + vec3(max(uLuminosity, 0.0)), vec3(1.0));
	if (uUseDetail != 0) {
		vec4 detail = sampleRepeatingAtlasRect(
			uDetail,
			vTextureCoordinate * uDetailTiling,
			uDetailRect.xy,
			uDetailRect.zw - uDetailRect.xy
		);
		float detailAlpha = clamp(detail.a, 0.0, 1.0);
		color.rgb = clamp(
			color.rgb * (detail.rgb + (1.0 - detailAlpha)),
			vec3(0.0),
			vec3(1.0)
		);
	}
	${fogApplication}
	fragmentColor = color;
}
`;
}

/** Shared uniforms for every renderer-owned static-object material program. */
interface WebGL2ObjectProgramBase {
	readonly program: WebGLProgram;
	/** Null for ordinary draws; otherwise the sole per-draw authored-scope selector. */
	readonly portalVisibilityUniforms: WebGL2PortalDeferredVisibilityUniforms | null;
	readonly uniforms: {
		readonly alphaTest: WebGLUniformLocation;
		readonly ambientColor: WebGLUniformLocation;
		readonly dynamicLightCount: WebGLUniformLocation;
		readonly dynamicLightPositionRange: WebGLUniformLocation;
		readonly dynamicLightColorIntensity: WebGLUniformLocation;
		readonly staticLightCount: WebGLUniformLocation;
		readonly staticLightPositionRange: WebGLUniformLocation;
		readonly staticLightColorIntensity: WebGLUniformLocation;
		readonly ambientLevel: WebGLUniformLocation;
		readonly base: WebGLUniformLocation;
		readonly baseRect: WebGLUniformLocation;
		readonly clipTransform: WebGLUniformLocation;
		readonly detail: WebGLUniformLocation;
		readonly detailRect: WebGLUniformLocation;
		readonly detailTiling: WebGLUniformLocation;
		readonly landblockOffset: WebGLUniformLocation;
		readonly luminosity: WebGLUniformLocation;
		readonly materialColor: WebGLUniformLocation;
		readonly materialKind: WebGLUniformLocation;
		readonly palette: WebGLUniformLocation;
		readonly paletteRect: WebGLUniformLocation;
		readonly palettedClipMap: WebGLUniformLocation;
		readonly projection: WebGLUniformLocation;
		readonly sunColor: WebGLUniformLocation;
		readonly sunVector: WebGLUniformLocation;
		readonly useDetail: WebGLUniformLocation;
		readonly view: WebGLUniformLocation;
		readonly wrapRepeat: WebGLUniformLocation;
	};
}

/** Baked object program with one draw-scoped local transform uniform. */
export interface WebGL2ObjectProgram extends WebGL2ObjectProgramBase {
	readonly transformSource: "uniform";
	readonly uniforms: WebGL2ObjectProgramBase["uniforms"] & {
		readonly localToLandblock: WebGLUniformLocation;
	};
}

/** Instanced object program whose transforms and colors are vertex attributes. */
export interface WebGL2InstancedObjectProgram extends WebGL2ObjectProgramBase {
	readonly transformSource: "attribute";
}

/** Opaque-only program carrying the shared distance-fog uniform contract. */
export interface WebGL2FogObjectProgram extends WebGL2ObjectProgram {
	readonly fogUniforms: {
		readonly cameraPosition: WebGLUniformLocation;
		readonly fogColor: WebGLUniformLocation;
		readonly fogEnabled: WebGLUniformLocation;
		readonly fogFar: WebGLUniformLocation;
		readonly fogNear: WebGLUniformLocation;
	};
}

/** Fogged instanced program carrying the same distance-fog uniform contract. */
export interface WebGL2FogInstancedObjectProgram extends WebGL2InstancedObjectProgram {
	readonly fogUniforms: WebGL2FogObjectProgram["fogUniforms"];
}

interface WebGL2ObjectProgramOptions {
	readonly distanceFog: boolean;
	readonly portalVisibility: boolean;
	readonly transformSource: ObjectVertexTransformSource;
}

/** Compile the default fogged baked object-material program. */
export function createWebGL2ObjectProgram(
	gl: WebGL2RenderingContext,
): WebGL2FogObjectProgram;
/** Compile an unfogged program for transparent and additive static materials. */
export function createWebGL2ObjectProgram(
	gl: WebGL2RenderingContext,
	options: {
		readonly distanceFog: false;
		readonly portalVisibility?: false;
		readonly transformSource?: "uniform";
	},
): WebGL2ObjectProgram;
/** Compile a fogged object program backed by matrix/color instance attributes. */
export function createWebGL2ObjectProgram(
	gl: WebGL2RenderingContext,
	options: {
		readonly distanceFog: true;
		readonly portalVisibility?: false;
		readonly transformSource: "attribute";
	},
): WebGL2FogInstancedObjectProgram;
/** Compile an unfogged object program backed by matrix/color instance attributes. */
export function createWebGL2ObjectProgram(
	gl: WebGL2RenderingContext,
	options: {
		readonly distanceFog: false;
		readonly portalVisibility?: false;
		readonly transformSource: "attribute";
	},
): WebGL2InstancedObjectProgram;
/** Compile an unfogged baked program with scope-envelope visibility. */
export function createWebGL2ObjectProgram(
	gl: WebGL2RenderingContext,
	options: {
		readonly distanceFog: false;
		readonly portalVisibility: true;
		readonly transformSource?: "uniform";
	},
): WebGL2ObjectProgram;
/** Compile an unfogged instanced program with scope-envelope visibility. */
export function createWebGL2ObjectProgram(
	gl: WebGL2RenderingContext,
	options: {
		readonly distanceFog: false;
		readonly portalVisibility: true;
		readonly transformSource: "attribute";
	},
): WebGL2InstancedObjectProgram;
export function createWebGL2ObjectProgram(
	gl: WebGL2RenderingContext,
	options: Partial<WebGL2ObjectProgramOptions> = {},
):
	| WebGL2ObjectProgram
	| WebGL2FogObjectProgram
	| WebGL2InstancedObjectProgram
	| WebGL2FogInstancedObjectProgram {
	const distanceFog = options.distanceFog ?? true;
	const portalVisibility = options.portalVisibility ?? false;
	const transformSource = options.transformSource ?? "uniform";
	const vertexShader = compileWebGL2Shader(
		gl,
		gl.VERTEX_SHADER,
		createObjectVertexShader(distanceFog, transformSource),
	);
	const fragmentShader = compileWebGL2Shader(
		gl,
		gl.FRAGMENT_SHADER,
		portalVisibility
			? createPortalObjectFragmentShader(distanceFog)
			: createObjectFragmentShader(distanceFog),
	);
	const program = gl.createProgram();
	if (!program) throw new Error("Failed to allocate object shader program.");
	try {
		gl.attachShader(program, vertexShader);
		gl.attachShader(program, fragmentShader);
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			throw new Error(
				`Failed to link object shader program: ${gl.getProgramInfoLog(program) ?? "unknown error"}`,
			);
		}
		const uniforms: WebGL2ObjectProgramBase["uniforms"] = {
			alphaTest: requireWebGL2Uniform(gl, program, "uAlphaTest"),
			ambientColor: requireWebGL2Uniform(gl, program, "uAmbientColor"),
			dynamicLightCount: requireWebGL2Uniform(
				gl,
				program,
				"uDynamicLightCount",
			),
			dynamicLightPositionRange: requireWebGL2Uniform(
				gl,
				program,
				"uDynamicLightPositionRange[0]",
			),
			dynamicLightColorIntensity: requireWebGL2Uniform(
				gl,
				program,
				"uDynamicLightColorIntensity[0]",
			),
			staticLightCount: requireWebGL2Uniform(gl, program, "uStaticLightCount"),
			staticLightPositionRange: requireWebGL2Uniform(
				gl,
				program,
				"uStaticLightPositionRange[0]",
			),
			staticLightColorIntensity: requireWebGL2Uniform(
				gl,
				program,
				"uStaticLightColorIntensity[0]",
			),
			ambientLevel: requireWebGL2Uniform(gl, program, "uAmbientLevel"),
			base: requireWebGL2Uniform(gl, program, "uBase"),
			baseRect: requireWebGL2Uniform(gl, program, "uBaseRect"),
			clipTransform: requireWebGL2Uniform(gl, program, "uClipTransform"),
			detail: requireWebGL2Uniform(gl, program, "uDetail"),
			detailRect: requireWebGL2Uniform(gl, program, "uDetailRect"),
			detailTiling: requireWebGL2Uniform(gl, program, "uDetailTiling"),
			landblockOffset: requireWebGL2Uniform(gl, program, "uLandblockOffset"),
			luminosity: requireWebGL2Uniform(gl, program, "uLuminosity"),
			materialColor: requireWebGL2Uniform(gl, program, "uMaterialColor"),
			materialKind: requireWebGL2Uniform(gl, program, "uMaterialKind"),
			palette: requireWebGL2Uniform(gl, program, "uPalette"),
			paletteRect: requireWebGL2Uniform(gl, program, "uPaletteRect"),
			palettedClipMap: requireWebGL2Uniform(gl, program, "uPalettedClipMap"),
			projection: requireWebGL2Uniform(gl, program, "uProjection"),
			sunColor: requireWebGL2Uniform(gl, program, "uSunColor"),
			sunVector: requireWebGL2Uniform(gl, program, "uSunVector"),
			useDetail: requireWebGL2Uniform(gl, program, "uUseDetail"),
			view: requireWebGL2Uniform(gl, program, "uView"),
			wrapRepeat: requireWebGL2Uniform(gl, program, "uWrapRepeat"),
		};
		// Sampler-unit assignments are link-lifetime invariants. Program construction owns this
		// one-time mutation; renderer state mirrors begin unknown after all programs are created.
		gl.useProgram(program);
		gl.uniform1i(uniforms.base, OBJECT_TEXTURE_UNITS.base);
		gl.uniform1i(uniforms.palette, OBJECT_TEXTURE_UNITS.palette);
		gl.uniform1i(uniforms.detail, OBJECT_TEXTURE_UNITS.detail);
		const portalVisibilityUniforms = portalVisibility
			? bindWebGL2PortalDeferredVisibilityProgram(gl, program)
			: null;
		const objectProgram: WebGL2ObjectProgram | WebGL2InstancedObjectProgram =
			transformSource === "uniform"
				? {
						program,
						portalVisibilityUniforms,
						transformSource,
						uniforms: {
							...uniforms,
							localToLandblock: requireWebGL2Uniform(
								gl,
								program,
								"uLocalToLandblock",
							),
						},
					}
				: {
						program,
						portalVisibilityUniforms,
						transformSource,
						uniforms,
					};
		if (!distanceFog) return objectProgram;
		return {
			...objectProgram,
			fogUniforms: {
				cameraPosition: requireWebGL2Uniform(gl, program, "uCameraPosition"),
				fogColor: requireWebGL2Uniform(gl, program, "uFogColor"),
				fogEnabled: requireWebGL2Uniform(gl, program, "uFogEnabled"),
				fogFar: requireWebGL2Uniform(gl, program, "uFogFar"),
				fogNear: requireWebGL2Uniform(gl, program, "uFogNear"),
			},
		};
	} catch (error) {
		gl.deleteProgram(program);
		throw error;
	} finally {
		gl.deleteShader(vertexShader);
		gl.deleteShader(fragmentShader);
	}
}
