import type {
	DynamicEntityAnimationPlaybackState,
	DynamicEntityAnimationPlaybackSummaryDto,
	DynamicEntitySummaryDto,
	DynamicEntityId,
	DynamicEntityRecord,
	DynamicEntitySetupAnimationResourceState,
	DynamicEntitySetupAnimationResourceSummaryDto,
	DynamicEntitySourceFacts,
	DynamicEntitySourceSummaryDto,
	DynamicRuntimeSnapshot,
} from "./contracts";

export class DynamicEntityStore {
	readonly #recordsById = new Map<DynamicEntityId, DynamicEntityRecord>();

	upsert(record: DynamicEntityRecord): void {
		this.#recordsById.set(record.id, record);
	}

	update(
		id: DynamicEntityId,
		updateRecord: (record: DynamicEntityRecord) => DynamicEntityRecord,
	): DynamicEntityRecord | null {
		const record = this.#recordsById.get(id);
		if (!record) {
			return null;
		}

		const updated = updateRecord(record);
		this.#recordsById.set(id, updated);
		return updated;
	}

	remove(id: DynamicEntityId): DynamicEntityRecord | null {
		const record = this.#recordsById.get(id) ?? null;
		if (record === null) {
			return null;
		}
		this.#recordsById.delete(id);
		return record;
	}

	retainStaticSourceScopeKeys(
		retainedScopeKeys: ReadonlySet<string>,
	): readonly DynamicEntityRecord[] {
		const removed: DynamicEntityRecord[] = [];
		for (const [id, record] of this.#recordsById) {
			const retentionPolicy = record.presentation.policy.retentionPolicy;
			if (retentionPolicy.kind === "explicit-runtime-lifetime") {
				continue;
			}
			if (!retainedScopeKeys.has(retentionPolicy.sourceScopeKey)) {
				removed.push(record);
				this.#recordsById.delete(id);
			}
		}
		return removed;
	}

	get(id: DynamicEntityId): DynamicEntityRecord | null {
		return this.#recordsById.get(id) ?? null;
	}

	getSummary(id: DynamicEntityId): DynamicEntitySummaryDto | null {
		const record = this.get(id);
		return record === null ? null : createDynamicEntitySummaryDto(record);
	}

	records(): readonly DynamicEntityRecord[] {
		return [...this.#recordsById.values()].sort(compareDynamicEntityRecords);
	}

	createSnapshot(): DynamicRuntimeSnapshot {
		const records = this.records();
		const staticAuthoredCount = records.filter(
			(record) => record.source.kind === "static-authored",
		).length;
		const runtimeSpawnCount = records.filter(
			(record) => record.source.kind === "runtime-spawn",
		).length;
		return {
			activeEntityCount: records.length,
			nonRenderableEntityCount: records.filter(
				(record) => record.renderability.status === "non-renderable",
			).length,
			records: records.map(createDynamicEntitySummaryDto),
			runtimeSpawnCount,
			staticAuthoredCount,
			staticSeedCount: staticAuthoredCount,
		};
	}
}

function createDynamicEntitySummaryDto(
	record: DynamicEntityRecord,
): DynamicEntitySummaryDto {
	return {
		animation: {
			defaultAnimationId: record.animation.defaultAnimationId,
			playback: createAnimationPlaybackSummary(record.animation.playback),
			status: record.animation.status,
		},
		baseTransform: record.baseTransform,
		bounds: record.bounds,
		effectiveResidence: record.effectiveResidence,
		id: record.id,
		presentation: record.presentation,
		provenance: record.provenance,
		renderability: record.renderability,
		resources: {
			required: record.resources.required,
			setupAnimation: createSetupAnimationResourceSummary(
				record.resources.setupAnimation,
			),
			status: record.resources.status,
			visual: record.resources.visual,
		},
		source: createDynamicEntitySourceSummary(record.source),
		sourceResidence: record.sourceResidence,
	};
}

function createDynamicEntitySourceSummary(
	source: DynamicEntitySourceFacts,
): DynamicEntitySourceSummaryDto {
	if (source.kind === "runtime-spawn") {
		return source;
	}
	return {
		defaultAnimationId: source.seed.defaultAnimationId,
		kind: "static-authored",
		object: source.seed.object,
		setupModelId: source.seed.setupModelId,
		sourceAssetId: source.seed.sourceAssetId,
	};
}

function createAnimationPlaybackSummary(
	playback: DynamicEntityAnimationPlaybackState,
): DynamicEntityAnimationPlaybackSummaryDto {
	if (playback.status !== "playing") {
		return playback;
	}
	return {
		animationAssetId: playback.animationAssetId,
		animationId: playback.animationId,
		currentFrameIndex: playback.currentFrameIndex,
		elapsedSeconds: playback.elapsedSeconds,
		frameCount: playback.frameCount,
		frameNumber: playback.frameNumber,
		frameRateFps: playback.frameRateFps,
		loopIteration: playback.loopIteration,
		objectRootPose: playback.objectRootPose,
		partCount: playback.partCount,
		partPoses: playback.partPoses,
		status: "playing",
		transformEffects: {
			activeOmega:
				playback.transformEffects.activeOmega === null
					? null
					: {
							animationAssetId:
								playback.transformEffects.activeOmega.animationAssetId,
							animationId: playback.transformEffects.activeOmega.animationId,
							entityId: playback.transformEffects.activeOmega.entityId,
							hookName: playback.transformEffects.activeOmega.hookName,
							hookType: playback.transformEffects.activeOmega.hookType,
							lastAppliedFrameIndex:
								playback.transformEffects.activeOmega.lastAppliedFrameIndex,
							lastAppliedLoopIteration:
								playback.transformEffects.activeOmega.lastAppliedLoopIteration,
							objectRootRotation:
								playback.transformEffects.activeOmega.objectRootRotation,
							omega: playback.transformEffects.activeOmega.omega,
							rawPayloadBytes:
								playback.transformEffects.activeOmega.rawPayloadBytes,
						},
		},
	};
}

function createSetupAnimationResourceSummary(
	setupAnimation: DynamicEntitySetupAnimationResourceState,
): DynamicEntitySetupAnimationResourceSummaryDto {
	if (setupAnimation.status !== "ready") {
		return setupAnimation;
	}
	return {
		animationAssetId: setupAnimation.animation.assetId,
		animationId: setupAnimation.animation.payload.animationId,
		animationKey: setupAnimation.animationKey,
		frameCount: setupAnimation.animation.payload.frameCount,
		partCount: setupAnimation.animation.payload.partCount,
		setupModelKey: setupAnimation.setupModelKey,
		status: "ready",
	};
}

function compareDynamicEntityRecords(
	left: DynamicEntityRecord,
	right: DynamicEntityRecord,
): number {
	return left.id.localeCompare(right.id);
}
