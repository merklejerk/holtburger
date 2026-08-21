import { describe, expect, it } from "vitest";

import type { DynamicEntityEvent } from "../lib/game/runtime/dynamic-entity-feed";
import {
	ExplorerDynamicEntitySession,
	type ExplorerDynamicEntityTransport,
} from "./explorer-dynamic-entity-session";
import { IDLE_MOTION_ORDER } from "./explorer-entity-possession";

/// Records every invocation and answers from a per-command script, for commands that publish no
/// snapshot and therefore cannot be observed through the entity feed.
class RecordingTransport implements ExplorerDynamicEntityTransport {
	readonly invocations: [string, Record<string, unknown> | undefined][] = [];
	readonly responses = new Map<string, unknown>();

	async listen(): Promise<() => void> {
		return () => {};
	}

	async invoke(
		command: string,
		args?: Record<string, unknown>,
	): Promise<unknown> {
		this.invocations.push([command, args]);
		return this.responses.get(command);
	}
}

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
				motionTableDid: null,
				setupDid: 0x02000001,
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
			kind: "world" as const,
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
	};
}

describe("ExplorerDynamicEntitySession", () => {
	it("waits for a same-generation mutation event instead of mistaking prior state for completion", async () => {
		const transport = new FakeTransport();
		const session = new ExplorerDynamicEntitySession(transport);
		await session.start();

		transport.invoke = async (command: string): Promise<unknown> => {
			transport.calls.push(`invoke:${command}`);
			return { guid: 2, generation: 1 };
		};
		let completed = false;
		const launch = session
			.launch({
				guid: 2,
				generation: 1,
				direction: { x: 1, y: 0, z: 0 },
			})
			.then(() => {
				completed = true;
			});
		await Promise.resolve();
		await Promise.resolve();
		expect(completed).toBe(false);

		transport.emit({ kind: "upserted", entity: entity(2) });
		await launch;
		expect(completed).toBe(true);
	});

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
		// The pre-snapshot upsert is ignored; only the hydration snapshot is observable.
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

describe("possession", () => {
	it("possesses one entity and reports what its table models", async () => {
		const transport = new RecordingTransport();
		transport.responses.set("possess_explorer_entity", {
			guid: 0xf0000001,
			modelledCommands: ["0x45000005", "0x44000007"],
			motionTableId: "0x09000001",
		});
		const session = new ExplorerDynamicEntitySession(transport);

		const possession = await session.possess(0xf0000001);

		expect(possession.motionTableId).toBe("0x09000001");
		expect(possession.modelledCommands).toEqual(["0x45000005", "0x44000007"]);
		expect(transport.invocations).toContainEqual([
			"possess_explorer_entity",
			{ request: { guid: 0xf0000001 } },
		]);
	});

	it("releases by naming no entity", async () => {
		const transport = new RecordingTransport();
		transport.responses.set("possess_explorer_entity", {
			guid: null,
			modelledCommands: [],
			motionTableId: null,
		});
		const session = new ExplorerDynamicEntitySession(transport);

		expect((await session.possess(null)).guid).toBeNull();
		expect(transport.invocations).toContainEqual([
			"possess_explorer_entity",
			{ request: { guid: null } },
		]);
	});

	it("reports whether an order reached anything, so an unpossessed order is not silent", async () => {
		const transport = new RecordingTransport();
		transport.responses.set("set_explorer_entity_motion", false);
		const session = new ExplorerDynamicEntitySession(transport);

		expect(await session.setMotionOrder(IDLE_MOTION_ORDER)).toBe(false);
	});
});
