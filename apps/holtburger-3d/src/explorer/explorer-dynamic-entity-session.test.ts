import { describe, expect, it } from "vitest";

import type { DynamicEntityEvent } from "../lib/game/runtime/dynamic-entity-feed";
import {
	ExplorerDynamicEntitySession,
	type ExplorerDynamicEntityTransport,
} from "./explorer-dynamic-entity-session";

class FakeTransport implements ExplorerDynamicEntityTransport {
	readonly calls: string[] = [];
	handler: ((payload: unknown) => void) | null = null;
	snapshotGuid = 2;

	async listen(
		event: string,
		handler: (payload: unknown) => void,
	): Promise<() => void> {
		this.calls.push(`listen:${event}`);
		this.handler = handler;
		return () => {
			this.calls.push("unlisten");
			this.handler = null;
		};
	}

	async invoke(command: string): Promise<unknown> {
		this.calls.push(`invoke:${command}`);
		this.emit({
			kind: "upserted",
			entity: entity(1),
		});
		this.emit({
			kind: "snapshot",
			snapshot: {
				hostTime: { seconds: 1 },
				entities: [entity(this.snapshotGuid)],
			},
		});
		return undefined;
	}

	emit(event: DynamicEntityEvent): void {
		this.handler?.(event);
	}
}

function entity(guid: number) {
	return {
		generation: 1,
		identity: { guid, wcid: 42, name: "Drudge" },
		presentation: {
			content: {
				setupDid: 0x02000001,
				motionTableDid: null,
				soundTableDid: null,
				physicsEffectTableDid: null,
			},
			appearance: {
				paletteDid: null,
				subPalettes: [],
				textureChanges: [],
				partChanges: [],
			},
			objectScale: 1,
		},
		physics: {
			semanticMask: 0,
			participation: "pose-only" as const,
			noDraw: false,
			hidden: false,
			cloaked: false,
			lighting: false,
			defaultAnimation: false,
			defaultScript: false,
		},
		placement: {
			pose: {
				landblockId: 0xda550001,
				coords: { x: 1, y: 2, z: 3 },
				rotation: { w: 1, x: 0, y: 0, z: 0 },
			},
			velocity: { x: 0, y: 0, z: 0 },
			acceleration: { x: 0, y: 0, z: 0 },
			omega: { x: 0, y: 0, z: 0 },
			contact: "unknown" as const,
			sampleMode: "authoritative-only" as const,
		},
		motion: null,
	};
}

describe("ExplorerDynamicEntitySession", () => {
	it("listens before requesting state and reconstructs again after listener restart", async () => {
		const transport = new FakeTransport();
		const session = new ExplorerDynamicEntitySession(transport);
		await session.start();
		expect(transport.calls.slice(0, 2)).toEqual([
			"listen:explorer-dynamic-entity",
			"invoke:request_explorer_dynamic_entity_snapshot",
		]);
		expect(
			session.mirror.entities().map((value) => value.identity.guid),
		).toEqual([2]);

		session.stop();
		transport.snapshotGuid = 3;
		await session.start();
		expect(
			session.mirror.entities().map((value) => value.identity.guid),
		).toEqual([3]);
		expect(
			transport.calls.filter((call) => call.startsWith("listen:")),
		).toHaveLength(2);
	});

	it("notifies subscribers only when an accepted event changes the mirror", async () => {
		const transport = new FakeTransport();
		const session = new ExplorerDynamicEntitySession(transport);
		let changes = 0;
		const unsubscribe = session.subscribe(() => (changes += 1));
		await session.start();
		// The pre-snapshot upsert is ignored; only the recovery snapshot is observable.
		expect(changes).toBe(1);
		transport.emit({ kind: "removed", guid: 2, generation: 2 });
		expect(changes).toBe(1);
		transport.emit({ kind: "removed", guid: 2, generation: 1 });
		expect(changes).toBe(2);
		unsubscribe();
		transport.emit({
			kind: "snapshot",
			snapshot: { hostTime: { seconds: 2 }, entities: [entity(4)] },
		});
		expect(changes).toBe(2);
	});
});
