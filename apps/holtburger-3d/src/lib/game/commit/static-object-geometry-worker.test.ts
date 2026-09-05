import { describe, expect, it } from "vitest";
import { Mat4, Vec3 } from "../math/types";
import { RESTING_PLACEMENT_KEY } from "../resolution/presentation";
import { transformPoint3 } from "../math/matrices";
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

	it("keeps retail-hidden triangles independently selectable after baking", () => {
		const visible = resident("opaque", Mat4.identity(), new Vec3(1, 1, 1));
		const hiddenBase = resident(
			"opaque",
			translation(2, 0, 0),
			new Vec3(1, 1, 1),
		);
		const hidden = {
			...hiddenBase,
			presentation: {
				...hiddenBase.presentation,
				parts: hiddenBase.presentation.parts.map((part) => ({
					...part,
					retailVisibility: "degrade-hidden" as const,
				})),
			},
		};

		const result = bake({
			resourceNamespace: "static-install:retail-visibility" as const,
			source: source([visible, hidden]),
		});

		expect(
			result?.objects[0]?.drawUnits
				.map(({ retailVisibility }) => retailVisibility)
				.sort(),
		).toEqual(["degrade-hidden", "normally-visible"]);
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

	// Retail never normalizes, validates, or derives a face normal for an authored GfxObj
	// normal, and 2.6% of retail vertices author exactly zero. Its software sun term yields
	// nothing for them because max(0, N.L) is zero, which the object shader reproduces.
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
				lights: [],
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

	it("bakes the resting pose, not the default pose, when a setup authors both", () => {
		const base = resident("setup", Mat4.identity(), new Vec3(1, 1, 1));
		const posedResident = {
			...base,
			presentation: {
				...base.presentation,
				placementPoses: new Map([
					[0, { partTransforms: [translation(5, 0, 0)], placementId: 0 }],
					[
						RESTING_PLACEMENT_KEY,
						{
							partTransforms: [translation(1, 0, 0)],
							placementId: RESTING_PLACEMENT_KEY,
						},
					],
				]),
			},
		};

		const result = bake({
			resourceNamespace: "static-install:resting" as const,
			source: source([posedResident]),
		});

		expect(result?.geometry[0]?.geometry.positions).toEqual(
			Float32Array.from([1, 0, 0, 2, 0, 0, 1, 1, 0]),
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
		const objects = objectsSource([
			resident("opaque", Mat4.identity(), new Vec3(1, 1, 1)),
		]);
		const buildings = prepareStaticObjectGeometry({
			layer: LandblockLayerKind.Buildings,
			resourceNamespace: "static-install:shared" as const,
			source: buildingsSource,
		});
		const preparedObjects = prepareStaticObjectGeometry({
			layer: LandblockLayerKind.Objects,
			resourceNamespace: "static-install:shared" as const,
			source: objects,
		});

		expect(buildings?.geometry[0]?.key).not.toBe(
			preparedObjects?.geometry[0]?.key,
		);
		expect(preparedObjects?.geometry[0]?.key).toContain("objects-layer");
	});

	it("rejects a source routed through the wrong static layer", () => {
		expect(() =>
			prepareStaticObjectGeometry({
				layer: LandblockLayerKind.Buildings,
				resourceNamespace: "static-install:mismatch" as const,
				source: objectsSource([]),
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

	it("hydrates generated template transforms across the worker boundary", async () => {
		const worker = new StaticObjectGeometryWorker({
			createGeometryWorker: () => new TransferWorkerPort(),
		});

		const result = await worker.prepare({
			layer: LandblockLayerKind.Generated,
			resourceNamespace: "static-install:generated-template-transfer" as const,
			source: generatedSource([
				resident(
					"transparent-transfer",
					translation(3, 0, 0),
					new Vec3(1, 1, 1),
				),
			]),
		});

		const template = result?.objects[0]?.frameStreamedInstances[0];
		expect(template?.instance.sourceToLandblock).toBeInstanceOf(Mat4);
		expect(template?.instance.sourceToLandblock.m41).toBe(3);
		expect(template?.transparentSort.center).toBeInstanceOf(Vec3);
		// Equivalence pin for the retired per-frame transform: a template's published center must
		// equal what the renderer used to derive each frame from the shared source-local center.
		const partitionGeometry = result?.geometry.find(({ key }) =>
			key.startsWith("static-source-geometry:"),
		)?.geometry;
		expect(partitionGeometry).toBeDefined();
		const sourceLocalCenter = Vec3.zero();
		const { positions } = partitionGeometry!;
		for (let offset = 0; offset < positions.length; offset += 3) {
			sourceLocalCenter.x += positions[offset]! / (positions.length / 3);
			sourceLocalCenter.y += positions[offset + 1]! / (positions.length / 3);
			sourceLocalCenter.z += positions[offset + 2]! / (positions.length / 3);
		}
		const retiredPerFrameCenter = transformPoint3(
			template!.instance.sourceToLandblock,
			sourceLocalCenter,
		);
		expect(template?.transparentSort.center.x).toBeCloseTo(
			retiredPerFrameCenter.x,
			12,
		);
		expect(template?.transparentSort.center.y).toBeCloseTo(
			retiredPerFrameCenter.y,
			12,
		);
		expect(template?.transparentSort.center.z).toBeCloseTo(
			retiredPerFrameCenter.z,
			12,
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

	it("bakes repeated generated residents into one merged landblock buffer", () => {
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
		expect(result?.geometry[0]?.key).toBe(
			"static-install-geometry:static-install:generated-repeated/generated-layer",
		);
		// Baking replicates vertices per instance: two residents merge to six vertices.
		expect(result?.geometry[0]?.geometry.positions).toHaveLength(18);
		expect(result?.objects).toHaveLength(1);
		expect(result?.objects[0]?.drawUnits).toHaveLength(1);
		expect(result?.objects[0]?.frameStreamedInstances).toEqual([]);
		expect(result?.objects[0]?.bounds.max).toMatchObject({ x: 11, y: 1, z: 0 });
		expect(result?.metrics).toMatchObject({
			bakedDrawUnitCount: 1,
			sourcePartCount: 2,
			sourceResidentCount: 2,
			transparentTemplateInstanceCount: 0,
		});
	});

	it("splits transparent contributions into templates and bakes the rest", () => {
		const residents = ["opaque", "alpha-test", "additive", "transparent"].map(
			(kind, index) =>
				resident(kind, translation(index * 2, 0, 0), new Vec3(1, 1, 1)),
		);

		const result = prepareStaticObjectGeometry({
			layer: LandblockLayerKind.Generated,
			resourceNamespace: "static-install:generated-mixed" as const,
			source: generatedSource(residents),
		});

		// Additive commutes, so it bakes alongside opaque and alpha-test.
		expect(
			result?.objects[0]?.drawUnits.map(({ ordering }) => ordering).sort(),
		).toEqual(["additive", "alpha-test", "opaque"]);
		expect(result?.objects[0]?.frameStreamedInstances).toHaveLength(1);
		expect(result?.objects[0]?.frameStreamedInstances[0]).toMatchObject({
			// Landblock space: the source-local centroid (1/3, 1/3, 0) translated by this
			// resident's own placement, which sits at x = 6. The renderer no longer applies it.
			transparentSort: {
				center: { x: 6 + 1 / 3, y: 1 / 3, z: 0 },
				stableId: expect.stringContaining("transparent"),
			},
		});
		// One merged baked buffer plus one shared template partition geometry.
		expect(result?.geometry).toHaveLength(2);
		expect(result?.metrics).toMatchObject({
			bakedDrawUnitCount: 3,
			transparentTemplateCohortCount: 1,
			transparentTemplateInstanceCount: 1,
		});
	});

	it.each(["direct", "worker"] as const)(
		"shares a source draw across repeated transparent residents via %s",
		async (mode) => {
			const first = resident(
				"transparent-shared",
				Mat4.identity(),
				new Vec3(1, 1, 1),
			);
			const second = {
				...first,
				identity: {
					kind: "authored" as const,
					sourceId: "transparent-shared-b",
				},
				placement: {
					...first.placement,
					localTransform: translation(10, 0, 0),
				},
			};
			const job: StaticObjectGeometryPreparationJob = {
				layer: LandblockLayerKind.Generated,
				resourceNamespace: "static-install:generated-shared-template",
				source: generatedSource([first, second]),
			};
			const worker = new StaticObjectGeometryWorker({
				createGeometryWorker: () => new TransferWorkerPort(),
			});
			const result =
				mode === "worker"
					? await worker.prepare(job)
					: prepareStaticObjectGeometry(job);
			worker.destroy();

			expect(result?.geometry).toHaveLength(1);
			expect(result?.objects[0]?.drawUnits).toEqual([]);
			expect(result?.objects[0]?.frameStreamedInstances).toHaveLength(2);
			const [left, right] = result?.objects[0]?.frameStreamedInstances ?? [];
			expect(left?.draw).toBeDefined();
			expect(left?.draw).toBe(right?.draw);
			expect(left?.instance.sourceToLandblock.m41).toBe(0);
			expect(right?.instance.sourceToLandblock.m41).toBe(10);
			expect(left?.transparentSort.stableId).not.toBe(
				right?.transparentSort.stableId,
			);
			expect(result?.objects[0]?.bounds.max).toMatchObject({
				x: 11,
				y: 1,
				z: 0,
			});
		},
	);

	it("includes exact triangle membership in template partition identity", () => {
		const first = resident(
			"transparent-membership-a",
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
			id: "transparent-membership-b",
			presentation: {
				...firstPresentation,
				id: "presentation:transparent-membership-b" as const,
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

		// Two subset partitions for the split-material resident, one full-membership
		// partition for the merged-material resident, each its own template cohort.
		expect(result?.geometry).toHaveLength(3);
		expect(result?.objects[0]?.frameStreamedInstances).toHaveLength(3);
		expect(
			new Set(
				result?.objects[0]?.frameStreamedInstances.map(
					({ draw }) => draw.cohortKey,
				),
			).size,
		).toBe(3);
		expect(
			result?.geometry.map(({ geometry }) => geometry.indices.length).sort(),
		).toEqual([3, 3, 6]);
	});

	it("applies flat setup part transforms in generated templates", () => {
		const base = resident(
			"transparent-setup",
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
							id: "geometry:transparent-child" as const,
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

		const transforms = result?.objects[0]?.frameStreamedInstances
			.map(({ instance }) => instance.sourceToLandblock)
			.sort((left, right) => left.m41 - right.m41);
		expect(transforms).toEqual([
			new Mat4(2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 12, 20, 30, 1),
			new Mat4(2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 20, 20, 30, 1),
		]);
	});

	it("bakes unsupported generated transforms wholly, transparent ranges sorted", () => {
		const result = prepareStaticObjectGeometry({
			layer: LandblockLayerKind.Generated,
			resourceNamespace: "static-install:generated-ineligible" as const,
			source: generatedSource([
				resident("transparent-non-uniform", Mat4.identity(), new Vec3(2, 3, 2)),
			]),
		});

		expect(result?.objects[0]?.frameStreamedInstances).toEqual([]);
		expect(result?.objects[0]?.drawUnits).toHaveLength(1);
		expect(result?.objects[0]?.drawUnits[0]?.ordering).toBe("transparent");
		expect(result?.objects[0]?.drawUnits[0]?.transparentSort).not.toBeNull();
		expect(result?.metrics).toMatchObject({
			bakedDrawUnitCount: 1,
			transparentTemplateInstanceCount: 0,
		});
	});

	it("merges eligible and ineligible generated parts into one baked buffer", () => {
		const result = prepareStaticObjectGeometry({
			layer: LandblockLayerKind.Generated,
			resourceNamespace: "static-install:generated-merged" as const,
			source: generatedSource([
				resident("eligible", Mat4.identity(), new Vec3(1, 1, 1)),
				resident("fallback", translation(5, 0, 0), new Vec3(2, 3, 2)),
			]),
		});

		expect(result?.geometry).toHaveLength(1);
		expect(result?.objects[0]?.drawUnits).toHaveLength(1);
		expect(result?.objects[0]?.frameStreamedInstances).toEqual([]);
		expect(result?.metrics).toMatchObject({ bakedDrawUnitCount: 1 });
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
		mapBlockers: new Map(),
		kind: LandblockLayerKind.Buildings,
		landblockId: "0xda55ffff",
		staticResidents,
	};
}

function generatedSource(
	staticResidents: readonly ReturnType<typeof resident>[],
): ResolvedOutdoorStaticLayerSource {
	return {
		dynamicSources: [],
		kind: LandblockLayerKind.Generated,
		landblockId: "0xda55ffff",
		staticResidents,
	};
}

function objectsSource(
	staticResidents: readonly ReturnType<typeof resident>[],
): ResolvedOutdoorStaticLayerSource {
	return {
		dynamicSources: [],
		kind: LandblockLayerKind.Objects,
		landblockId: "0xda55ffff",
		staticResidents,
	};
}

function envCellResidentSource(
	staticResidents: readonly ReturnType<typeof resident>[],
): ResolvedEnvCellStaticObjectSource {
	return {
		dynamicSources: [],
		envCellId: "0xda550101",
		kind: LandblockLayerKind.EnvCells,
		staticLights: [],
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
			motionTableId: null,
			soundTableId: null,
		},
		identity: { kind: "authored", sourceId: id },
		localBounds: null,
		placement: { envCellId: null, landblockId: "0xda55ffff", localTransform },
		presentation: {
			appearanceKey: `appearance:${id}`,
			id: `presentation:${id}` as const,
			lights: [],
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
					retailVisibility: "normally-visible",
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
			motionTableId: null,
			soundTableId: null,
		},
		setupId: "0x02000001",
	};
}

function translation(x: number, y: number, z: number): Mat4 {
	return new Mat4(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1);
}
