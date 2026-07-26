import {
	compileWebGL2Shader,
	requireWebGL2Uniform,
} from "./webgl2-shader-utils";
import { WEBGL2_DISTANCE_FOG_GLSL } from "./webgl2-fog";

/** Object transform source selected at shader compilation rather than through nullable uniforms. */
export type ObjectVertexTransformSource = "baked" | "instanced";

/** Build one object vertex variant with explicit fog and transform contracts. */
export function createObjectVertexShader(
	distanceFog: boolean,
	transformSource: ObjectVertexTransformSource = "baked",
): string {
	const fogDeclarations = distanceFog
		? `
uniform vec2 uCameraHorizontalPosition;
out float vHorizontalDistance;`
		: "";
	const fogCalculation = distanceFog
		? "vHorizontalDistance = length(anchoredPosition.xz - uCameraHorizontalPosition);"
		: "";
	const transformDeclarations =
		transformSource === "instanced"
			? `
layout(location = 3) in mat4 aSourceToLandblock;
layout(location = 7) in vec4 aInstanceColor;`
			: "uniform mat4 uLocalToLandblock;";
	const transform =
		transformSource === "instanced"
			? "aSourceToLandblock"
			: "uLocalToLandblock";
	const instanceColor =
		transformSource === "instanced" ? "aInstanceColor" : "vec4(1.0)";
	return `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aTextureCoordinate;

uniform mat4 uProjection;
uniform mat4 uView;
uniform vec3 uLandblockOffset;
${transformDeclarations}
${fogDeclarations}

out vec2 vTextureCoordinate;
out vec4 vInstanceColor;

void main() {
	vec3 landblockPosition = (${transform} * vec4(aPosition, 1.0)).xyz;
	vec3 anchoredPosition = landblockPosition + uLandblockOffset;
	vTextureCoordinate = aTextureCoordinate;
	vInstanceColor = ${instanceColor};
	${fogCalculation}
	gl_Position = uProjection * uView * vec4(anchoredPosition, 1.0);
}
`;
}

/** Build the object fragment variant; the unfogged variant omits fog uniforms entirely. */
export function createObjectFragmentShader(distanceFog: boolean): string {
	const fogDeclarations = distanceFog
		? `
uniform int uFogEnabled;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uFogColor;

${WEBGL2_DISTANCE_FOG_GLSL}`
		: "";
	const fogApplication = distanceFog
		? "color.rgb = applyDistanceFog(color.rgb, vHorizontalDistance);"
		: "";
	return `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uBase;
uniform sampler2D uPalette;
uniform sampler2D uDetail;
uniform float uAlphaTest;
uniform int uMaterialKind;
uniform int uWrapRepeat;
uniform int uUseDetail;
uniform int uPalettedClipMap;
uniform vec4 uBaseRect;
uniform vec4 uPaletteRect;
uniform vec2 uPaletteSize;
uniform vec4 uDetailRect;
uniform vec4 uMaterialColor;
uniform float uDetailTiling;
uniform float uLuminosity;
${fogDeclarations}

in vec2 vTextureCoordinate;
in vec4 vInstanceColor;
${distanceFog ? "in float vHorizontalDistance;" : ""}
out vec4 fragmentColor;

vec2 sourceUv() {
	return uWrapRepeat != 0 ? fract(vTextureCoordinate) : clamp(vTextureCoordinate, 0.0, 1.0);
}

vec2 atlasUv(vec2 source, vec4 rect) {
	return mix(rect.xy, rect.zw, source);
}

vec4 sampleMaterial() {
	if (uMaterialKind == 0) return uMaterialColor;
	vec2 uv = sourceUv();
	if (uMaterialKind == 1) {
		vec4 direct = texture(uBase, atlasUv(uv, uBaseRect)) * uMaterialColor;
		if (direct.a < uAlphaTest) discard;
		return direct;
	}
	vec4 encoded = texture(uBase, atlasUv(uv, uBaseRect));
	float index = uMaterialKind == 2
		? floor(encoded.r * 255.0 + 0.5)
		: floor(encoded.r * 255.0 + 0.5) + floor(encoded.g * 255.0 + 0.5) * 256.0;
	if (uPalettedClipMap != 0 && index < 8.0) discard;
	vec2 paletteSize = max(uPaletteSize, vec2(1.0));
	if (index >= paletteSize.x * paletteSize.y) return vec4(0.0);
	vec2 paletteCoordinate = vec2(mod(index, paletteSize.x), floor(index / paletteSize.x));
	vec2 paletteUv = uPaletteRect.xy + (paletteCoordinate + vec2(0.5)) / paletteSize * (uPaletteRect.zw - uPaletteRect.xy);
	return texture(uPalette, paletteUv) * uMaterialColor;
}

void main() {
	vec4 color = sampleMaterial() * vInstanceColor;
	if (uUseDetail != 0) {
		vec2 detailUv = atlasUv(fract(vTextureCoordinate * uDetailTiling), uDetailRect);
		vec4 detail = texture(uDetail, detailUv);
		color.rgb = mix(color.rgb, detail.rgb, detail.a);
	}
	color.rgb += vec3(max(uLuminosity, 0.0));
	${fogApplication}
	fragmentColor = color;
}
`;
}

/** Shared uniforms for every renderer-owned static-object material program. */
interface WebGL2ObjectProgramBase {
	readonly program: WebGLProgram;
	readonly uniforms: {
		readonly alphaTest: WebGLUniformLocation;
		readonly base: WebGLUniformLocation;
		readonly baseRect: WebGLUniformLocation;
		readonly detail: WebGLUniformLocation;
		readonly detailRect: WebGLUniformLocation;
		readonly detailTiling: WebGLUniformLocation;
		readonly landblockOffset: WebGLUniformLocation;
		readonly luminosity: WebGLUniformLocation;
		readonly materialColor: WebGLUniformLocation;
		readonly materialKind: WebGLUniformLocation;
		readonly palette: WebGLUniformLocation;
		readonly paletteRect: WebGLUniformLocation;
		readonly paletteSize: WebGLUniformLocation;
		readonly palettedClipMap: WebGLUniformLocation;
		readonly projection: WebGLUniformLocation;
		readonly useDetail: WebGLUniformLocation;
		readonly view: WebGLUniformLocation;
		readonly wrapRepeat: WebGLUniformLocation;
	};
}

/** Baked object program with one draw-scoped local transform uniform. */
export interface WebGL2ObjectProgram extends WebGL2ObjectProgramBase {
	readonly transformSource: "baked";
	readonly uniforms: WebGL2ObjectProgramBase["uniforms"] & {
		readonly localToLandblock: WebGLUniformLocation;
	};
}

/** Instanced object program whose transforms and colors are vertex attributes. */
export interface WebGL2InstancedObjectProgram extends WebGL2ObjectProgramBase {
	readonly transformSource: "instanced";
}

/** Opaque-only program carrying the shared distance-fog uniform contract. */
export interface WebGL2FogObjectProgram extends WebGL2ObjectProgram {
	readonly fogUniforms: {
		readonly cameraHorizontalPosition: WebGLUniformLocation;
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
		readonly transformSource?: "baked";
	},
): WebGL2ObjectProgram;
/** Compile a fogged object program backed by matrix/color instance attributes. */
export function createWebGL2ObjectProgram(
	gl: WebGL2RenderingContext,
	options: {
		readonly distanceFog: true;
		readonly transformSource: "instanced";
	},
): WebGL2FogInstancedObjectProgram;
/** Compile an unfogged object program backed by matrix/color instance attributes. */
export function createWebGL2ObjectProgram(
	gl: WebGL2RenderingContext,
	options: {
		readonly distanceFog: false;
		readonly transformSource: "instanced";
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
	const transformSource = options.transformSource ?? "baked";
	const vertexShader = compileWebGL2Shader(
		gl,
		gl.VERTEX_SHADER,
		createObjectVertexShader(distanceFog, transformSource),
	);
	const fragmentShader = compileWebGL2Shader(
		gl,
		gl.FRAGMENT_SHADER,
		createObjectFragmentShader(distanceFog),
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
			base: requireWebGL2Uniform(gl, program, "uBase"),
			baseRect: requireWebGL2Uniform(gl, program, "uBaseRect"),
			detail: requireWebGL2Uniform(gl, program, "uDetail"),
			detailRect: requireWebGL2Uniform(gl, program, "uDetailRect"),
			detailTiling: requireWebGL2Uniform(gl, program, "uDetailTiling"),
			landblockOffset: requireWebGL2Uniform(gl, program, "uLandblockOffset"),
			luminosity: requireWebGL2Uniform(gl, program, "uLuminosity"),
			materialColor: requireWebGL2Uniform(gl, program, "uMaterialColor"),
			materialKind: requireWebGL2Uniform(gl, program, "uMaterialKind"),
			palette: requireWebGL2Uniform(gl, program, "uPalette"),
			paletteRect: requireWebGL2Uniform(gl, program, "uPaletteRect"),
			paletteSize: requireWebGL2Uniform(gl, program, "uPaletteSize"),
			palettedClipMap: requireWebGL2Uniform(gl, program, "uPalettedClipMap"),
			projection: requireWebGL2Uniform(gl, program, "uProjection"),
			useDetail: requireWebGL2Uniform(gl, program, "uUseDetail"),
			view: requireWebGL2Uniform(gl, program, "uView"),
			wrapRepeat: requireWebGL2Uniform(gl, program, "uWrapRepeat"),
		};
		const objectProgram: WebGL2ObjectProgram | WebGL2InstancedObjectProgram =
			transformSource === "baked"
				? {
						program,
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
						transformSource,
						uniforms,
					};
		if (!distanceFog) return objectProgram;
		return {
			...objectProgram,
			fogUniforms: {
				cameraHorizontalPosition: requireWebGL2Uniform(
					gl,
					program,
					"uCameraHorizontalPosition",
				),
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
