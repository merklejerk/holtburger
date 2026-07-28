import { describe, expect, it } from "vitest";
import { Mat4, Vec3 } from "../math/types";
import { LandblockLayerKind } from "../runtime/scene-interest";
import type { ResolvedOutdoorStaticLayerSource } from "../resolution/landblock-layer";
import type { ClosedWorkerPort } from "../workers/closed-worker";
import { StaticObjectGeometryWorker } from "./static-object-geometry-worker-client";
import {
	prepareStaticObjectGeometry,
	type StaticObjectGeometryPreparationJob,
} from "./static-object-geometry-worker";

describe("prepareStaticObjectGeometry", () => {
	it("bakes transformed positions into one finite landblock-local allocation", () => {
		const result = bake({
			resourceNamespace: "static-install:test" as const,
			source: source([
				resident("opaque", translation(10, 20, 30), new Vec3(2, 2, 2)),
			]),
		});

		expect(result?.geometry[0]?.geometry.positions).toEqual(
			Float32Array.from([10, 20, 30, 12, 20, 30, 10, 22, 30]),
		);
		expect(result?.bounds.min).toMatchObject({ x: 10, y: 20, z: 30 });
		expect(result?.bounds.max).toMatchObject({ x: 12, y: 22, z: 30 });
		expect(result?.drawUnits).toHaveLength(1);
	});

	it("retains the eligible detail role selected by the static layer domain", () => {
		const building = bake({
			resourceNamespace: "static-install:building-detail" as const,
			source: source([resident("detail", Mat4.identity(), new Vec3(1, 1, 1))]),
		});
		const generated = prepareStaticObjectGeometry({
			layer: LandblockLayerKind.Generated,
			resourceNamespace: "static-install:object-detail" as const,
			source: generatedSource([
				resident("detail", Mat4.identity(), new Vec3(1, 1, 1)),
			]),
		});

		expect(building?.drawUnits[0]?.material.detailRole).toBe("building");
		expect(generated?.drawUnits[0]?.material.detailRole).toBe("object");
	});

	it("keeps transparent ranges independent by resident while merging additive ranges", () => {
		const transparent = [
			resident("transparent-a", Mat4.identity(), new Vec3(1, 1, 1)),
			resident("transparent-b", translation(2, 0, 0), new Vec3(1, 1, 1)),
		];
		const transparentResult = bake({
			resourceNamespace: "static-install:transparent" as const,
			source: source(transparent),
		});
		expect(transparentResult?.drawUnits).toHaveLength(2);
		expect(
			transparentResult?.drawUnits.every(
				(range) => range.transparentSort !== null,
			),
		).toBe(true);

		const additiveResult = bake({
			resourceNamespace: "static-install:additive" as const,
			source: source([
				resident("additive-a", Mat4.identity(), new Vec3(1, 1, 1)),
				resident("additive-b", translation(2, 0, 0), new Vec3(1, 1, 1)),
			]),
		});
		expect(additiveResult?.drawUnits).toHaveLength(1);
		expect(additiveResult?.drawUnits[0]?.transparentSort).toBeNull();
		expect(additiveResult?.metrics).toMatchObject({
			bakedDrawUnitCount: 1,
			sourceMaterialSlotCount: 2,
			sourceRangeCount: 2,
		});
	});

	it("returns no placeholder output when every resident is promoted dynamic", () => {
		expect(
			bake({
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
		const result = bake({
			resourceNamespace: "static-install:zero-normal" as const,
			source: source([zeroNormals]),
		});

		expect(result?.geometry[0]?.geometry.normals).toEqual(new Float32Array(9));
	});

	it("applies setup-style parent transforms and resident scale exactly once", () => {
		const base = resident("setup", translation(10, 20, 30), new Vec3(2, 2, 2));
		const root = base.presentation.parts[0]!;
		const setupResident = {
			...base,
			presentation: {
				...base.presentation,
				parts: [
					root,
					{
						...root,
						geometry: { ...root.geometry, id: "geometry:setup-child" },
						parentPartIndex: 0,
						partIndex: 1,
					},
				],
				placementPoses: new Map([
					[
						0,
						{
							partTransforms: [Mat4.identity(), translation(1, 0, 0)],
							placementId: 0,
						},
					],
				]),
			},
		};

		const result = bake({
			resourceNamespace: "static-install:setup" as const,
			source: source([setupResident]),
		});

		expect(result?.geometry[0]?.geometry.positions).toEqual(
			Float32Array.from([
				10, 20, 30, 12, 20, 30, 10, 22, 30, 12, 20, 30, 14, 20, 30, 12, 22, 30,
			]),
		);
	});

	it("keeps geometry bytes and ranges stable across independent installation namespaces", () => {
		const input = source([
			resident("opaque", Mat4.identity(), new Vec3(1, 1, 1)),
		]);
		const first = bake({
			resourceNamespace: "static-install:first" as const,
			source: input,
		});
		const second = bake({
			resourceNamespace: "static-install:second" as const,
			source: input,
		});

		expect(second?.geometry[0]?.geometry.positions).toEqual(
			first?.geometry[0]?.geometry.positions,
		);
		expect(second?.geometry[0]?.geometry.indices).toEqual(
			first?.geometry[0]?.geometry.indices,
		);
		expect(second?.drawUnits).toEqual(
			first?.drawUnits.map((drawUnit, index) => ({
				...drawUnit,
				geometry: second.drawUnits[index]!.geometry,
			})),
		);
	});

	it("keeps buildings and objects in distinct layer-aware geometry identities", () => {
		const buildingsSource = source([
			resident("opaque", Mat4.identity(), new Vec3(1, 1, 1)),
		]);
		const objectsSource = {
			...buildingsSource,
			kind: LandblockLayerKind.Objects,
		};
		const buildings = prepareStaticObjectGeometry({
			layer: LandblockLayerKind.Buildings,
			resourceNamespace: "static-install:shared" as const,
			source: buildingsSource,
		});
		const objects = prepareStaticObjectGeometry({
			layer: LandblockLayerKind.Objects,
			resourceNamespace: "static-install:shared" as const,
			source: objectsSource,
		});

		expect(buildings?.geometry[0]?.key).not.toBe(objects?.geometry[0]?.key);
		expect(objects?.geometry[0]?.key).toContain("objects-layer");
	});

	it("rejects a source routed through the wrong static layer", () => {
		expect(() =>
			prepareStaticObjectGeometry({
				layer: LandblockLayerKind.Buildings,
				resourceNamespace: "static-install:mismatch" as const,
				source: { ...source([]), kind: LandblockLayerKind.Objects },
			}),
		).toThrow("does not match source layer");
	});

	it("transfers real ArrayBuffer geometry inputs through the worker client", async () => {
		const input = source([
			resident("opaque", Mat4.identity(), new Vec3(1, 1, 1)),
		]);
		const positions =
			input.staticResidents[0]!.presentation.parts[0]!.geometry.positions
				.buffer;
		const worker = new StaticObjectGeometryWorker({
			createGeometryWorker: () => new TransferWorkerPort(),
		});

		const result = await worker.prepare({
			layer: LandblockLayerKind.Buildings,
			resourceNamespace: "static-install:transfer" as const,
			source: input,
		});

		expect(positions.byteLength).toBe(0);
		expect(result?.geometry[0]?.geometry.positions).toEqual(
			Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
		);
		worker.destroy();
	});

	it("preserves geometry buffers shared with a runtime-owned dynamic resident", async () => {
		const staticResident = resident(
			"shared-definition",
			Mat4.identity(),
			new Vec3(1, 1, 1),
		);
		const input = {
			...source([staticResident]),
			dynamicResidents: [
				{ ...staticResident, id: "dynamic-shared-definition" },
			],
		};
		const positions =
			input.dynamicResidents[0]!.presentation.parts[0]!.geometry.positions
				.buffer;
		const worker = new StaticObjectGeometryWorker({
			createGeometryWorker: () => new TransferWorkerPort(),
		});

		const result = await worker.prepare({
			layer: LandblockLayerKind.Buildings,
			resourceNamespace: "static-install:shared-dynamic" as const,
			source: input,
		});

		expect(positions.byteLength).toBeGreaterThan(0);
		expect(
			input.dynamicResidents[0]!.presentation.parts[0]!.geometry.positions,
		).toEqual(Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]));
		expect(result?.drawUnits).toHaveLength(1);
		worker.destroy();
	});

	it("emits one source-local geometry and stream for repeated generated residents", () => {
		const first = resident(
			"generated-opaque",
			Mat4.identity(),
			new Vec3(1, 1, 1),
		);
		const second = {
			...first,
			id: "generated-opaque-b",
			placement: {
				...first.placement,
				localTransform: translation(10, 0, 0),
			},
			presentation: {
				...first.presentation,
				id: "presentation:generated-opaque-b" as const,
			},
		};

		const result = prepareStaticObjectGeometry({
			layer: LandblockLayerKind.Generated,
			resourceNamespace: "static-install:generated-repeated" as const,
			source: generatedSource([first, second]),
		});

		expect(result?.geometry).toHaveLength(1);
		expect(result?.geometry[0]?.geometry.positions).toEqual(
			Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
		);
		expect(result?.instanceStreams).toHaveLength(1);
		expect(result?.instanceStreams[0]?.data.instances).toHaveLength(2);
		expect(result?.drawUnits).toHaveLength(1);
		expect(result?.drawUnits[0]?.kind).toBe("instanced");
		expect(result?.bounds.max).toMatchObject({ x: 11, y: 1, z: 0 });
		expect(result?.metrics).toMatchObject({
			bakedDrawUnitCount: 0,
			persistentCohortCount: 1,
			persistentDrawUnitCount: 1,
			persistentInstanceCount: 2,
			persistentStreamCount: 1,
			sourcePartCount: 2,
			sourceResidentCount: 2,
		});
	});

	it("emits persistent and transparent generated strategies in one result", () => {
		const residents = ["opaque", "alpha-test", "additive", "transparent"].map(
			(kind, index) =>
				resident(kind, translation(index * 2, 0, 0), new Vec3(1, 1, 1)),
		);

		const result = prepareStaticObjectGeometry({
			layer: LandblockLayerKind.Generated,
			resourceNamespace: "static-install:generated-mixed" as const,
			source: generatedSource(residents),
		});

		expect(result?.drawUnits.map(({ ordering }) => ordering).sort()).toEqual([
			"additive",
			"alpha-test",
			"opaque",
		]);
		expect(result?.instanceStreams).toHaveLength(3);
		expect(result?.frameStreamedInstances).toHaveLength(1);
		expect(result?.frameStreamedInstances[0]).toMatchObject({
			transparentSort: {
				center: { x: 1 / 3, y: 1 / 3, z: 0 },
				stableId: expect.stringContaining("transparent"),
			},
		});
		expect(result?.metrics).toMatchObject({
			persistentInstanceCount: 3,
			transparentTemplateCohortCount: 1,
			transparentTemplateInstanceCount: 1,
		});
	});

	it("includes exact triangle membership in generated partition identity", () => {
		const first = resident(
			"partition-membership-a",
			Mat4.identity(),
			new Vec3(1, 1, 1),
		);
		const originalPart = first.presentation.parts[0]!;
		const firstMaterial = originalPart.materials[0]!;
		const secondMaterial = {
			...firstMaterial,
			id: "material:partition-b" as const,
		};
		const sharedGeometry = {
			...originalPart.geometry,
			id: "geometry:partition-membership" as const,
			indices: Uint32Array.from([0, 1, 2, 1, 3, 2]),
			materialSideKinds: Uint8Array.from([0, 0]),
			materialSideTypes: Uint8Array.from([0, 0]),
			materialSlotIndices: Uint16Array.from([0, 1]),
			materialStippling: Uint8Array.from([0, 0]),
			materialWrapModes: Uint8Array.from([0, 0]),
			normals: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
			positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]),
			textureCoordinates: Float32Array.from([0, 0, 1, 0, 0, 1, 1, 1]),
		};
		const firstPresentation = {
			...first.presentation,
			parts: [
				{
					...originalPart,
					geometry: sharedGeometry,
					materials: [firstMaterial, secondMaterial],
				},
			],
		};
		const second = {
			...first,
			id: "partition-membership-b",
			presentation: {
				...firstPresentation,
				id: "presentation:partition-membership-b" as const,
				parts: [
					{
						...firstPresentation.parts[0]!,
						materials: [firstMaterial, firstMaterial],
					},
				],
			},
		};

		const result = prepareStaticObjectGeometry({
			layer: LandblockLayerKind.Generated,
			resourceNamespace: "static-install:partition-membership" as const,
			source: generatedSource([
				{ ...first, presentation: firstPresentation },
				second,
			]),
		});

		expect(result?.geometry).toHaveLength(3);
		expect(result?.instanceStreams).toHaveLength(2);
		expect(result?.drawUnits).toHaveLength(3);
		expect(
			result?.geometry.map(({ geometry }) => geometry.indices.length).sort(),
		).toEqual([3, 3, 6]);
	});

	it("applies setup hierarchy transforms once in generated instance streams", () => {
		const base = resident(
			"generated-setup",
			translation(10, 20, 30),
			new Vec3(2, 2, 2),
		);
		const root = base.presentation.parts[0]!;
		const setupResident = {
			...base,
			presentation: {
				...base.presentation,
				parts: [
					root,
					{
						...root,
						geometry: { ...root.geometry, id: "geometry:generated-child" },
						parentPartIndex: 0,
						partIndex: 1,
					},
				],
				placementPoses: new Map([
					[
						0,
						{
							partTransforms: [Mat4.identity(), translation(1, 0, 0)],
							placementId: 0,
						},
					],
				]),
			},
		};

		const result = prepareStaticObjectGeometry({
			layer: LandblockLayerKind.Generated,
			resourceNamespace: "static-install:generated-setup" as const,
			source: generatedSource([setupResident]),
		});

		const transforms = result?.instanceStreams
			.map(({ data }) => data.instances[0]!.sourceToLandblock)
			.sort((left, right) => left.m41 - right.m41);
		expect(transforms).toEqual([
			new Mat4(2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 10, 20, 30, 1),
			new Mat4(2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 12, 20, 30, 1),
		]);
	});

	it("falls back explicitly for unsupported generated transforms", () => {
		const result = prepareStaticObjectGeometry({
			layer: LandblockLayerKind.Generated,
			resourceNamespace: "static-install:generated-fallback" as const,
			source: generatedSource([
				resident("non-uniform", Mat4.identity(), new Vec3(2, 3, 2)),
			]),
		});

		expect(result?.instanceStreams).toEqual([]);
		expect(result?.drawUnits[0]?.kind).toBe("baked");
		expect(result?.metrics).toMatchObject({
			bakedDrawUnitCount: 1,
			persistentInstanceCount: 0,
		});
	});

	it("merges an explicit baked fallback with eligible generated cohorts", () => {
		const result = prepareStaticObjectGeometry({
			layer: LandblockLayerKind.Generated,
			resourceNamespace: "static-install:generated-mixed-fallback" as const,
			source: generatedSource([
				resident("eligible", Mat4.identity(), new Vec3(1, 1, 1)),
				resident("fallback", translation(5, 0, 0), new Vec3(2, 3, 2)),
			]),
		});

		expect(result?.drawUnits.map(({ kind }) => kind).sort()).toEqual([
			"baked",
			"instanced",
		]);
		expect(result?.geometry).toHaveLength(2);
		expect(result?.metrics).toMatchObject({
			bakedDrawUnitCount: 1,
			persistentDrawUnitCount: 1,
			persistentInstanceCount: 1,
		});
		expect(result?.bounds.max).toMatchObject({ x: 7, y: 3, z: 0 });
	});

	it("rejects singular generated transforms instead of emitting corrupt instances", () => {
		expect(() =>
			prepareStaticObjectGeometry({
				layer: LandblockLayerKind.Generated,
				resourceNamespace: "static-install:generated-singular" as const,
				source: generatedSource([
					resident("singular", Mat4.identity(), new Vec3(1, 0, 1)),
				]),
			}),
		).toThrow("singular instance transform");
	});
});

class TransferWorkerPort implements ClosedWorkerPort {
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessage: ((event: MessageEvent<unknown>) => void) | null = null;

	postMessage(
		message: {
			readonly id: number;
			readonly input: StaticObjectGeometryPreparationJob;
		},
		transfer: readonly Transferable[],
	): void {
		const cloned = structuredClone(message, { transfer: [...transfer] });
		const result = prepareStaticObjectGeometry(cloned.input);
		this.onmessage?.({
			data: { id: cloned.id, ok: true, result },
		} as MessageEvent<unknown>);
	}

	terminate(): void {}
}

function bake(job: Omit<StaticObjectGeometryPreparationJob, "layer">) {
	return prepareStaticObjectGeometry({
		...job,
		layer: LandblockLayerKind.Buildings,
	});
}

function source(
	staticResidents: readonly ReturnType<typeof resident>[],
): ResolvedOutdoorStaticLayerSource {
	return {
		dynamicResidents: [],
		kind: LandblockLayerKind.Buildings,
		landblockId: "0xda55ffff",
		staticResidents,
	};
}

function generatedSource(
	staticResidents: readonly ReturnType<typeof resident>[],
): ResolvedOutdoorStaticLayerSource {
	return {
		...source(staticResidents),
		kind: LandblockLayerKind.Generated,
	};
}

function resident(id: string, localTransform: Mat4, scale: Vec3) {
	const flags = id.startsWith("transparent")
		? 0x10
		: id.startsWith("additive")
			? 0x10000
			: id.startsWith("detail")
				? 0x20000
				: id.startsWith("alpha-test")
					? 0x04
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
