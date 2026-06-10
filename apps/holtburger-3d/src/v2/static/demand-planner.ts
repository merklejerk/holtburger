import {
	buildOutdoorCoverageLandblocks,
	normalizeOutdoorLandblockId,
} from "../../lib/landblocks";
import type {
	StaticDemand,
	StaticDomain,
	StaticLodRadii,
	StaticScope,
	StaticWorkRequest,
} from "./contracts";

const domainPriorities: Record<StaticDomain, number> = {
	terrain: 0,
	buildings: 10,
	detail: 20,
	envCells: 30,
};

export function planStaticWorkRequests(
	demand: StaticDemand,
	revision: number,
): StaticWorkRequest[] {
	if (!demand.location) {
		return [];
	}

	if (demand.location.kind === "interior-cell") {
		return [
			createStaticWorkRequest({
				domain: "envCells",
				policyRevision: demand.policyRevision,
				priority: domainPriorities.envCells,
				revision,
				scope: {
					envCellId: demand.location.envCellId,
					kind: "env-cell",
					landblockId: normalizeOutdoorLandblockId(demand.location.landblockId),
				},
			}),
		];
	}

	const lod = normalizeOutdoorLodRadii(demand.lod);
	const landblockId = normalizeOutdoorLandblockId(demand.location.landblockId);
	const requests: StaticWorkRequest[] = [];

	addOutdoorDomainRequests(requests, {
		domain: "terrain",
		focusLandblockId: landblockId,
		policyRevision: demand.policyRevision,
		radius: lod.terrain,
		revision,
	});
	addOutdoorDomainRequests(requests, {
		domain: "buildings",
		focusLandblockId: landblockId,
		policyRevision: demand.policyRevision,
		radius: lod.buildings,
		revision,
	});
	addOutdoorDomainRequests(requests, {
		domain: "detail",
		focusLandblockId: landblockId,
		policyRevision: demand.policyRevision,
		radius: lod.detail,
		revision,
	});
	addOutdoorDomainRequests(requests, {
		domain: "envCells",
		focusLandblockId: landblockId,
		policyRevision: demand.policyRevision,
		radius: lod.envCells,
		revision,
	});

	return requests.sort(compareStaticWorkRequests);
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
	requests: StaticWorkRequest[],
	input: {
		readonly domain: StaticDomain;
		readonly focusLandblockId: number;
		readonly policyRevision: number;
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
		requests.push(
			createStaticWorkRequest({
				domain: input.domain,
				policyRevision: input.policyRevision,
				priority: domainPriorities[input.domain] + landblock.distance,
				revision: input.revision,
				scope: {
					kind: "landblock",
					landblockId: landblock.landblockId,
				},
			}),
		);
	}
}

function createStaticWorkRequest(input: {
	readonly domain: StaticDomain;
	readonly policyRevision: number;
	readonly priority: number;
	readonly revision: number;
	readonly scope: StaticScope;
}): StaticWorkRequest {
	const scopeKey = describeStaticScopeKey(input.scope);

	return {
		domain: input.domain,
		policyRevision: input.policyRevision,
		priority: input.priority,
		requestId: `${input.revision}:${scopeKey}:${input.domain}`,
		revision: input.revision,
		scope: input.scope,
	};
}

export function describeStaticScopeKey(scope: StaticScope): string {
	if (scope.kind === "env-cell") {
		return `env-cell:${formatHex32(scope.envCellId)}`;
	}

	return `landblock:${formatHex32(scope.landblockId)}`;
}

function compareStaticWorkRequests(
	left: StaticWorkRequest,
	right: StaticWorkRequest,
): number {
	if (left.priority !== right.priority) {
		return left.priority - right.priority;
	}

	return left.requestId.localeCompare(right.requestId);
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
