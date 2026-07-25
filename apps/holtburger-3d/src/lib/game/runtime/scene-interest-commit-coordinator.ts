import { log, LogLevel } from "../../logs";
import { type CommitBundle, type CommitPipeline } from "../commit/types";
import {
	diffSceneInterest,
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
		readonly artifact: CommitBundle;
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
			void this.#prepare(layer, revision);
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

	async #prepare(
		layer: LandblockIdLayer,
		dispatchRevision: SceneInterestRevision,
	): Promise<void> {
		try {
			const artifacts = await this.#pipeline.prepareLandblockLayers(
				new Set([layer]),
			);
			if (!this.#isCurrent(layer, dispatchRevision)) return;
			if (artifacts.length === 0) {
				this.#callbacks.unavailable({ layer, revision: dispatchRevision });
				return;
			}
			for (const artifact of artifacts) {
				this.#callbacks.prepared({ artifact, revision: dispatchRevision });
			}
		} catch (error) {
			if (!this.#isCurrent(layer, dispatchRevision)) return;
			log(error, LogLevel.Error);
			this.#callbacks.failed({ error, layer, revision: dispatchRevision });
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
