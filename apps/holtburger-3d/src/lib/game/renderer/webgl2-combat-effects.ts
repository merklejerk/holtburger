import type {
	CombatEffectInstance,
	CombatEffectsAppearance,
	CombatEffectsResources,
	CombatEffectsTuning,
} from "../systems/combat-effects-system";

import type { SceneScope } from "../scene";
import { scopeKey } from "../scene/scope";
import { createLandblockWorldOrigin } from "../landblocks";
import type { LandblockOwnerId } from "../game-types";
import {
	linkWebGL2Program,
	requireWebGL2Uniform,
} from "../webgl/shader-program";
import { BILLBOARD_CLIP_GLSL } from "./billboard-clip-glsl";
import {
	bindWebGL2PortalDeferredVisibilityProgram,
	PORTAL_DEFERRED_VISIBILITY_GLSL,
	type WebGL2PortalDeferredVisibilityUniforms,
} from "./portal-deferred-visibility-glsl";
import type { NameplatePortalScopeRouting } from "./webgl2-nameplate-pass";

/** Whole labels share one atlas entry; rasterization and lookup use the same vocabulary. */
const WHOLE_WORD_TOKENS: readonly string[] = ["MISS", "RESIST", "CRITICAL"];

/** Complete per-view routing facts; renderer scope keys are never retained by effects. */
export interface CombatEffectsView {
	readonly clipFromAnchor: Float32Array;
	readonly anchorLandblockId: LandblockOwnerId;
	readonly width: number;
	readonly height: number;
	readonly density: number;
	readonly selectedScope: (scope: SceneScope) => number | null;
	readonly routing: NameplatePortalScopeRouting | null;
}

interface Glyph {
	readonly uv: readonly [number, number, number, number];
	readonly width: number;
	readonly height: number;
	readonly advance: number;
	/** Texture padding/bearing relative to the shaped text origin. */
	readonly offsetX: number;
}
interface Program {
	readonly handle: WebGLProgram;
	readonly matrix: WebGLUniformLocation;
	readonly extent: WebGLUniformLocation;
	readonly density: WebGLUniformLocation;
	readonly portal: WebGL2PortalDeferredVisibilityUniforms | null;
}
interface DeviceResources {
	readonly texture: WebGLTexture;
	readonly sampler: WebGLSampler;
	readonly buffer: WebGLBuffer;
	readonly vao: WebGLVertexArrayObject;
	readonly flat: Program;
	readonly portal: Program;
	readonly glyphs: ReadonlyMap<string, Glyph>;
}

const FLOATS_PER_GLYPH = 16;
const CORNERS =
	"vec2[6](vec2(0,0),vec2(1,0),vec2(1,1),vec2(0,0),vec2(1,1),vec2(0,1))";

/** Effects-owned GPU adapter: one lazy atlas, bounded instance uploads, explicit release. */
export class WebGL2CombatEffects implements CombatEffectsResources {
	readonly #gl: WebGL2RenderingContext;
	#tuning: CombatEffectsTuning;
	#atlasDirty = false;
	#device: DeviceResources | null = null;
	#instances: readonly CombatEffectInstance[] = [];
	#released = false;
	#scratch = new Float32Array(0);
	#used = 0;

	constructor(gl: WebGL2RenderingContext, tuning: CombatEffectsTuning) {
		this.#gl = gl;
		this.#tuning = tuning;
	}

	setAppearance(appearance: CombatEffectsAppearance): void {
		if (this.#released)
			throw new Error("Combat effects adapter has been released.");
		if (
			appearance.font !== this.#tuning.font ||
			appearance.fontSize !== this.#tuning.fontSize
		)
			this.refreshFontAtlas();
		this.#tuning = { ...this.#tuning, ...appearance };
	}

	refreshFontAtlas(): void {
		if (this.#released)
			throw new Error("Combat effects adapter has been released.");
		this.#atlasDirty = true;
	}

	submit(instances: readonly CombatEffectInstance[]): void {
		if (this.#released)
			throw new Error("Combat effects adapter has been released.");
		this.#instances = instances;
	}
	clear(): void {
		this.#instances = [];
	}

	/** Route snapshots independently of any now-deleted entity's live render contribution. */
	drawWorld(view: CombatEffectsView): void {
		if (this.#released) return;
		const domains = new Map<
			number,
			{ key: string; effects: CombatEffectInstance[] }
		>();
		for (const effect of this.#instances) {
			if (effect.placement.kind !== "world") continue;
			const seen = new Set<number>();
			for (const scope of effect.placement.scopes) {
				const ordinal = view.selectedScope(scope);
				if (ordinal === null || seen.has(ordinal)) continue;
				seen.add(ordinal);
				let domain = domains.get(ordinal);
				if (!domain) {
					domain = { key: scopeKey(scope), effects: [] };
					domains.set(ordinal, domain);
				}
				domain.effects.push(effect);
			}
		}
		for (const domain of domains.values())
			this.#draw(domain.effects, view, domain.key, false);
	}

	/** Unplaced effects draw exactly once on the final framebuffer, after scene composition. */
	drawLane(width: number, height: number, density: number): void {
		if (this.#released) return;
		const effects = this.#instances.filter(
			(effect) => effect.placement.kind === "unplaced",
		);
		if (effects.length === 0) return;
		const gl = this.#gl;
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, width, height);
		this.#draw(
			effects,
			{
				width,
				height,
				density,
				clipFromAnchor: new Float32Array(16),
				anchorLandblockId: "0x0000ffff",
				selectedScope: () => null,
				routing: null,
			},
			"outdoor",
			true,
		);
	}

	#draw(
		effects: readonly CombatEffectInstance[],
		view: CombatEffectsView,
		key: string,
		screen: boolean,
	): void {
		if (effects.length === 0) return;
		if (this.#device === null) {
			this.#device = createDevice(this.#gl, this.#tuning);
			this.#atlasDirty = false;
		} else if (this.#atlasDirty) {
			const atlas = rasterAtlas(this.#tuning);
			uploadAtlas(this.#gl, this.#device.texture, atlas.canvas);
			this.#device = { ...this.#device, glyphs: atlas.glyphs };
			this.#atlasDirty = false;
		}
		const device = this.#device;
		this.#used = 0;
		for (const effect of effects) {
			const anchor: [number, number, number] = [0, 0, 0];
			if (effect.placement.kind === "world") {
				const origin = createLandblockWorldOrigin(view.anchorLandblockId);
				anchor[0] = effect.placement.position[0] - origin.x;
				anchor[1] =
					effect.placement.position[1] -
					origin.y +
					this.#tuning.worldRise * effect.progress;
				anchor[2] = effect.placement.position[2] - origin.z;
			}
			const y = screen ? -this.#tuning.screenRise * effect.progress : 0;

			const outline = effect.profile === "critical" ? "critical" : "normal";
			this.#writeText(
				effect.text,
				outline,
				effect,
				anchor,
				effect.spreadPixels,
				y,
				effect.scale,
				screen,
				device.glyphs,
			);
			if (effect.profile === "critical") {
				this.#writeText(
					"CRITICAL",
					"critical",
					effect,
					anchor,
					effect.spreadPixels,
					y -
						(this.#tuning.fontSize + this.#tuning.criticalLabelGap) *
							effect.scale,
					effect.scale * this.#tuning.criticalLabelScale,
					screen,
					device.glyphs,
				);
			}
		}
		const gl = this.#gl;
		const program = view.routing && !screen ? device.portal : device.flat;
		gl.useProgram(program.handle);
		gl.uniformMatrix4fv(program.matrix, false, view.clipFromAnchor);
		gl.uniform2f(program.extent, view.width, view.height);
		gl.uniform1f(program.density, view.density);
		if (view.routing && program.portal)
			view.routing.routeDeferredSubmission(key, program.portal);
		gl.bindVertexArray(device.vao);
		gl.bindBuffer(gl.ARRAY_BUFFER, device.buffer);
		gl.bufferData(
			gl.ARRAY_BUFFER,
			this.#scratch.subarray(0, this.#used),
			gl.STREAM_DRAW,
		);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, device.texture);
		gl.bindSampler(0, device.sampler);
		gl.depthMask(false);
		// Combat feedback overlays geometry, including the mesh containing its center anchor.
		// Portal-domain clipping remains in the fragment shader.
		gl.disable(gl.DEPTH_TEST);
		gl.disable(gl.CULL_FACE);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.#used / FLOATS_PER_GLYPH);

		gl.bindVertexArray(null);
	}

	#writeText(
		text: string,
		outline: string,
		effect: CombatEffectInstance,
		anchor: readonly number[],
		x: number,
		y: number,
		scale: number,
		screen: boolean,
		glyphs: ReadonlyMap<string, Glyph>,
	): void {
		// Words are pre-shaped by Canvas; numbers use measured advances rather than monospacing.
		const tokens = WHOLE_WORD_TOKENS.includes(text) ? [text] : [...text];
		const run = tokens.map((token) => {
			const glyph = glyphs.get(`${outline}:${token}`);
			if (!glyph) throw new Error(`Combat atlas lacks ${outline}:${token}.`);
			return glyph;
		});
		let left =
			x - run.reduce((sum, glyph) => sum + glyph.advance * scale, 0) / 2;
		for (const glyph of run) {
			const needed = this.#used + FLOATS_PER_GLYPH;
			if (needed > this.#scratch.length) {
				const expanded = new Float32Array(
					Math.max(needed, this.#scratch.length * 2, 256),
				);
				expanded.set(this.#scratch);
				this.#scratch = expanded;
			}
			const color = this.#tuning.colors[effect.profile];
			this.#scratch.set(
				[
					...anchor,
					left + glyph.offsetX * scale,
					y,
					glyph.width * scale,
					glyph.height * scale,
					...glyph.uv,
					...color,
					effect.opacity,
					Number(screen),
				],
				this.#used,
			);
			this.#used = needed;
			left += glyph.advance * scale;
		}
	}

	release(): void {
		if (this.#released) return;
		this.clear();
		if (this.#device) deleteDevice(this.#gl, this.#device);
		this.#device = null;
		this.#scratch = new Float32Array(0);
		this.#released = true;
	}
}

/** Reuse the atlas texture and programs when only glyph metrics change. */
function uploadAtlas(
	gl: WebGL2RenderingContext,
	texture: WebGLTexture,
	canvas: HTMLCanvasElement,
): void {
	const maximumSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
	if (canvas.width > maximumSize || canvas.height > maximumSize)
		throw new Error("Combat glyph atlas exceeds the device texture extent.");
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
}

function createDevice(
	gl: WebGL2RenderingContext,
	tuning: CombatEffectsTuning,
): DeviceResources {
	const atlas = rasterAtlas(tuning);

	let texture: WebGLTexture | null = null;
	let sampler: WebGLSampler | null = null;
	let buffer: WebGLBuffer | null = null;
	let vao: WebGLVertexArrayObject | null = null;
	let flat: Program | null = null;
	let portal: Program | null = null;
	try {
		texture = gl.createTexture();
		sampler = gl.createSampler();
		buffer = gl.createBuffer();
		vao = gl.createVertexArray();
		if (!texture || !sampler || !buffer || !vao)
			throw new Error("Failed to allocate combat effects GPU resources.");
		flat = createProgram(gl, false);
		portal = createProgram(gl, true);
		uploadAtlas(gl, texture, atlas.canvas);
		gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.bindVertexArray(vao);
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		let offset = 0;
		for (const [index, size] of [3, 2, 2, 4, 4, 1].entries()) {
			gl.enableVertexAttribArray(index);
			gl.vertexAttribPointer(
				index,
				size,
				gl.FLOAT,
				false,
				FLOATS_PER_GLYPH * 4,
				offset * 4,
			);
			gl.vertexAttribDivisor(index, 1);
			offset += size;
		}
		gl.bindVertexArray(null);
		return {
			texture,
			sampler,
			buffer,
			vao,
			flat,
			portal,
			glyphs: atlas.glyphs,
		};
	} catch (cause) {
		if (texture) gl.deleteTexture(texture);
		if (sampler) gl.deleteSampler(sampler);
		if (buffer) gl.deleteBuffer(buffer);
		if (vao) gl.deleteVertexArray(vao);
		if (flat) deleteProgram(gl, flat.handle);
		if (portal) deleteProgram(gl, portal.handle);
		throw cause;
	}
}
function deleteDevice(
	gl: WebGL2RenderingContext,
	device: DeviceResources,
): void {
	gl.deleteTexture(device.texture);
	gl.deleteSampler(device.sampler);
	gl.deleteBuffer(device.buffer);
	gl.deleteVertexArray(device.vao);
	deleteProgram(gl, device.flat.handle);
	deleteProgram(gl, device.portal.handle);
}

/** Unbind owned programs so failed initialization and disposal both release immediately. */
function deleteProgram(gl: WebGL2RenderingContext, handle: WebGLProgram): void {
	// WebGL defers deletion of the currently used program until it is unbound.
	if (gl.getParameter(gl.CURRENT_PROGRAM) === handle) gl.useProgram(null);
	gl.deleteProgram(handle);
}

function rasterAtlas(tuning: CombatEffectsTuning): {
	canvas: HTMLCanvasElement;
	glyphs: ReadonlyMap<string, Glyph>;
} {
	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas2D unavailable for combat text atlas.");
	const font = `bold ${tuning.fontSize}px ${tuning.font}`;
	ctx.font = font;
	const padding =
		Math.ceil(Math.max(tuning.outlineWidth, tuning.criticalOutlineWidth)) + 2;
	const tokens = [..."0123456789", ...WHOLE_WORD_TOKENS];
	const measured = tokens.map((token) => ({
		token,
		metrics: ctx.measureText(token),
	}));
	const cellWidth = (metrics: TextMetrics) =>
		Math.ceil(Math.max(metrics.width, metrics.actualBoundingBoxRight)) +
		Math.ceil(Math.max(0, metrics.actualBoundingBoxLeft)) +
		padding * 2;
	const width = measured.reduce(
		(sum, { metrics }) => sum + cellWidth(metrics),
		0,
	);
	const ascent = Math.ceil(
		Math.max(...measured.map(({ metrics }) => metrics.actualBoundingBoxAscent)),
	);
	const descent = Math.ceil(
		Math.max(
			...measured.map(({ metrics }) => metrics.actualBoundingBoxDescent),
		),
	);
	const height = ascent + descent + padding * 2;
	canvas.width = width;
	canvas.height = height * 2;
	ctx.font = font;
	ctx.textBaseline = "alphabetic";
	ctx.lineJoin = "round";
	const glyphs = new Map<string, Glyph>();
	for (const [row, outline] of ["normal", "critical"].entries()) {
		let x = 0;
		for (const { token, metrics } of measured) {
			const w = cellWidth(metrics);
			const bearingLeft = Math.ceil(Math.max(0, metrics.actualBoundingBoxLeft));
			ctx.strokeStyle = "black";
			ctx.fillStyle = "white";
			ctx.lineWidth =
				2 *
				(outline === "critical"
					? tuning.criticalOutlineWidth
					: tuning.outlineWidth);
			ctx.strokeText(
				token,
				x + padding + bearingLeft,
				row * height + padding + ascent,
			);
			ctx.fillText(
				token,
				x + padding + bearingLeft,
				row * height + padding + ascent,
			);
			glyphs.set(`${outline}:${token}`, {
				width: w,
				height,
				advance: metrics.width,
				offsetX: -padding - bearingLeft,
				uv: [x / width, row / 2, w / width, 0.5],
			});
			x += w;
		}
	}
	return { canvas, glyphs };
}

function createProgram(gl: WebGL2RenderingContext, portal: boolean): Program {
	const vertex = `#version 300 es
precision highp float;
layout(location=0) in vec3 aAnchor;
layout(location=1) in vec2 aOffset;
layout(location=2) in vec2 aSize;
layout(location=3) in vec4 aRect;
layout(location=4) in vec4 aTint;
layout(location=5) in float aScreen;
uniform mat4 uMatrix;
uniform vec2 uExtent;
uniform float uDensity;
out vec2 vUv;
out vec4 vTint;
${BILLBOARD_CLIP_GLSL}
void main() {
    vec2 corner = ${CORNERS}[gl_VertexID];
    vec4 clip = aScreen > 0.5 ? vec4(0.0, -0.2, 0.0, 1.0) : uMatrix * vec4(aAnchor, 1.0);
    vec2 pixel = aOffset + (corner - vec2(0.0, 0.5)) * aSize;
    pixel.y = -pixel.y;
    gl_Position = offsetBillboardClip(clip, pixel * uDensity, uExtent, clip.w);
    vUv = aRect.xy + vec2(corner.x, corner.y) * aRect.zw;
    vTint = aTint;
}`;
	const fragment = `#version 300 es
precision highp float;
precision highp int;
${portal ? PORTAL_DEFERRED_VISIBILITY_GLSL : ""}
uniform sampler2D uAtlas;
in vec2 vUv;
in vec4 vTint;
out vec4 outColor;
void main() {
    vec4 texel = texture(uAtlas, vUv);
    if (texel.a <= 0.01) discard;
    ${portal ? "if (!portalDeferredFragmentVisible()) discard;" : ""}
    outColor = vec4(texel.rgb * vTint.rgb, texel.a * vTint.a);
}`;
	const handle = linkWebGL2Program(gl, "combat effects", vertex, fragment);
	try {
		gl.useProgram(handle);
		gl.uniform1i(requireWebGL2Uniform(gl, handle, "uAtlas"), 0);
		return {
			handle,
			matrix: requireWebGL2Uniform(gl, handle, "uMatrix"),
			extent: requireWebGL2Uniform(gl, handle, "uExtent"),
			density: requireWebGL2Uniform(gl, handle, "uDensity"),
			portal: portal
				? bindWebGL2PortalDeferredVisibilityProgram(gl, handle)
				: null,
		};
	} catch (cause) {
		deleteProgram(gl, handle);
		throw cause;
	}
}
