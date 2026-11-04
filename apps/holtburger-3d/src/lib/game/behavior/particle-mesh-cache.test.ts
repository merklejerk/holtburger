import { describe, expect, it, vi } from "vitest";
import type { DecodedParticleMesh } from "../../assets/decode-particle-mesh-record";
import type { ParticleMeshSource } from "../../assets/particle-mesh-source";
import type { DatAssetId } from "../game-types";
import { ParticleMeshCache } from "./particle-mesh-cache";
import { HostCommandError } from "../../host/host-command-result";

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
	it("caches rejected source meshes until explicit retry and preserves installed siblings", async () => {
		const failure = new HostCommandError({
			code: "application_error",
			message: "Missing particle mesh",
			resource: {
				kind: "missing",
				namespace: "eor/portal",
				file_id: Number(MESH_A),
			},
		});
		const loadParticleMeshes = vi.fn(async (ids: readonly DatAssetId[]) => ({
			presentations: new Map(
				ids.map((id) => [
					id,
					{ orientation: "viewer-facing" } as DecodedParticleMesh,
				]),
			),
			textureDependencies: [],
		}));
		loadParticleMeshes.mockRejectedValueOnce(failure);
		const cache = new ParticleMeshCache(
			{ loadParticleMeshes, destroy() {} },
			async () => {},
		);
		await expect(cache.prepare([MESH_A])).rejects.toBe(failure);
		await expect(cache.prepare([MESH_A.toUpperCase()])).rejects.toBe(failure);
		expect(loadParticleMeshes).toHaveBeenCalledTimes(1);
		await cache.prepare([MESH_B]);
		expect(cache.isReady(MESH_B)).toBe(true);
		expect(cache.isReady(MESH_B.toUpperCase())).toBe(true);
		expect(cache.isReady(MESH_A)).toBe(false);
		cache.retryFailed();
		await cache.prepare([MESH_A]);
		expect(cache.isReady(MESH_A)).toBe(true);
		expect(cache.isReady(MESH_B)).toBe(true);
		cache.destroy();
	});
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
		const second = cache.prepare([MESH_A.toUpperCase()]);
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
