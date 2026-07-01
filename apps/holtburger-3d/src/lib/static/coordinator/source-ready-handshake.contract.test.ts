import { describe, expect, it } from "vitest";
import { StaticSourceReadyHandshake } from "./source-ready-handshake";

interface FixtureSourcePayload {
	readonly sourceId: string;
}

interface FixturePlacementIntent {
	readonly itemId: string;
}

interface FixturePlacement {
	readonly itemId: string;
	readonly pageId: string;
}

interface FixturePlacementSnapshot {
	readonly revision: number;
	readonly placementsByItemId: ReadonlyMap<string, FixturePlacement>;
}

describe("source-ready handshake contract spike", () => {
	it("resumes source-ready work after a fake placement snapshot is supplied", () => {
		const handshake = createHandshake({
			activeTaskIds: ["task-a"],
			revision: 1,
		});
		const sourceReady = handshake.createSourceReadyWork({
			domain: "outdoor-buildings",
			placementIntents: [{ itemId: "texture-a" }],
			sourcePayloads: [{ sourceId: "source-a" }],
			taskIds: ["task-a"],
		});
		const snapshot = createPlacementSnapshot(sourceReady.placementIntents, 7);

		const result = handshake.resume(
			sourceReady.token,
			snapshot,
			(work, placed) => ({
				placementPageId:
					placed.placementsByItemId.get(work.placementIntents[0]?.itemId ?? "")
						?.pageId ?? null,
				sourceId: work.sourcePayloads[0]?.sourceId ?? null,
				taskIds: work.token.taskIds,
			}),
		);

		expect(result).toEqual({
			kind: "resumed",
			result: {
				placementPageId: "page:texture-a",
				sourceId: "source-a",
				taskIds: ["task-a"],
			},
		});
	});

	it("rejects a resume after demand removes an in-flight task", () => {
		const handshake = createHandshake({
			activeTaskIds: ["task-a"],
			revision: 1,
		});
		const sourceReady = createSourceReady(handshake, "task-a", "texture-a");
		handshake.setDemandState({ activeTaskIds: [], revision: 1 });

		const result = handshake.resume(
			sourceReady.token,
			createPlacementSnapshot(sourceReady.placementIntents),
			() => "should-not-run",
		);

		expect(result).toMatchObject({
			kind: "rejected",
			reason: "stale-tasks",
		});
	});

	it("rejects an older source-ready token after a newer demand revision supersedes it", () => {
		const handshake = createHandshake({
			activeTaskIds: ["task-a"],
			revision: 1,
		});
		const stale = createSourceReady(handshake, "task-a", "texture-a");
		handshake.setDemandState({ activeTaskIds: ["task-b"], revision: 2 });
		const current = createSourceReady(handshake, "task-b", "texture-b");

		expect(
			handshake.resume(
				stale.token,
				createPlacementSnapshot(stale.placementIntents, 2),
				() => "stale",
			),
		).toMatchObject({
			kind: "rejected",
			reason: "superseded",
		});
		expect(
			handshake.resume(
				current.token,
				createPlacementSnapshot(current.placementIntents, 2),
				() => "current",
			),
		).toEqual({
			kind: "resumed",
			result: "current",
		});
	});

	it("rejects a token after placement failure is reported", () => {
		const handshake = createHandshake({
			activeTaskIds: ["task-a"],
			revision: 1,
		});
		const sourceReady = createSourceReady(handshake, "task-a", "texture-a");
		handshake.fail(sourceReady.token, "placement failed");

		const result = handshake.resume(
			sourceReady.token,
			createPlacementSnapshot(sourceReady.placementIntents),
			() => "should-not-run",
		);

		expect(result).toEqual({
			kind: "rejected",
			message: "placement failed",
			reason: "failed",
		});
	});

	it("consumes a token when bake fails after placement succeeds", () => {
		const handshake = createHandshake({
			activeTaskIds: ["task-a"],
			revision: 1,
		});
		const sourceReady = createSourceReady(handshake, "task-a", "texture-a");
		const bakeError = new Error("bake failed");

		expect(() =>
			handshake.resume(
				sourceReady.token,
				createPlacementSnapshot(sourceReady.placementIntents),
				() => {
					throw bakeError;
				},
			),
		).toThrow(bakeError);
		expect(
			handshake.resume(
				sourceReady.token,
				createPlacementSnapshot(sourceReady.placementIntents),
				() => "should-not-run",
			),
		).toMatchObject({
			kind: "rejected",
			reason: "already-resumed",
		});
	});

	it("rejects duplicate resume attempts", () => {
		const handshake = createHandshake({
			activeTaskIds: ["task-a"],
			revision: 1,
		});
		const sourceReady = createSourceReady(handshake, "task-a", "texture-a");
		const snapshot = createPlacementSnapshot(sourceReady.placementIntents);

		expect(
			handshake.resume(sourceReady.token, snapshot, () => "first"),
		).toEqual({
			kind: "resumed",
			result: "first",
		});
		expect(
			handshake.resume(sourceReady.token, snapshot, () => "second"),
		).toMatchObject({
			kind: "rejected",
			reason: "already-resumed",
		});
	});

	it("rejects a resume after disposal while placement is in flight", () => {
		const handshake = createHandshake({
			activeTaskIds: ["task-a"],
			revision: 1,
		});
		const sourceReady = createSourceReady(handshake, "task-a", "texture-a");
		handshake.dispose();

		expect(
			handshake.resume(
				sourceReady.token,
				createPlacementSnapshot(sourceReady.placementIntents),
				() => "should-not-run",
			),
		).toMatchObject({
			kind: "rejected",
			reason: "disposed",
		});
	});

	it("allows same-revision source-ready work to resume out of order", () => {
		const handshake = createHandshake({
			activeTaskIds: ["task-a", "task-b"],
			revision: 1,
		});
		const first = createSourceReady(handshake, "task-a", "texture-a");
		const second = createSourceReady(handshake, "task-b", "texture-b");
		const committedTaskIds: string[] = [];

		const secondResult = handshake.resume(
			second.token,
			createPlacementSnapshot(second.placementIntents),
			(work) => {
				committedTaskIds.push(...work.token.taskIds);
				return work.token.taskIds[0] ?? null;
			},
		);
		const firstResult = handshake.resume(
			first.token,
			createPlacementSnapshot(first.placementIntents),
			(work) => {
				committedTaskIds.push(...work.token.taskIds);
				return work.token.taskIds[0] ?? null;
			},
		);

		expect(secondResult).toEqual({ kind: "resumed", result: "task-b" });
		expect(firstResult).toEqual({ kind: "resumed", result: "task-a" });
		expect(committedTaskIds).toEqual(["task-b", "task-a"]);
	});
});

function createHandshake(state: {
	readonly activeTaskIds: readonly string[];
	readonly revision: number;
}): StaticSourceReadyHandshake<FixtureSourcePayload, FixturePlacementIntent> {
	const handshake = new StaticSourceReadyHandshake<
		FixtureSourcePayload,
		FixturePlacementIntent
	>();
	handshake.setDemandState(state);
	return handshake;
}

function createSourceReady(
	handshake: StaticSourceReadyHandshake<
		FixtureSourcePayload,
		FixturePlacementIntent
	>,
	taskId: string,
	itemId: string,
) {
	return handshake.createSourceReadyWork({
		domain: "outdoor-buildings",
		placementIntents: [{ itemId }],
		sourcePayloads: [{ sourceId: `source:${taskId}` }],
		taskIds: [taskId],
	});
}

function createPlacementSnapshot(
	intents: readonly FixturePlacementIntent[],
	revision = 1,
): FixturePlacementSnapshot {
	return {
		placementsByItemId: new Map(
			intents.map((intent) => [
				intent.itemId,
				{
					itemId: intent.itemId,
					pageId: `page:${intent.itemId}`,
				},
			]),
		),
		revision,
	};
}
