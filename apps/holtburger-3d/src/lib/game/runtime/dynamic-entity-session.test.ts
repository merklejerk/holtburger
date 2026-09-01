import { describe, expect, it } from "vitest";

import type {
	DynamicEntityEvent,
	DynamicEntityView,
} from "./dynamic-entity-feed";
import { DynamicEntitySession } from "./dynamic-entity-session";

class Feed {
	readonly calls: string[] = [];
	#handler: ((payload: unknown) => void) | null = null;
	#snapshotGuid = 1;

	async subscribe(handler: (payload: unknown) => void): Promise<() => void> {
		this.calls.push("subscribe");
		this.#handler = handler;
		return () => {
			this.calls.push("unsubscribe");
			this.#handler = null;
		};
	}

	async requestCurrentState(): Promise<void> {
		this.calls.push("request-current-state");
		this.emit({
			kind: "snapshot",
			snapshot: {
				hostTime: { seconds: 1 },
				entities: [view(this.#snapshotGuid)],
			},
		});
	}

	setSnapshotGuid(guid: number): void {
		this.#snapshotGuid = guid;
	}

	emit(event: DynamicEntityEvent): void {
		this.#handler?.(event);
	}
}

describe("DynamicEntitySession", () => {
	it("subscribes before requesting a replacement snapshot", async () => {
		const feed = new Feed();
		const session = new DynamicEntitySession({
			subscribe: (handler) => feed.subscribe(handler),
			requestCurrentState: () => feed.requestCurrentState(),
		});

		await session.start();

		expect(feed.calls).toEqual(["subscribe", "request-current-state"]);
		expect(
			session.mirror.entities().map((entity) => entity.identity.guid),
		).toEqual([1]);
	});

	it("invalidates deltas until a complete replacement snapshot arrives", async () => {
		const feed = new Feed();
		const session = new DynamicEntitySession({
			subscribe: (handler) => feed.subscribe(handler),
			requestCurrentState: () => feed.requestCurrentState(),
		});
		const changes: string[] = [];
		session.subscribe((event) => changes.push(event.kind));

		await session.start();
		feed.setSnapshotGuid(2);
		session.invalidate();
		feed.emit({ kind: "upserted", entity: view(3) });
		expect(
			session.mirror.entities().map((entity) => entity.identity.guid),
		).toEqual([1]);

		feed.emit({
			kind: "snapshot",
			snapshot: { hostTime: { seconds: 2 }, entities: [view(2)] },
		});
		expect(
			session.mirror.entities().map((entity) => entity.identity.guid),
		).toEqual([2]);
		expect(changes).toEqual(["snapshot", "snapshot"]);
	});

	it("stops the feed and requires hydration again on restart", async () => {
		const feed = new Feed();
		const session = new DynamicEntitySession({
			subscribe: (handler) => feed.subscribe(handler),
			requestCurrentState: () => feed.requestCurrentState(),
		});

		await session.start();
		session.stop();
		feed.setSnapshotGuid(4);
		await session.start();

		expect(feed.calls).toEqual([
			"subscribe",
			"request-current-state",
			"unsubscribe",
			"subscribe",
			"request-current-state",
		]);
		expect(
			session.mirror.entities().map((entity) => entity.identity.guid),
		).toEqual([4]);
	});
});

function view(guid: number): DynamicEntityView {
	return {
		generation: 1,
		identity: { guid, wcid: 42 },
		display: { name: "Drudge", level: null },
		presentation: {
			entityClass: "other",
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
			radar: { blipColor: "Default", behavior: null, obviousRange: null },
		},
		physics: {
			semanticMask: 0,
			participation: "pose-only",
			noDraw: false,
			hidden: false,
			cloaked: false,
			lighting: false,
			defaultAnimation: false,
			defaultScript: false,
		},
		placement: {
			kind: "attached",
			parent: 0,
			parentLocation: "none",
			placement: "default",
		},
		motion: null,
	};
}
