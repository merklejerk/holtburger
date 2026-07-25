import { describe, expect, it } from "vitest";
import { Mat4, Vec3 } from "../math/types";
import { LandblockLayerKind } from "../runtime/scene-interest";
import type { ResolvedObjectLayerSource } from "../resolution/landblock-layer";
import { bakeBuildingGeometry } from "./building-geometry-worker";

describe("bakeBuildingGeometry", () => {
	it("bakes transformed positions into one finite landblock-local allocation", () => {
		const result = bakeBuildingGeometry({
			resourceNamespace: "static-install:test" as const,
			source: source([
				resident("opaque", translation(10, 20, 30), new Vec3(2, 2, 2)),
			]),
		});

		expect(result?.geometry.geometry.positions).toEqual(
			Float32Array.from([10, 20, 30, 12, 20, 30, 10, 22, 30]),
		);
		expect(result?.bounds.min).toMatchObject({ x: 10, y: 20, z: 30 });
		expect(result?.bounds.max).toMatchObject({ x: 12, y: 22, z: 30 });
		expect(result?.ranges).toHaveLength(1);
	});

	it("keeps transparent ranges independent by resident while merging additive ranges", () => {
		const transparent = [
			resident("transparent-a", Mat4.identity(), new Vec3(1, 1, 1)),
			resident("transparent-b", translation(2, 0, 0), new Vec3(1, 1, 1)),
		];
		const transparentResult = bakeBuildingGeometry({
			resourceNamespace: "static-install:transparent" as const,
			source: source(transparent),
		});
		expect(transparentResult?.ranges).toHaveLength(2);
		expect(
			transparentResult?.ranges.every(
				(range) => range.transparentSort !== null,
			),
		).toBe(true);

		const additiveResult = bakeBuildingGeometry({
			resourceNamespace: "static-install:additive" as const,
			source: source([
				resident("additive-a", Mat4.identity(), new Vec3(1, 1, 1)),
				resident("additive-b", translation(2, 0, 0), new Vec3(1, 1, 1)),
			]),
		});
		expect(additiveResult?.ranges).toHaveLength(1);
		expect(additiveResult?.ranges[0]?.transparentSort).toBeNull();
		expect(additiveResult?.metrics).toMatchObject({
			bakedRangeCount: 1,
			sourceMaterialSlotCount: 2,
			sourceRangeCount: 2,
		});
	});

	it("returns no placeholder output when every resident is promoted dynamic", () => {
		expect(
			bakeBuildingGeometry({
				resourceNamespace: "static-install:empty" as const,
				source: {
					...source([]),
					dynamicResidents: [
						resident("opaque", Mat4.identity(), new Vec3(1, 1, 1)),
					],
				},
			}),
		).toBeNull();
	});

	it("preserves zero authored normals without inventing face-lighting data", () => {
		const base = resident("opaque", Mat4.identity(), new Vec3(1, 1, 1));
		const zeroNormals = {
			...base,
			presentation: {
				...base.presentation,
				parts: [
					{
						...base.presentation.parts[0]!,
						geometry: {
							...base.presentation.parts[0]!.geometry,
							normals: new Float32Array(9),
						},
					},
				],
			},
		};
		const result = bakeBuildingGeometry({
			resourceNamespace: "static-install:zero-normal" as const,
			source: source([zeroNormals]),
		});

		expect(result?.geometry.geometry.normals).toEqual(new Float32Array(9));
	});

	it("keeps geometry bytes and ranges stable across independent installation namespaces", () => {
		const input = source([
			resident("opaque", Mat4.identity(), new Vec3(1, 1, 1)),
		]);
		const first = bakeBuildingGeometry({
			resourceNamespace: "static-install:first" as const,
			source: input,
		});
		const second = bakeBuildingGeometry({
			resourceNamespace: "static-install:second" as const,
			source: input,
		});

		expect(second?.geometry.geometry.positions).toEqual(
			first?.geometry.geometry.positions,
		);
		expect(second?.geometry.geometry.indices).toEqual(
			first?.geometry.geometry.indices,
		);
		expect(second?.ranges).toEqual(first?.ranges);
	});
});

function source(
	staticResidents: readonly ReturnType<typeof resident>[],
): ResolvedObjectLayerSource {
	return {
		dynamicResidents: [],
		kind: LandblockLayerKind.Buildings,
		landblockId: "0xda55ffff",
		staticResidents,
	};
}

function resident(id: string, localTransform: Mat4, scale: Vec3) {
	const flags = id.startsWith("transparent")
		? 0x10
		: id.startsWith("additive")
			? 0x10000
			: 0;
	const material = {
		color: [1, 1, 1, 1] as const,
		diffuseScale: 1,
		id: `material:${flags}` as const,
		kind: "solid-color" as const,
		luminosity: 0,
		rawSurfaceFlags: flags,
		translucency: 0,
	};
	return {
		appearance: null,
		id,
		localBounds: null,
		placement: { envCellId: null, landblockId: "0xda55ffff", localTransform },
		presentation: {
			effects: {
				animationId: null,
				physicsScriptId: null,
				physicsScriptTableId: null,
				soundTableId: null,
			},
			id: `presentation:${id}` as const,
			motion: null,
			parts: [
				{
					defaultScale: new Vec3(1, 1, 1),
					geometry: {
						bounds: null,
						id: `geometry:${id}` as const,
						indices: Uint32Array.from([0, 1, 2]),
						materialSideKinds: Uint8Array.from([0]),
						materialSideTypes: Uint8Array.from([0]),
						materialSlotIndices: Uint16Array.from([0]),
						materialStippling: Uint8Array.from([0]),
						materialWrapModes: Uint8Array.from([0]),
						normals: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1]),
						positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
						textureCoordinates: Float32Array.from([0, 0, 1, 0, 0, 1]),
					},
					materials: [material],
					parentPartIndex: null,
					partIndex: 0,
				},
			],
			placementPoses: new Map([
				[0, { partTransforms: [Mat4.identity()], placementId: 0 }],
			]),
			selectionBounds: null,
			sortingBounds: null,
			sourceAssetId: "0x01000001",
		},
		scale,
	};
}

function translation(x: number, y: number, z: number): Mat4 {
	return new Mat4(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1);
}
