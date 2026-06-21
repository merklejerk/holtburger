import type { StaticDrawUnit } from "../static/contracts";

export interface EnvCellResourceMembership {
	readonly landblockId: number;
	readonly envCellId: number;
	readonly structuredInteriorDrawUnitIds: readonly string[];
	readonly envCellStaticObjectDrawUnitIds: readonly string[];
	readonly sharedEnvCellStaticObjectDrawUnits: number;
}

interface MutableEnvCellResourceMembership {
	readonly landblockId: number;
	readonly envCellId: number;
	readonly structuredInteriorDrawUnitIds: string[];
	readonly envCellStaticObjectDrawUnitIds: string[];
	sharedEnvCellStaticObjectDrawUnits: number;
}

export function createEnvCellResourceMembershipSnapshot(
	drawUnits: Iterable<StaticDrawUnit>,
): readonly EnvCellResourceMembership[] {
	const memberships = new Map<string, MutableEnvCellResourceMembership>();

	for (const drawUnit of drawUnits) {
		if (drawUnit.kind === "structured-interior-geometry") {
			getOrCreateMembership(
				memberships,
				drawUnit.landblockId,
				drawUnit.envCellId,
			).structuredInteriorDrawUnitIds.push(drawUnit.drawUnitId);
			continue;
		}

		if (
			drawUnit.kind === "static-object-geometry" &&
			drawUnit.ownership.kind === "env-cell-static-object-seeds"
		) {
			for (const envCellId of drawUnit.ownership.envCellIds) {
				const membership = getOrCreateMembership(
					memberships,
					drawUnit.landblockId,
					envCellId,
				);
				membership.envCellStaticObjectDrawUnitIds.push(drawUnit.drawUnitId);
				if (drawUnit.ownership.envCellIds.length > 1) {
					membership.sharedEnvCellStaticObjectDrawUnits += 1;
				}
			}
		}
	}

	return [...memberships.values()]
		.map((membership) => ({
			envCellId: membership.envCellId,
			envCellStaticObjectDrawUnitIds:
				membership.envCellStaticObjectDrawUnitIds.sort(compareStrings),
			landblockId: membership.landblockId,
			sharedEnvCellStaticObjectDrawUnits:
				membership.sharedEnvCellStaticObjectDrawUnits,
			structuredInteriorDrawUnitIds:
				membership.structuredInteriorDrawUnitIds.sort(compareStrings),
		}))
		.sort(compareEnvCellResourceMembership);
}

export function createEnvCellResourceMembershipIndex(
	memberships: readonly EnvCellResourceMembership[],
): ReadonlyMap<number, ReadonlyMap<number, EnvCellResourceMembership>> {
	const byLandblock = new Map<number, Map<number, EnvCellResourceMembership>>();
	for (const membership of memberships) {
		getOrCreateNestedMap(byLandblock, membership.landblockId).set(
			membership.envCellId,
			membership,
		);
	}
	return byLandblock;
}

export function envCellResourceMembershipSnapshotsEqual(
	left: readonly EnvCellResourceMembership[],
	right: readonly EnvCellResourceMembership[],
): boolean {
	if (left.length !== right.length) {
		return false;
	}
	return left.every((leftEntry, index) =>
		envCellResourceMembershipEquals(leftEntry, right[index]),
	);
}

function getOrCreateMembership(
	memberships: Map<string, MutableEnvCellResourceMembership>,
	landblockId: number,
	envCellId: number,
): MutableEnvCellResourceMembership {
	const key = createEnvCellResourceKey(landblockId, envCellId);
	const existing = memberships.get(key);
	if (existing) {
		return existing;
	}
	const membership: MutableEnvCellResourceMembership = {
		envCellId,
		envCellStaticObjectDrawUnitIds: [],
		landblockId,
		sharedEnvCellStaticObjectDrawUnits: 0,
		structuredInteriorDrawUnitIds: [],
	};
	memberships.set(key, membership);
	return membership;
}

function envCellResourceMembershipEquals(
	left: EnvCellResourceMembership,
	right: EnvCellResourceMembership | undefined,
): boolean {
	return (
		right !== undefined &&
		left.landblockId === right.landblockId &&
		left.envCellId === right.envCellId &&
		left.sharedEnvCellStaticObjectDrawUnits ===
			right.sharedEnvCellStaticObjectDrawUnits &&
		stringArraysEqual(
			left.structuredInteriorDrawUnitIds,
			right.structuredInteriorDrawUnitIds,
		) &&
		stringArraysEqual(
			left.envCellStaticObjectDrawUnitIds,
			right.envCellStaticObjectDrawUnitIds,
		)
	);
}

function createEnvCellResourceKey(
	landblockId: number,
	envCellId: number,
): string {
	return `${landblockId >>> 0}:${envCellId >>> 0}`;
}

function getOrCreateNestedMap<K, L, V>(
	map: Map<K, Map<L, V>>,
	key: K,
): Map<L, V> {
	const existing = map.get(key);
	if (existing) {
		return existing;
	}

	const nested = new Map<L, V>();
	map.set(key, nested);
	return nested;
}

function compareEnvCellResourceMembership(
	left: EnvCellResourceMembership,
	right: EnvCellResourceMembership,
): number {
	return (
		compareNumbers(left.landblockId, right.landblockId) ||
		compareNumbers(left.envCellId, right.envCellId)
	);
}

function compareNumbers(left: number, right: number): number {
	return left - right;
}

function compareStrings(left: string, right: string): number {
	return left.localeCompare(right);
}

function stringArraysEqual(
	left: readonly string[],
	right: readonly string[],
): boolean {
	return (
		left.length === right.length &&
		left.every((leftValue, index) => leftValue === right[index])
	);
}
