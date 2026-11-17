import { describe, expect, it } from "vitest";

import {
	WebGL2EntityOverlayPass,
	type EntityOverlayDrawInstance,
	type EntityOverlayScopedDrawInstance,
} from "./webgl2-entity-overlay-pass";
import type { NameplateTextureBinding } from "./webgl2-nameplate-texture-cache";
import { PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES } from "./portal-propagation-metadata";
import { SHARED_FRAME_SETTINGS } from "../../frontend-frame-settings";
import { Vec3 } from "../math/types";

const ATLAS_TEXTURE = { key: "shared-atlas" } as unknown as WebGLTexture;
const OTHER_ATLAS_TEXTURE = { key: "other-atlas" } as unknown as WebGLTexture;
const FALLBACK_TEXTURE = { key: "fallback" } as unknown as WebGLTexture;

function binding(
	_key: string,
	width: number,
	height: number,
	texture: WebGLTexture = ATLAS_TEXTURE,
): NameplateTextureBinding {
	return {
		height,
		texture,
		width,
		atlasUvRect: new Float32Array([0, 0, 1, 1]),
	};
}

function createFixture() {
	const draws: number[] = [];
	const drawDepthTests: boolean[] = [];
	let depthTest = false;
	const uploadedFloatCounts: number[] = [];
	const uploadedFloats: number[][] = [];
	const anchorOffsets: number[] = [];
	const attribDivisors: Array<readonly [number, number]> = [];
	const plateSizes: Array<readonly [number, number]> = [];
	const healthBarSizes: Array<readonly [number, number]> = [];
	const referenceDistances: number[] = [];
	const sampler = { key: "nameplate" } as unknown as WebGLSampler;
	const samplerBindings: Array<WebGLSampler | null> = [];
	const textureBindings: Array<WebGLTexture | null> = [];
	const shaderSources: string[] = [];
	const deleted = { buffers: 0, programs: 0, vertexArrays: 0 };
	const gl = {
		ARRAY_BUFFER: 1,
		BLEND: 2,
		COMPILE_STATUS: 3,
		CULL_FACE: 4,
		DEPTH_TEST: 5,
		FLOAT: 6,
		FRAGMENT_SHADER: 7,
		LEQUAL: 8,
		LINK_STATUS: 9,
		INVALID_INDEX: 0xffff_ffff,
		ONE_MINUS_SRC_ALPHA: 10,
		SRC_ALPHA: 11,
		STATIC_DRAW: 12,
		STREAM_DRAW: 13,
		TEXTURE0: 14,
		TEXTURE_2D: 15,
		TRIANGLES: 16,
		UNIFORM_BLOCK_DATA_SIZE: 17,
		VERTEX_SHADER: 18,
		activeTexture: () => undefined,
		attachShader: () => undefined,
		bindBuffer: () => undefined,
		bindSampler: (_unit: number, binding: WebGLSampler | null) =>
			samplerBindings.push(binding),
		bindTexture: (_target: number, texture: WebGLTexture | null) =>
			textureBindings.push(texture),
		bindVertexArray: () => undefined,
		blendFunc: () => undefined,
		bufferData: () => undefined,
		bufferSubData: (
			_target: number,
			_offset: number,
			data: Float32Array,
			_sourceOffset: number,
			length: number,
		) => {
			uploadedFloatCounts.push(length);
			uploadedFloats.push(Array.from(data.subarray(0, length)));
		},
		compileShader: () => undefined,
		createBuffer: () => ({}) as WebGLBuffer,
		createProgram: () => ({}) as WebGLProgram,
		createShader: () => ({}) as WebGLShader,
		createVertexArray: () => ({}) as WebGLVertexArrayObject,
		deleteBuffer: () => {
			deleted.buffers += 1;
		},
		deleteProgram: () => {
			deleted.programs += 1;
		},
		deleteShader: () => undefined,
		deleteVertexArray: () => {
			deleted.vertexArrays += 1;
		},
		depthFunc: () => undefined,
		depthMask: () => undefined,
		disable: (capability: number) => {
			if (capability === gl.DEPTH_TEST) depthTest = false;
		},
		drawArraysInstanced: (
			_mode: number,
			_first: number,
			_count: number,
			instanceCount: number,
		) => {
			draws.push(instanceCount);
			drawDepthTests.push(depthTest);
		},
		enable: (capability: number) => {
			if (capability === gl.DEPTH_TEST) depthTest = true;
		},
		enableVertexAttribArray: () => undefined,
		getProgramInfoLog: () => "",
		getProgramParameter: () => true,
		getUniformBlockIndex: () => 0,
		getActiveUniformBlockParameter: () =>
			PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES,
		getShaderInfoLog: () => "",
		getShaderParameter: () => true,
		getUniformLocation: (_program: WebGLProgram, name: string) =>
			({ name }) as unknown as WebGLUniformLocation,
		linkProgram: () => undefined,
		shaderSource: (_shader: WebGLShader, source: string) =>
			shaderSources.push(source),
		uniform1i: () => undefined,
		uniform1f: (location: { readonly name: string }, value: number) => {
			if (location.name === "uReferenceDistance")
				referenceDistances.push(value);
		},
		uniformBlockBinding: () => undefined,
		uniform2f: (
			location: { readonly name: string },
			first: number,
			second: number,
		) => {
			if (location.name === "uPlateSize") plateSizes.push([first, second]);
			if (location.name === "uHealthBarSize")
				healthBarSizes.push([first, second]);
		},
		uniform4f: () => undefined,
		uniformMatrix4fv: () => undefined,
		useProgram: () => undefined,
		vertexAttribDivisor: (index: number, divisor: number) => {
			attribDivisors.push([index, divisor]);
		},
		vertexAttribPointer: (
			index: number,
			_size: number,
			_type: number,
			_normalized: boolean,
			_stride: number,
			offset: number,
		) => {
			if (index === 1) anchorOffsets.push(offset);
		},
	} as unknown as WebGL2RenderingContext;
	return {
		anchorOffsets,
		attribDivisors,
		deleted,
		draws,
		drawDepthTests,
		gl,
		healthBarSizes,
		plateSizes,
		referenceDistances,
		sampler,
		samplerBindings,
		shaderSources,
		textureBindings,
		uploadedFloatCounts,
		uploadedFloats,
	};
}

const barSettings = SHARED_FRAME_SETTINGS.healthBars;
const context = {
	clipFromAnchor: new Float32Array(16),
	referenceDistance: 6.25,
	viewportHeight: 720,
	viewportWidth: 1_280,
	healthBar: {
		sizePixels: [
			barSettings.widthCssPixels,
			barSettings.heightCssPixels,
		] as const,
		gapPixels: barSettings.gapCssPixels,
		borderWidthPixels: barSettings.borderWidthCssPixels,
		fillColor: barSettings.fillColor,
		backgroundColor: barSettings.backgroundColor,
		borderColor: barSettings.borderColor,
	},
};

describe("WebGL2EntityOverlayPass", () => {
	it.each(["flat", "portal"] as const)(
		"keeps selected plates visible without merging their depth policy into adjacent ordinary plates (%s)",
		(path) => {
			const fixture = createFixture();
			const pass = new WebGL2EntityOverlayPass(
				fixture.gl,
				fixture.sampler,
				FALLBACK_TEXTURE,
			);
			const plate = binding("shared", 64, 16);
			const instances = [true, false, true].map((depthTest) => ({
				anchor: Vec3.zero(),
				binding: plate,
				healthFraction: null,
				depthTest,
				renderScopeKey: "env:one",
			}));
			if (path === "portal")
				pass.drawScoped(context, instances, {
					deferredRenderDomainOrdinal: () => 0,
				});
			else pass.draw(context, instances);
			expect(fixture.draws).toEqual([1, 1, 1]);
			expect(fixture.drawDepthTests).toEqual([true, false, true]);
		},
	);
	it("forwards the supplied reference distance to the billboard draw program", () => {
		const fixture = createFixture();

		const pass = new WebGL2EntityOverlayPass(
			fixture.gl,
			fixture.sampler,
			FALLBACK_TEXTURE,
		);

		pass.draw(context, [
			{
				depthTest: true,
				anchor: Vec3.zero(),
				binding: binding("plate", 64, 16),
				healthFraction: null,
			},
		]);
		expect(fixture.referenceDistances).toEqual([context.referenceDistance]);
	});

	it("uploads one ordered instance stream and draws different plates from one atlas", () => {
		const fixture = createFixture();
		const pass = new WebGL2EntityOverlayPass(
			fixture.gl,
			fixture.sampler,
			FALLBACK_TEXTURE,
		);
		const drudge = binding("drudge", 128, 32);
		const instances: EntityOverlayDrawInstance[] = [
			{
				depthTest: true,
				anchor: new Vec3(1, 2, 3),
				binding: drudge,
				healthFraction: null,
			},
			{
				depthTest: true,
				anchor: new Vec3(4, 5, 6),
				binding: drudge,
				healthFraction: null,
			},
			{
				depthTest: true,
				anchor: new Vec3(7, 8, 9),
				binding: binding("town-crier", 96, 48),
				healthFraction: null,
			},
		];

		pass.draw(context, instances);

		expect(fixture.uploadedFloatCounts).toEqual([33]);
		expect(fixture.draws).toEqual([3]);
		expect(
			fixture.uploadedFloats[0]?.filter((_, index) => index % 11 === 4),
		).toEqual([128, 128, 96]);
		expect(fixture.samplerBindings).toEqual([fixture.sampler, null]);
		expect(pass.diagnostics()).toEqual({ drawCount: 1, instanceCount: 3 });
	});

	it("does no upload or draw work for an empty submission", () => {
		const fixture = createFixture();
		const pass = new WebGL2EntityOverlayPass(
			fixture.gl,
			fixture.sampler,
			FALLBACK_TEXTURE,
		);

		pass.draw(context, []);

		expect(fixture.uploadedFloatCounts).toEqual([]);
		expect(fixture.draws).toEqual([]);
		expect(fixture.samplerBindings).toEqual([]);
		expect(pass.diagnostics()).toEqual({ drawCount: 0, instanceCount: 0 });
	});

	it("coalesces ordered instances across portal domains when they share one atlas", () => {
		const fixture = createFixture();
		const pass = new WebGL2EntityOverlayPass(
			fixture.gl,
			fixture.sampler,
			FALLBACK_TEXTURE,
		);
		const drudge = binding("drudge", 128, 32);
		const instances: EntityOverlayScopedDrawInstance[] = [
			{
				depthTest: true,
				anchor: new Vec3(1, 2, 3),
				binding: drudge,
				healthFraction: null,
				renderScopeKey: "env:one",
			},
			{
				depthTest: true,
				anchor: new Vec3(4, 5, 6),
				binding: drudge,
				healthFraction: null,
				renderScopeKey: "env:one",
			},
			{
				depthTest: true,
				anchor: new Vec3(7, 8, 9),
				binding: drudge,
				healthFraction: null,
				renderScopeKey: "outdoor",
			},
		];
		const routed: string[] = [];

		pass.drawScoped(context, instances, {
			deferredRenderDomainOrdinal: (renderScopeKey) => {
				routed.push(renderScopeKey);
				return renderScopeKey === "outdoor" ? 0 : 1;
			},
		});

		expect(routed).toEqual(["env:one", "env:one", "outdoor"]);
		expect(fixture.draws).toEqual([3]);
		expect(pass.diagnostics()).toEqual({ drawCount: 1, instanceCount: 3 });
	});

	it("submits fifty ordered scoped plates with one depth-tested draw", () => {
		const fixture = createFixture();
		const pass = new WebGL2EntityOverlayPass(
			fixture.gl,
			fixture.sampler,
			FALLBACK_TEXTURE,
		);
		const plates = Array.from({ length: 50 }, (_, index) => ({
			anchor: new Vec3(index, 0, 0),
			binding: binding(`plate:${index}`, 64 + index, 24),
			healthFraction: null,
			depthTest: true,
			renderScopeKey: index % 2 === 0 ? "outdoor" : "indoor",
		}));
		pass.drawScoped(context, plates, {
			deferredRenderDomainOrdinal: (key) => (key === "outdoor" ? 0 : 1),
		});
		expect(fixture.draws).toEqual([50]);
		expect(fixture.drawDepthTests).toEqual([true]);
		expect(pass.diagnostics()).toEqual({ drawCount: 1, instanceCount: 50 });
	});

	it("preserves plate order while batching distinct atlas rectangles", () => {
		const fixture = createFixture();
		const pass = new WebGL2EntityOverlayPass(
			fixture.gl,
			fixture.sampler,
			FALLBACK_TEXTURE,
		);
		const drudge = binding("drudge", 128, 32);
		const townCrier = binding("town-crier", 96, 48);

		pass.draw(context, [
			{
				depthTest: true,
				anchor: new Vec3(1, 2, 3),
				binding: drudge,
				healthFraction: null,
			},
			{
				depthTest: true,
				anchor: new Vec3(4, 5, 6),
				binding: townCrier,
				healthFraction: null,
			},
			{
				depthTest: true,
				anchor: new Vec3(7, 8, 9),
				binding: drudge,
				healthFraction: null,
			},
		]);

		expect(fixture.draws).toEqual([3]);
		expect(
			fixture.uploadedFloats[0]?.filter((_, index) => index % 11 === 4),
		).toEqual([128, 96, 128]);
	});

	it("packs instanced health fractions with divisor 1 and negative sentinels without splitting matching batches", () => {
		const fixture = createFixture();
		const pass = new WebGL2EntityOverlayPass(
			fixture.gl,
			fixture.sampler,
			FALLBACK_TEXTURE,
		);
		const drudge = binding("drudge", 128, 32);

		pass.draw(context, [
			{
				depthTest: true,
				anchor: new Vec3(1, 2, 3),
				binding: drudge,
				healthFraction: 0.625,
			},
			{
				depthTest: true,
				anchor: new Vec3(4, 5, 6),
				binding: drudge,
				healthFraction: null,
			},
			{
				depthTest: true,
				anchor: new Vec3(7, 8, 9),
				binding: drudge,
				healthFraction: 1.5,
			},
		]);

		expect(fixture.attribDivisors).toEqual([
			[1, 1],
			[2, 1],
			[3, 1],
			[4, 1],
			[5, 1],
		]);
		expect(fixture.draws).toEqual([3]);
		expect(
			fixture.uploadedFloats[0]?.filter((_, index) => index % 11 === 3),
		).toEqual([0.625, -1, 1]);
		expect(fixture.healthBarSizes).toEqual([
			[barSettings.widthCssPixels, barSettings.heightCssPixels],
		]);
	});

	it("coalesces bar-only overlays into adjacent labeled runs without atlas acquisition", () => {
		const fixture = createFixture();
		const pass = new WebGL2EntityOverlayPass(
			fixture.gl,
			fixture.sampler,
			FALLBACK_TEXTURE,
		);
		const label = binding("label", 128, 32);
		pass.draw(context, [
			{
				depthTest: true,
				anchor: new Vec3(1, 2, 3),
				binding: null,
				healthFraction: 0.5,
			},
			{
				depthTest: true,
				anchor: new Vec3(4, 5, 6),
				binding: label,
				healthFraction: null,
			},
			{
				depthTest: true,
				anchor: new Vec3(7, 8, 9),
				binding: null,
				healthFraction: 0.25,
			},
			{
				depthTest: true,
				anchor: new Vec3(1, 1, 1),
				binding: label,
				healthFraction: 0.75,
			},
		]);
		expect(fixture.draws).toEqual([4]);
		expect(fixture.textureBindings).toEqual([ATLAS_TEXTURE, null]);
		const floats = fixture.uploadedFloats[0] ?? [];
		// Bar-only plate dimensions and atlas rectangles are zero.
		expect(floats.slice(4, 10)).toEqual([0, 0, 0, 0, 0, 0]);
		expect(floats.slice(26, 32)).toEqual([0, 0, 0, 0, 0, 0]);
		expect(floats.filter((_, index) => index % 11 === 3)).toEqual([
			0.5, -1, 0.25, 0.75,
		]);
	});

	it("binds the borrowed fallback texture for runs containing only bars", () => {
		const fixture = createFixture();
		const pass = new WebGL2EntityOverlayPass(
			fixture.gl,
			fixture.sampler,
			FALLBACK_TEXTURE,
		);
		pass.draw(context, [
			{
				depthTest: false,
				anchor: Vec3.zero(),
				binding: null,
				healthFraction: 1,
			},
			{
				depthTest: false,
				anchor: Vec3.zero(),
				binding: null,
				healthFraction: 0,
			},
		]);
		expect(fixture.draws).toEqual([2]);
		expect(fixture.textureBindings).toEqual([FALLBACK_TEXTURE, null]);
	});

	it("splits ordered runs only for distinct label atlases or depth routes", () => {
		const fixture = createFixture();
		const pass = new WebGL2EntityOverlayPass(
			fixture.gl,
			fixture.sampler,
			FALLBACK_TEXTURE,
		);
		pass.draw(context, [
			{
				depthTest: true,
				anchor: Vec3.zero(),
				binding: binding("a", 8, 8),
				healthFraction: null,
			},
			{
				depthTest: true,
				anchor: Vec3.zero(),
				binding: null,
				healthFraction: 0.5,
			},
			{
				depthTest: true,
				anchor: Vec3.zero(),
				binding: binding("b", 8, 8, OTHER_ATLAS_TEXTURE),
				healthFraction: null,
			},
			{
				depthTest: false,
				anchor: Vec3.zero(),
				binding: null,
				healthFraction: 0.5,
			},
		]);
		expect(fixture.draws).toEqual([2, 1, 1]);
		expect(fixture.textureBindings).toEqual([
			ATLAS_TEXTURE,
			OTHER_ATLAS_TEXTURE,
			FALLBACK_TEXTURE,
			null,
		]);
	});

	it("rejects an overlay instance with neither component", () => {
		const fixture = createFixture();
		const pass = new WebGL2EntityOverlayPass(
			fixture.gl,
			fixture.sampler,
			FALLBACK_TEXTURE,
		);
		expect(() =>
			pass.draw(context, [
				{
					depthTest: true,
					anchor: Vec3.zero(),
					binding: null,
					healthFraction: null,
				},
			]),
		).toThrow("neither label nor bar");
	});

	it("reserves the label gap only when both components are composed", () => {
		const fixture = createFixture();
		new WebGL2EntityOverlayPass(fixture.gl, fixture.sampler, FALLBACK_TEXTURE);
		const vertex = fixture.shaderSources.find((source) =>
			source.includes("aPlateSize"),
		);
		expect(vertex).toContain("hasPlate * uHealthBarGapBorder.x");
	});

	it("owns and releases its complete GPU resource set", () => {
		const fixture = createFixture();
		const pass = new WebGL2EntityOverlayPass(
			fixture.gl,
			fixture.sampler,
			FALLBACK_TEXTURE,
		);

		pass.destroy();
		pass.destroy();

		// The fallback texture is borrowed from the renderer and is not released here.
		expect(fixture.deleted).toEqual({
			buffers: 2,
			programs: 2,
			vertexArrays: 1,
		});
		expect(() => pass.draw(context, [])).toThrow(
			"Entity overlay pass is destroyed",
		);
	});
});
