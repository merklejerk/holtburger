import { describe, expect, it, vi } from "vitest";
import {
	CommitBundleSourceKind,
	type CommitBundle,
	type CommitPipeline,
} from "../commit/types";
import {
	LandblockLayerKind,
	type LandblockIdLayer,
	type SceneInterestMap,
} from "./scene-interest";
import {
	SceneInterestCommitCoordinator,
	type SceneInterestCommitCoordinatorCallbacks,
} from "./scene-interest-commit-coordinator";

const landblockId = "0xda55ffff" as const;

describe("SceneInterestCommitCoordinator", () => {
	it("prepares every newly requested layer of one landblock as one batch", async () => {
		const requests: LandblockIdLayer[][] = [];
		const callbacks = createCallbacks();
		const pipeline: CommitPipeline = {
			prepareLandblockLayers: async (layers) => {
				requests.push([...layers]);
				return [...layers].map(({ layer }) => artifact(layer));
			},
		};
		const coordinator = new SceneInterestCommitCoordinator(pipeline, callbacks);

		coordinator.reconcile(
			sceneInterest([
				LandblockLayerKind.Terrain,
				LandblockLayerKind.Buildings,
				LandblockLayerKind.Objects,
			]),
		);

		await vi.waitFor(() => expect(callbacks.prepared).toHaveBeenCalledTimes(3));

		expect(requests).toEqual([
			[
				{ id: landblockId, layer: LandblockLayerKind.Terrain },
				{ id: landblockId, layer: LandblockLayerKind.Buildings },
				{ id: landblockId, layer: LandblockLayerKind.Objects },
			],
		]);
		expect(callbacks.unavailable).not.toHaveBeenCalled();
	});

	it("marks only an omitted layer unavailable after a successful batch", async () => {
		const callbacks = createCallbacks();
		const pipeline: CommitPipeline = {
			prepareLandblockLayers: async () => [
				artifact(LandblockLayerKind.Buildings),
			],
		};
		const coordinator = new SceneInterestCommitCoordinator(pipeline, callbacks);

		coordinator.reconcile(
			sceneInterest([LandblockLayerKind.Buildings, LandblockLayerKind.Objects]),
		);

		await vi.waitFor(() =>
			expect(callbacks.unavailable).toHaveBeenCalledTimes(1),
		);

		expect(callbacks.prepared).toHaveBeenCalledWith({
			artifact: artifact(LandblockLayerKind.Buildings),
			revision: 1,
		});
		expect(callbacks.unavailable).toHaveBeenCalledWith({
			layer: { id: landblockId, layer: LandblockLayerKind.Objects },
			revision: 1,
		});
	});
});

function artifact(layer: LandblockLayerKind): CommitBundle {
	return {
		commit: {},
		dynamicEntities: [],
		kind: CommitBundleSourceKind.LandblockLayer,
		landblockId,
		layer,
	} as CommitBundle;
}

function createCallbacks(): SceneInterestCommitCoordinatorCallbacks & {
	readonly prepared: ReturnType<typeof vi.fn>;
	readonly unavailable: ReturnType<typeof vi.fn>;
} {
	return {
		evict: vi.fn(),
		failed: vi.fn(),
		prepared: vi.fn(),
		unavailable: vi.fn(),
	};
}

function sceneInterest(
	layers: readonly LandblockLayerKind[],
): SceneInterestMap {
	return new Map([[landblockId, new Set(layers)]]);
}
