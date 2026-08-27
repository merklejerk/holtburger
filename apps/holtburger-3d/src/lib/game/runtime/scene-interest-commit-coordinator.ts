import type { CommitPipeline, LandblockLayerCommit } from "../commit/types";
import {
	diffSceneInterest,
	groupLandblockLayers,
	type LandblockIdLayer,
	type SceneInterestMap,
} from "./scene-interest";
import type {
	SceneInterestReceipt,
	SceneInterestRevision,
} from "./scene-availability";
import { HostRequestGate } from "../../host/host-request-gate";

/** Leave ample protocol headroom while keeping the four-worker host content pool supplied. */
const MAX_SCENE_LANDBLOCK_REQUESTS = 32;

/** Runtime mutation callbacks kept outside the asynchronous scene-interest loading coordinator. */
export interface SceneInterestCommitCoordinatorCallbacks {
	readonly evict: (options: {
		readonly layer: LandblockIdLayer;
		/** Exact dispatch revision whose interest was withdrawn. */
		readonly revision: SceneInterestRevision;
	}) => void;
	readonly failed: (options: {
		readonly error: unknown;
		readonly layer: LandblockIdLayer;
		readonly revision: SceneInterestRevision;
	}) => void;
	readonly prepared: (options: {
		readonly artifact: LandblockLayerCommit;
		readonly revision: SceneInterestRevision;
	}) => void;
	readonly unavailable: (options: {
		readonly layer: LandblockIdLayer;
		readonly revision: SceneInterestRevision;
	}) => void;
}

/**
 * Owns scene-interest diffs, dispatch tokens, and asynchronous commit receipt coordination.
 *
 * Runtime systems retain mutation authority: this coordinator only decides whether a completed
 * source/worker result still belongs to the exact layer dispatch that launched it.
 */
export class SceneInterestCommitCoordinator {
	readonly #callbacks: SceneInterestCommitCoordinatorCallbacks;
	readonly #pipeline: CommitPipeline;
	readonly #requests: HostRequestGate;
	readonly #layerRevisions = new Map<string, SceneInterestRevision>();
	#interest: SceneInterestMap = new Map();
	#nextRevision = 0;
	#destroyed = false;

	constructor(
		pipeline: CommitPipeline,
		callbacks: SceneInterestCommitCoordinatorCallbacks,
		maxConcurrentRequests = MAX_SCENE_LANDBLOCK_REQUESTS,
	) {
		this.#pipeline = pipeline;
		this.#callbacks = callbacks;
		this.#requests = new HostRequestGate(maxConcurrentRequests);
	}

	/** Reconcile one complete interest set and dispatch only newly demanded layers. */
	reconcile(interest: SceneInterestMap): SceneInterestReceipt {
		const revision = this.#createRevision();
		if (this.#destroyed) return { revision };
		const { newLayers, evictedLayers } = diffSceneInterest(
			this.#interest,
			interest,
		);
		this.#interest = interest;
		for (const layer of evictedLayers) {
			const evictedRevision = this.#layerRevisions.get(layerKey(layer));
			this.#layerRevisions.delete(layerKey(layer));
			if (evictedRevision !== undefined) {
				this.#callbacks.evict({ layer, revision: evictedRevision });
			}
		}
		for (const layer of newLayers) {
			this.#layerRevisions.set(layerKey(layer), revision);
		}
		for (const layers of groupLandblockLayers(newLayers).values()) {
			void this.#requests
				.schedule(() => this.#prepareLandblock(layers, revision))
				.catch((error: unknown) => {
					if (!this.#destroyed) console.error(error);
				});
		}
		return { revision };
	}

	/** Whether an exact dispatch still owns its requested layer. */
	ownsDispatch(
		layer: LandblockIdLayer,
		dispatchRevision: SceneInterestRevision,
	): boolean {
		return this.#isCurrent(layer, dispatchRevision);
	}

	/** Stop new publication; already running workers may finish and are then discarded. */
	destroy(): void {
		this.#destroyed = true;
		this.#requests.destroy();
		this.#layerRevisions.clear();
		this.#interest = new Map();
	}

	async #prepareLandblock(
		layers: readonly LandblockIdLayer[],
		dispatchRevision: SceneInterestRevision,
	): Promise<void> {
		// Re-evaluate after leaving the bounded queue. Superseded owners never create a stale host
		// request, while retained layers from a partially changed owner still complete normally.
		const currentLayers = layers.filter((layer) =>
			this.#isCurrent(layer, dispatchRevision),
		);
		if (currentLayers.length === 0) return;
		try {
			const requestedLayers = new Set(currentLayers.map(layerKey));
			const artifacts = await this.#pipeline.prepareLandblockLayers(
				new Set(currentLayers),
			);
			const preparedLayers = new Set<string>();
			for (const artifact of artifacts) {
				const layer = { id: artifact.landblockId, layer: artifact.layer };
				if (!requestedLayers.has(layerKey(layer))) continue;
				if (!this.#isCurrent(layer, dispatchRevision)) continue;
				preparedLayers.add(layerKey(layer));
				this.#callbacks.prepared({ artifact, revision: dispatchRevision });
			}
			for (const layer of currentLayers) {
				if (
					this.#isCurrent(layer, dispatchRevision) &&
					!preparedLayers.has(layerKey(layer))
				) {
					this.#callbacks.unavailable({ layer, revision: dispatchRevision });
				}
			}
		} catch (error) {
			console.error(error);
			for (const layer of currentLayers) {
				if (this.#isCurrent(layer, dispatchRevision)) {
					this.#callbacks.failed({ error, layer, revision: dispatchRevision });
				}
			}
		}
	}

	#isCurrent(
		layer: LandblockIdLayer,
		dispatchRevision: SceneInterestRevision,
	): boolean {
		return (
			!this.#destroyed &&
			this.#layerRevisions.get(layerKey(layer)) === dispatchRevision
		);
	}

	#createRevision(): SceneInterestRevision {
		this.#nextRevision += 1;
		return this.#nextRevision as SceneInterestRevision;
	}
}

function layerKey(layer: LandblockIdLayer): string {
	return `${layer.id}/${layer.layer}`;
}
