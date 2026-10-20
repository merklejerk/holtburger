import type { SceneInterestRequest } from "../lib/game/runtime/scene-interest";
import type { LandblockOwnerId } from "../lib/game/game-types";
import {
	ClientEntityMirror,
	type ClientEntityFacts,
} from "./client-entity-mirror";
import {
	DynamicEntityMirror,
	type DynamicEntityView,
	type DynamicEntityWorldPlacement,
} from "../lib/game/runtime/dynamic-entity-feed";
import type { ClientLifecycleSessionState } from "./client-lifecycle-session";
import type { NearbySessionEvent } from "./client-nearby";
import { entityFacts } from "./client-entity-mirror.test-support";
import { targetingEntity } from "./client-targeting.test-support";

/** Asset-free accepted public catalog facts; merged identity is deliberately different. */
export function nearbyFacts(guid: number, name: string): ClientEntityFacts {
	return entityFacts(guid, {
		nearby: {
			name,
			category: "monster",
			vendor: false,
			stackCount: null,
			structure: { current: null, max: null },
		},
	});
}

/** Test-owned accepted poses used in unit and real browser fixtures. */
export function nearbyPose(
	guid: number,
	x: number,
): DynamicEntityView & { placement: DynamicEntityWorldPlacement } {
	const entity = targetingEntity(guid, 1);
	return {
		...entity,
		placement: {
			...entity.placement,
			pose: { ...entity.placement.pose, coords: { x, y: 0, z: 0 } },
		},
	};
}

/** Real mirrors with controllable delivery edges, including pending recovery and portal state. */
export class NearbyTestSession {
	readonly entities = new ClientEntityMirror();
	readonly mirror = new DynamicEntityMirror();
	readonly listeners = new Set<(event: NearbySessionEvent) => void>();
	current: Pick<
		ClientLifecycleSessionState,
		"lifecycle" | "playerGuid" | "worldName"
	> = {
		lifecycle: { kind: "in-world" },
		playerGuid: 1,
		worldName: "Fixture",
	};
	state() {
		return this.current;
	}
	subscribe(listener: (event: NearbySessionEvent) => void) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	emit(event: NearbySessionEvent): void {
		for (const listener of this.listeners) listener(event);
	}
	baseline(
		facts: readonly ClientEntityFacts[],
		poses: readonly DynamicEntityView[],
	): void {
		this.entities.commit(
			this.entities.prepareSnapshot(
				{
					entities: [entityFacts(1), ...facts],
					worldContainer: { kind: "closed" },
					projectileSupply: { kind: "not-applicable" },
				},
				1,
			),
		);
		this.mirror.apply({
			kind: "snapshot",
			snapshot: { hostTime: { seconds: 10 }, entities: [...poses] },
		});
		this.emit({ type: "current-state" });
	}
	update(
		facts: readonly ClientEntityFacts[],
		removed: readonly number[] = [],
	): void {
		const prepared = this.entities.prepareDelta({
			upserts: [...facts],
			removed: [...removed],
			worldContainer: null,
			projectileSupply: null,
		});
		if (prepared !== null) this.entities.commit(prepared);
		this.emit({ type: "entities" });
	}
	pose(entity: DynamicEntityView): void {
		const event = { kind: "upserted" as const, entity };
		this.mirror.apply(event);
		this.emit({ type: "dynamic", event });
	}
}

/** Minimal complete interest requests; owner/layer membership does not require asset fixtures. */
export function nearbySceneInterest(
	owner: LandblockOwnerId,
	kind: "outdoor" | "dungeon",
): SceneInterestRequest {
	return {
		ambientOutdoorEnvCellOwners: new Set(),
		radii: {
			terrainRadius: 0,
			buildingRadius: 0,
			envCellRadius: null,
			explicitObjectRadius: null,
			generatedObjectRadius: null,
		},
		target:
			kind === "outdoor"
				? { kind, requested: { kind: "outdoor", landblockId: owner } }
				: {
						kind,
						requested: { kind: "automatic-landblock", landblockId: owner },
					},
	};
}
