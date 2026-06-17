import type { TransitionApertureBatch } from "../static/contracts";
import type {
	PortalSceneDomain,
	RenderPassPlan,
	SceneDomainTargetKind,
} from "./types";

export type TransitionCompositeDirection =
	| "outdoor-to-indoor"
	| "indoor-to-outdoor";

export type TransitionCompositeCullFace = "front" | "back";

export interface TransitionCompositeApertureBatchInput {
	readonly apertureBatchId: string;
	readonly frontFace: TransitionApertureBatch["frontFace"];
	readonly indexCount: number;
	readonly landblockId: number;
	readonly rangeCount: number;
}

export type TransitionCompositeWorkPlan =
	| {
			readonly kind: "none";
			readonly depthWork: readonly [];
	  }
	| {
			readonly kind: "transition-composite";
			readonly apertureBatchIds: readonly string[];
			readonly baseScene: PortalSceneDomain;
			readonly depthWork: readonly TransitionCompositeDepthWork[];
			readonly maxDepth: number;
	  };

export interface TransitionCompositeDepthWork {
	readonly apertureBatchIds: readonly string[];
	readonly cullFace: TransitionCompositeCullFace;
	readonly currentTarget: SceneDomainTargetKind;
	readonly direction: TransitionCompositeDirection;
	readonly sourceTarget: SceneDomainTargetKind;
	readonly transitionDepth: number;
}

export function createTransitionCompositeApertureBatchInput(
	batch: TransitionApertureBatch,
): TransitionCompositeApertureBatchInput {
	return {
		apertureBatchId: batch.apertureBatchId,
		frontFace: batch.frontFace,
		indexCount: batch.indices.length,
		landblockId: batch.landblockId,
		rangeCount: batch.ranges.length,
	};
}

export function planTransitionCompositeWork(options: {
	readonly apertureBatches: readonly TransitionCompositeApertureBatchInput[];
	readonly renderPassPlan: RenderPassPlan;
}): TransitionCompositeWorkPlan {
	const renderPassPlan = options.renderPassPlan;
	if (renderPassPlan.kind === "single-surface-resident") {
		return { kind: "none", depthWork: [] };
	}

	const maxDepth = Math.max(0, Math.trunc(renderPassPlan.transitionDepthPolicy.maxDepth));
	const apertureBatchIds = selectRenderableApertureBatchIds({
		apertureBatches: options.apertureBatches,
		baseScene: renderPassPlan.baseScene,
	});
	const depthWork: TransitionCompositeDepthWork[] = [];
	for (let transitionDepth = 0; transitionDepth < maxDepth; transitionDepth += 1) {
		const currentTarget = getTransitionDepthCurrentTarget(
			renderPassPlan.baseScene,
			transitionDepth,
		);
		const sourceTarget = getOppositeSceneDomainTarget(currentTarget);
		const direction: TransitionCompositeDirection =
			sourceTarget === "interior" ? "outdoor-to-indoor" : "indoor-to-outdoor";
		depthWork.push({
			apertureBatchIds,
			cullFace: getTransitionCompositeCullFace(direction),
			currentTarget,
			direction,
			sourceTarget,
			transitionDepth,
		});
	}

	return {
		apertureBatchIds,
		baseScene: renderPassPlan.baseScene,
		depthWork,
		kind: "transition-composite",
		maxDepth,
	};
}

function selectRenderableApertureBatchIds(options: {
	readonly apertureBatches: readonly TransitionCompositeApertureBatchInput[];
	readonly baseScene: PortalSceneDomain;
}): readonly string[] {
	return options.apertureBatches
		.filter((batch) => batch.landblockId === options.baseScene.landblockId)
		.filter(isRenderableTransitionApertureBatch)
		.map((batch) => batch.apertureBatchId);
}

function isRenderableTransitionApertureBatch(
	batch: TransitionCompositeApertureBatchInput,
): boolean {
	return (
		batch.frontFace === "indoor-visible" &&
		batch.indexCount > 0 &&
		batch.rangeCount > 0
	);
}

function getTransitionDepthCurrentTarget(
	baseScene: PortalSceneDomain,
	transitionDepth: number,
): SceneDomainTargetKind {
	const baseTarget = getPortalSceneDomainTarget(baseScene);
	return transitionDepth % 2 === 0
		? baseTarget
		: getOppositeSceneDomainTarget(baseTarget);
}

function getPortalSceneDomainTarget(
	scene: PortalSceneDomain,
): SceneDomainTargetKind {
	return scene.kind;
}

function getOppositeSceneDomainTarget(
	target: SceneDomainTargetKind,
): SceneDomainTargetKind {
	return target === "exterior" ? "interior" : "exterior";
}

function getTransitionCompositeCullFace(
	direction: TransitionCompositeDirection,
): TransitionCompositeCullFace {
	return direction === "outdoor-to-indoor" ? "front" : "back";
}
