import type { Vec3Dto } from "../host/contracts";
import {
	deriveTransitionPortalDepthBatches,
	type TransitionPortalDepthBatchModel,
	type TransitionPortalVisiblePools,
} from "./transition-portal-depth-batches";
import type { TransitionPortalRenderLevel } from "./render-policy";
import type { PortalAperturePlane } from "./portal-apertures";
import type { RenderMat4 } from "./render-math";
import {
	createTransitionPortalWorkItem,
	type TransitionPortalCandidate,
	type TransitionPortalCandidateModel,
	type TransitionPortalScene,
	type TransitionPortalWorkItem,
} from "./transition-portal-work-items";
import type { WorldRenderSceneContext } from "./render-scene-context";
import type { CameraViewResidencyContext } from "./world-residency-index";
import type { StructuredInteriorSceneModel } from "./structured-interior-scene";
import type { Webgl2WorldDrawUnit } from "./webgl2-world-resources";

export interface Webgl2VisibleTransitionPortalWork {
	workItem: TransitionPortalWorkItem;
	maskDrawUnitId: string;
	direction: TransitionPortalWorkItem["direction"];
	entryEnvCellId: number;
	requestedInteriorEnvCellIds: readonly number[];
	screenRect: Webgl2PortalScreenRect;
	screenAreaPx: number;
}

export interface Webgl2PortalScreenRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface Webgl2TransitionPortalWorkPlan
	extends TransitionPortalDepthBatchModel<Webgl2VisibleTransitionPortalWork> {
	visibleWorkItems: readonly Webgl2VisibleTransitionPortalWork[];
}

export function deriveWebgl2BaseSceneDomain(options: {
	renderSceneContext: WorldRenderSceneContext;
	structuredInteriorScene: StructuredInteriorSceneModel;
}): TransitionPortalScene {
	return options.renderSceneContext.kind === "dungeon" &&
		options.structuredInteriorScene.cells.length > 0
		? "interior"
		: "exterior";
}

export function deriveWebgl2BaseSceneDomainFromResidency(
	context: CameraViewResidencyContext,
): TransitionPortalScene {
	return context.kind === "env-cell" ? "interior" : "exterior";
}

export function deriveWebgl2InitialPortalEnvCellId(
	context: CameraViewResidencyContext,
): number | null {
	return context.kind === "env-cell" ? context.envCellId : null;
}

export function planWebgl2TransitionPortalWork(options: {
	transitionPortalModel: TransitionPortalCandidateModel;
	visiblePortalMaskDrawUnits: readonly Webgl2WorldDrawUnit[];
	cameraPosition: Vec3Dto;
	viewProjectionMatrix: RenderMat4;
	viewport: { width: number; height: number };
	baseScene: TransitionPortalScene;
	initialEnvCellId: number | null;
	levels: readonly TransitionPortalRenderLevel[];
}): Webgl2TransitionPortalWorkPlan {
	const candidatesById = new Map(
		options.transitionPortalModel.candidates.map((candidate) => [
			candidate.id,
			candidate,
		]),
	);
	const visiblePools: TransitionPortalVisiblePools<Webgl2VisibleTransitionPortalWork> =
		{
			outdoorToIndoor: [],
			indoorToOutdoor: [],
		};

	for (const maskDrawUnit of options.visiblePortalMaskDrawUnits) {
		const candidateId = parsePortalMaskDrawUnitCandidateId(maskDrawUnit.id);
		if (!candidateId) {
			continue;
		}
		const candidate = candidatesById.get(candidateId);
		if (!candidate) {
			continue;
		}
		const workItem = createTransitionPortalWorkItem({
			candidate,
			cameraPosition: options.cameraPosition,
			worldPlane: transformPortalAperturePlane(
				candidate,
				maskDrawUnit.modelMatrix,
			),
		});
		if (!workItem) {
			continue;
		}
		const screenRect = projectPortalMaskScreenRect({
			candidate,
			modelMatrix: maskDrawUnit.modelMatrix,
			viewProjectionMatrix: options.viewProjectionMatrix,
			viewport: options.viewport,
		});
		if (!screenRect) {
			continue;
		}
		const work: Webgl2VisibleTransitionPortalWork = {
			workItem,
			maskDrawUnitId: maskDrawUnit.id,
			direction: workItem.direction,
			entryEnvCellId: workItem.entryEnvCellId,
			requestedInteriorEnvCellIds: workItem.requestedInteriorEnvCellIds,
			screenRect,
			screenAreaPx: screenRect.width * screenRect.height,
		};
		if (work.direction === "outdoor-to-indoor") {
			visiblePools.outdoorToIndoor.push(work);
		} else {
			visiblePools.indoorToOutdoor.push(work);
		}
	}

	for (const pool of [visiblePools.outdoorToIndoor, visiblePools.indoorToOutdoor]) {
		pool.sort(compareWebgl2VisibleTransitionPortalWork);
	}

	const depthBatches = deriveTransitionPortalDepthBatches({
		levels: options.levels,
		baseScene: options.baseScene,
		initialEnvCellId: options.initialEnvCellId,
		visiblePools,
	});

	return {
		...depthBatches,
		visibleWorkItems: [
			...visiblePools.outdoorToIndoor,
			...visiblePools.indoorToOutdoor,
		],
	};
}

function parsePortalMaskDrawUnitCandidateId(drawUnitId: string): string | null {
	const prefix = "portal-mask/";
	return drawUnitId.startsWith(prefix) ? drawUnitId.slice(prefix.length) : null;
}

function projectPortalMaskScreenRect(options: {
	candidate: TransitionPortalCandidate;
	modelMatrix: RenderMat4;
	viewProjectionMatrix: RenderMat4;
	viewport: { width: number; height: number };
}): Webgl2PortalScreenRect | null {
	const projected = options.candidate.aperture.points.flatMap((point) => {
		const world = transformPoint(options.modelMatrix, point);
		const clip = transformPoint4(options.viewProjectionMatrix, world);
		if (clip.w <= 0) {
			return [];
		}
		const inverseW = 1 / clip.w;
		return [
			{
				x: ((clip.x * inverseW + 1) / 2) * options.viewport.width,
				y: ((1 - clip.y * inverseW) / 2) * options.viewport.height,
			},
		];
	});
	if (projected.length < 3) {
		return null;
	}
	const minX = Math.max(0, Math.floor(Math.min(...projected.map((point) => point.x))));
	const maxX = Math.min(
		options.viewport.width,
		Math.ceil(Math.max(...projected.map((point) => point.x))),
	);
	const minY = Math.max(0, Math.floor(Math.min(...projected.map((point) => point.y))));
	const maxY = Math.min(
		options.viewport.height,
		Math.ceil(Math.max(...projected.map((point) => point.y))),
	);
	const width = maxX - minX;
	const height = maxY - minY;
	return width > 0 && height > 0
		? {
				x: minX,
				y: minY,
				width,
				height,
			}
		: null;
}

function transformPortalAperturePlane(
	candidate: TransitionPortalCandidate,
	matrix: RenderMat4,
): PortalAperturePlane | null {
	const plane = candidate.aperture.plane;
	if (!plane) {
		return null;
	}
	const normalLengthSq =
		plane.normal.x * plane.normal.x +
		plane.normal.y * plane.normal.y +
		plane.normal.z * plane.normal.z;
	if (normalLengthSq === 0) {
		return null;
	}

	const pointOnPlane = transformPoint(matrix, {
		x: (plane.normal.x * plane.constant) / normalLengthSq,
		y: (plane.normal.y * plane.constant) / normalLengthSq,
		z: (plane.normal.z * plane.constant) / normalLengthSq,
	});
	const worldNormal = transformDirection(matrix, plane.normal);
	return {
		normal: worldNormal,
		constant:
			worldNormal.x * pointOnPlane.x +
			worldNormal.y * pointOnPlane.y +
			worldNormal.z * pointOnPlane.z,
		source: plane.source,
	};
}

function transformPoint(matrix: RenderMat4, point: Vec3Dto): Vec3Dto {
	return {
		x: matrix[0] * point.x + matrix[4] * point.y + matrix[8] * point.z + matrix[12],
		y: matrix[1] * point.x + matrix[5] * point.y + matrix[9] * point.z + matrix[13],
		z: matrix[2] * point.x + matrix[6] * point.y + matrix[10] * point.z + matrix[14],
	};
}

function transformDirection(matrix: RenderMat4, direction: Vec3Dto): Vec3Dto {
	return {
		x: matrix[0] * direction.x + matrix[4] * direction.y + matrix[8] * direction.z,
		y: matrix[1] * direction.x + matrix[5] * direction.y + matrix[9] * direction.z,
		z: matrix[2] * direction.x + matrix[6] * direction.y + matrix[10] * direction.z,
	};
}

function transformPoint4(matrix: RenderMat4, point: Vec3Dto): {
	x: number;
	y: number;
	z: number;
	w: number;
} {
	return {
		x: matrix[0] * point.x + matrix[4] * point.y + matrix[8] * point.z + matrix[12],
		y: matrix[1] * point.x + matrix[5] * point.y + matrix[9] * point.z + matrix[13],
		z: matrix[2] * point.x + matrix[6] * point.y + matrix[10] * point.z + matrix[14],
		w: matrix[3] * point.x + matrix[7] * point.y + matrix[11] * point.z + matrix[15],
	};
}

function compareWebgl2VisibleTransitionPortalWork(
	left: Webgl2VisibleTransitionPortalWork,
	right: Webgl2VisibleTransitionPortalWork,
): number {
	return left.workItem.id.localeCompare(right.workItem.id);
}
