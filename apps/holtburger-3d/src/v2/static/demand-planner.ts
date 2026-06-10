import {
	buildOutdoorCoverageLandblocks,
	normalizeOutdoorLandblockId,
} from "../../lib/landblocks";
import type {
	StaticDemand,
	StaticDomain,
	StaticLodRadii,
	StaticResolverJob,
	StaticResolverScope,
	ScheduledStaticWork,
} from "./contracts";

const domainPriorities: Record<StaticDomain, number> = {
	"outdoor-terrain": 0,
	"landblock-topology": 5,
	"outdoor-buildings": 10,
	"outdoor-detail": 20,
	"dungeon-static": 0,
};

export function planScheduledStaticWork(
	demand: StaticDemand,
	revision: number,
): ScheduledStaticWork[] {
	if (!demand.location) {
		return [];
	}

	if (demand.location.kind === "interior-cell") {
		const landblockId = normalizeOutdoorLandblockId(demand.location.landblockId);

		return [
			createScheduledStaticWork({
				job: {
					domain: "dungeon-static",
					scope: {
						kind: "landblock",
						landblockId,
					},
				},
				priority: domainPriorities["dungeon-static"],
				revision,
			}),
		];
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
		domain: "outdoor-detail",
		focusLandblockId: landblockId,
		radius: lod.detail,
		revision,
	});
	addOutdoorDomainRequests(work, {
		domain: "landblock-topology",
		focusLandblockId: landblockId,
		radius: lod.topology,
		revision,
	});

	return work.sort(compareScheduledStaticWork);
}

export function normalizeOutdoorLodRadii(lod: StaticLodRadii): StaticLodRadii {
	const terrain = normalizeRadius(lod.terrain);

	return {
		terrain,
		buildings: Math.min(normalizeRadius(lod.buildings), terrain),
		detail: Math.min(normalizeRadius(lod.detail), terrain),
		topology: Math.min(normalizeRadius(lod.topology), terrain),
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
