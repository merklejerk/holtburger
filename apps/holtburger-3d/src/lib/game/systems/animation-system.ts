import type { SceneNodeId } from "../scene";
import type { ArticulatedPose } from "./components";

/** Mutable playback state retained separately from dynamic presentation ownership. */
interface AnimationRecord {
	/** Current sampled rigid-part pose applied before every spatial query. */
	pose: ArticulatedPose;
}

/** Runtime update port implemented by the dynamic system's part-node owner. */
export interface AnimatedPartNodeUpdater {
	setPose(nodeId: SceneNodeId, pose: ArticulatedPose): void;
}

/** Owns animation sampling state and applies sampled poses before rendering observes the scene. */
export class AnimationSystem<TOwnerId extends string> {
	readonly #updater: AnimatedPartNodeUpdater;
	readonly #records = new Map<SceneNodeId, AnimationRecord>();
	readonly #owners = new Map<TOwnerId, Set<SceneNodeId>>();

	constructor(updater: AnimatedPartNodeUpdater) {
		this.#updater = updater;
	}

	install(ownerId: TOwnerId, nodeId: SceneNodeId, pose: ArticulatedPose): void {
		let nodes = this.#owners.get(ownerId);
		if (!nodes) {
			nodes = new Set();
			this.#owners.set(ownerId, nodes);
		}
		nodes.add(nodeId);
		this.#records.set(nodeId, { pose });
	}

	setPose(nodeId: SceneNodeId, pose: ArticulatedPose): void {
		const record = this.#records.get(nodeId);
		if (!record)
			throw new Error(`Animation state for ${nodeId} does not exist.`);
		record.pose = pose;
	}

	/** Apply sampled transforms before renderer visibility collection; playback remains a future concern. */
	update(): void {
		for (const [nodeId, record] of this.#records) {
			this.#updater.setPose(nodeId, record.pose);
		}
	}

	removeOwner(ownerId: TOwnerId): void {
		const nodes = this.#owners.get(ownerId);
		if (!nodes) return;
		for (const nodeId of nodes) this.#records.delete(nodeId);
		this.#owners.delete(ownerId);
	}
}
