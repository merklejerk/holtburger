import type { Mat4 } from "../math/types";
import type { SceneNodeId } from "../scene";
import type { AnimatedPresentationSample } from "./animation-system";
import type { ArticulatedPose } from "./components";

/** Scene-mutation port owned by the dynamic presentation system. */
export interface DynamicPosePublisher {
	setPose(nodeId: SceneNodeId, pose: ArticulatedPose): void;
	setVisualRootTransform(nodeId: SceneNodeId, transform: Mat4): void;
}

/** Composes sampled presentation layers once and publishes final transform state. */
export class PoseSystem {
	readonly #publisher: DynamicPosePublisher;
	#lastPublicationDurationMs = 0;
	#lastPublishedEntityCount = 0;

	constructor(publisher: DynamicPosePublisher) {
		this.#publisher = publisher;
	}

	publish(samples: readonly AnimatedPresentationSample[]): void {
		const startedAt = performance.now();
		for (const sample of samples) {
			this.#publisher.setVisualRootTransform(
				sample.nodeId,
				sample.visualRootTransform,
			);
			this.#publisher.setPose(sample.nodeId, sample.pose);
		}
		this.#lastPublicationDurationMs = performance.now() - startedAt;
		this.#lastPublishedEntityCount = samples.length;
	}

	getDiagnostics() {
		return {
			lastPublicationDurationMs: this.#lastPublicationDurationMs,
			lastPublishedEntityCount: this.#lastPublishedEntityCount,
		};
	}
}
