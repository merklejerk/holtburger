import { describe, expect, it } from "vitest";

import type { DynamicEntityEvent } from "../lib/game/runtime/dynamic-entity-feed";
import {
	ExplorerDynamicEntitySession,
	type ExplorerDynamicEntityTransport,
} from "./explorer-dynamic-entity-session";

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
	readonly handlers = new Map<string, (payload: unknown) => void>();
	snapshotGuid = 2;

	async listen(
		event: string,
		handler: (payload: unknown) => void,
	): Promise<() => void> {
		this.calls.push(`listen:${event}`);
		this.handlers.set(event, handler);
		return () => {
			this.calls.push("unlisten");
			this.handlers.delete(event);
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
		this.handlers.get("explorer-dynamic-entity")?.(event);
	}

	emitPossessionOutcome(outcome: unknown): void {
		this.handlers.get("explorer-possession-event-outcome")?.(outcome);
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
		expect(transport.calls.slice(0, 3)).toEqual([
			"listen:explorer-dynamic-entity",
			"listen:explorer-possession-event-outcome",
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
		).toHaveLength(4);
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

	it("decodes dedicated possession outcomes independently from entity delivery", async () => {
		const transport = new FakeTransport();
		const session = new ExplorerDynamicEntitySession(transport);
		const outcomes: unknown[] = [];
		session.subscribePossessionOutcomes((outcome) => outcomes.push(outcome));
		await session.start();

		transport.emitPossessionOutcome({
			possessionGeneration: 4,
			sequence: 2,
			result: { kind: "rejected", reason: "airborne" },
		});

		expect(outcomes).toEqual([
			{
				possessionGeneration: 4,
				sequence: 2,
				result: { kind: "rejected", reason: "airborne" },
			},
		]);
	});
});

describe("possession", () => {
	it("possesses one entity and reports its generation-bound stance capabilities", async () => {
		const transport = new RecordingTransport();
		transport.responses.set("possess_explorer_entity", {
			acceptedStance: 0x8000003d,
			entityGeneration: 7,
			guid: 0xf0000001,
			motionTableId: "0x09000001",
			possessionGeneration: 9,
			stances: [
				{
					chargeDurationMs: 1_000,
					jumpPresentation: "ready-and-falling",
					run: "target-authored",
					sidestep: "standard-fallback-without-target-presentation",
					style: 0x8000003d,
					turn: "target-authored",
					walk: "target-authored",
				},
			],
		});
		const session = new ExplorerDynamicEntitySession(transport);

		const possession = await session.possess(0xf0000001);

		expect(possession.motionTableId).toBe("0x09000001");
		expect(possession.possessionGeneration).toBe(9);
		expect(possession.stances[0]?.sidestep).toBe(
			"standard-fallback-without-target-presentation",
		);
		expect(transport.invocations).toContainEqual([
			"possess_explorer_entity",
			{ request: { guid: 0xf0000001 } },
		]);
	});

	it("releases by naming no entity", async () => {
		const transport = new RecordingTransport();
		transport.responses.set("possess_explorer_entity", {
			acceptedStance: null,
			entityGeneration: null,
			guid: null,
			motionTableId: null,
			possessionGeneration: 10,
			stances: [],
		});
		const session = new ExplorerDynamicEntitySession(transport);

		expect((await session.possess(null)).guid).toBeNull();
		expect(transport.invocations).toContainEqual([
			"possess_explorer_entity",
			{ request: { guid: null } },
		]);
	});

	it("returns typed replaceable-intent and lifecycle queue outcomes", async () => {
		const transport = new RecordingTransport();
		transport.responses.set("set_explorer_possession_intent", "accepted");
		transport.responses.set("queue_explorer_possession_event", {
			result: "queued",
			outcomes: [],
		});
		const session = new ExplorerDynamicEntitySession(transport);
		const intent = {
			drive: {
				gait: "run" as const,
				lateral: null,
				longitudinal: "backward" as const,
				turn: "left" as const,
			},
			possessionGeneration: 9,
			revision: 3,
			stance: 0x8000003d,
		};

		expect(await session.setPossessionIntent(intent)).toBe("accepted");
		expect(
			await session.queuePossessionEvent({
				...intent,
				kind: "begin-jump",
				sequence: 0,
			}),
		).toEqual({ result: "queued", outcomes: [] });
	});
});
