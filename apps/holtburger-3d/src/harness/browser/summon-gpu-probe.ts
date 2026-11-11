import { sceneVec3 } from "../../lib/assets/ac-frame";
import { Mat4, Vec3 } from "../../lib/game/math/types";
import { WebGL2SummonChainPass } from "../../lib/game/renderer/webgl2-summon-chain-pass";

/** Actual GPU evidence for procedural links, composed world depth and doorway occlusion. */
export interface SummonGpuProof {
	readonly visiblePixels: number;
	readonly rebasedPixels: number;
	readonly wallOccludedPixels: number;
	/** Visible front links and links through the opening in a synthetic final depth buffer. */
	readonly doorwayPixels: number;
	/** Links behind the solid portion of the doorway wall. */
	readonly doorwayWallPixels: number;
	readonly verticalPixels: number;
	readonly coincidentPixels: number;
	/** Bounds fade only the interior; terminal overhang contributes no pixels. */
	readonly endpointFade: boolean;
	/** Fixed endpoints with changing interior geometry at rest. */
	readonly idleSway: boolean;
	/** Brightness crest moves from owner (end) toward summon (start). */
	readonly directedPulse: boolean;
	/** Largest changed-pixel count across an almost stationary spacing threshold. */
	readonly spacingJumpPixels: number;
	/** Changed pixels immediately across a full animation cycle. */
	readonly phaseWrapPixels: number;
	readonly glError: number;
}

/** Render synthetic canonical endpoints through the production pass without external content. */
export function runSummonGpuFixture(
	gl: WebGL2RenderingContext,
): SummonGpuProof {
	const width = gl.drawingBufferWidth;
	const height = gl.drawingBufferHeight;
	const pass = new WebGL2SummonChainPass(gl);
	const input = {
		start: sceneVec3(new Vec3(-0.8, 0.3, 0)),
		end: sceneVec3(new Vec3(0.8, 0.3, 0)),
		startHalfExtents: new Vec3(0.25, 0.2, 0.2),
		endHalfExtents: new Vec3(0.25, 0.2, 0.2),
		timeSeconds: 0,
		color: [0.2, 1, 0.45, 0.25] as const,
		tuning: {
			linkRadius: 0.06,
			linkSpacing: 0.09,
			sagFraction: 0.08,
			swayAmplitude: 0.04,
			swayHertz: 0.3,
			pulseHertz: 0.6,
			pulseWavelength: 0.8,
			pulseStrength: 0.7,
			endpointFadePower: 1.5,
			maximumDistance: 10,
			fadeDistance: 1,
			glowScale: 1.5,
			glowOpacity: 0.25,
		},
	};
	const pixels = new Uint8Array(width * height * 4);
	const clear = (depth = 1) => {
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, width, height);
		gl.disable(gl.SCISSOR_TEST);
		gl.colorMask(true, true, true, true);
		gl.depthMask(true);
		gl.clearColor(0, 0, 0, 1);
		gl.clearDepth(depth);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
	};
	const count = () => {
		gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
		let populated = 0;
		for (let index = 1; index < pixels.length; index += 4)
			if (pixels[index] > 0) populated++;
		return populated;
	};
	const matrix = Mat4.identity();
	// Identity projection makes these synthetic canonical coordinates clip coordinates too.
	const anchor = Vec3.zero();
	try {
		clear();
		pass.draw(input, anchor, matrix);
		const visiblePixels = count();
		input.start.x += 100;
		input.end.x += 100;
		clear();
		pass.draw(input, new Vec3(100, 0, 0), matrix);
		const rebasedPixels = count();
		input.start.x -= 100;
		input.end.x -= 100;
		clear(0);
		pass.draw(input, anchor, matrix);
		const wallOccludedPixels = count();
		// Model a final composed wall at depth 0.5, with an opening in its centre.
		// The leash crosses the wall plane: front links remain visible outside the opening.
		input.start.z = -0.4;
		input.end.z = 0.4;
		clear(0.5);
		const openingLeft = Math.floor(width * 0.4);
		const openingRight = Math.ceil(width * 0.6);
		gl.enable(gl.SCISSOR_TEST);
		gl.scissor(openingLeft, 0, openingRight - openingLeft, height);
		gl.clearDepth(1);
		gl.clear(gl.DEPTH_BUFFER_BIT);
		gl.disable(gl.SCISSOR_TEST);
		pass.draw(input, anchor, matrix);
		const doorwayPixels = count();
		let doorwayWallPixels = 0;
		let frontPixels = 0;
		let openingPixels = 0;
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				if (pixels[(y * width + x) * 4 + 1] === 0) continue;
				if (x < openingLeft) frontPixels++;
				else if (x >= openingRight) doorwayWallPixels++;
				else openingPixels++;
			}
		}
		if (frontPixels === 0)
			throw new Error(
				"Summon doorway fixture lost links in front of the wall.",
			);
		if (openingPixels === 0)
			throw new Error("Summon doorway fixture lost links through the opening.");
		input.start.z = 0;
		input.end.z = 0;
		input.start.x = 0;
		input.start.y = -0.7;
		input.end.x = 0;
		input.end.y = 0.7;
		clear();
		pass.draw(input, anchor, matrix);
		const verticalPixels = count();
		input.end.copy(input.start);
		clear();
		pass.draw(input, anchor, matrix);
		const coincidentPixels = count();
		input.start.x = -0.8;
		input.start.y = 0;
		input.end.x = 0.8;
		input.end.y = 0;
		input.tuning.sagFraction = 0;
		input.tuning.swayAmplitude = 0;
		input.tuning.pulseStrength = 0;
		input.tuning.glowOpacity = 0;
		input.startHalfExtents.x = 0.4;
		input.endHalfExtents.x = 0.4;
		clear();
		pass.draw(input, anchor, matrix);
		count();
		const faded = pixels.slice();
		input.startHalfExtents.x = 0.0001;
		input.endHalfExtents.x = 0.0001;
		clear();
		pass.draw(input, anchor, matrix);
		count();
		let interiorReduction = 0;
		let exteriorDifference = 0;
		let terminalPixels = 0;
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const sceneX = (2 * (x + 0.5)) / width - 1;
				const index = (y * width + x) * 4 + 1;
				if (Math.abs(sceneX) < 0.35)
					exteriorDifference += Math.abs(pixels[index] - faded[index]);
				if (Math.abs(sceneX) > 0.45 && Math.abs(sceneX) < 0.75)
					interiorReduction += pixels[index] - faded[index];
				if (Math.abs(sceneX) >= 0.8) terminalPixels += faded[index];
			}
		}
		const endpointFade =
			interiorReduction > 0 && exteriorDifference === 0 && terminalPixels === 0;
		const still = pixels.slice();
		input.tuning.swayAmplitude = 0.08;
		clear();
		pass.draw(input, anchor, matrix);
		count();
		const firstSway = pixels.slice();
		input.timeSeconds = 0.7;
		clear();
		pass.draw(input, anchor, matrix);
		count();
		const idleSway = pixels.some((value, index) => value !== firstSway[index]);
		input.tuning.swayAmplitude = 0;
		input.tuning.pulseStrength = 3;
		input.tuning.pulseHertz = 1;
		input.tuning.pulseWavelength = 4;
		const pulseCentroid = (time: number) => {
			input.timeSeconds = time;
			clear();
			pass.draw(input, anchor, matrix);
			count();
			let weight = 0;
			let moment = 0;
			for (let y = 0; y < height; y++) {
				for (let x = 0; x < width; x++) {
					const index = (y * width + x) * 4 + 1;
					const extra = pixels[index] - still[index];
					weight += extra;
					moment += extra * x;
				}
			}
			if (weight <= 0) throw new Error("Summon pulse did not add brightness.");
			return moment / weight;
		};
		const firstCrest = pulseCentroid(0.1);
		const directedPulse = pulseCentroid(0.25) < firstCrest;
		const capture = (time: number) => {
			input.timeSeconds = time;
			clear();
			pass.draw(input, anchor, matrix);
			count();
			return pixels.slice();
		};
		const changedPixels = (before: Uint8Array, after: Uint8Array) => {
			let changed = 0;
			for (let index = 1; index < before.length; index += 4)
				if (Math.abs(before[index] - after[index]) > 8) changed++;
			return changed;
		};
		input.tuning.swayAmplitude = 0.08;
		const cycle = 1 / input.tuning.swayHertz;
		const phaseWrapPixels = Math.max(
			changedPixels(capture(cycle - 1e-6), capture(cycle + 1e-6)),
			changedPixels(capture(1 - 1e-6), capture(1 + 1e-6)),
		);
		input.tuning.swayAmplitude = 0;
		input.tuning.pulseStrength = 0;
		// Cross an exact link-spacing multiple with micrometre endpoint motion.
		const threshold = input.tuning.linkSpacing * 18;
		input.end.x = input.start.x + threshold - 1e-6;
		const beforeThreshold = capture(0);
		input.end.x += 2e-6;
		const spacingJumpPixels = changedPixels(beforeThreshold, capture(0));
		return {
			spacingJumpPixels,
			phaseWrapPixels,
			endpointFade,
			idleSway,
			directedPulse,
			visiblePixels,
			rebasedPixels,
			wallOccludedPixels,
			doorwayPixels,
			doorwayWallPixels,
			verticalPixels,
			coincidentPixels,
			glError: gl.getError(),
		};
	} finally {
		pass.destroy();
		gl.clearDepth(1);
	}
}
