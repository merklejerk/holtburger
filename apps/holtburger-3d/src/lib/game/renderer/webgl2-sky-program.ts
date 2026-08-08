import {
	compileWebGL2Shader,
	requireWebGL2Uniform,
} from "./webgl2-shader-utils";

/** Sampler units bound once for the sky program's lifetime. */
export const SKY_TEXTURE_UNITS = {
	base: 0,
	palette: 1,
} as const;

/**
 * How the fragment stage should read the bound base texture.
 *
 * Mirrors the object program's material kinds, minus the ones the sky cannot reach: sky surfaces
 * are always texture-backed (never solid color) and never carry a detail texture.
 */
export const SKY_MATERIAL_KIND = {
	/** Direct color: `r8g8b8` or `a8r8g8b8`, sampled normally. */
	direct: 0,
	/** `index8`: one byte per texel indexing the bound palette. */
	index8: 1,
	/** `index16`: two bytes per texel indexing the bound palette. */
	index16: 2,
} as const;

/**
 * Sky vertex stage.
 *
 * Celestial objects are orientation-only: retail leaves them at the viewer cell's origin
 * (`GameSky::UseTime`, acclient.c:297744, writes an identity-origin frame) and makes them distant
 * purely through the pass's extended far plane. The view matrix therefore arrives with its
 * translation already removed, so the sky rotates with the camera but never translates with it.
 */
const SKY_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aTextureCoordinate;

uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uModel;
/** Authored \`tex_velocity\` phase for this draw, already wrapped into [0, 1). */
uniform vec2 uTextureOffset;

out vec2 vTextureCoordinate;

void main() {
	// The normal attribute is bound by the shared object geometry layout but unused: retail draws
	// the sky with lighting suppressed, so there is nothing to light against.
	vTextureCoordinate = aTextureCoordinate + uTextureOffset;
	gl_Position = uProjection * uView * uModel * vec4(aPosition, 1.0);
}
`;

/**
 * Sky fragment stage.
 *
 * Deliberately smaller than the object program's: no fog, no scene lighting, no detail texture, and
 * no atlas rect addressing. The sky owns standalone textures, so repeat wrapping is the sampler's
 * job rather than something emulated with \`fract\` and explicit gradients.
 *
 * SEAM: environment override needs fog here. `GameSky::Draw` forces fog off for the sky pass
 * *except* while an environment override is active (acclient.c:297398) — the one case this program
 * cannot express. Re-adding it is not a uniform flip: it means fog uniforms plus the shared
 * `WEBGL2_DISTANCE_FOG_GLSL` chunk, and deciding how fog distance behaves against this pass's
 * extended far plane (`SKY_FAR_PLANE`), which is the interaction most likely to be got wrong.
 * Omitted rather than stubbed because nothing can currently activate an override, and an
 * unreachable fog path would go untested until the day it matters.
 */
const SKY_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uBase;
uniform sampler2D uPalette;
uniform int uMaterialKind;
uniform float uAlphaTest;
/** Retail's indexed clip-map rule: palette indices below 8 are fully transparent. */
uniform int uPalettedClipMap;
/** The surface's own diffuse scale, modulating the sampled texture. Not authored \`max_bright\`. */
uniform float uDiffuse;
/** Authored brightness, replacing the surface's own; 1 where the day group authors none. */
uniform float uLuminosity;
/** Authored \`transparent\`, applied as alpha \`1 - t\`. */
uniform float uAlpha;

in vec2 vTextureCoordinate;
out vec4 fragmentColor;

float paletteIndex() {
	ivec2 size = textureSize(uBase, 0);
	// Indexed surfaces must not filter their index bytes, so address texels directly.
	ivec2 texel = ivec2(floor(fract(vTextureCoordinate) * vec2(size)));
	vec4 encoded = texelFetch(uBase, clamp(texel, ivec2(0), size - ivec2(1)), 0) * 255.0;
	return uMaterialKind == ${SKY_MATERIAL_KIND.index8}
		? floor(encoded.r + 0.5)
		: floor(encoded.r + 0.5) + floor(encoded.g + 0.5) * 256.0;
}

vec4 paletteColor(float index) {
	if (uPalettedClipMap != 0 && index < 8.0) return vec4(0.0);
	ivec2 size = textureSize(uPalette, 0);
	float width = float(size.x);
	if (index >= width * float(size.y)) return vec4(0.0);
	return texelFetch(
		uPalette,
		ivec2(int(mod(index, width)), int(floor(index / width))),
		0
	);
}

void main() {
	vec4 color = uMaterialKind == ${SKY_MATERIAL_KIND.direct}
		? texture(uBase, vTextureCoordinate)
		: paletteColor(paletteIndex());
	if (color.a < uAlphaTest) discard;
	// Retail picks one brightness channel, never both. D3DPolyRender branches on the surface's own
	// luminosity (acclient.c:434305): above zero it drives Emissive from it and the diffuse term
	// contributes nothing visible; at zero it takes the else branch and drives Ambient and Diffuse
	// instead. Multiplying the two together was wrong in both directions — it dimmed every emissive
	// layer by its diffuse scale, and it made a zero-luminosity layer resolve to black, which is
	// what the old full-brightness default existed to hide.
	//
	// Both uniforms already carry the day group's authored replacement where one exists and the
	// surface's own value where it does not, which is retail's -1 sentinel behaviour.
	float brightness = uLuminosity > 0.0 ? uLuminosity : uDiffuse;
	fragmentColor = vec4(
		color.rgb * brightness,
		color.a * uAlpha
	);
}
`;

export interface WebGL2SkyProgram {
	readonly program: WebGLProgram;
	readonly uniforms: {
		readonly projection: WebGLUniformLocation;
		readonly view: WebGLUniformLocation;
		readonly model: WebGLUniformLocation;
		readonly textureOffset: WebGLUniformLocation;
		readonly materialKind: WebGLUniformLocation;
		readonly alphaTest: WebGLUniformLocation;
		readonly palettedClipMap: WebGLUniformLocation;
		readonly diffuse: WebGLUniformLocation;
		readonly luminosity: WebGLUniformLocation;
		readonly alpha: WebGLUniformLocation;
	};
}

/** Link the sky program and bind its sampler units once. */
export function createWebGL2SkyProgram(
	gl: WebGL2RenderingContext,
): WebGL2SkyProgram {
	const vertexShader = compileWebGL2Shader(
		gl,
		gl.VERTEX_SHADER,
		SKY_VERTEX_SHADER,
	);
	const fragmentShader = compileWebGL2Shader(
		gl,
		gl.FRAGMENT_SHADER,
		SKY_FRAGMENT_SHADER,
	);
	const program = gl.createProgram();
	if (!program) throw new Error("Failed to allocate sky shader program.");
	gl.attachShader(program, vertexShader);
	gl.attachShader(program, fragmentShader);
	gl.linkProgram(program);
	gl.deleteShader(vertexShader);
	gl.deleteShader(fragmentShader);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const log = gl.getProgramInfoLog(program) ?? "unknown error";
		gl.deleteProgram(program);
		throw new Error(`Failed to link sky shader program: ${log}`);
	}
	gl.useProgram(program);
	gl.uniform1i(
		requireWebGL2Uniform(gl, program, "uBase"),
		SKY_TEXTURE_UNITS.base,
	);
	gl.uniform1i(
		requireWebGL2Uniform(gl, program, "uPalette"),
		SKY_TEXTURE_UNITS.palette,
	);
	gl.useProgram(null);
	return {
		program,
		uniforms: {
			alpha: requireWebGL2Uniform(gl, program, "uAlpha"),
			alphaTest: requireWebGL2Uniform(gl, program, "uAlphaTest"),
			diffuse: requireWebGL2Uniform(gl, program, "uDiffuse"),
			luminosity: requireWebGL2Uniform(gl, program, "uLuminosity"),
			materialKind: requireWebGL2Uniform(gl, program, "uMaterialKind"),
			model: requireWebGL2Uniform(gl, program, "uModel"),
			palettedClipMap: requireWebGL2Uniform(gl, program, "uPalettedClipMap"),
			projection: requireWebGL2Uniform(gl, program, "uProjection"),
			textureOffset: requireWebGL2Uniform(gl, program, "uTextureOffset"),
			view: requireWebGL2Uniform(gl, program, "uView"),
		},
	};
}
