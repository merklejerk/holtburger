import { describe, expect, it } from "vitest";
import { Mat4, Vec3 } from "../math/types";
import { LandblockLayerKind } from "../runtime/scene-interest";
import type {
	ResolvedEnvCellStaticObjectSource,
	ResolvedObjectResident,
	ResolvedOutdoorStaticLayerSource,
} from "../resolution/landblock-layer";
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
		expect(result?.objects[0]?.bounds.min).toMatchObject({
			x: 10,
			y: 20,
			z: 30,
		});
		expect(result?.objects[0]?.bounds.max).toMatchObject({
			x: 12,
			y: 22,
			z: 30,
		});
		expect(result?.objects[0]?.drawUnits).toHaveLength(1);
	});

	it("selects detail only for the building static geometry domain", () => {
		const building = bake({
			resourceNamespace: "static-install:building-detail" as const,
			source: source([resident("opaque", Mat4.identity(), new Vec3(1, 1, 1))]),
		});
		const generated = prepareStaticObjectGeometry({
			layer: LandblockLayerKind.Generated,
			resourceNamespace: "static-install:object-detail" as const,
			source: generatedSource([
				resident("opaque", Mat4.identity(), new Vec3(1, 1, 1)),
			]),
		});
		const indoorResident = prepareStaticObjectGeometry({
			layer: LandblockLayerKind.EnvCells,
			resourceNamespace: "static-install:env-cell-resident-detail" as const,
			source: envCellResidentSource([
				resident("opaque", Mat4.identity(), new Vec3(1, 1, 1)),
			]),
		});

		expect(building?.objects[0]?.drawUnits[0]?.material.detailRole).toBe(
			"building",
		);
		expect(generated?.objects[0]?.drawUnits[0]?.material.detailRole).toBeNull();
		expect(
			indoorResident?.objects[0]?.drawUnits[0]?.material.detailRole,
		).toBeNull();
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
		expect(transparentResult?.objects[0]?.drawUnits).toHaveLength(2);
		expect(
			transparentResult?.objects[0]?.drawUnits.every(
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
		expect(additiveResult?.objects[0]?.drawUnits).toHaveLength(1);
		expect(
			additiveResult?.objects[0]?.drawUnits[0]?.transparentSort,
		).toBeNull();
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
					dynamicSources: [
						dynamicSource(
							resident("opaque", Mat4.identity(), new Vec3(1, 1, 1)),
						),
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

	it("applies each setup part transform against the object frame, not its siblings", () => {
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
						geometry: {
							...root.geometry,
							id: "geometry:setup-child" as const,
						},
						partIndex: 1,
					},
				],
				holdingLocations: new Map(),
				placementPoses: new Map([
					[
						0,
						{
							partTransforms: [translation(5, 0, 0), translation(1, 0, 0)],
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
				20, 20, 30, 22, 20, 30, 20, 22, 30, 12, 20, 30, 14, 20, 30, 12, 22, 30,
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
		if (!second) throw new Error("Expected the second geometry preparation.");
		expect(second?.objects[0]?.drawUnits).toEqual(
			first?.objects[0]?.drawUnits.map((drawUnit, index) => ({
				...drawUnit,
				geometry: second.objects[0]!.drawUnits[index]!.geometry,
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
		} satisfies ResolvedOutdoorStaticLayerSource;
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
			dynamicSources: [dynamicSource(staticResident)],
		};
		const positions =
			input.dynamicSources[0]!.presentation.parts[0]!.geometry.positions.buffer;
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
			input.dynamicSources[0]!.presentation.parts[0]!.geometry.positions,
		).toEqual(Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]));
		expect(result?.objects[0]?.drawUnits).toHaveLength(1);
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
		expect(result?.objects[0]?.drawUnits).toHaveLength(1);
		expect(result?.objects[0]?.drawUnits[0]?.kind).toBe("instanced");
		expect(result?.objects[0]?.bounds.max).toMatchObject({ x: 11, y: 1, z: 0 });
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

	it("partitions generated residents into tight cullable clusters while sharing geometry", () => {
		const first = resident(
			"generated-clustered",
			translation(10, 0, -10),
			new Vec3(1, 1, 1),
		);
		const second = {
			...first,
			identity: {
				kind: "authored" as const,
				sourceId: "generated-clustered-b",
			},
			placement: {
				...first.placement,
				localTransform: translation(100, 0, -10),
			},
		};
		const third = {
			...first,
			identity: {
				kind: "authored" as const,
				sourceId: "generated-clustered-c",
			},
			placement: {
				...first.placement,
				localTransform: translation(10, 0, -100),
			},
		};

		const result = prepareStaticObjectGeometry({
			layer: LandblockLayerKind.Generated,
			resourceNamespace: "static-install:generated-clustered" as const,
			source: generatedSource([first, second, third]),
		});

		expect(result?.geometry).toHaveLength(1);
		expect(result?.objects).toHaveLength(3);
		expect(result?.objects.map(({ bounds }) => bounds.min.x)).toEqual([
			10, 10, 100,
		]);
		expect(result?.objects.map(({ bounds }) => bounds.max.x)).toEqual([
			11, 11, 101,
		]);
		expect(result?.objects.map(({ bounds }) => bounds.min.z)).toEqual([
			-10, -100, -10,
		]);
		expect(result?.instanceStreams).toHaveLength(3);
		expect(
			result?.instanceStreams.map(({ data }) => data.instances.length),
		).toEqual([1, 1, 1]);
		expect(result?.metrics).toMatchObject({
			persistentCohortCount: 3,
			persistentDrawUnitCount: 3,
			persistentInstanceCount: 3,
			sourceResidentCount: 3,
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

		expect(
			result?.objects[0]?.drawUnits.map(({ ordering }) => ordering).sort(),
		).toEqual(["additive", "alpha-test", "opaque"]);
		expect(result?.instanceStreams).toHaveLength(3);
		expect(result?.objects[0]?.frameStreamedInstances).toHaveLength(1);
		expect(result?.objects[0]?.frameStreamedInstances[0]).toMatchObject({
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
		expect(result?.objects[0]?.drawUnits).toHaveLength(3);
		expect(
			result?.geometry.map(({ geometry }) => geometry.indices.length).sort(),
		).toEqual([3, 3, 6]);
	});

	it("applies flat setup part transforms in generated instance streams", () => {
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
						geometry: {
							...root.geometry,
							id: "geometry:generated-child" as const,
						},
						partIndex: 1,
					},
				],
				holdingLocations: new Map(),
				placementPoses: new Map([
					[
						0,
						{
							partTransforms: [translation(5, 0, 0), translation(1, 0, 0)],
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
			new Mat4(2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 12, 20, 30, 1),
			new Mat4(2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 20, 20, 30, 1),
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
		expect(result?.objects[0]?.drawUnits[0]?.kind).toBe("baked");
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

		expect(
			result?.objects[0]?.drawUnits.map(({ kind }) => kind).sort(),
		).toEqual(["baked", "instanced"]);
		expect(result?.geometry).toHaveLength(2);
		expect(result?.metrics).toMatchObject({
			bakedDrawUnitCount: 1,
			persistentDrawUnitCount: 1,
			persistentInstanceCount: 1,
		});
		expect(result?.objects[0]?.bounds.max).toMatchObject({ x: 7, y: 3, z: 0 });
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
		dynamicSources: [],
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

function envCellResidentSource(
	staticResidents: readonly ReturnType<typeof resident>[],
): ResolvedEnvCellStaticObjectSource {
	return {
		dynamicSources: [],
		envCellId: "0xda550101",
		kind: LandblockLayerKind.EnvCells,
		landblockId: "0xda55ffff",
		staticResidents,
	};
}

function resident(
	id: string,
	localTransform: Mat4,
	scale: Vec3,
): ResolvedObjectResident {
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
		behavior: {
			animationId: null,
			kind: "none",
			physicsScriptId: null,
			physicsScriptTableId: null,
			soundTableId: null,
		},
		identity: { kind: "authored", sourceId: id },
		localBounds: null,
		placement: { envCellId: null, landblockId: "0xda55ffff", localTransform },
		presentation: {
			appearanceKey: `appearance:${id}`,
			id: `presentation:${id}` as const,
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
						sourceDiagnostics: { rejectedDegenerateTriangles: [] },
						textureCoordinates: Float32Array.from([0, 0, 1, 0, 0, 1]),
					},
					materials: [material],
					partIndex: 0,
				},
			],
			holdingLocations: new Map(),
			placementPoses: new Map([
				[0, { partTransforms: [Mat4.identity()], placementId: 0 }],
			]),
			selectionBounds: null,
			sortingBounds: null,
			sourceAssetId: "0x01000001",
		},
		scale,
		setupId: null,
	};
}

function dynamicSource(
	sourceResident: ReturnType<typeof resident>,
): import("../resolution/landblock-layer").AuthoredDynamicSource {
	return {
		...sourceResident,
		behavior: {
			animationId: "0x03000001",
			kind: "animation-only",
			physicsScriptId: null,
			physicsScriptTableId: null,
			soundTableId: null,
		},
		setupId: "0x02000001",
	};
}

function translation(x: number, y: number, z: number): Mat4 {
	return new Mat4(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1);
}
