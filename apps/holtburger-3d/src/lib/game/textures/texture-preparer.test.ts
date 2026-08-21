import { describe, expect, it } from "vitest";
import type { TexturePixelSource } from "../../assets/texture-pixel-source";
import { TERRAIN_TYPE_COUNT } from "../terrain/pcode";
import {
	createAssetTextureKey,
	createTextureArrayKey,
	type AssetTextureFact,
	type TerrainColorTextureArrayFact,
	TexturePixelFormat,
	TexturePurpose,
} from "./types";
import {
	type PreparedTextureSurface,
	type TexturePreparationServiceRequest,
	type TexturePreparationServiceResponse,
	WorkerTexturePreparer,
} from "./texture-preparer";

const DETAIL_TEXTURE: AssetTextureFact = {
	kind: "asset",
	key: createAssetTextureKey(TexturePurpose.TerrainDetail, "0x05000004"),
	purpose: TexturePurpose.TerrainDetail,
	sourceAssetId: "0x05000004",
};

describe("WorkerTexturePreparer", () => {
	it("coalesces concurrent preparation for one stable texture key", async () => {
		const assets = new DeferredTexturePixelSource(createDetailSurface());
		const preparer = await WorkerTexturePreparer.build(assets);

		const first = preparer.prepare(DETAIL_TEXTURE);
		const second = preparer.prepare(DETAIL_TEXTURE);

		expect(assets.requests).toHaveLength(1);
		assets.resolveRequest();
		await expect(Promise.all([first, second])).resolves.toEqual([
			{
				height: 2,
				key: DETAIL_TEXTURE.key,
				pixels: new Uint8Array([1, 2, 3, 4]),
				purpose: TexturePurpose.TerrainDetail,
				sourceAssetId: "0x05000004",
				width: 2,
			},
			{
				height: 2,
				key: DETAIL_TEXTURE.key,
				pixels: new Uint8Array([1, 2, 3, 4]),
				purpose: TexturePurpose.TerrainDetail,
				sourceAssetId: "0x05000004",
				width: 2,
			},
		]);
	});

	it("requests an authored palette by resource id and a composition by identity", async () => {
		const composite = {
			identity: "palette-composite:04000001:04000abc+18+8",
			basePaletteId: "0x04000001",
			ranges: [
				{ replacementPaletteId: "0x04000abc", offset: 0x18, colorCount: 0x08 },
			],
		} as const;
		const assets = new RecordingTexturePixelSource();
		const preparer = await WorkerTexturePreparer.build(assets);

		await preparer.prepare({
			kind: "asset",
			key: createAssetTextureKey(TexturePurpose.ObjectPalette, "0x04000001"),
			purpose: TexturePurpose.ObjectPalette,
			sourceAssetId: "0x04000001",
		});
		await preparer.prepare({
			kind: "asset",
			key: createAssetTextureKey(
				TexturePurpose.ObjectPalette,
				composite.identity,
			),
			purpose: TexturePurpose.ObjectPalette,
			sourceAssetId: composite.identity,
			paletteComposite: composite,
		});

		expect(assets.requests).toEqual([
			{
				kind: "prepared-object-palette",
				purpose: TexturePurpose.ObjectPalette,
				sourceAssetId: "palette/0x04000001",
			},
			{
				kind: "prepared-object-palette",
				purpose: TexturePurpose.ObjectPalette,
				sourceAssetId: composite.identity,
				paletteComposite: composite,
			},
		]);
	});

	it("assembles one complete terrain palette in authored code order", async () => {
		const colorA = "surface-texture/0x05000001" as const;
		const colorB = "surface-texture/0x05000002" as const;
		const sourceAssetIdsByTerrainCode = Array.from(
			{ length: TERRAIN_TYPE_COUNT },
			(_, terrainCode) => (terrainCode === 2 ? colorB : colorA),
		);
		const fact: TerrainColorTextureArrayFact = {
			kind: "array",
			key: createTextureArrayKey(TexturePurpose.TerrainColor, "test-region"),
			purpose: TexturePurpose.TerrainColor,
			sourceAssetIds: [colorA, colorB],
			sourceAssetIdsByTerrainCode,
		};
		const pixelSource = new TerrainColorPixelSource(
			new Map([
				[colorA, [0.1, 0.2, 0.3] as const],
				[colorB, [0.7, 0.8, 0.9] as const],
			]),
		);
		const preparer = await WorkerTexturePreparer.build(pixelSource);

		const source = await preparer.prepare(fact);
		if (!("palette" in source)) {
			throw new Error("Terrain-color preparation returned no palette.");
		}
		expect(source.layers.map(({ sourceAssetId }) => sourceAssetId)).toEqual([
			colorA,
			colorB,
		]);
		expect(Array.from(source.palette.colors.slice(0, 9))).toEqual([
			expect.closeTo(0.1),
			expect.closeTo(0.2),
			expect.closeTo(0.3),
			expect.closeTo(0.1),
			expect.closeTo(0.2),
			expect.closeTo(0.3),
			expect.closeTo(0.7),
			expect.closeTo(0.8),
			expect.closeTo(0.9),
		]);
		expect(source.palette.colors).toHaveLength(TERRAIN_TYPE_COUNT * 3);
		expect(pixelSource.requests).toEqual([colorA, colorB]);
	});

	it.each([
		["wrong channel count", [0, 0], "2 mean RGB channels instead of three"],
		["non-finite channel", [0, Number.NaN, 0], "non-finite"],
		["out-of-range channel", [0, 0, 2], "out-of-range"],
	] as const)(
		"rejects a %s at the pixel-source boundary",
		async (_, meanRgb, message) => {
			const color = "surface-texture/0x05000001" as const;
			const preparer = await WorkerTexturePreparer.build(
				new InvalidTerrainColorPixelSource(meanRgb),
			);
			await expect(
				preparer.prepare({
					kind: "array",
					key: createTextureArrayKey(TexturePurpose.TerrainColor, "bad-region"),
					purpose: TexturePurpose.TerrainColor,
					sourceAssetIds: [color],
					sourceAssetIdsByTerrainCode: Array.from(
						{ length: TERRAIN_TYPE_COUNT },
						() => color,
					),
				}),
			).rejects.toThrow(message);
		},
	);

	it.each([
		["short", TERRAIN_TYPE_COUNT - 1],
		["long", TERRAIN_TYPE_COUNT + 1],
	] as const)("rejects a %s terrain-code join", async (_, terrainCodeCount) => {
		const color = "surface-texture/0x05000001" as const;
		const preparer = await WorkerTexturePreparer.build(
			new TerrainColorPixelSource(new Map([[color, [0.1, 0.2, 0.3] as const]])),
		);

		await expect(
			preparer.prepare({
				kind: "array",
				key: createTextureArrayKey(
					TexturePurpose.TerrainColor,
					`${terrainCodeCount}-code-region`,
				),
				purpose: TexturePurpose.TerrainColor,
				sourceAssetIds: [color],
				sourceAssetIdsByTerrainCode: Array.from(
					{ length: terrainCodeCount },
					() => color,
				),
			}),
		).rejects.toThrow(`expected ${TERRAIN_TYPE_COUNT}`);
	});
});

/** Deliberately violates the replaceable source interface to exercise runtime validation. */
class InvalidTerrainColorPixelSource implements TexturePixelSource {
	constructor(readonly meanRgb: readonly number[]) {}

	async loadTexturePixels(
		request: TexturePreparationServiceRequest,
	): Promise<TexturePreparationServiceResponse> {
		if (
			request.kind !== "prepared-texture-surface" ||
			request.purpose !== TexturePurpose.TerrainColor
		) {
			throw new Error("Invalid-mean fixture received another purpose.");
		}
		return {
			kind: request.kind,
			purpose: request.purpose,
			surface: {
				format: TexturePixelFormat.RGBA8,
				height: 1,
				meanRgb: this.meanRgb,
				pixels: new Uint8Array([1, 2, 3, 4]),
				sourceAssetId: request.sourceAssetId,
				width: 1,
			},
		} as unknown as TexturePreparationServiceResponse;
	}
}

class TerrainColorPixelSource implements TexturePixelSource {
	readonly requests: string[] = [];
	constructor(
		readonly means: ReadonlyMap<string, readonly [number, number, number]>,
	) {}

	async loadTexturePixels(
		request: TexturePreparationServiceRequest,
	): Promise<TexturePreparationServiceResponse> {
		if (
			request.kind !== "prepared-texture-surface" ||
			request.purpose !== TexturePurpose.TerrainColor
		) {
			throw new Error("Terrain-color fixture received another purpose.");
		}
		this.requests.push(request.sourceAssetId);
		const meanRgb = this.means.get(request.sourceAssetId);
		if (!meanRgb)
			throw new Error(`Missing fixture mean for ${request.sourceAssetId}.`);
		return {
			kind: request.kind,
			purpose: request.purpose,
			surface: {
				format: TexturePixelFormat.RGBA8,
				height: 1,
				meanRgb,
				pixels: new Uint8Array([1, 2, 3, 4]),
				sourceAssetId: request.sourceAssetId,
				width: 1,
			},
		};
	}
}

/** Echoes each request back so the preparer's own identity validation stays in play. */
class RecordingTexturePixelSource implements TexturePixelSource {
	readonly requests: TexturePreparationServiceRequest[] = [];

	async loadTexturePixels(
		request: TexturePreparationServiceRequest,
	): Promise<TexturePreparationServiceResponse> {
		this.requests.push(request);
		const surface = {
			format: TexturePixelFormat.RGBA8,
			height: 1,
			pixels: new Uint8Array([1, 2, 3, 4]),
			sourceAssetId: request.sourceAssetId,
			width: 1,
		};
		if (
			request.kind === "prepared-texture-surface" &&
			request.purpose === TexturePurpose.TerrainColor
		) {
			return {
				kind: request.kind,
				purpose: request.purpose,
				surface: { ...surface, meanRgb: [0, 0, 0] },
			};
		}
		switch (request.kind) {
			case "prepared-texture-surface":
				return { kind: request.kind, purpose: request.purpose, surface };
			case "prepared-object-texture":
				return { kind: request.kind, purpose: request.purpose, surface };
			case "prepared-object-palette":
				return { kind: request.kind, purpose: request.purpose, surface };
		}
	}
}

class DeferredTexturePixelSource implements TexturePixelSource {
	readonly requests: TexturePreparationServiceRequest[] = [];
	#resolve: (() => void) | undefined;
	readonly #surface: PreparedTextureSurface;
	readonly #requestComplete = new Promise<void>((resolve) => {
		this.#resolve = resolve;
	});

	constructor(surface: PreparedTextureSurface) {
		this.#surface = surface;
	}

	async loadTexturePixels(
		request: TexturePreparationServiceRequest,
	): Promise<TexturePreparationServiceResponse> {
		this.requests.push(request);
		await this.#requestComplete;
		if (
			request.kind !== "prepared-texture-surface" ||
			request.purpose !== TexturePurpose.TerrainDetail
		) {
			throw new Error("Deferred fixture only serves terrain detail.");
		}
		return {
			kind: request.kind,
			purpose: request.purpose,
			surface: this.#surface,
		};
	}

	resolveRequest(): void {
		if (!this.#resolve) throw new Error("Texture request was not pending.");
		this.#resolve();
		this.#resolve = undefined;
	}
}

function createDetailSurface(): PreparedTextureSurface {
	return {
		format: TexturePixelFormat.RGBA8,
		height: 2,
		pixels: new Uint8Array([1, 2, 3, 4]),
		sourceAssetId: "0x05000004",
		width: 2,
	};
}
