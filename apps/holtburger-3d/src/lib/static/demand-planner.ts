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
	ScheduledStaticWork,
} from "./contracts";
import { createLayerOwnerKeyForStaticScope } from "./layer-owners";

const domainPriorities: Record<StaticDomain, number> = {
	"outdoor-terrain": 0,
	"outdoor-buildings": 5,
	"outdoor-explicit-objects": 15,
	"outdoor-generated-scenery": 20,
	"landblock-env-cells": 10,
	"outdoor-detail": 20,
};

export function planStaticDemand(
	demand: StaticDemand,
	revision: number,
): StaticDemandPlan {
	if (!demand.location) {
		return { retainedLayerOwners: [], sourceRequests: [], work: [] };
	}

	if (demand.location.kind === "interior-cell") {
		const landblockId = normalizeOutdoorLandblockId(
			demand.location.landblockId,
		);
		const work = [
			...(["outdoor-buildings", "landblock-env-cells"] as const).map((domain) =>
				createScheduledStaticWork({
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
		].sort(compareScheduledStaticWork);

		return {
			retainedLayerOwners: work.map(createLayerOwnerKeyFromWork),
			sourceRequests: createLandblockSceneLodSourceRequests(work, "outdoor"),
			work,
		};
	}

	const lod = normalizeOutdoorLodRadii(demand.lod);
	const landblockId = normalizeOutdoorLandblockId(demand.location.landblockId);
	const work: ScheduledStaticWork[] = [];

	addOutdoorDomainRequests(work, {
		domain: "outdoor-terrain",
		focusLandblockId: landblockId,
		radius: lod.terrain,
		revision,
	});
	addOutdoorDomainRequests(work, {
		domain: "outdoor-buildings",
		focusLandblockId: landblockId,
		radius: lod.buildings,
		revision,
	});
	addOutdoorDomainRequests(work, {
		domain: "outdoor-explicit-objects",
		focusLandblockId: landblockId,
		radius: lod.detail,
		revision,
	});
	addOutdoorDomainRequests(work, {
		domain: "outdoor-generated-scenery",
		focusLandblockId: landblockId,
		radius: lod.detail,
		revision,
	});
	addOutdoorDomainRequests(work, {
		domain: "landblock-env-cells",
		focusLandblockId: landblockId,
		radius: lod.envCells,
		revision,
	});

	const sortedWork = work.sort(compareScheduledStaticWork);

	return {
		retainedLayerOwners: sortedWork.map(createLayerOwnerKeyFromWork),
		sourceRequests: createLandblockSceneLodSourceRequests(
			sortedWork,
			"outdoor",
		),
		work: sortedWork,
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
	work: ScheduledStaticWork[],
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
		work.push(
			createScheduledStaticWork({
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

function createScheduledStaticWork(input: {
	readonly job: StaticResolverJob;
	readonly priority: number;
	readonly revision: number;
}): ScheduledStaticWork {
	const scopeKey = describeStaticScopeKey(input.job.scope);

	return {
		job: input.job,
		priority: input.priority,
		workId: `${input.revision}:${scopeKey}:${input.job.domain}`,
		revision: input.revision,
	};
}

export function describeStaticScopeKey(scope: StaticResolverScope): string {
	return `landblock:${formatHex32(scope.landblockId)}`;
}

function createLayerOwnerKeyFromWork(work: ScheduledStaticWork) {
	return createLayerOwnerKeyForStaticScope({
		domain: work.job.domain,
		scope: work.job.scope,
		scopeKey: describeStaticScopeKey(work.job.scope),
	});
}

function createLandblockSceneLodSourceRequests(
	work: readonly ScheduledStaticWork[],
	context: StaticLandblockSceneLodSourceRequest["context"],
): readonly StaticLandblockSceneLodSourceRequest[] {
	const requestsByLandblock = new Map<
		number,
		{
			readonly landblockId: number;
			sourceLod: StaticLandblockSceneLodSourceRequest["sourceLod"];
			readonly requestedLayersByKind: Map<
				StaticLandblockSceneLodLayerRequest["kind"],
				StaticLandblockSceneLodLayerRequest
			>;
		}
	>();

	for (const item of work) {
		const landblockId = item.job.scope.landblockId;
		const layerKind = landblockSceneLodLayerKindForStaticDomain(
			item.job.domain,
		);
		const layerLod = sourceLodForLandblockSceneLayer(layerKind);
		let request = requestsByLandblock.get(landblockId);
		if (!request) {
			request = {
				landblockId,
				requestedLayersByKind: new Map(),
				sourceLod: layerLod,
			};
			requestsByLandblock.set(landblockId, request);
		}
		if (layerLod > request.sourceLod) {
			request.sourceLod = layerLod;
		}
		request.requestedLayersByKind.set(layerKind, {
			kind: layerKind,
			targetOwnerKey: createLayerOwnerKeyFromWork(item),
		});
	}

	return [...requestsByLandblock.values()]
		.map((request) => ({
			context,
			landblockId: request.landblockId,
			requestedLayers: [...request.requestedLayersByKind.values()].sort(
				compareLandblockSceneLodLayerRequests,
			),
			sourceLod: request.sourceLod,
		}))
		.sort(compareLandblockSceneLodSourceRequests);
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
		case "landblock-env-cells":
			return "env-cell-system";
		case "outdoor-detail":
			return "outdoor-generated-scenery";
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
	left: StaticLandblockSceneLodSourceRequest,
	right: StaticLandblockSceneLodSourceRequest,
): number {
	return left.landblockId - right.landblockId;
}

function compareScheduledStaticWork(
	left: ScheduledStaticWork,
	right: ScheduledStaticWork,
): number {
	if (left.priority !== right.priority) {
		return left.priority - right.priority;
	}

	return left.workId.localeCompare(right.workId);
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
