import { CLIENT_SUMMON_TUNING } from "../../client/client-tuning";
import { sceneVec3 } from "../../lib/assets/ac-frame";
import { Mat4, Vec3 } from "../../lib/game/math/types";
import { WebGL2SummonChainPass } from "../../lib/game/renderer/webgl2-summon-chain-pass";
import {
	PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
	PORTAL_PROPAGATION_SCOPE_METADATA_OFFSET_BYTES,
} from "../../lib/game/renderer/portal-propagation-metadata";
import { PORTAL_SCOPE_ATLAS_METADATA_BINDING_POINT } from "../../lib/game/renderer/portal-scope-atlas-metadata-glsl";
import { PORTAL_SCOPE_ATLAS_TEXTURE_UNITS } from "../../lib/game/renderer/portal-scope-atlas-command-model";

/** Actual GPU evidence for procedural links, world depth and deferred portal rejection. */
export interface SummonGpuProof {
	readonly visiblePixels: number;
	readonly rebasedPixels: number;
	readonly wallOccludedPixels: number;
	readonly portalVisiblePixels: number;
	readonly portalOccludedPixels: number;
	readonly verticalPixels: number;
	readonly coincidentPixels: number;
	readonly glError: number;
}

/** Render synthetic canonical endpoints through the production pass without external content. */
export function runSummonGpuFixture(
	gl: WebGL2RenderingContext,
): SummonGpuProof {
	const width = gl.drawingBufferWidth;
	const height = gl.drawingBufferHeight;
	const pass = new WebGL2SummonChainPass(gl);
	const envelope = gl.createTexture();
	const metadata = gl.createBuffer();
	if (envelope === null || metadata === null) {
		pass.destroy();
		gl.deleteTexture(envelope);
		gl.deleteBuffer(metadata);
		throw new Error(
			"Summon fixture could not allocate portal evidence resources.",
		);
	}
	const input = {
		start: sceneVec3(new Vec3(-0.8, 0.3, 0)),
		end: sceneVec3(new Vec3(0.8, 0.3, 0)),
		renderScope: { kind: "outdoor" as const },
		color: [0.2, 1, 0.45, 0.25] as const,
		tuning: {
			...CLIENT_SUMMON_TUNING.leash,
			linkRadius: 0.06,
			linkSpacing: 0.09,
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
		pass.draw(input, anchor, matrix, null);
		const visiblePixels = count();
		input.start.x += 100;
		input.end.x += 100;
		clear();
		pass.draw(input, new Vec3(100, 0, 0), matrix, null);
		const rebasedPixels = count();
		input.start.x -= 100;
		input.end.x -= 100;
		clear(0);
		pass.draw(input, anchor, matrix, null);
		const wallOccludedPixels = count();
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
		const routing = {
			routeDeferredSubmission: (
				_scope: string,
				uniforms: { readonly renderDomain: WebGLUniformLocation },
			) => gl.uniform1ui(uniforms.renderDomain, 0),
		};
		clear();
		pass.draw(input, anchor, matrix, routing);
		const portalVisiblePixels = count();
		depths.fill(0);
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
		pass.draw(input, anchor, matrix, routing);
		const portalOccludedPixels = count();
		input.start.x = 0;
		input.start.y = -0.7;
		input.end.x = 0;
		input.end.y = 0.7;
		clear();
		pass.draw(input, anchor, matrix, null);
		const verticalPixels = count();
		input.end.copy(input.start);
		clear();
		pass.draw(input, anchor, matrix, null);
		const coincidentPixels = count();
		return {
			visiblePixels,
			rebasedPixels,
			wallOccludedPixels,
			portalVisiblePixels,
			portalOccludedPixels,
			verticalPixels,
			coincidentPixels,
			glError: gl.getError(),
		};
	} finally {
		pass.destroy();
		gl.bindBufferBase(
			gl.UNIFORM_BUFFER,
			PORTAL_SCOPE_ATLAS_METADATA_BINDING_POINT,
			null,
		);
		gl.bindBuffer(gl.UNIFORM_BUFFER, null);
		gl.deleteBuffer(metadata);
		gl.bindTexture(gl.TEXTURE_2D, null);
		gl.deleteTexture(envelope);
		gl.clearDepth(1);
	}
}
