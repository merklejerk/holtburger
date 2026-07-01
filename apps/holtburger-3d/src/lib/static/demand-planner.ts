import {
	buildOutdoorCoverageLandblocks,
	normalizeOutdoorLandblockId,
} from "../../lib/landblocks";
import type {
	StaticDemand,
	StaticDemandPlan,
	StaticDomain,
	StaticLandblockSceneLodLayerRequest,
	StaticLandblockSceneLodSourceRequest,
	StaticLodRadii,
	StaticResolverJob,
	StaticResolverScope,
	StaticLayerTaskRequest,
} from "./contracts";
import {
	createLayerOwnerKeyForStaticScope,
	createLayerOwnerKeyId,
} from "./layer-owners";

const domainPriorities: Record<StaticDomain, number> = {
	"outdoor-terrain": 0,
	"outdoor-buildings": 5,
	"outdoor-explicit-objects": 15,
	"outdoor-generated-scenery": 20,
	"env-cell-system": 10,
};

export function planStaticDemand(
	demand: StaticDemand,
	revision: number,
): StaticDemandPlan {
	if (!demand.location) {
		return { layerTasks: [], retainedLayerOwners: [], sourceRequests: [] };
	}

	if (demand.location.kind === "interior-cell") {
		const landblockId = normalizeOutdoorLandblockId(
			demand.location.landblockId,
		);
		const layerTasks = [
			...(["outdoor-buildings", "env-cell-system"] as const).map((domain) =>
				createStaticLayerTaskRequest({
					job: {
						domain,
						scope: {
							kind: "landblock",
							landblockId,
						},
					},
					priority: domainPriorities[domain],
					revision,
				}),
			),
		].sort(compareStaticLayerTaskRequests);

		return {
			layerTasks,
			retainedLayerOwners: layerTasks.map((task) => task.ownerKey),
			sourceRequests: createLandblockSceneLodSourceRequests(
				layerTasks,
				"outdoor",
			),
		};
	}

	const lod = normalizeOutdoorLodRadii(demand.lod);
	const landblockId = normalizeOutdoorLandblockId(demand.location.landblockId);
	const layerTasks: StaticLayerTaskRequest[] = [];

	addOutdoorDomainRequests(layerTasks, {
		domain: "outdoor-terrain",
		focusLandblockId: landblockId,
		radius: lod.terrain,
		revision,
	});
	addOutdoorDomainRequests(layerTasks, {
		domain: "outdoor-buildings",
		focusLandblockId: landblockId,
		radius: lod.buildings,
		revision,
	});
	addOutdoorDomainRequests(layerTasks, {
		domain: "outdoor-explicit-objects",
		focusLandblockId: landblockId,
		radius: lod.detail,
		revision,
	});
	addOutdoorDomainRequests(layerTasks, {
		domain: "outdoor-generated-scenery",
		focusLandblockId: landblockId,
		radius: lod.detail,
		revision,
	});
	addOutdoorDomainRequests(layerTasks, {
		domain: "env-cell-system",
		focusLandblockId: landblockId,
		radius: lod.envCells,
		revision,
	});

	const sortedTasks = layerTasks.sort(compareStaticLayerTaskRequests);

	return {
		layerTasks: sortedTasks,
		retainedLayerOwners: sortedTasks.map((task) => task.ownerKey),
		sourceRequests: createLandblockSceneLodSourceRequests(
			sortedTasks,
			"outdoor",
		),
	};
}

export function normalizeOutdoorLodRadii(lod: StaticLodRadii): StaticLodRadii {
	const terrain = normalizeRadius(lod.terrain);

	return {
		terrain,
		buildings: Math.min(normalizeRadius(lod.buildings), terrain),
		detail: Math.min(normalizeRadius(lod.detail), terrain),
		envCells: Math.min(normalizeRadius(lod.envCells), terrain),
	};
}

function addOutdoorDomainRequests(
	layerTasks: StaticLayerTaskRequest[],
	input: {
		readonly domain: StaticDomain;
		readonly focusLandblockId: number;
		readonly radius: number;
		readonly revision: number;
	},
): void {
	if (input.radius < 0) {
		return;
	}

	for (const landblock of buildOutdoorCoverageLandblocks(
		input.focusLandblockId,
		input.radius,
	)) {
		layerTasks.push(
			createStaticLayerTaskRequest({
				job: {
					domain: input.domain,
					scope: {
						kind: "landblock",
						landblockId: landblock.landblockId,
					},
				},
				priority: domainPriorities[input.domain] + landblock.distance,
				revision: input.revision,
			}),
		);
	}
}

function createStaticLayerTaskRequest(input: {
	readonly job: StaticResolverJob;
	readonly priority: number;
	readonly revision: number;
}): StaticLayerTaskRequest {
	const scopeKey = describeStaticScopeKey(input.job.scope);
	const ownerKey = createLayerOwnerKeyForStaticScope({
		domain: input.job.domain,
		scope: input.job.scope,
		scopeKey,
	});

	return {
		domain: input.job.domain,
		ownerId: createLayerOwnerKeyId(ownerKey),
		ownerKey,
		priority: input.priority,
		revision: input.revision,
		scope: input.job.scope,
		scopeKey,
		taskId: `${input.revision}:${scopeKey}:${input.job.domain}`,
	};
}

function describeStaticScopeKey(scope: StaticResolverScope): string {
	return `landblock:${formatHex32(scope.landblockId)}`;
}

function createLandblockSceneLodSourceRequests(
	layerTasks: readonly StaticLayerTaskRequest[],
	context: StaticLandblockSceneLodSourceRequest["context"],
): readonly StaticLandblockSceneLodSourceRequest[] {
	const requestsByLandblock = new Map<
		number,
		{
			readonly landblockId: number;
			priority: number;
			sourceLod: StaticLandblockSceneLodSourceRequest["sourceLod"];
			readonly requestedLayersByKind: Map<
				StaticLandblockSceneLodLayerRequest["kind"],
				StaticLandblockSceneLodLayerRequest
			>;
		}
	>();

	for (const item of layerTasks) {
		const landblockId = item.scope.landblockId;
		const layerKind = landblockSceneLodLayerKindForStaticDomain(item.domain);
		const layerLod = sourceLodForLandblockSceneLayer(layerKind);
		let request = requestsByLandblock.get(landblockId);
		if (!request) {
			request = {
				landblockId,
				priority: item.priority,
				requestedLayersByKind: new Map(),
				sourceLod: layerLod,
			};
			requestsByLandblock.set(landblockId, request);
		}
		request.priority = Math.min(request.priority, item.priority);
		if (layerLod > request.sourceLod) {
			request.sourceLod = layerLod;
		}
		request.requestedLayersByKind.set(layerKind, {
			kind: layerKind,
			targetOwnerKey: item.ownerKey,
		});
	}

	return [...requestsByLandblock.values()]
		.map((request) => ({
			context,
			landblockId: request.landblockId,
			priority: request.priority,
			requestedLayers: [...request.requestedLayersByKind.values()].sort(
				compareLandblockSceneLodLayerRequests,
			),
			sourceLod: request.sourceLod,
		}))
		.sort(compareLandblockSceneLodSourceRequests)
		.map((prioritizedRequest) => {
			return {
				context: prioritizedRequest.context,
				landblockId: prioritizedRequest.landblockId,
				requestedLayers: prioritizedRequest.requestedLayers,
				sourceLod: prioritizedRequest.sourceLod,
			};
		});
}

function landblockSceneLodLayerKindForStaticDomain(
	domain: StaticDomain,
): StaticLandblockSceneLodLayerRequest["kind"] {
	switch (domain) {
		case "outdoor-terrain":
			return "terrain";
		case "outdoor-buildings":
			return "outdoor-buildings";
		case "outdoor-explicit-objects":
			return "outdoor-explicit-objects";
		case "outdoor-generated-scenery":
			return "outdoor-generated-scenery";
		case "env-cell-system":
			return "env-cell-system";
	}
}

function sourceLodForLandblockSceneLayer(
	kind: StaticLandblockSceneLodLayerRequest["kind"],
): StaticLandblockSceneLodSourceRequest["sourceLod"] {
	switch (kind) {
		case "terrain":
			return 0;
		case "outdoor-buildings":
			return 1;
		case "outdoor-explicit-objects":
			return 2;
		case "outdoor-generated-scenery":
			return 3;
		case "env-cell-system":
			return 4;
	}
}

function compareLandblockSceneLodLayerRequests(
	left: StaticLandblockSceneLodLayerRequest,
	right: StaticLandblockSceneLodLayerRequest,
): number {
	const lodDelta =
		sourceLodForLandblockSceneLayer(left.kind) -
		sourceLodForLandblockSceneLayer(right.kind);
	if (lodDelta !== 0) {
		return lodDelta;
	}

	return left.kind.localeCompare(right.kind);
}

function compareLandblockSceneLodSourceRequests(
	left: StaticLandblockSceneLodSourceRequest & { readonly priority: number },
	right: StaticLandblockSceneLodSourceRequest & { readonly priority: number },
): number {
	return left.priority - right.priority || left.landblockId - right.landblockId;
}

function compareStaticLayerTaskRequests(
	left: StaticLayerTaskRequest,
	right: StaticLayerTaskRequest,
): number {
	if (left.priority !== right.priority) {
		return left.priority - right.priority;
	}

	return left.taskId.localeCompare(right.taskId);
}

function normalizeRadius(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}

	return Math.trunc(value);
}

function formatHex32(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}
