import { log, LogLevel } from "../../logs";
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
	readonly #layerRevisions = new Map<string, SceneInterestRevision>();
	#interest: SceneInterestMap = new Map();
	#nextRevision = 0;
	#destroyed = false;

	constructor(
		pipeline: CommitPipeline,
		callbacks: SceneInterestCommitCoordinatorCallbacks,
	) {
		this.#pipeline = pipeline;
		this.#callbacks = callbacks;
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
			void this.#prepareLandblock(layers, revision);
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
		this.#layerRevisions.clear();
		this.#interest = new Map();
	}

	async #prepareLandblock(
		layers: readonly LandblockIdLayer[],
		dispatchRevision: SceneInterestRevision,
	): Promise<void> {
		try {
			const requestedLayers = new Set(layers.map(layerKey));
			const artifacts = await this.#pipeline.prepareLandblockLayers(
				new Set(layers),
			);
			const preparedLayers = new Set<string>();
			for (const artifact of artifacts) {
				const layer = { id: artifact.landblockId, layer: artifact.layer };
				if (!requestedLayers.has(layerKey(layer))) continue;
				if (!this.#isCurrent(layer, dispatchRevision)) continue;
				preparedLayers.add(layerKey(layer));
				this.#callbacks.prepared({ artifact, revision: dispatchRevision });
			}
			for (const layer of layers) {
				if (
					this.#isCurrent(layer, dispatchRevision) &&
					!preparedLayers.has(layerKey(layer))
				) {
					this.#callbacks.unavailable({ layer, revision: dispatchRevision });
				}
			}
		} catch (error) {
			log(error, LogLevel.Error);
			for (const layer of layers) {
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
