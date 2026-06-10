import { describe, expect, it } from "vitest";
import type { PreparedAsset } from "../assets/contracts";
import type { RuntimeHost, RuntimeHostSnapshot } from "../host/contracts";
import type {
	Renderer,
	RendererSnapshot,
	RendererSnapshotListener,
	StaticResidencyDelta,
} from "../renderer/types";
import { StaticCoordinator } from "../static/coordinator/static-coordinator";
import type { TerrainGeometryStaticDrawUnit } from "../static/contracts";
import {
	DeferredStaticBakerClient,
	DeferredStaticResolverClient,
} from "../static/fake-workers";
import { createClientRuntime } from "./client-runtime";

describe("V2 client runtime", () => {
	it("passes manual domain coverage radii into static demand planning", () => {
		const resolver = new DeferredStaticResolverClient();
		const runtime = createClientRuntime({
			host: new FakeRuntimeHost(),
			renderer: new FakeRenderer(),
			staticCoordinator: new StaticCoordinator({
				baker: new DeferredStaticBakerClient(),
				resolver,
			}),
		});

		runtime.requestStaticWork({
			domains: ["buildings", "terrain", "topology"],
			landblockId: "0xda55ffff",
			locationKind: "outdoor-landblock",
			lod: {
				buildings: 0,
				terrain: 1,
				topology: 0,
			},
		});

		expect(
			resolver.pendingRequests.filter(
				(request) => request.job.domain === "outdoor-terrain",
			),
		).toHaveLength(9);
		expect(
			resolver.pendingRequests.filter(
				(request) => request.job.domain === "outdoor-buildings",
			),
		).toHaveLength(1);
		expect(
			resolver.pendingRequests.filter(
				(request) => request.job.domain === "landblock-topology",
			),
		).toHaveLength(1);
		runtime.dispose();
	});

	it("forwards committed static draw units and eviction deltas to the renderer", async () => {
		const renderer = new FakeRenderer();
		const resolver = new DeferredStaticResolverClient();
		const baker = new DeferredStaticBakerClient();
		const staticCoordinator = new StaticCoordinator({ baker, resolver });
		const runtime = createClientRuntime({
			host: new FakeRuntimeHost(),
			renderer,
			staticCoordinator,
		});

		runtime.requestStaticWork({
			domains: ["terrain"],
			landblockId: "0xda55ffff",
			locationKind: "outdoor-landblock",
		});
		resolver.complete(resolver.pendingRequests[0]?.requestId ?? "");
		await flushPromises();
		baker.complete("1:landblock:da55ffff:outdoor-terrain", {
			drawUnits: [createTerrainDrawUnit("terrain-a", 0xdb55ffff)],
		});
		await flushPromises();

		expect(renderer.staticDeltas).toEqual([
			{
				addedDrawUnitPlacements: [
					{
						drawUnit: createTerrainDrawUnit("terrain-a", 0xdb55ffff),
						translation: [192, 0, 0],
					},
				],
				removedDrawUnitIds: [],
				revision: 1,
			},
		]);

		runtime.evictStaticWork();

		expect(renderer.staticDeltas.at(-1)).toEqual({
			addedDrawUnitPlacements: [],
			removedDrawUnitIds: ["terrain-a"],
			revision: 2,
		});
		runtime.dispose();
	});
});

class FakeRenderer implements Renderer {
	readonly staticDeltas: StaticResidencyDelta[] = [];
	#snapshot: RendererSnapshot = {
		backend: "webgl2",
		canvasHeight: 1,
		canvasWidth: 1,
		error: null,
		frameCount: 0,
		isRunning: true,
		renderedTriangles: 0,
		staticDrawUnits: 0,
		terrainDrawUnits: 0,
	};

	applyStaticDelta(delta: StaticResidencyDelta): void {
		this.staticDeltas.push(delta);
		this.#snapshot = {
			...this.#snapshot,
			renderedTriangles: delta.addedDrawUnitPlacements.length,
			staticDrawUnits: delta.addedDrawUnitPlacements.length,
			terrainDrawUnits: delta.addedDrawUnitPlacements.length,
		};
	}

	applyDynamicDelta(): void {}
	applyTexturePlacementUpdate(): void {}
	applySamplerPolicyUpdate(): void {}
	updateFrameState(): void {}

	subscribe(listener: RendererSnapshotListener): () => void {
		listener(this.#snapshot);
		return () => {};
	}

	dispose(): void {
		this.#snapshot = {
			...this.#snapshot,
			isRunning: false,
		};
	}
}

class FakeRuntimeHost implements RuntimeHost {
	lookupAsset(): Promise<PreparedAsset> {
		return Promise.reject(new Error("host lookup should not run in this test"));
	}

	createSnapshot(): RuntimeHostSnapshot {
		return {
			failure: null,
			isAvailable: false,
		};
	}
}

function createTerrainDrawUnit(
	drawUnitId: string,
	landblockId: number,
): TerrainGeometryStaticDrawUnit {
	return {
		coordinateSpace: "landblock-render-local",
		domain: "outdoor-terrain",
		drawUnitId,
		indexType: "uint16",
		indices: new Uint16Array([0, 1, 2]),
		kind: "terrain-geometry",
		landblockId,
		materialFamily: "terrain-debug-flat",
		primaryTextureUseId: null,
		positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
		sourceTriangleIds: ["triangle-a"],
		texCoords: new Float32Array([0, 0, 1, 0, 0, 1]),
		textureUseIds: [],
		triangleCount: 1,
		vertexCount: 3,
	};
}

async function flushPromises(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}
