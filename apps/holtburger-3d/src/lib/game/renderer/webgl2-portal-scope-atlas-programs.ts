import { PORTAL_QUERY_EPSILON } from "../scene/planar-aperture";
import { PORTAL_WINDOW_NDC_EPSILON } from "./portal-view-window";
import { PORTAL_ARRIVAL_METADATA_HAS_ENTRY_PLANE } from "./portal-arrival-metadata";
import {
	PORTAL_CROSSING_DEPTH_POLICY_REJECT_EQUAL,
	PORTAL_CROSSING_NEAR_CLIP_RAY_FLAG,
} from "./portal-crossing-triangle-stream";
import { PORTAL_SCOPE_ATLAS_TEXTURE_UNITS } from "./portal-scope-atlas-command-model";
import { PORTAL_ENVELOPE_SAMPLING_GLSL } from "./portal-envelope-sampling-glsl";
import {
	bindPortalScopeAtlasMetadataBlock,
	PORTAL_SCOPE_ATLAS_METADATA_GLSL,
} from "./portal-scope-atlas-metadata-glsl";
import {
	compileWebGL2Shader,
	requireWebGL2Uniform,
} from "./webgl2-shader-utils";

const PROPAGATION_VERTEX_SHADER = `#version 300 es
precision highp float;
precision highp int;

${PORTAL_SCOPE_ATLAS_METADATA_GLSL}

layout(location = 0) in vec3 aPosition;
layout(location = 1) in uint aOutputArrival;
layout(location = 2) in uint aSourceScope;
layout(location = 3) in uint aPolicy;

out vec3 vAnchorPosition;
flat out uint vOutputArrival;
flat out uint vSourceScope;
flat out uint vPolicy;

void main() {
	vAnchorPosition = aPosition;
	vOutputArrival = aOutputArrival;
	vSourceScope = aSourceScope;
	vPolicy = aPolicy;
	vec4 clipPosition = uClipFromAnchor * vec4(aPosition, 1.0);
	if ((aPolicy & ${PORTAL_CROSSING_NEAR_CLIP_RAY_FLAG}u) != 0u) {
		// Keeping z at the positive epsilon makes canonical clipping retain exactly the
		// w >= epsilon and x/y side planes used by the CPU eye-ray projection.
		clipPosition.z = ${PORTAL_WINDOW_NDC_EPSILON};
	}
	gl_Position = clipPosition;
}
`;

const REDUCTION_VERTEX_SHADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

${PORTAL_SCOPE_ATLAS_METADATA_GLSL}

uniform sampler2D uSceneDepth;
flat out uint vScope;

vec2 unitVertex(int vertex) {
	const vec2 vertices[6] = vec2[6](
		vec2(0.0, 0.0), vec2(1.0, 0.0), vec2(1.0, 1.0),
		vec2(0.0, 0.0), vec2(1.0, 1.0), vec2(0.0, 1.0)
	);
	return vertices[vertex];
}

void main() {
	uint scope = uint(gl_InstanceID);
	PortalScopeMetadata metadata = uScopes[scope];
	vec2 atlasPixel = vec2(metadata.atlasAndScreenOrigin.xy)
		+ unitVertex(gl_VertexID) * vec2(metadata.extentAndReserved.xy);
	vec2 atlasExtent = vec2(textureSize(uSceneDepth, 0));
	vScope = scope;
	gl_Position = vec4(atlasPixel * 2.0 / atlasExtent - 1.0, 0.0, 1.0);
}
`;

const REDUCTION_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
precision highp sampler2D;

${PORTAL_SCOPE_ATLAS_METADATA_GLSL}

uniform highp usampler2D uFrontier0;
uniform highp usampler2D uFrontier1;
uniform sampler2D uFrontierDepth;
uniform int uRound;
uniform int uTraversalDepth;
flat in uint vScope;

uint arrivalScope(uint arrival) {
	return uArrivals[arrival - 1u].route.x;
}

void main() {
	PortalScopeMetadata scope = uScopes[vScope];
	ivec2 atlasPixel = ivec2(gl_FragCoord.xy);
	ivec2 screenPixel = ivec2(scope.atlasAndScreenOrigin.zw)
		+ atlasPixel - ivec2(scope.atlasAndScreenOrigin.xy);
	uint current;
	if (uRound == 0) {
		current = 1u;
	} else if ((uRound & 1) == 1) {
		current = texelFetch(uFrontier0, screenPixel, 0).r;
	} else {
		current = texelFetch(uFrontier1, screenPixel, 0).r;
	}
	uint next = (uRound & 1) == 0
		? texelFetch(uFrontier0, screenPixel, 0).r
		: texelFetch(uFrontier1, screenPixel, 0).r;

	bool contributesCurrent = current != 0u && arrivalScope(current) == vScope;
	bool contributesTerminal = uRound + 1 == uTraversalDepth
		&& next != 0u
		&& arrivalScope(next) == vScope;
	if (!contributesCurrent && !contributesTerminal) discard;

	float encodedDepth = 0.0;
	if (contributesCurrent) {
		encodedDepth = next == 0u
			? 1.0
			: texelFetch(uFrontierDepth, screenPixel, 0).r * 0.5;
	}
	if (contributesTerminal) encodedDepth = 1.0;
	gl_FragDepth = encodedDepth;
}
`;

const RESOLVE_VERTEX_SHADER = `#version 300 es
precision highp float;
precision highp int;

${PORTAL_SCOPE_ATLAS_METADATA_GLSL}

flat out uint vScope;

vec2 unitVertex(int vertex) {
	const vec2 vertices[6] = vec2[6](
		vec2(0.0, 0.0), vec2(1.0, 0.0), vec2(1.0, 1.0),
		vec2(0.0, 0.0), vec2(1.0, 1.0), vec2(0.0, 1.0)
	);
	return vertices[vertex];
}

void main() {
	uint scope = uint(gl_InstanceID);
	PortalScopeMetadata metadata = uScopes[scope];
	vec2 screenPixel = vec2(metadata.atlasAndScreenOrigin.zw)
		+ unitVertex(gl_VertexID) * vec2(metadata.extentAndReserved.xy);
	vec2 drawingExtent = vec2(uScopes[0].extentAndReserved.xy);
	vScope = scope;
	gl_Position = vec4(screenPixel * 2.0 / drawingExtent - 1.0, 0.0, 1.0);
}
`;

const RESOLVE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

${PORTAL_SCOPE_ATLAS_METADATA_GLSL}
${PORTAL_ENVELOPE_SAMPLING_GLSL}

uniform sampler2D uSceneColor;
uniform sampler2D uSceneDepth;
flat in uint vScope;
layout(location = 0) out vec4 outColor;

void main() {
	PortalScopeMetadata scope = uScopes[vScope];
	ivec2 screenPixel = ivec2(gl_FragCoord.xy);
	ivec2 atlasPixel = portalScopeAtlasPixel(scope, screenPixel);
	float envelopeDepth = portalEnvelopeDepthAtAtlasPixel(scope, atlasPixel);
	float sceneDepth = texelFetch(uSceneDepth, atlasPixel, 0).r;
	if (envelopeDepth != 1.0 && sceneDepth * 0.5 >= envelopeDepth) discard;
	outColor = texelFetch(uSceneColor, atlasPixel, 0);
	gl_FragDepth = sceneDepth;
}
`;

/** Linked program set and the only frame-varying reduction uniforms. */
export interface WebGL2PortalScopeAtlasPrograms {
	readonly propagationFrom0: WebGLProgram;
	readonly propagationFrom1: WebGLProgram;
	readonly propagationRoot: WebGLProgram;
	readonly reduction: WebGLProgram;
	readonly reductionUniforms: {
		readonly round: WebGLUniformLocation;
		readonly traversalDepth: WebGLUniformLocation;
	};
	readonly resolve: WebGLProgram;
}

/** Link the shader substrate and bind every sampler/block decision once. */
export function createWebGL2PortalScopeAtlasPrograms(
	gl: WebGL2RenderingContext,
	metadataBindingPoint: number,
): WebGL2PortalScopeAtlasPrograms {
	const previousProgram = gl.getParameter(
		gl.CURRENT_PROGRAM,
	) as WebGLProgram | null;
	const programs: WebGLProgram[] = [];
	try {
		const propagationRoot = linkProgram(
			gl,
			PROPAGATION_VERTEX_SHADER,
			propagationFragmentShader(null),
			"root propagation",
		);
		programs.push(propagationRoot);
		const propagationFrom0 = linkProgram(
			gl,
			PROPAGATION_VERTEX_SHADER,
			propagationFragmentShader(PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.frontier0),
			"frontier-0 propagation",
		);
		programs.push(propagationFrom0);
		const propagationFrom1 = linkProgram(
			gl,
			PROPAGATION_VERTEX_SHADER,
			propagationFragmentShader(PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.frontier1),
			"frontier-1 propagation",
		);
		programs.push(propagationFrom1);
		const reduction = linkProgram(
			gl,
			REDUCTION_VERTEX_SHADER,
			REDUCTION_FRAGMENT_SHADER,
			"envelope reduction",
		);
		programs.push(reduction);
		const resolve = linkProgram(
			gl,
			RESOLVE_VERTEX_SHADER,
			RESOLVE_FRAGMENT_SHADER,
			"scope resolve",
		);
		programs.push(resolve);

		for (const program of programs) {
			bindPortalScopeAtlasMetadataBlock(gl, program, metadataBindingPoint);
		}
		configurePropagationSamplers(gl, propagationRoot, null);
		configurePropagationSamplers(
			gl,
			propagationFrom0,
			PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.frontier0,
		);
		configurePropagationSamplers(
			gl,
			propagationFrom1,
			PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.frontier1,
		);
		gl.useProgram(reduction);
		gl.uniform1i(
			requireWebGL2Uniform(gl, reduction, "uSceneDepth"),
			PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.sceneDepth,
		);
		gl.uniform1i(
			requireWebGL2Uniform(gl, reduction, "uFrontier0"),
			PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.frontier0,
		);
		gl.uniform1i(
			requireWebGL2Uniform(gl, reduction, "uFrontier1"),
			PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.frontier1,
		);
		gl.uniform1i(
			requireWebGL2Uniform(gl, reduction, "uFrontierDepth"),
			PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.frontierDepth,
		);
		gl.useProgram(resolve);
		gl.uniform1i(
			requireWebGL2Uniform(gl, resolve, "uSceneColor"),
			PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.sceneColor,
		);
		gl.uniform1i(
			requireWebGL2Uniform(gl, resolve, "uSceneDepth"),
			PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.sceneDepth,
		);
		gl.uniform1i(
			requireWebGL2Uniform(gl, resolve, "uPortalEnvelopeDepth"),
			PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.envelopeDepth,
		);
		return {
			propagationFrom0,
			propagationFrom1,
			propagationRoot,
			reduction,
			reductionUniforms: {
				round: requireWebGL2Uniform(gl, reduction, "uRound"),
				traversalDepth: requireWebGL2Uniform(gl, reduction, "uTraversalDepth"),
			},
			resolve,
		};
	} catch (cause) {
		for (const program of programs) gl.deleteProgram(program);
		throw cause;
	} finally {
		gl.useProgram(previousProgram);
	}
}

/** Dispose every linked variant exactly once. */
export function destroyWebGL2PortalScopeAtlasPrograms(
	gl: WebGL2RenderingContext,
	programs: WebGL2PortalScopeAtlasPrograms,
): void {
	gl.deleteProgram(programs.propagationRoot);
	gl.deleteProgram(programs.propagationFrom0);
	gl.deleteProgram(programs.propagationFrom1);
	gl.deleteProgram(programs.reduction);
	gl.deleteProgram(programs.resolve);
}

function propagationFragmentShader(currentFrontierUnit: number | null): string {
	const currentDeclaration =
		currentFrontierUnit === null
			? ""
			: "uniform highp usampler2D uCurrentFrontier;";
	const currentRead =
		currentFrontierUnit === null
			? "uint current = 1u;"
			: "uint current = texelFetch(uCurrentFrontier, screenPixel, 0).r;";
	return `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
precision highp sampler2D;

${PORTAL_SCOPE_ATLAS_METADATA_GLSL}

uniform sampler2D uSceneDepth;
${currentDeclaration}
in vec3 vAnchorPosition;
flat in uint vOutputArrival;
flat in uint vSourceScope;
flat in uint vPolicy;
layout(location = 0) out uint outState;

void main() {
	ivec2 screenPixel = ivec2(gl_FragCoord.xy);
	${currentRead}
	if (current == 0u) discard;
	PortalArrivalMetadata arrival = uArrivals[current - 1u];
	if (arrival.route.x != vSourceScope || arrival.route.y == vOutputArrival) discard;
	if ((arrival.route.z & ${PORTAL_ARRIVAL_METADATA_HAS_ENTRY_PLANE}u) != 0u
		&& dot(arrival.entryPlane, vec4(vAnchorPosition, 1.0)) <= ${PORTAL_QUERY_EPSILON}) {
		discard;
	}
	PortalScopeMetadata scope = uScopes[vSourceScope];
	uvec2 screenOrigin = scope.atlasAndScreenOrigin.zw;
	uvec2 extent = scope.extentAndReserved.xy;
	if (any(lessThan(uvec2(screenPixel), screenOrigin))
		|| any(greaterThanEqual(uvec2(screenPixel), screenOrigin + extent))) {
		discard;
	}
	ivec2 atlasPixel = ivec2(scope.atlasAndScreenOrigin.xy)
		+ screenPixel - ivec2(screenOrigin);
	if ((vPolicy & ${PORTAL_CROSSING_NEAR_CLIP_RAY_FLAG}u) == 0u) {
		float localOpaqueDepth = texelFetch(uSceneDepth, atlasPixel, 0).r;
		bool occluded = vPolicy == ${PORTAL_CROSSING_DEPTH_POLICY_REJECT_EQUAL}u
			? gl_FragCoord.z >= localOpaqueDepth
			: gl_FragCoord.z > localOpaqueDepth;
		if (occluded) discard;
	}
	outState = vOutputArrival;
}
`;
}

function configurePropagationSamplers(
	gl: WebGL2RenderingContext,
	program: WebGLProgram,
	currentFrontierUnit: number | null,
): void {
	gl.useProgram(program);
	gl.uniform1i(
		requireWebGL2Uniform(gl, program, "uSceneDepth"),
		PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.sceneDepth,
	);
	if (currentFrontierUnit !== null) {
		gl.uniform1i(
			requireWebGL2Uniform(gl, program, "uCurrentFrontier"),
			currentFrontierUnit,
		);
	}
}

function linkProgram(
	gl: WebGL2RenderingContext,
	vertexSource: string,
	fragmentSource: string,
	owner: string,
): WebGLProgram {
	const vertex = compileWebGL2Shader(gl, gl.VERTEX_SHADER, vertexSource);
	let fragment: WebGLShader | null = null;
	let program: WebGLProgram | null = null;
	try {
		fragment = compileWebGL2Shader(gl, gl.FRAGMENT_SHADER, fragmentSource);
		program = gl.createProgram();
		if (!program) {
			throw new Error(
				`Failed to allocate portal scope-atlas ${owner} program.`,
			);
		}
		gl.attachShader(program, vertex);
		gl.attachShader(program, fragment);
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			throw new Error(
				`Failed to link portal scope-atlas ${owner} program: ${gl.getProgramInfoLog(program) ?? "unknown error"}.`,
			);
		}
		return program;
	} catch (cause) {
		if (program) gl.deleteProgram(program);
		throw cause;
	} finally {
		gl.deleteShader(vertex);
		if (fragment) gl.deleteShader(fragment);
	}
}
