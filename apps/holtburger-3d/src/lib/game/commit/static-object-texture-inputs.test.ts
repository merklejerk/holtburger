import { describe, expect, it } from "vitest";
import { Mat4, Vec3 } from "../math/types";
import type { ResolvedOutdoorStaticLayerSource } from "../resolution/landblock-layer";
import type { ResolvedMaterial } from "../resolution/presentation";
import { LandblockLayerKind } from "../runtime/scene-interest";
import { TexturePurpose } from "../textures/types";
import { collectStaticObjectTextureDependencies } from "./static-object-texture-inputs";

describe("collectStaticObjectTextureDependencies", () => {
	it("collects only triangle-referenced indexed texture and palette facts across objects", () => {
		const requirements = collectStaticObjectTextureDependencies(
			objectsSourceWithOneReferencedMaterial(),
		);

		expect(requirements).toEqual([
			expect.objectContaining({
				purpose: TexturePurpose.ObjectIndex8,
				sourceAssetId: "0x05000001",
			}),
			expect.objectContaining({
				purpose: TexturePurpose.ObjectPalette,
				sourceAssetId: "0x04000001",
			}),
		]);
	});

	it("leaves promoted template textures to the visual-template repository", () => {
		const source = objectsSourceWithOneReferencedMaterial();
		const resident = source.staticResidents[0]!;
		const dynamic = {
			...resident,
			behavior: {
				animationId: "0x03000001",
				kind: "animation-only",
				physicsScriptId: null,
				physicsScriptTableId: null,
				motionTableId: null,
				soundTableId: null,
			},
			identity: { kind: "authored", sourceId: "animated:0" },
			setupId: "0x02000001",
		} as const;

		const requirements = collectStaticObjectTextureDependencies({
			...source,
			dynamicSources: [dynamic],
			staticResidents: [],
		});

		expect(requirements).toEqual([]);
	});
});

function objectsSourceWithOneReferencedMaterial(): ResolvedOutdoorStaticLayerSource {
	return {
		dynamicSources: [],
		kind: LandblockLayerKind.Objects,
		landblockId: "0xda55ffff",
		staticResidents: [
			{
				behavior: {
					animationId: null,
					kind: "none",
					physicsScriptId: null,
					physicsScriptTableId: null,
					motionTableId: null,
					soundTableId: null,
				},
				identity: { kind: "authored", sourceId: "explicit:0" },
				localBounds: null,
				placement: {
					envCellId: null,
					landblockId: "0xda55ffff",
					localTransform: Mat4.identity(),
				},
				presentation: {
					appearanceKey: "gfx-obj:0x01000001",
					id: "presentation:explicit:0",
					parts: [
						{
							defaultScale: new Vec3(1, 1, 1),
							geometry: {
								bounds: null,
								id: "geometry:explicit:0",
								indices: Uint32Array.from([]),
								materialSideKinds: Uint8Array.from([0]),
								materialSideTypes: Uint8Array.from([0]),
								materialSlotIndices: Uint16Array.from([0]),
								materialStippling: Uint8Array.from([0]),
								materialWrapModes: Uint8Array.from([1]),
								normals: Float32Array.from([]),
								positions: Float32Array.from([]),
								sourceDiagnostics: {
									rejectedDegenerateTriangles: [],
								},
								textureCoordinates: Float32Array.from([]),
							},
							materials: [
								indexedMaterial("0x05000001", "0x04000001"),
								indexedMaterial("0x05000002", "0x04000002"),
							],
							partIndex: 0,
						},
					],
					lights: [],
					holdingLocations: new Map(),
					placementPoses: new Map(),
					selectionBounds: null,
					sortingBounds: null,
					sourceAssetId: "0x01000001",
				},
				scale: new Vec3(1, 1, 1),
				setupId: null,
			},
		],
	};
}

function indexedMaterial(
	colorTextureId: string,
	paletteTextureId: string,
): ResolvedMaterial {
	return {
		colorTextureId,
		diffuseScale: 1,
		id: `material:${colorTextureId}`,
		kind: "texture" as const,
		luminosity: 0,
		paletteTextureId,
		paletteComposite: null,
		rawSurfaceFlags: 0,
		renderSurfaceId: "0x06000001",
		textureEncoding: "index8" as const,
		translucency: 0,
	};
}
