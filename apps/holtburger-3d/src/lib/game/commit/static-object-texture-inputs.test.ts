import { describe, expect, it } from "vitest";
import { Mat4, Vec3 } from "../math/types";
import type {
	ResolvedObjectResident,
	ResolvedOutdoorStaticLayerSource,
} from "../resolution/landblock-layer";
import type {
	ResolvedMaterial,
	ResolvedObjectPart,
} from "../resolution/presentation";
import { LandblockLayerKind } from "../runtime/scene-interest";
import { collectStaticObjectTextureDependencies } from "./static-object-texture-inputs";

const INDEX_TEXTURE = "0x05000001";
const PALETTE = "0x04000001";

// These fixtures describe two real triangles, including both sampler choices.
function part(materials: readonly ResolvedMaterial[]): ResolvedObjectPart {
	return {
		partIndex: 0,
		defaultScale: new Vec3(1, 1, 1),
		retailVisibility: "normally-visible",
		materials,
		geometry: {
			id: "geometry:fixture",
			bounds: null,
			positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
			normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
			textureCoordinates: new Float32Array([0, 0, 1, 0, 0, 1]),
			indices: new Uint32Array([0, 1, 2, 0, 2, 1]),
			materialSlotIndices: new Uint16Array([0, 0]),
			materialWrapModes: new Uint8Array([0, 1]),
			materialSideKinds: new Uint8Array([0, 1]),
			materialSideTypes: new Uint8Array([0, 0]),
			materialStippling: new Uint8Array([0, 0]),
			sourceDiagnostics: { rejectedDegenerateTriangles: [] },
		},
	};
}

function resident(
	parts: readonly ResolvedObjectPart[],
): ResolvedObjectResident {
	return {
		identity: { kind: "authored", sourceId: "explicit:0" },
		setupId: null,
		localBounds: null,
		scale: new Vec3(1, 1, 1),
		placement: {
			envCellId: null,
			landblockId: "0xda55ffff",
			localTransform: Mat4.identity(),
		},
		behavior: {
			kind: "none",
			animationId: null,
			physicsScriptId: null,
			physicsScriptTableId: null,
			motionTableId: null,
			soundTableId: null,
		},
		presentation: {
			appearanceKey: "gfx-obj:0x01000001",
			id: "presentation:fixture",
			sourceAssetId: "0x01000001",
			parts,
			lights: [],
			holdingLocations: new Map(),
			placementPoses: new Map(),
			selectionBounds: null,
			sortingBounds: null,
		},
	};
}

function source(
	staticResidents: readonly ResolvedObjectResident[],
): Extract<
	ResolvedOutdoorStaticLayerSource,
	{ readonly kind: LandblockLayerKind.Objects }
> {
	return {
		kind: LandblockLayerKind.Objects,
		landblockId: "0xda55ffff",
		staticResidents,
		dynamicSources: [],
	};
}

function indexedMaterial(
	colorTextureId: string,
): Extract<ResolvedMaterial, { readonly kind: "texture" }> {
	return {
		id: "material:fixture",
		kind: "texture",
		colorTextureId,
		renderSurfaceId: "0x06000001",
		paletteTextureId: PALETTE,
		paletteComposite: null,
		textureEncoding: "index8",
		rawSurfaceFlags: 0,
		translucency: 0,
		luminosity: 0,
		diffuseScale: 1,
	};
}

function textureIds(
	input: ResolvedOutdoorStaticLayerSource,
): readonly string[] {
	return collectStaticObjectTextureDependencies(input).map(
		(fact) => fact.sourceAssetId,
	);
}

describe("collectStaticObjectTextureDependencies", () => {
	it("collects only referenced facts across repeated placements and parts", () => {
		const shared = part([
			indexedMaterial(INDEX_TEXTURE),
			indexedMaterial("0x05000002"),
		]);
		const original = resident([shared]);
		const repeated = {
			...original,
			identity: { kind: "authored", sourceId: "explicit:1" },
		} as const;
		expect(textureIds(source([original, repeated]))).toEqual([
			INDEX_TEXTURE,
			PALETTE,
		]);
	});

	it("retains different material closures on shared geometry even when material IDs match", () => {
		const original = part([indexedMaterial(INDEX_TEXTURE)]);
		const other = { ...original, materials: [indexedMaterial("0x05000002")] };
		expect(textureIds(source([resident([other, original])]))).toEqual([
			INDEX_TEXTURE,
			"0x05000002",
			PALETTE,
		]);
	});

	it("does not retain identity state across independent collections", () => {
		const original = resident([part([indexedMaterial(INDEX_TEXTURE)])]);
		expect(textureIds(source([original]))).toEqual([INDEX_TEXTURE, PALETTE]);
		expect(textureIds(source([original]))).toEqual([INDEX_TEXTURE, PALETTE]);
	});

	it("rejects a missing slot after a previously visited material", () => {
		const original = part([indexedMaterial(INDEX_TEXTURE)]);
		const invalid = {
			...original,
			geometry: {
				...original.geometry,
				materialSlotIndices: new Uint16Array([0, 1]),
			},
		};
		expect(() =>
			collectStaticObjectTextureDependencies(source([resident([invalid])])),
		).toThrow(
			"Authored resident explicit:0 part 0 triangle 1 has no material slot 1.",
		);
	});

	it("preserves composed palette payloads and excludes the original palette", () => {
		const paletteComposite = {
			identity: "palette-composite:fixture",
			basePaletteId: PALETTE,
			ranges: [
				{ replacementPaletteId: "0x04000002", offset: 8, colorCount: 8 },
			],
		} as const;
		const material = { ...indexedMaterial(INDEX_TEXTURE), paletteComposite };
		const facts = collectStaticObjectTextureDependencies(
			source([resident([part([material])])]),
		);
		expect(facts.map((fact) => fact.sourceAssetId)).toEqual([
			INDEX_TEXTURE,
			paletteComposite.identity,
		]);
		expect(facts[1]).toMatchObject({ paletteComposite });
	});

	it("rejects an indexed texture without a palette", () => {
		const material = {
			...indexedMaterial(INDEX_TEXTURE),
			paletteTextureId: null,
		};
		expect(() =>
			collectStaticObjectTextureDependencies(
				source([resident([part([material])])]),
			),
		).toThrow("Indexed material material:fixture has no palette dependency.");
	});

	it("accepts empty and solid-only sources without texture demand", () => {
		const solid: ResolvedMaterial = {
			kind: "solid-color",
			id: "material:solid",
			color: [1, 1, 1, 1],
			rawSurfaceFlags: 0,
			translucency: 0,
			luminosity: 0,
			diffuseScale: 1,
		};
		expect(textureIds(source([]))).toEqual([]);
		expect(textureIds(source([resident([part([solid])])]))).toEqual([]);
	});

	it("leaves promoted template textures to the visual-template repository", () => {
		const original = resident([part([indexedMaterial(INDEX_TEXTURE)])]);
		const dynamic = {
			...original,
			setupId: "0x02000001",
			behavior: {
				...original.behavior,
				kind: "animation-only",
				animationId: "0x03000001",
				physicsScriptId: null,
				physicsScriptTableId: null,
			},
		} as const;
		expect(
			collectStaticObjectTextureDependencies({
				...source([]),
				dynamicSources: [dynamic],
			}),
		).toEqual([]);
	});

	it("preserves dependency facts across static detail domains including EnvCell residents", () => {
		const original = source([
			resident([part([indexedMaterial(INDEX_TEXTURE)])]),
		]);
		const expected = collectStaticObjectTextureDependencies(original);
		const envCell = {
			...original,
			kind: LandblockLayerKind.EnvCells,
			envCellId: "0xda550100",
			staticLights: [],
		} as const;
		expect(collectStaticObjectTextureDependencies(envCell)).toEqual(expected);
		expect(
			collectStaticObjectTextureDependencies({
				...original,
				kind: LandblockLayerKind.Generated,
			}),
		).toEqual(expected);
		expect(
			collectStaticObjectTextureDependencies({
				...original,
				kind: LandblockLayerKind.Buildings,
				mapBlockers: new Map(),
			}),
		).toEqual(expected);
	});
});
