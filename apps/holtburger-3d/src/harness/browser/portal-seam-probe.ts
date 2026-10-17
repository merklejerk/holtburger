import {
	WebGL2PortalScopeAtlasPipeline,
	type WebGL2PortalScopeAtlasFrame,
} from "../../lib/game/renderer/webgl2-portal-scope-atlas-pipeline";
import {
	WebGL2PortalScopeAtlasExecutor,
	type WebGL2PortalScopeAtlasExecutionInput,
} from "../../lib/game/renderer/webgl2-portal-scope-atlas-executor";
import { PORTAL_PROPAGATION_ARRIVAL_METADATA_OFFSET_BYTES } from "../../lib/game/renderer/portal-propagation-metadata";
import {
	PORTAL_ARRIVAL_METADATA_RECORD_BYTES,
	PORTAL_ARRIVAL_METADATA_JUNCTION_OFFSET_BYTES,
} from "../../lib/game/renderer/portal-arrival-metadata";
import { scopeKey } from "../../lib/game/scene/scope";

/** Harness-only capture; every borrowed arena is read synchronously before another frame. */
let latest: {
	executor: WebGL2PortalScopeAtlasExecutor;
	input: WebGL2PortalScopeAtlasExecutionInput;
} | null = null;
let frame: WebGL2PortalScopeAtlasFrame | null = null;
let readback: {
	gl: WebGL2RenderingContext;
	rounds: Record<string, number>[];
} | null = null;

/** Capture the production plan and executor without adding diagnostic state to product code. */
export function installPortalSeamProbe(): void {
	const prepare = WebGL2PortalScopeAtlasPipeline.prototype.prepare;
	WebGL2PortalScopeAtlasPipeline.prototype.prepare = function (...args) {
		frame = prepare.apply(this, args);
		return frame;
	};
	const execute = WebGL2PortalScopeAtlasExecutor.prototype.execute;
	WebGL2PortalScopeAtlasExecutor.prototype.execute = function (input) {
		latest = { executor: this, input };
		execute.call(this, input);
	};
	const propagate = WebGL2PortalScopeAtlasExecutor.prototype.drawPropagation;
	WebGL2PortalScopeAtlasExecutor.prototype.drawPropagation = function (
		...args
	) {
		propagate.apply(this, args);
		if (readback === null || latest === null) return;
		const { gl, rounds } = readback;
		const { width, height } = latest.input.outputExtent;
		const previous = gl.getParameter(
			gl.READ_FRAMEBUFFER_BINDING,
		) as WebGLFramebuffer | null;
		gl.bindFramebuffer(
			gl.READ_FRAMEBUFFER,
			latest.input.targets.frontiers[args[0]].framebuffer,
		);
		const pixels = new Uint32Array(width * height * 4);
		gl.readPixels(
			0,
			0,
			width,
			height,
			gl.RGBA_INTEGER,
			gl.UNSIGNED_INT,
			pixels,
		);
		gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previous);
		const counts: Record<string, number> = {};
		for (let i = 0; i < pixels.length; i += 4) {
			const id = pixels[i]!;
			if (id !== 0) counts[id] = (counts[id] ?? 0) + 1;
		}
		rounds.push(counts);
	};
}

/** Re-execute one frozen production input; the only experimental change is junction metadata. */
export function runPortalSeamProbe() {
	if (latest === null || frame === null)
		throw new Error("No production portal execution captured.");
	const canvas = document.querySelector<HTMLCanvasElement>("canvas");
	const gl = canvas?.getContext("webgl2");
	if (!gl) throw new Error("No harness WebGL2 context.");
	const captured = latest;
	const visibility = frame.atlas.visibility;
	const crossings = Array.from(
		{ length: visibility.selectedCrossingCount },
		(_, ordinal) => {
			const crossing = visibility.selectedCrossing(ordinal);
			return {
				arrival: ordinal + 2,
				id: crossing.id,
				source: scopeKey(crossing.source),
				target: scopeKey(crossing.target),
				junction: crossing.junctionGroupId,
			};
		},
	);
	const original = captured.input.stream.propagationMetadataBytes;
	const metadata = original.slice();
	const view = new DataView(metadata.buffer);
	const seam = crossings.filter(
		(c) =>
			(c.source === "0xd5990109" && c.target === "outdoor") ||
			(c.source === "outdoor" && c.target === "0xd6990121") ||
			(c.source === "0xd6990121" && c.target === "outdoor") ||
			(c.source === "outdoor" && c.target === "0xd5990109"),
	);
	for (const crossing of seam)
		view.setUint32(
			PORTAL_PROPAGATION_ARRIVAL_METADATA_OFFSET_BYTES +
				(crossing.arrival - 1) * PORTAL_ARRIVAL_METADATA_RECORD_BYTES +
				PORTAL_ARRIVAL_METADATA_JUNCTION_OFFSET_BYTES,
			0xffff_ffff,
			true,
		);
	const run = (bytes: Uint8Array) => {
		const rounds: Record<string, number>[] = [];
		readback = { gl, rounds };
		try {
			const stream = captured.input.stream;
			captured.executor.execute({
				...captured.input,
				stream: {
					bytes: stream.bytes,
					usedByteLength: stream.usedByteLength,
					vertexCount: stream.vertexCount,
					propagationMetadataBytes: bytes,
					arrivalMetadataStateCount: stream.arrivalMetadataStateCount,
					renderDomainMetadataStateCount: stream.renderDomainMetadataStateCount,
					usedPropagationMetadataByteLength:
						stream.usedPropagationMetadataByteLength,
				},
			});
			const { width, height } = captured.input.outputExtent;
			const previous = gl.getParameter(
				gl.READ_FRAMEBUFFER_BINDING,
			) as WebGLFramebuffer | null;
			gl.bindFramebuffer(gl.READ_FRAMEBUFFER, captured.input.outputFramebuffer);
			const pixels = new Uint8Array(width * height * 4);
			gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
			gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previous);
			return { rounds, pixels, error: gl.getError() };
		} finally {
			readback = null;
		}
	};
	const baseline = run(original);
	const control = run(original);
	const joined = run(metadata);
	run(original);
	const difference = (a: Uint8Array, b: Uint8Array) => {
		let count = 0;
		for (let i = 0; i < a.length; i += 4)
			if (
				a[i] !== b[i] ||
				a[i + 1] !== b[i + 1] ||
				a[i + 2] !== b[i + 2] ||
				a[i + 3] !== b[i + 3]
			)
				count++;
		return count;
	};
	return {
		crossings,
		seam,
		baseline: baseline.rounds,
		joined: joined.rounds,
		controlChangedPixels: difference(baseline.pixels, control.pixels),
		joinedChangedPixels: difference(baseline.pixels, joined.pixels),
		errors: [baseline.error, control.error, joined.error],
		planTrace: { ...frame.atlas.trace },
	};
}
