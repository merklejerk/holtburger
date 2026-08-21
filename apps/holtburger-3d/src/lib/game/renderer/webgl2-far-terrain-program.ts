import { WEBGL2_DISTANCE_FOG_GLSL } from "./webgl2-fog";
import { WEBGL2_DIRECTIONAL_LIGHTING_GLSL } from "./webgl2-lighting";
import { TERRAIN_TYPE_COUNT } from "../terrain/pcode";
import {
	compileWebGL2Shader,
	requireWebGL2Uniform,
} from "./webgl2-shader-utils";

export const WEBGL2_FAR_TERRAIN_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 3) in uint aTerrainColorCode;

uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uLocalToLandblock;
uniform vec3 uLandblockOffset;
uniform vec3 uCameraPosition;
uniform vec4 uClipTransform;
uniform vec3 uTerrainPalette[${TERRAIN_TYPE_COUNT}];

${WEBGL2_DIRECTIONAL_LIGHTING_GLSL}

out vec3 vLitColor;
out float vViewerDistance;

void main() {
	vec3 landblockPosition = (uLocalToLandblock * vec4(aPosition, 1.0)).xyz;
	vec3 anchoredPosition = landblockPosition + uLandblockOffset;
	vec4 viewPosition = uView * vec4(anchoredPosition, 1.0);
	vec3 directionalLight = min(
		evaluateAmbientAndSun(mat3(uLocalToLandblock) * aNormal),
		vec3(1.0)
	);
	// RETAIL DIVERGENCE: retail selected a composed surface for every terrain cell from its four
	// authored corner codes (CLandBlockStruct::GetCellRotation, acclient.c:339677-339713) and drew
	// every visible land cell against that surface array (acclient.c:438478-438495). This far pass
	// instead resolves each authored vertex code to its source-surface mean and interpolates the
	// colors. Restoring retail composition would remove the approximation but also restore all near
	// texture/composition state for 111 of 139 visible landblocks in the deterministic 0xda55ffff
	// radius-8, noon-fog census captured on 2026-08-20.
	vLitColor = uTerrainPalette[int(aTerrainColorCode)] * directionalLight;
	vViewerDistance = length(anchoredPosition - uCameraPosition);
	vec4 clipPosition = uProjection * viewPosition;
	clipPosition.xy = clipPosition.xy * uClipTransform.xy
		+ clipPosition.ww * uClipTransform.zw;
	gl_Position = clipPosition;
}
`;

export const WEBGL2_FAR_TERRAIN_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform int uFogEnabled;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uFogColor;

${WEBGL2_DISTANCE_FOG_GLSL}

in vec3 vLitColor;
in float vViewerDistance;
out vec4 fragmentColor;

void main() {
	fragmentColor = vec4(applyDistanceFog(vLitColor, vViewerDistance), 1.0);
}
`;

/** Sampler-free far-terrain program resolving one shared regional palette per vertex. */
export interface WebGL2FarTerrainProgram {
	readonly program: WebGLProgram;
	readonly uniforms: {
		readonly ambientColor: WebGLUniformLocation;
		readonly ambientLevel: WebGLUniformLocation;
		readonly cameraPosition: WebGLUniformLocation;
		readonly clipTransform: WebGLUniformLocation;
		readonly fogColor: WebGLUniformLocation;
		readonly fogEnabled: WebGLUniformLocation;
		readonly fogFar: WebGLUniformLocation;
		readonly fogNear: WebGLUniformLocation;
		readonly landblockOffset: WebGLUniformLocation;
		readonly localToLandblock: WebGLUniformLocation;
		readonly palette: WebGLUniformLocation;
		readonly projection: WebGLUniformLocation;
		readonly sunColor: WebGLUniformLocation;
		readonly sunVector: WebGLUniformLocation;
		readonly view: WebGLUniformLocation;
	};
}

/** Compile the narrow far-terrain draw program. */
export function createWebGL2FarTerrainProgram(
	gl: WebGL2RenderingContext,
): WebGL2FarTerrainProgram {
	const vertexShader = compileWebGL2Shader(
		gl,
		gl.VERTEX_SHADER,
		WEBGL2_FAR_TERRAIN_VERTEX_SHADER,
	);
	const fragmentShader = compileWebGL2Shader(
		gl,
		gl.FRAGMENT_SHADER,
		WEBGL2_FAR_TERRAIN_FRAGMENT_SHADER,
	);
	const program = gl.createProgram();
	if (!program) {
		gl.deleteShader(vertexShader);
		gl.deleteShader(fragmentShader);
		throw new Error("Failed to allocate far-terrain shader program.");
	}
	try {
		gl.attachShader(program, vertexShader);
		gl.attachShader(program, fragmentShader);
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			throw new Error(
				`Failed to link far-terrain shader program: ${gl.getProgramInfoLog(program) ?? "unknown error"}`,
			);
		}
		return {
			program,
			uniforms: {
				ambientColor: requireWebGL2Uniform(gl, program, "uAmbientColor"),
				ambientLevel: requireWebGL2Uniform(gl, program, "uAmbientLevel"),
				cameraPosition: requireWebGL2Uniform(gl, program, "uCameraPosition"),
				clipTransform: requireWebGL2Uniform(gl, program, "uClipTransform"),
				fogColor: requireWebGL2Uniform(gl, program, "uFogColor"),
				fogEnabled: requireWebGL2Uniform(gl, program, "uFogEnabled"),
				fogFar: requireWebGL2Uniform(gl, program, "uFogFar"),
				fogNear: requireWebGL2Uniform(gl, program, "uFogNear"),
				landblockOffset: requireWebGL2Uniform(gl, program, "uLandblockOffset"),
				localToLandblock: requireWebGL2Uniform(
					gl,
					program,
					"uLocalToLandblock",
				),
				palette: requireWebGL2Uniform(gl, program, "uTerrainPalette[0]"),
				projection: requireWebGL2Uniform(gl, program, "uProjection"),
				sunColor: requireWebGL2Uniform(gl, program, "uSunColor"),
				sunVector: requireWebGL2Uniform(gl, program, "uSunVector"),
				view: requireWebGL2Uniform(gl, program, "uView"),
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
