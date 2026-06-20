import type {
	PortalFrameWorkPlan,
	RendererEnvCellResourceMembership,
} from "../renderer/types";
import type {
	PortalTraversalPlan,
	PortalTraversalVisibleCell,
	StaticSceneCameraResidency,
} from "./static-scene-query";

export interface DirectEnvCellFramePlanInput {
	readonly currentCameraResidency: StaticSceneCameraResidency;
	readonly rendererEnvCellResourceMembership: readonly RendererEnvCellResourceMembership[];
	readonly traversalPlan: PortalTraversalPlan;
}

export function createDirectEnvCellFramePlan(
	input: DirectEnvCellFramePlanInput,
): PortalFrameWorkPlan | null {
	if (input.currentCameraResidency.kind !== "env-cell") {
		return null;
	}
	if (input.traversalPlan.visibleCells.length === 0) {
		return null;
	}

	const membershipsByKey = new Map(
		input.rendererEnvCellResourceMembership.map((membership) => [
			createEnvCellKey(membership.landblockId, membership.envCellId),
			membership,
		]),
	);

	return {
		baseScene: {
			envCellId: input.currentCameraResidency.envCellId,
			kind: "env-cell-direct",
			landblockId: input.currentCameraResidency.landblockId,
		},
		directEnvCellDraws: input.traversalPlan.visibleCells.map((cell) =>
			createDirectEnvCellDrawRequest(cell, membershipsByKey),
		),
		kind: "direct-env-cell",
		mode: "portal-traversal",
		transitionSceneCrossings: [],
	};
}

function createDirectEnvCellDrawRequest(
	cell: PortalTraversalVisibleCell,
	membershipsByKey: ReadonlyMap<string, RendererEnvCellResourceMembership>,
): Extract<
	PortalFrameWorkPlan,
	{ readonly kind: "direct-env-cell" }
>["directEnvCellDraws"][number] {
	const membership =
		membershipsByKey.get(createEnvCellKey(cell.landblockId, cell.envCellId)) ??
		null;
	const structuredInteriorDrawUnitIds =
		membership?.structuredInteriorDrawUnitIds ?? [];
	const envCellStaticObjectDrawUnitIds =
		membership?.envCellStaticObjectDrawUnitIds ?? [];
	const hasDrawResources =
		structuredInteriorDrawUnitIds.length > 0 ||
		envCellStaticObjectDrawUnitIds.length > 0;
	return {
		envCellId: cell.envCellId,
		envCellStaticObjectDrawUnitIds,
		landblockId: cell.landblockId,
		portalStackId: cell.portalStackId,
		resourceState: hasDrawResources ? "ready" : "missing-resources",
		structuredInteriorDrawUnitIds,
		traversalDepth: cell.traversalDepth,
	};
}

function createEnvCellKey(landblockId: number, envCellId: number): string {
	return `${landblockId >>> 0}:${envCellId >>> 0}`;
}
