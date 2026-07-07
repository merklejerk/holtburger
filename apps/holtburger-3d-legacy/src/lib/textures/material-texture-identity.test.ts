import { describe, expect, it } from "vitest";
import type {
	HostAssetKey,
	PreparedAsset,
	PreparedAssetReader,
} from "../assets/contracts";
import { describeHostAssetKey } from "../assets/keys";
import type { MaterialTextureDataUseIdentity } from "../static/contracts";
import { createMaterialTextureIdentityFacts } from "./material-texture-identity";

describe("material texture identity facts", () => {
	it("keeps material wrap out of texture identity while preserving page compatibility", async () => {
		const dataUse = createRenderSurfaceUse(0x06000010, "rgba-color");
		const reader = createPaletteReader([]);

		const clamp = await createMaterialTextureIdentityFacts({
			assetReader: reader,
			dataUse,
			domain: "outdoor-buildings",
			purpose: "object-base-color",
			samplingPolicy: { wrapS: "clamp-to-edge", wrapT: "clamp-to-edge" },
		});
		const repeat = await createMaterialTextureIdentityFacts({
			assetReader: reader,
			dataUse,
			domain: "outdoor-buildings",
			purpose: "object-base-color",
			samplingPolicy: { wrapS: "repeat", wrapT: "repeat" },
		});

		expect(repeat.textureKey).toBe(clamp.textureKey);
		expect(repeat.pageClass).toBe(clamp.pageClass);
	});

	it("keeps terrain physical wrap in page class without changing texture identity", async () => {
		const dataUse = createRenderSurfaceUse(0x06000010, "rgba-color");
		const reader = createPaletteReader([]);

		const clamp = await createMaterialTextureIdentityFacts({
			assetReader: reader,
			dataUse,
			domain: "outdoor-terrain",
			purpose: "terrain-color",
			samplingPolicy: { wrapS: "clamp-to-edge", wrapT: "clamp-to-edge" },
		});
		const repeat = await createMaterialTextureIdentityFacts({
			assetReader: reader,
			dataUse,
			domain: "outdoor-terrain",
			purpose: "terrain-color",
			samplingPolicy: { wrapS: "repeat", wrapT: "repeat" },
		});

		expect(repeat.textureKey).toBe(clamp.textureKey);
		expect(repeat.pageClass).not.toBe(clamp.pageClass);
	});

	it("uses replacement range bytes instead of replacement palette ids for palette texture keys", async () => {
		const firstReader = createPaletteReader([
			createPaletteAsset(
				0x04000010,
				[0xff000000, 0xff112233, 0xff445566, 0xffffffff],
			),
		]);
		const secondReader = createPaletteReader([
			createPaletteAsset(
				0x04000020,
				[0xff999999, 0xff112233, 0xff445566, 0xff000000],
			),
		]);

		const first = await createMaterialTextureIdentityFacts({
			assetReader: firstReader,
			dataUse: createPaletteUse(0x04000001, 0x04000010, 1, 2),
			domain: "outdoor-buildings",
			purpose: "object-palette",
		});
		const second = await createMaterialTextureIdentityFacts({
			assetReader: secondReader,
			dataUse: createPaletteUse(0x04000001, 0x04000020, 1, 2),
			domain: "outdoor-buildings",
			purpose: "object-palette",
		});

		expect(second.textureKey).toBe(first.textureKey);
		expect(firstReader.requestedKeys).toEqual(["palette:04000010"]);
		expect(secondReader.requestedKeys).toEqual(["palette:04000020"]);
	});

	it("changes palette texture identity when replacement bytes change", async () => {
		const first = await createMaterialTextureIdentityFacts({
			assetReader: createPaletteReader([
				createPaletteAsset(
					0x04000010,
					[0xff000000, 0xff112233, 0xff445566, 0xffffffff],
				),
			]),
			dataUse: createPaletteUse(0x04000001, 0x04000010, 1, 2),
			domain: "outdoor-buildings",
			purpose: "object-palette",
		});
		const second = await createMaterialTextureIdentityFacts({
			assetReader: createPaletteReader([
				createPaletteAsset(
					0x04000010,
					[0xff000000, 0xff112233, 0xff445567, 0xffffffff],
				),
			]),
			dataUse: createPaletteUse(0x04000001, 0x04000010, 1, 2),
			domain: "outdoor-buildings",
			purpose: "object-palette",
		});

		expect(second.textureKey).not.toBe(first.textureKey);
	});
});

interface RecordingPaletteReader extends PreparedAssetReader {
	readonly requestedKeys: readonly string[];
}

function createPaletteReader(
	assets: readonly PreparedAsset[],
): RecordingPaletteReader {
	const assetsByKey = new Map(
		assets.map((asset) => [describeHostAssetKey(asset.key), asset] as const),
	);
	const requestedKeys: string[] = [];
	return {
		requestedKeys,
		async requestPreparedAsset(key: HostAssetKey): Promise<PreparedAsset> {
			requestedKeys.push(describeHostAssetKey(key));
			const asset = assetsByKey.get(describeHostAssetKey(key));
			if (!asset) {
				throw new Error(`Missing fixture asset ${describeHostAssetKey(key)}.`);
			}
			return asset;
		},
	};
}

function createRenderSurfaceUse(
	renderSurfaceId: number,
	usage: Exclude<
		Extract<
			MaterialTextureDataUseIdentity,
			{ readonly kind: "prepared-render-surface-texture-use" }
		>["usage"],
		"index8" | "index16"
	>,
): MaterialTextureDataUseIdentity {
	return {
		kind: "prepared-render-surface-texture-use",
		renderSurface: {
			kind: "render-surface",
			renderSurfaceId,
		},
		usage,
	};
}

function createPaletteUse(
	basePaletteId: number,
	replacementPaletteId: number,
	offset: number,
	count: number,
): MaterialTextureDataUseIdentity {
	return {
		domain: "index8",
		kind: "prepared-palette-texture-use",
		palette: {
			kind: "palette",
			paletteId: basePaletteId,
		},
		replacements: [
			{
				count,
				offset,
				palette: {
					kind: "palette",
					paletteId: replacementPaletteId,
				},
			},
		],
		usage: "palette-rgba",
	};
}

function createPaletteAsset(
	paletteId: number,
	colorsArgb: readonly number[],
): PreparedAsset {
	return {
		key: {
			id: paletteId.toString(16).padStart(8, "0"),
			kind: "palette",
		},
		payload: {
			colorCount: colorsArgb.length,
			colorsArgb,
			kind: "palette",
			paletteId,
			provenance: {
				detail: null,
				errorCode: null,
				source: "app-local-stub",
				sourceAssetKind: "palette",
			},
			residencyKind: "unknown",
			sourceAssetKind: "palette",
		},
		preparedAt: "fixture",
		revision: 1,
		sourceAssetId: `palette/${paletteId.toString(16).padStart(8, "0")}`,
	};
}
