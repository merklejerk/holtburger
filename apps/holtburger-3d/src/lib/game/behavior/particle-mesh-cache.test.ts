import { describe, expect, it } from "vitest";
import type { DecodedStaticPresentation } from "../../assets/decode-static-source-record";
import type { ParticleMeshSource } from "../../assets/particle-mesh-source";
import type { DatAssetId } from "../game-types";
import { ParticleMeshCache } from "./particle-mesh-cache";

const MESH_A = "0x01000ff4" as DatAssetId;
const MESH_B = "0x0100162f" as DatAssetId;

function fakeSource(): ParticleMeshSource & {
	readonly batches: DatAssetId[][];
	release: () => void;
} {
	const batches: DatAssetId[][] = [];
	let release = () => {};
	return {
		batches,
		destroy: () => {},
		loadParticleMeshes: async (hwGfxObjIds) => {
			batches.push([...hwGfxObjIds]);
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			return {
				presentations: new Map(
					hwGfxObjIds.map((id) => [id, {} as DecodedStaticPresentation]),
				),
				textureDependencies: [],
			};
		},
		get release() {
			return () => release();
		},
	};
}

describe("ParticleMeshCache", () => {
	it("loads a batch once and serves it from memory afterwards", async () => {
		const source = fakeSource();
		const cache = new ParticleMeshCache(source);

		const first = cache.prepare([MESH_A, MESH_B]);
		source.release();
		await first;

		expect(source.batches).toEqual([[MESH_A, MESH_B]]);
		expect(cache.get(MESH_A)).not.toBeNull();

		await cache.prepare([MESH_A, MESH_B]);
		// Already resident: no second transfer.
		expect(source.batches).toHaveLength(1);
	});

	it("requests only the meshes it does not already have", async () => {
		const source = fakeSource();
		const cache = new ParticleMeshCache(source);
		const first = cache.prepare([MESH_A]);
		source.release();
		await first;

		const second = cache.prepare([MESH_A, MESH_B]);
		source.release();
		await second;

		expect(source.batches).toEqual([[MESH_A], [MESH_B]]);
	});

	it("does not start a second load for a mesh already in flight", async () => {
		const source = fakeSource();
		const cache = new ParticleMeshCache(source);

		const first = cache.prepare([MESH_A]);
		const second = cache.prepare([MESH_A]);
		source.release();
		await Promise.all([first, second]);

		expect(source.batches).toEqual([[MESH_A]]);
	});

	it("reports an unresident mesh rather than loading inside a frame", () => {
		const cache = new ParticleMeshCache(fakeSource());

		// Returning null is what keeps frame-time IO impossible for the draw path.
		expect(cache.get(MESH_A)).toBeNull();
	});

	it("refuses preparation after destruction", async () => {
		const cache = new ParticleMeshCache(fakeSource());
		cache.destroy();

		await expect(cache.prepare([MESH_A])).rejects.toThrow("destroyed");
	});
});
