import { describe, expect, it } from "vitest";
import { Mat4, Vec3 } from "../math/types";
import { LandblockLayerKind } from "../runtime/scene-interest";
import type { ResolvedOutdoorStaticLayerSource } from "../resolution/landblock-layer";
import type { ClosedWorkerPort } from "../workers/closed-worker";
import { StaticObjectGeometryWorker } from "./static-object-geometry-worker-client";
import {
	bakeStaticObjectGeometry,
	type StaticObjectGeometryJob,
} from "./static-object-geometry-worker";

describe("bakeStaticObjectGeometry", () => {
	it("bakes transformed positions into one finite landblock-local allocation", () => {
		const result = bake({
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
		const transparentResult = bake({
			resourceNamespace: "static-install:transparent" as const,
			source: source(transparent),
		});
		expect(transparentResult?.ranges).toHaveLength(2);
		expect(
			transparentResult?.ranges.every(
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

		expect(result?.geometry.geometry.normals).toEqual(new Float32Array(9));
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

		expect(result?.geometry.geometry.positions).toEqual(
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

		expect(second?.geometry.geometry.positions).toEqual(
			first?.geometry.geometry.positions,
		);
		expect(second?.geometry.geometry.indices).toEqual(
			first?.geometry.geometry.indices,
		);
		expect(second?.ranges).toEqual(first?.ranges);
	});

	it("keeps buildings and objects in distinct layer-aware geometry identities", () => {
		const buildingsSource = source([
			resident("opaque", Mat4.identity(), new Vec3(1, 1, 1)),
		]);
		const objectsSource = {
			...buildingsSource,
			kind: LandblockLayerKind.Objects,
		};
		const buildings = bakeStaticObjectGeometry({
			layer: LandblockLayerKind.Buildings,
			resourceNamespace: "static-install:shared" as const,
			source: buildingsSource,
		});
		const objects = bakeStaticObjectGeometry({
			layer: LandblockLayerKind.Objects,
			resourceNamespace: "static-install:shared" as const,
			source: objectsSource,
		});

		expect(buildings?.geometry.key).not.toBe(objects?.geometry.key);
		expect(objects?.geometry.key).toContain("objects-layer");
	});

	it("rejects a source routed through the wrong static layer", () => {
		expect(() =>
			bakeStaticObjectGeometry({
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

		const result = await worker.bake({
			layer: LandblockLayerKind.Buildings,
			resourceNamespace: "static-install:transfer" as const,
			source: input,
		});

		expect(positions.byteLength).toBe(0);
		expect(result?.geometry.geometry.positions).toEqual(
			Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
		);
		worker.destroy();
	});
});

class TransferWorkerPort implements ClosedWorkerPort {
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessage: ((event: MessageEvent<unknown>) => void) | null = null;

	postMessage(
		message: { readonly id: number; readonly input: StaticObjectGeometryJob },
		transfer: readonly Transferable[],
	): void {
		const cloned = structuredClone(message, { transfer: [...transfer] });
		const result = bakeStaticObjectGeometry(cloned.input);
		this.onmessage?.({
			data: { id: cloned.id, ok: true, result },
		} as MessageEvent<unknown>);
	}

	terminate(): void {}
}

function bake(job: Omit<StaticObjectGeometryJob, "layer">) {
	return bakeStaticObjectGeometry({
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
