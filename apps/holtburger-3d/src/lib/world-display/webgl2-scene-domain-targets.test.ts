import { describe, expect, it } from "vitest";

import {
	createWebgl2PortalCompositeTargetSet,
	createWebgl2SceneDomainTargetSet,
} from "./webgl2-scene-domain-targets";

describe("createWebgl2SceneDomainTargetSet", () => {
	it("creates exterior and interior color/depth framebuffers at the canvas backing size", () => {
		const gl = new CapturingSceneDomainTargetGl();

		const targets = createWebgl2SceneDomainTargetSet(gl.asContext(), {
			width: 320,
			height: 240,
		});

		expect(targets.width).toBe(320);
		expect(targets.height).toBe(240);
		expect(targets.exterior.domain).toBe("exterior");
		expect(targets.interior.domain).toBe("interior");
		expect(gl.texImage2DFormats).toEqual([
			[gl.RGB8, gl.RGB],
			[gl.DEPTH24_STENCIL8, gl.DEPTH_STENCIL],
			[gl.RGB8, gl.RGB],
			[gl.DEPTH24_STENCIL8, gl.DEPTH_STENCIL],
		]);
		expect(gl.texImage2DSizes).toEqual([
			[320, 240],
			[320, 240],
			[320, 240],
			[320, 240],
		]);
		expect(gl.framebufferAttachmentCount).toBe(4);

		targets.dispose();

		expect(gl.deletedFramebuffers).toBe(2);
		expect(gl.deletedTextures).toBe(4);
	});

	it("fails loudly when framebuffer completeness is unavailable", () => {
		const gl = new CapturingSceneDomainTargetGl();
		gl.framebufferStatus = gl.FRAMEBUFFER_UNSUPPORTED;

		expect(() =>
			createWebgl2SceneDomainTargetSet(gl.asContext(), {
				width: 320,
				height: 240,
			}),
		).toThrow("FRAMEBUFFER_UNSUPPORTED");
		expect(gl.deletedTextures).toBe(2);
	});

	it("creates ping-pong portal composite color/depth-stencil framebuffers", () => {
		const gl = new CapturingSceneDomainTargetGl();

		const targets = createWebgl2PortalCompositeTargetSet(gl.asContext(), {
			width: 128,
			height: 96,
		});

		expect(targets.width).toBe(128);
		expect(targets.height).toBe(96);
		expect(targets.read.label).toBe("portal composite read");
		expect(targets.write.label).toBe("portal composite write");
		expect(gl.texImage2DFormats).toEqual([
			[gl.RGB8, gl.RGB],
			[gl.DEPTH24_STENCIL8, gl.DEPTH_STENCIL],
			[gl.RGB8, gl.RGB],
			[gl.DEPTH24_STENCIL8, gl.DEPTH_STENCIL],
		]);
		expect(gl.framebufferAttachmentCount).toBe(4);

		targets.dispose();

		expect(gl.deletedFramebuffers).toBe(2);
		expect(gl.deletedTextures).toBe(4);
	});
});

class CapturingSceneDomainTargetGl {
	readonly MAX_TEXTURE_SIZE = 3379;
	readonly TEXTURE_2D = 3553;
	readonly RGB8 = 32849;
	readonly RGB = 6407;
	readonly UNSIGNED_BYTE = 5121;
	readonly DEPTH_COMPONENT24 = 33190;
	readonly DEPTH_COMPONENT = 6402;
	readonly UNSIGNED_INT = 5125;
	readonly DEPTH24_STENCIL8 = 35056;
	readonly DEPTH_STENCIL = 34041;
	readonly UNSIGNED_INT_24_8 = 34042;
	readonly CLAMP_TO_EDGE = 33071;
	readonly NEAREST = 9728;
	readonly TEXTURE_WRAP_S = 10242;
	readonly TEXTURE_WRAP_T = 10243;
	readonly TEXTURE_MIN_FILTER = 10241;
	readonly TEXTURE_MAG_FILTER = 10240;
	readonly FRAMEBUFFER = 36160;
	readonly COLOR_ATTACHMENT0 = 36064;
	readonly DEPTH_ATTACHMENT = 36096;
	readonly DEPTH_STENCIL_ATTACHMENT = 33306;
	readonly FRAMEBUFFER_COMPLETE = 36053;
	readonly FRAMEBUFFER_INCOMPLETE_ATTACHMENT = 36054;
	readonly FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT = 36055;
	readonly FRAMEBUFFER_INCOMPLETE_DIMENSIONS = 36057;
	readonly FRAMEBUFFER_UNSUPPORTED = 36061;
	readonly FRAMEBUFFER_INCOMPLETE_MULTISAMPLE = 36182;

	framebufferStatus = this.FRAMEBUFFER_COMPLETE;
	framebufferAttachmentCount = 0;
	deletedFramebuffers = 0;
	deletedTextures = 0;
	readonly texImage2DFormats: [GLenum, GLenum][] = [];
	readonly texImage2DSizes: [number, number][] = [];

	asContext(): WebGL2RenderingContext {
		return this as unknown as WebGL2RenderingContext;
	}

	getParameter(parameter: GLenum): number {
		if (parameter === this.MAX_TEXTURE_SIZE) {
			return 4096;
		}
		throw new Error(`Unexpected getParameter ${parameter}.`);
	}

	createTexture(): WebGLTexture {
		return {} as WebGLTexture;
	}

	bindTexture(): void {
		return;
	}

	texImage2D(
		_target: GLenum,
		_level: number,
		internalFormat: GLenum,
		width: number,
		height: number,
		_border?: number,
		format?: GLenum,
	): void {
		this.texImage2DFormats.push([internalFormat, format ?? internalFormat]);
		this.texImage2DSizes.push([width, height]);
	}

	texParameteri(): void {
		return;
	}

	createFramebuffer(): WebGLFramebuffer {
		return {} as WebGLFramebuffer;
	}

	bindFramebuffer(): void {
		return;
	}

	framebufferTexture2D(): void {
		this.framebufferAttachmentCount += 1;
	}

	checkFramebufferStatus(): GLenum {
		return this.framebufferStatus;
	}

	deleteFramebuffer(): void {
		this.deletedFramebuffers += 1;
	}

	deleteTexture(): void {
		this.deletedTextures += 1;
	}
}
