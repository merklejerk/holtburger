import { describe, expect, it } from "vitest";
import { AABB3, Vec3 } from "../math/types";
import type {
	ClosedWorkerPort,
	ClosedWorkerRequest,
	ClosedWorkerResponse,
} from "../workers/closed-worker";
import { generateTerrain } from "./terrain-generator";
import { validateTerrainGenerationValues } from "./terrain-generation-validation";
import {
	terrainWorkerResultTransferables,
	type TerrainWorkerJob,
	type TerrainWorkerResult,
} from "./terrain-worker-contract";
import { WorkerTerrainGenerator } from "./terrain-worker-client";
import { TERRAIN_TYPE_COUNT } from "./pcode";
import { TERRAIN_GRID_CELLS, type TerrainGenerationSource } from "./types";

describe("WorkerTerrainGenerator", () => {
	it("copies retained inputs, transfers results, and hydrates geometry bounds", async () => {
		const source = createSource();
		source.heights[10] = 7;
		source.terrainSamples[10] = (TERRAIN_TYPE_COUNT - 1) << 2;
		const originalHeights = source.heights.slice();
		const originalSamples = source.terrainSamples.slice();
		const port = new ExecutingTerrainWorkerPort();
		const generator = new WorkerTerrainGenerator({ createWorker: () => port });

		const result = await generator.generate(source);

		expect(source.heights.byteLength).toBeGreaterThan(0);
		expect(source.terrainSamples.byteLength).toBeGreaterThan(0);
		expect(source.heights).toEqual(originalHeights);
		expect(source.terrainSamples).toEqual(originalSamples);
		expect(port.detachedInputByteLengths).toEqual([0, 0, 0, 0]);
		expect(port.detachedResultByteLengths).toEqual([0, 0, 0, 0, 0, 0]);
		expect(result.geometry.terrainColorCodes[10]).toBe(TERRAIN_TYPE_COUNT - 1);
		expect(result.bounds).toBeInstanceOf(AABB3);
		expect(result.bounds.min).toBeInstanceOf(Vec3);
		expect(result.bounds.clone()).toEqual(result.bounds);
		expect(generator.getDiagnostics()).toMatchObject({
			completedJobCount: 1,
			transferredBytes:
				source.cellDiagonals.byteLength +
				source.heightIndices.byteLength +
				source.heights.byteLength +
				source.terrainSamples.byteLength,
			workerCount: 1,
		});
		await generator.destroy();
	});

	it("surfaces worker errors and rejects later work after destruction", async () => {
		const port = new RejectingTerrainWorkerPort();
		const generator = new WorkerTerrainGenerator({ createWorker: () => port });

		await expect(generator.generate(createSource())).rejects.toThrow(
			"synthetic terrain failure",
		);
		await generator.destroy();
		await expect(generator.generate(createSource())).rejects.toThrow(
			"destroyed",
		);
		expect(port.terminated).toBe(true);
	});

	it("replaces a worker that terminates through its error channel", async () => {
		const crashed = new CrashingTerrainWorkerPort();
		const replacement = new ExecutingTerrainWorkerPort();
		const ports: ClosedWorkerPort[] = [crashed, replacement];
		const generator = new WorkerTerrainGenerator({
			createWorker: () => {
				const port = ports.shift();
				if (!port) throw new Error("Unexpected terrain worker replacement.");
				return port;
			},
		});

		await expect(generator.generate(createSource())).rejects.toThrow(
			"synthetic terrain worker crash",
		);
		await expect(generator.generate(createSource())).resolves.toMatchObject({
			geometry: { kind: "terrain" },
		});

		expect(crashed.terminated).toBe(true);
		expect(generator.getDiagnostics().completedJobCount).toBe(2);
		await generator.destroy();
	});
});

class ExecutingTerrainWorkerPort implements ClosedWorkerPort {
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessage:
		| ((event: MessageEvent<ClosedWorkerResponse<unknown>>) => void)
		| null = null;
	detachedInputByteLengths: number[] = [];
	detachedResultByteLengths: number[] = [];

	postMessage(
		message: ClosedWorkerRequest<unknown>,
		transfer: readonly Transferable[],
	): void {
		const request = structuredClone(
			message as ClosedWorkerRequest<TerrainWorkerJob>,
			{ transfer: [...transfer] },
		);
		this.detachedInputByteLengths = transfer.map((value) =>
			value instanceof ArrayBuffer ? value.byteLength : -1,
		);
		queueMicrotask(() => {
			const result = generateTerrain(request.input);
			validateTerrainGenerationValues(result);
			const resultTransfer = terrainWorkerResultTransferables(result);
			const response = structuredClone(
				{
					id: request.id,
					ok: true,
					result,
				} satisfies ClosedWorkerResponse<TerrainWorkerResult>,
				{ transfer: resultTransfer },
			);
			this.detachedResultByteLengths = resultTransfer.map((value) =>
				value instanceof ArrayBuffer ? value.byteLength : -1,
			);
			this.onmessage?.({ data: response } as MessageEvent<
				ClosedWorkerResponse<unknown>
			>);
		});
	}

	terminate(): void {}
}

class RejectingTerrainWorkerPort implements ClosedWorkerPort {
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessage:
		| ((event: MessageEvent<ClosedWorkerResponse<unknown>>) => void)
		| null = null;
	terminated = false;

	postMessage(message: ClosedWorkerRequest<unknown>): void {
		queueMicrotask(() => {
			this.onmessage?.({
				data: {
					error: "synthetic terrain failure",
					id: message.id,
					ok: false,
				},
			} as MessageEvent<ClosedWorkerResponse<unknown>>);
		});
	}

	terminate(): void {
		this.terminated = true;
	}
}

class CrashingTerrainWorkerPort implements ClosedWorkerPort {
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessage:
		| ((event: MessageEvent<ClosedWorkerResponse<unknown>>) => void)
		| null = null;
	terminated = false;

	postMessage(): void {
		queueMicrotask(() => {
			this.onerror?.({
				message: "synthetic terrain worker crash",
			} as ErrorEvent);
		});
	}

	terminate(): void {
		this.terminated = true;
	}
}

function createSource(): TerrainGenerationSource {
	const sideVertices = TERRAIN_GRID_CELLS + 1;
	const vertexCount = sideVertices ** 2;
	return {
		cellDiagonals: new Uint8Array(TERRAIN_GRID_CELLS ** 2),
		gridSize: sideVertices,
		heightIndices: new Uint8Array(vertexCount),
		heights: new Float32Array(vertexCount),
		landblockId: "0xda55ffff",
		terrainSamples: new Uint16Array(vertexCount),
		tileSize: 24,
	};
}
