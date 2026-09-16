import { describe, expect, it, vi } from "vitest";
import type { DecodedParticleMesh } from "../../assets/decode-particle-mesh-record";
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
					hwGfxObjIds.map((id) => [
						id,
						{ orientation: "viewer-facing" } as DecodedParticleMesh,
					]),
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
		const cache = new ParticleMeshCache(source, async () => {});

		const first = cache.prepare([MESH_A, MESH_B]);
		source.release();
		await first;

		expect(source.batches).toEqual([[MESH_A, MESH_B]]);
		expect(cache.getDiagnostics().residentMeshCount).toBe(2);

		await cache.prepare([MESH_A, MESH_B]);
		// Already resident: no second transfer.
		expect(source.batches).toHaveLength(1);
	});

	it("requests only the meshes it does not already have", async () => {
		const source = fakeSource();
		const cache = new ParticleMeshCache(source, async () => {});
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
		const cache = new ParticleMeshCache(source, async () => {});

		const first = cache.prepare([MESH_A]);
		const second = cache.prepare([MESH_A]);
		source.release();
		await Promise.all([first, second]);

		expect(source.batches).toEqual([[MESH_A]]);
	});

	it("keeps all owners waiting until their shared mesh finishes installation", async () => {
		const source = fakeSource();
		let finishInstallation: () => void = () => {
			throw new Error("Installation gate is not initialized.");
		};
		const installed = new Promise<void>((resolve) => {
			finishInstallation = resolve;
		});
		const install = vi.fn(() => installed);
		const cache = new ParticleMeshCache(source, install);
		const first = cache.prepare([MESH_A]);
		source.release();
		await vi.waitFor(() => expect(install).toHaveBeenCalledTimes(1));
		let secondReady = false;
		const second = cache.prepare([MESH_A]).then(() => {
			secondReady = true;
		});
		await Promise.resolve();
		expect(secondReady).toBe(false);
		expect(cache.getDiagnostics()).toEqual({
			inFlightMeshCount: 1,
			residentMeshCount: 0,
		});
		finishInstallation();
		await Promise.all([first, second]);
		expect(secondReady).toBe(true);
		expect(install).toHaveBeenCalledTimes(1);
	});

	it("propagates installation failure to every owner and permits a fresh retry", async () => {
		const source = fakeSource();
		const install = vi
			.fn(async () => {})
			.mockRejectedValueOnce(new Error("Upload failed."));
		const cache = new ParticleMeshCache(source, install);
		const first = cache.prepare([MESH_A]);
		const second = cache.prepare([MESH_A]);
		const settled = Promise.allSettled([first, second]);
		source.release();
		expect((await settled).map((result) => result.status)).toEqual([
			"rejected",
			"rejected",
		]);
		expect(cache.getDiagnostics()).toEqual({
			inFlightMeshCount: 0,
			residentMeshCount: 0,
		});
		const retry = cache.prepare([MESH_A]);
		source.release();
		await retry;
		expect(cache.getDiagnostics().residentMeshCount).toBe(1);
	});

	it("refuses preparation after destruction", async () => {
		const cache = new ParticleMeshCache(fakeSource(), async () => {});
		cache.destroy();

		await expect(cache.prepare([MESH_A])).rejects.toThrow("destroyed");
	});
});
