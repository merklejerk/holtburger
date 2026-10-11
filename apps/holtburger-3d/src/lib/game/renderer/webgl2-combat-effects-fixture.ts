import { decodeClientCombatOutcome } from "../../../client/client-host-contract";
import { CLIENT_COMBAT_EFFECTS_TUNING } from "../../../client/client-tuning";
import { sceneVector3 } from "../../assets/ac-frame";
import { CombatEffectsSystem } from "../systems/combat-effects-system";
import { createLandblockWorldOrigin } from "../landblocks";
import {
	WebGL2CombatEffects,
	type CombatEffectsView,
} from "./webgl2-combat-effects";
import {
	PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
	PORTAL_PROPAGATION_SCOPE_METADATA_OFFSET_BYTES,
} from "./portal-propagation-metadata";
import { PORTAL_SCOPE_ATLAS_METADATA_BINDING_POINT } from "./portal-scope-atlas-metadata-glsl";
import { PORTAL_SCOPE_ATLAS_TEXTURE_UNITS } from "./portal-scope-atlas-command-model";

/** Numeric browser/GPU evidence, independent of user visual acceptance. */
export interface CombatEffectsFixtureResult {
	readonly colorUpdateReusedAtlas: boolean;
	readonly typographyUpdateReusedResources: boolean;
	readonly liveAppearancePreserved: boolean;
	readonly worldPixels: number;
	readonly worldDraws: number;
	readonly laneDraws: number;
	readonly criticalGlyphCount: number;
	readonly lazyAllocation: boolean;
	readonly sharedAtlas: boolean;
	readonly rebasedPixels: number;
	readonly criticalPixels: number;
	readonly resistWorldPixels: number;
	readonly resistLanePixels: number;
	readonly resistGlyphCount: number;
	readonly resistSharedAtlas: boolean;
	readonly hiddenScopePixels: number;
	readonly portalVisiblePixels: number;
	readonly portalOccludedPixels: number;
	readonly expiredPixels: number;
	readonly lanePixels: number;
	readonly criticalLanePixels: number;
	readonly repeatedLifecycleReleased: boolean;
	readonly programFailureCleaned: boolean;
	readonly resetPixels: number;
	readonly resourcesReleased: boolean;
	readonly allocationFailureCleaned: boolean;
}

/** Runs the actual decoder, effect owner, atlas, flat/portal programs and cleanup on real WebGL2. */
export function runCombatEffectsFixture(
	gl: WebGL2RenderingContext,
): CombatEffectsFixtureResult {
	const width = gl.drawingBufferWidth,
		height = gl.drawingBufferHeight;
	const textures: WebGLTexture[] = [],
		buffers: WebGLBuffer[] = [],
		vaos: WebGLVertexArrayObject[] = [],
		programs: WebGLProgram[] = [],
		samplers: WebGLSampler[] = [];
	let drawCalls = 0,
		lastGlyphCount = 0;
	const deletedTextures = new Set<WebGLTexture>();
	const originals = {
		deleteTexture: gl.deleteTexture,
		uniform1i: gl.uniform1i,
		draw: gl.drawArraysInstanced,
		texture: gl.createTexture,
		buffer: gl.createBuffer,
		vao: gl.createVertexArray,
		program: gl.createProgram,
		sampler: gl.createSampler,
	};
	gl.drawArraysInstanced = (mode, first, count, instances) => {
		drawCalls++;
		lastGlyphCount = instances;
		originals.draw.call(gl, mode, first, count, instances);
	};
	gl.deleteTexture = (value) => {
		if (value) deletedTextures.add(value);
		originals.deleteTexture.call(gl, value);
	};
	gl.createTexture = () => {
		const value = originals.texture.call(gl);
		if (value) textures.push(value);
		return value;
	};
	gl.createBuffer = () => {
		const value = originals.buffer.call(gl);
		if (value) buffers.push(value);
		return value;
	};
	gl.createVertexArray = () => {
		const value = originals.vao.call(gl);
		if (value) vaos.push(value);
		return value;
	};
	gl.createProgram = () => {
		const value = originals.program.call(gl);
		if (value) programs.push(value);
		return value;
	};
	gl.createSampler = () => {
		const value = originals.sampler.call(gl);
		if (value) samplers.push(value);
		return value;
	};
	const tuning = {
		...CLIENT_COMBAT_EFFECTS_TUNING,
		lifetimeMs: 100,
		popMs: 20,
		fadeMs: 30,
		worldRise: 0.1,
	};
	const adapter = new WebGL2CombatEffects(gl, tuning);
	const system = new CombatEffectsSystem(tuning, { create: () => adapter });
	const pixels = new Uint8Array(width * height * 4);
	const clear = () => {
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, width, height);
		gl.depthMask(true);
		gl.clearColor(0, 0, 0, 1);
		gl.clearDepth(1);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
	};
	const count = () => {
		gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
		let total = 0;
		for (let i = 0; i < pixels.length; i += 4)
			if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 0) total++;
		return total;
	};
	const matrix = new Float32Array([
		1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
	]);
	const view: CombatEffectsView = {
		width,
		height,
		density: 1,
		anchorLandblockId: "0x0000ffff",
		clipFromAnchor: matrix,
		selectedScope: () => 0,
		routing: null,
	};
	const origin = createLandblockWorldOrigin(view.anchorLandblockId);
	const placement = {
		kind: "world" as const,
		position: sceneVector3([origin.x, origin.y, origin.z]),
		scopes: [
			{
				kind: "env-cell" as const,
				landblockId: "0x0000ffff" as const,
				envCellId: "0x00000100" as const,
			},
			{
				kind: "env-cell" as const,
				landblockId: "0x0000ffff" as const,
				envCellId: "0x00000101" as const,
			},
		],
	};
	const message = decodeClientCombatOutcome({
		worldGeneration: 1,
		attribution: { kind: "attributed", target: 42 },
		outcome: { kind: "damage", amount: 37, criticalHit: false },
	});
	let metadata: WebGLBuffer | null = null,
		envelope: WebGLTexture | null = null;
	try {
		clear();
		system.accept(message.outcome, placement, 0);
		system.advance(10);
		const lazyAllocation =
			textures.length === 0 && buffers.length === 0 && programs.length === 0;
		adapter.drawWorld(view);
		const worldDraws = drawCalls;
		const worldPixels = count();
		const allocated = [
			textures.length,
			buffers.length,
			vaos.length,
			programs.length,
			samplers.length,
		].join(":");
		const appearance = {
			font: tuning.font,
			fontSize: tuning.fontSize,
			colors: { ...tuning.colors, damage: [0, 1, 0] as const },
		};
		system.setAppearance(appearance);
		clear();
		adapter.drawWorld(view);
		const recoloredPixels = count();
		const colorUpdateReusedAtlas =
			recoloredPixels === worldPixels &&
			[
				textures.length,
				buffers.length,
				vaos.length,
				programs.length,
				samplers.length,
			].join(":") === allocated &&
			pixels.every(
				(channel, index) =>
					(index % 4 !== 0 && index % 4 !== 2) || channel === 0,
			);
		system.setAppearance({ ...appearance, fontSize: tuning.fontSize * 1.5 });
		clear();
		adapter.drawWorld(view);
		const typographyUpdateReusedResources =
			count() > worldPixels &&
			[
				textures.length,
				buffers.length,
				vaos.length,
				programs.length,
				samplers.length,
			].join(":") === allocated;
		system.setAppearance(tuning);
		system.refreshFontAtlas();
		clear();
		adapter.drawWorld(view);
		const liveAppearancePreserved =
			system.activeCount === 1 && count() === worldPixels;
		// A nearer depth buffer represents geometry covering a center-anchored indicator.
		clear();
		gl.clearDepth(0);
		gl.clear(gl.DEPTH_BUFFER_BIT);
		gl.enable(gl.DEPTH_TEST);
		adapter.drawWorld(view);
		if (count() !== worldPixels)
			throw new Error("Combat feedback was obscured by scene depth.");
		// Rebase the camera's landblock while adjusting its matrix to keep the same canonical point.
		const rebasedOrigin = createLandblockWorldOrigin("0x0100ffff");
		const rebasedMatrix = matrix.slice();
		rebasedMatrix[12] = rebasedOrigin.x - origin.x;
		clear();
		adapter.drawWorld({
			...view,
			anchorLandblockId: "0x0100ffff",
			clipFromAnchor: rebasedMatrix,
		});
		const rebasedPixels = count();
		clear();
		adapter.drawWorld({ ...view, selectedScope: () => null });
		const hiddenScopePixels = count();
		// Exercise real deferred visibility envelope sampling, not merely a mocked routing callback.
		metadata = gl.createBuffer();
		envelope = gl.createTexture();
		if (!metadata || !envelope)
			throw new Error("Combat fixture portal allocation failed.");
		const bytes = new Uint32Array(
			PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES / 4,
		);
		bytes.set(
			[0, 0, 0, 0, width, height, 0, 0],
			PORTAL_PROPAGATION_SCOPE_METADATA_OFFSET_BYTES / 4,
		);
		gl.bindBuffer(gl.UNIFORM_BUFFER, metadata);
		gl.bufferData(gl.UNIFORM_BUFFER, bytes, gl.STATIC_DRAW);
		gl.bindBufferBase(
			gl.UNIFORM_BUFFER,
			PORTAL_SCOPE_ATLAS_METADATA_BINDING_POINT,
			metadata,
		);
		gl.activeTexture(
			gl.TEXTURE0 + PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.envelopeDepth,
		);
		gl.bindTexture(gl.TEXTURE_2D, envelope);
		gl.bindSampler(PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.envelopeDepth, null);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		const depths = new Float32Array(width * height).fill(1);
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			gl.R32F,
			width,
			height,
			0,
			gl.RED,
			gl.FLOAT,
			depths,
		);
		const portalView = {
			...view,
			routing: {
				routeDeferredSubmission: (
					_key: string,
					uniforms: { readonly renderDomain: WebGLUniformLocation },
				) => gl.uniform1ui(uniforms.renderDomain, 0),
			},
		};
		clear();
		adapter.drawWorld(portalView);
		const portalVisiblePixels = count();
		depths.fill(0);
		gl.activeTexture(
			gl.TEXTURE0 + PORTAL_SCOPE_ATLAS_TEXTURE_UNITS.envelopeDepth,
		);
		gl.bindTexture(gl.TEXTURE_2D, envelope);
		gl.texSubImage2D(
			gl.TEXTURE_2D,
			0,
			0,
			0,
			width,
			height,
			gl.RED,
			gl.FLOAT,
			depths,
		);
		clear();
		adapter.drawWorld(portalView);
		const portalOccludedPixels = count();
		const beforeCriticalTextures = textures.length;
		system.clear();
		system.accept(
			{ kind: "damage", amount: 37, criticalHit: true },
			placement,
			0,
		);
		system.advance(10);
		clear();
		adapter.drawWorld(view);
		const criticalPixels = count();
		const criticalGlyphCount = lastGlyphCount;
		const sharedAtlas = textures.length === beforeCriticalTextures;
		system.clear();
		const resist = decodeClientCombatOutcome({
			worldGeneration: 1,
			attribution: { kind: "unplaced" },
			outcome: { kind: "resisted" },
		});
		system.accept(resist.outcome, placement, 0);
		system.advance(10);
		clear();
		gl.clearDepth(0);
		gl.clear(gl.DEPTH_BUFFER_BIT);
		gl.enable(gl.DEPTH_TEST);
		adapter.drawWorld(view);
		const resistWorldPixels = count();
		const resistGlyphCount = lastGlyphCount;
		system.clear();
		system.accept(resist.outcome, { kind: "unplaced" }, 0);
		system.advance(10);
		clear();
		adapter.drawLane(width, height, 1);
		const resistLanePixels = count();
		const resistSharedAtlas = textures.length === beforeCriticalTextures;
		system.advance(tuning.lifetimeMs);
		clear();
		adapter.drawWorld(view);
		adapter.drawLane(width, height, 1);
		const expiredPixels = count();
		const miss = decodeClientCombatOutcome({
			worldGeneration: 1,
			attribution: { kind: "unplaced" },
			outcome: { kind: "evaded" },
		});
		system.accept(miss.outcome, { kind: "unplaced" }, 200);
		system.advance(210);
		clear();
		const beforeLaneDraws = drawCalls;
		adapter.drawLane(width, height, 1);
		const laneDraws = drawCalls - beforeLaneDraws;
		const lanePixels = count();
		system.clear();
		system.accept(
			{ kind: "damage", amount: 37, criticalHit: true },
			{ kind: "unplaced" },
			200,
		);
		system.advance(210);
		clear();
		adapter.drawLane(width, height, 1);
		const criticalLanePixels = count();
		system.clear();
		clear();
		adapter.drawLane(width, height, 1);
		const resetPixels = count();
		system.dispose();
		gl.deleteBuffer(metadata);
		metadata = null;
		gl.deleteTexture(envelope);
		envelope = null;
		const allReleased = () =>
			textures.every(
				(value) => deletedTextures.has(value) && !gl.isTexture(value),
			) &&
			buffers.every((value) => !gl.isBuffer(value)) &&
			vaos.every((value) => !gl.isVertexArray(value)) &&
			programs.every((value) => !gl.isProgram(value)) &&
			samplers.every((value) => !gl.isSampler(value));
		const resourcesReleased = allReleased();
		// A second owner must allocate/release independently on the same context.
		const repeatedAdapter = new WebGL2CombatEffects(gl, tuning);
		const repeated = new CombatEffectsSystem(tuning, {
			create: () => repeatedAdapter,
		});
		try {
			repeated.accept(message.outcome, placement, 0);
			repeated.advance(10);
			clear();
			repeatedAdapter.drawWorld(view);
			if (count() !== worldPixels)
				throw new Error("Repeated combat owner changed the draw.");
		} finally {
			repeated.dispose();
		}
		const repeatedLifecycleReleased = allReleased();
		gl.createSampler = () => {
			throw new Error("Failed to allocate combat fixture sampler.");
		};
		const failed = new WebGL2CombatEffects(gl, tuning);
		failed.submit([
			{
				text: "1",
				profile: "damage",
				placement,
				spreadPixels: 0,
				progress: 0,
				scale: 1,
				opacity: 1,
			},
		]);
		let allocationFailed = false;
		try {
			failed.drawWorld(view);
		} catch (cause) {
			if (
				!(cause instanceof Error) ||
				!cause.message.includes("allocate combat")
			)
				throw cause;
			allocationFailed = true;
		}
		failed.release();
		const allocationFailureCleaned = allocationFailed && allReleased();
		gl.createSampler = () => {
			const value = originals.sampler.call(gl);
			if (value) samplers.push(value);
			return value;
		};
		// Fail after useProgram, proving that partial initialization unbinds before deletion.
		gl.uniform1i = () => {
			throw new Error("Combat fixture program initialization failed.");
		};
		const failedProgram = new WebGL2CombatEffects(gl, tuning);
		failedProgram.submit([
			{
				text: "1",
				profile: "damage",
				placement,
				spreadPixels: 0,
				progress: 0,
				scale: 1,
				opacity: 1,
			},
		]);
		let programFailed = false;
		try {
			failedProgram.drawWorld(view);
		} catch (cause) {
			if (
				!(cause instanceof Error) ||
				cause.message !== "Combat fixture program initialization failed."
			)
				throw cause;
			programFailed = true;
		} finally {
			failedProgram.release();
			gl.uniform1i = originals.uniform1i;
		}
		const programFailureCleaned = programFailed && allReleased();
		const error = gl.getError();
		if (error !== gl.NO_ERROR)
			throw new Error(`Combat fixture WebGL error ${error}.`);
		return {
			colorUpdateReusedAtlas,
			typographyUpdateReusedResources,
			liveAppearancePreserved,
			worldPixels,
			worldDraws,
			laneDraws,
			criticalGlyphCount,
			lazyAllocation,
			sharedAtlas,
			rebasedPixels,
			criticalPixels,
			resistWorldPixels,
			resistLanePixels,
			resistGlyphCount,
			resistSharedAtlas,
			hiddenScopePixels,
			portalVisiblePixels,
			portalOccludedPixels,
			expiredPixels,
			lanePixels,
			criticalLanePixels,
			repeatedLifecycleReleased,
			programFailureCleaned,
			resetPixels,
			resourcesReleased,
			allocationFailureCleaned,
		};
	} finally {
		system.dispose();
		if (metadata) gl.deleteBuffer(metadata);
		if (envelope) gl.deleteTexture(envelope);
		gl.drawArraysInstanced = originals.draw;
		gl.deleteTexture = originals.deleteTexture;
		gl.uniform1i = originals.uniform1i;
		gl.createTexture = originals.texture;
		gl.createBuffer = originals.buffer;
		gl.createVertexArray = originals.vao;
		gl.createProgram = originals.program;
		gl.createSampler = originals.sampler;
		gl.bindBufferBase(
			gl.UNIFORM_BUFFER,
			PORTAL_SCOPE_ATLAS_METADATA_BINDING_POINT,
			null,
		);
		gl.bindVertexArray(null);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.depthMask(true);
		gl.enable(gl.DEPTH_TEST);
	}
}
