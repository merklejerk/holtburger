import {
	compileWebGL2Shader,
	requireWebGL2Uniform,
} from "./webgl2-shader-utils";
import { WEBGL2_DISTANCE_FOG_GLSL } from "./webgl2-fog";

/** Build the object vertex variant; only fogged materials need camera-distance inputs. */
export function createObjectVertexShader(distanceFog: boolean): string {
	const fogDeclarations = distanceFog
		? `
uniform vec2 uCameraHorizontalPosition;
out float vHorizontalDistance;`
		: "";
	const fogCalculation = distanceFog
		? "vHorizontalDistance = length(anchoredPosition.xz - uCameraHorizontalPosition);"
		: "";
	return `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aTextureCoordinate;

uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uLocalToLandblock;
uniform vec3 uLandblockOffset;
${fogDeclarations}

out vec2 vTextureCoordinate;

void main() {
	vec3 landblockPosition = (uLocalToLandblock * vec4(aPosition, 1.0)).xyz;
	vec3 anchoredPosition = landblockPosition + uLandblockOffset;
	vTextureCoordinate = aTextureCoordinate;
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
	vec4 color = sampleMaterial();
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

/** Shared uniforms for all renderer-owned static-object material programs. */
export interface WebGL2ObjectProgram {
	readonly program: WebGLProgram;
	readonly uniforms: {
		readonly alphaTest: WebGLUniformLocation;
		readonly base: WebGLUniformLocation;
		readonly baseRect: WebGLUniformLocation;
		readonly detail: WebGLUniformLocation;
		readonly detailRect: WebGLUniformLocation;
		readonly detailTiling: WebGLUniformLocation;
		readonly landblockOffset: WebGLUniformLocation;
		readonly localToLandblock: WebGLUniformLocation;
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

/** Compile the fogged opaque object-material program. */
export function createWebGL2ObjectProgram(
	gl: WebGL2RenderingContext,
): WebGL2FogObjectProgram;
/** Compile an unfogged program for transparent and additive static materials. */
export function createWebGL2ObjectProgram(
	gl: WebGL2RenderingContext,
	options: { readonly distanceFog: false },
): WebGL2ObjectProgram;
export function createWebGL2ObjectProgram(
	gl: WebGL2RenderingContext,
	options: { readonly distanceFog: boolean } = { distanceFog: true },
): WebGL2ObjectProgram | WebGL2FogObjectProgram {
	const vertexShader = compileWebGL2Shader(
		gl,
		gl.VERTEX_SHADER,
		createObjectVertexShader(options.distanceFog),
	);
	const fragmentShader = compileWebGL2Shader(
		gl,
		gl.FRAGMENT_SHADER,
		createObjectFragmentShader(options.distanceFog),
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
		const objectProgram: WebGL2ObjectProgram = {
			program,
			uniforms: {
				alphaTest: requireWebGL2Uniform(gl, program, "uAlphaTest"),
				base: requireWebGL2Uniform(gl, program, "uBase"),
				baseRect: requireWebGL2Uniform(gl, program, "uBaseRect"),
				detail: requireWebGL2Uniform(gl, program, "uDetail"),
				detailRect: requireWebGL2Uniform(gl, program, "uDetailRect"),
				detailTiling: requireWebGL2Uniform(gl, program, "uDetailTiling"),
				landblockOffset: requireWebGL2Uniform(gl, program, "uLandblockOffset"),
				localToLandblock: requireWebGL2Uniform(
					gl,
					program,
					"uLocalToLandblock",
				),
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
			},
		};
		if (!options.distanceFog) return objectProgram;
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
