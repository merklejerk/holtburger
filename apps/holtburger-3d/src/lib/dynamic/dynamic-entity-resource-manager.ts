import type {
	AssetService,
	HostAssetKey,
	PreparedAssetLease,
} from "../assets/contracts";
import { createHostAssetKey } from "../assets/keys";
import type {
	DynamicEntityId,
	DynamicEntityIssue,
	DynamicEntityResourceKey,
	DynamicEntityResourceState,
	DynamicEntityRequiredResource,
	StaticAuthoredDynamicSeedFacts,
} from "./contracts";

export interface DynamicEntityResourceManagerOptions {
	readonly assetService: AssetService;
	readonly onResourcesChanged?: (change: DynamicEntityResourceChange) => void;
}

export type DynamicEntityResourceChange =
	| DynamicEntitySetupAnimationReadyChange
	| DynamicEntitySetupAnimationFailedChange;

interface DynamicEntitySetupAnimationReadyChange {
	readonly entityId: DynamicEntityId;
	readonly kind: "setup-animation-ready";
	readonly resources: DynamicEntityResourceState;
}

interface DynamicEntitySetupAnimationFailedChange {
	readonly entityId: DynamicEntityId;
	readonly issues: readonly DynamicEntityIssue[];
	readonly kind: "setup-animation-failed";
	readonly resources: DynamicEntityResourceState;
}

interface TrackedDynamicEntityResources {
	readonly animationHostKey: HostAssetKey;
	readonly animationResourceKey: DynamicEntityResourceKey;
	readonly generation: number;
	readonly leases: PreparedAssetLease[];
	readonly setupHostKey: HostAssetKey;
	readonly setupResourceKey: DynamicEntityResourceKey;
}

const SETUP_ANIMATION_REQUIRED_RESOURCES = [
	"setup-model",
	"animation",
] as const satisfies readonly DynamicEntityRequiredResource[];

/** Owns dynamic semantic resource state and leases over host-prepared assets. */
export class DynamicEntityResourceManager {
	readonly #assetService: AssetService;
	#onResourcesChanged?: (change: DynamicEntityResourceChange) => void;
	readonly #trackedByEntityId = new Map<
		DynamicEntityId,
		TrackedDynamicEntityResources
	>();
	#generation = 0;

	constructor({
		assetService,
		onResourcesChanged,
	}: DynamicEntityResourceManagerOptions) {
		this.#assetService = assetService;
		this.#onResourcesChanged = onResourcesChanged;
	}

	setResourceChangeListener(
		onResourcesChanged: (change: DynamicEntityResourceChange) => void,
	): void {
		this.#onResourcesChanged = onResourcesChanged;
	}

	createInitialResourceState(
		seed: StaticAuthoredDynamicSeedFacts,
	): DynamicEntityResourceState {
		const keys = createSetupAnimationResourceKeys(seed);
		return {
			required: SETUP_ANIMATION_REQUIRED_RESOURCES,
			setupAnimation: {
				animationKey: keys.animationResourceKey,
				setupModelKey: keys.setupResourceKey,
				status: "pending",
			},
			status: "pending",
		};
	}

	trackSetupAnimationResources(
		entityId: DynamicEntityId,
		seed: StaticAuthoredDynamicSeedFacts,
	): void {
		this.releaseEntity(entityId);

		const keys = createSetupAnimationResourceKeys(seed);
		const generation = this.#nextGeneration();
		this.#trackedByEntityId.set(entityId, {
			...keys,
			generation,
			leases: [],
		});

		void Promise.allSettled([
			this.#assetService.requestPreparedAsset(keys.setupHostKey),
			this.#assetService.requestPreparedAsset(keys.animationHostKey),
		]).then((results) => {
			this.#completeSetupAnimationRequest(entityId, generation, results);
		});
	}

	releaseEntity(entityId: DynamicEntityId): void {
		const tracked = this.#trackedByEntityId.get(entityId);
		if (!tracked) {
			return;
		}

		for (const lease of tracked.leases) {
			lease.release();
		}
		this.#trackedByEntityId.delete(entityId);
	}

	releaseAll(): void {
		for (const entityId of this.#trackedByEntityId.keys()) {
			this.releaseEntity(entityId);
		}
	}

	#completeSetupAnimationRequest(
		entityId: DynamicEntityId,
		generation: number,
		results: readonly PromiseSettledResult<unknown>[],
	): void {
		const tracked = this.#trackedByEntityId.get(entityId);
		if (!tracked || tracked.generation !== generation) {
			return;
		}

		const issues = createSetupAnimationLoadIssues(tracked, results);
		if (issues.length > 0) {
			this.#onResourcesChanged?.({
				entityId,
				issues,
				kind: "setup-animation-failed",
				resources: {
					required: SETUP_ANIMATION_REQUIRED_RESOURCES,
					setupAnimation: {
						animationKey: tracked.animationResourceKey,
						setupModelKey: tracked.setupResourceKey,
						status: "failed",
					},
					status: "failed",
				},
			});
			return;
		}

		tracked.leases.push(
			this.#assetService.acquirePreparedAssetLease(tracked.setupHostKey),
			this.#assetService.acquirePreparedAssetLease(tracked.animationHostKey),
		);
		this.#onResourcesChanged?.({
			entityId,
			kind: "setup-animation-ready",
			resources: {
				required: SETUP_ANIMATION_REQUIRED_RESOURCES,
				setupAnimation: {
					animationKey: tracked.animationResourceKey,
					setupModelKey: tracked.setupResourceKey,
					status: "ready",
				},
				status: "setup-animation-ready",
			},
		});
	}

	#nextGeneration(): number {
		this.#generation += 1;
		return this.#generation;
	}
}

function createSetupAnimationResourceKeys(seed: StaticAuthoredDynamicSeedFacts): {
	readonly animationHostKey: HostAssetKey;
	readonly animationResourceKey: DynamicEntityResourceKey;
	readonly setupHostKey: HostAssetKey;
	readonly setupResourceKey: DynamicEntityResourceKey;
} {
	return {
		animationHostKey: createHostAssetKey("animation", seed.defaultAnimationId),
		animationResourceKey: {
			id: seed.defaultAnimationId,
			kind: "animation",
		},
		setupHostKey: createHostAssetKey("setup-model", seed.setupModelId),
		setupResourceKey: {
			id: seed.setupModelId,
			kind: "setup-model",
		},
	};
}

function createSetupAnimationLoadIssues(
	tracked: TrackedDynamicEntityResources,
	results: readonly PromiseSettledResult<unknown>[],
): readonly DynamicEntityIssue[] {
	const issues: DynamicEntityIssue[] = [];
	const setupResult = results[0];
	const animationResult = results[1];

	if (setupResult?.status === "rejected") {
		issues.push({
			kind: "dynamic-resource-load-failed",
			message: formatErrorMessage(setupResult.reason),
			resource: "setup-model",
			resourceKey: tracked.setupResourceKey,
		});
	}

	if (animationResult?.status === "rejected") {
		issues.push({
			kind: "dynamic-resource-load-failed",
			message: formatErrorMessage(animationResult.reason),
			resource: "animation",
			resourceKey: tracked.animationResourceKey,
		});
	}

	return issues;
}

function formatErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
