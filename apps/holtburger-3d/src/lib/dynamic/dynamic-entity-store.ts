import type {
	DynamicEntitySummaryDto,
	DynamicEntityId,
	DynamicEntityRecord,
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

	retainSourceScopeKeys(
		retainedScopeKeys: ReadonlySet<string>,
	): readonly DynamicEntityRecord[] {
		const removed: DynamicEntityRecord[] = [];
		for (const [id, record] of this.#recordsById) {
			if (!retainedScopeKeys.has(record.provenance.sourceScopeKey)) {
				removed.push(record);
				this.#recordsById.delete(id);
			}
		}
		return removed;
	}

	get(id: DynamicEntityId): DynamicEntityRecord | null {
		return this.#recordsById.get(id) ?? null;
	}

	records(): readonly DynamicEntityRecord[] {
		return [...this.#recordsById.values()].sort(compareDynamicEntityRecords);
	}

	createSnapshot(): DynamicRuntimeSnapshot {
		const records = this.records();
		return {
			activeEntityCount: records.length,
			issueCount: records.reduce(
				(count, record) => count + record.diagnostics.length,
				0,
			),
			nonRenderableEntityCount: records.filter(
				(record) => record.renderability.status === "non-renderable",
			).length,
			records: records.map(createDynamicEntitySummaryDto),
			staticSeedCount: records.length,
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
		diagnostics: record.diagnostics,
		effectiveResidence: record.effectiveResidence,
		id: record.id,
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
		source: {
			defaultAnimationId: record.sourceSeed.defaultAnimationId,
			object: record.sourceSeed.object,
			setupModelId: record.sourceSeed.setupModelId,
			sourceAssetId: record.sourceSeed.sourceAssetId,
		},
		sourceResidence: record.sourceResidence,
	};
}

function createAnimationPlaybackSummary(
	playback: DynamicEntityRecord["animation"]["playback"],
): DynamicEntitySummaryDto["animation"]["playback"] {
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
	setupAnimation: DynamicEntityRecord["resources"]["setupAnimation"],
): DynamicEntitySummaryDto["resources"]["setupAnimation"] {
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
