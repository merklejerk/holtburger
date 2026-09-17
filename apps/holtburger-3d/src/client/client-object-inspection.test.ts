import { describe, expect, it } from "vitest";
import fixture from "./fixtures/object-inspection-wire.json";
import { decodeObjectInspectionResult } from "./client-object-inspection-contract";
import {
	ClientObjectInspection,
	type ClientObjectInspectionState,
} from "./client-object-inspection";
import type {
	ClientLifecycleSessionEvent,
	ClientLifecycleSessionState,
} from "./client-lifecycle-session";

const itemFixture = decodeObjectInspectionResult(fixture.item);
const rejectedFixture = decodeObjectInspectionResult(fixture.rejected);
const missingFixture = decodeObjectInspectionResult(fixture.missing);
if (itemFixture.outcome.kind !== "ready")
	throw new Error("Item wire fixture must be ready.");
const itemInspectionFixture = itemFixture.outcome.inspection;

class FakeInspectionSession {
	readonly requests: number[] = [];
	readonly #listeners = new Set<(event: ClientLifecycleSessionEvent) => void>();
	#nextRequest: Promise<void> = Promise.resolve();

	state(): ClientLifecycleSessionState {
		return {
			lifecycle: { kind: "in-world" },
			playerGuid: 0x5000_0001,
			serverTime: null,
			worldGeneration: 1,
			worldName: null,
			playerName: null,
			knownSpells: null,
			combatMode: "peace",
			vitals: [],
			characterMotion: null,
			activeConfirmation: null,
			exit: null,
		};
	}

	subscribe(
		listener: (event: ClientLifecycleSessionEvent) => void,
	): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	examineEntity(guid: number): Promise<void> {
		this.requests.push(guid);
		return this.#nextRequest;
	}

	failNext(error: Error): void {
		this.#nextRequest = Promise.reject(error);
	}

	emit(event: ClientLifecycleSessionEvent): void {
		for (const listener of this.#listeners) listener(event);
	}
}

describe("ClientObjectInspection", () => {
	it("suppresses a duplicate pending target and accepts only the latest GUID", async () => {
		const session = new FakeInspectionSession();
		const failures: string[] = [];
		const owner = new ClientObjectInspection(session, (message) =>
			failures.push(message),
		);

		await owner.examine(1);
		await owner.examine(1);
		expect(session.requests).toEqual([1]);
		await owner.examine(itemFixture.guid);
		session.emit({
			type: "object-inspection-result",
			result: { guid: 1, outcome: { kind: "missing" } },
		});
		expect(owner.read()).toEqual({
			kind: "pending",
			guid: itemFixture.guid,
		});
		session.emit({
			type: "object-inspection-result",
			result: itemFixture,
		});
		expect(owner.read().kind).toBe("ready");
		expect(failures).toEqual([]);
	});

	it("opens a matching immutable snapshot and closes without a command", async () => {
		const session = new FakeInspectionSession();
		const owner = new ClientObjectInspection(session, () => undefined);
		const states: ClientObjectInspectionState[] = [];
		owner.subscribe((state) => states.push(state));

		await owner.examine(itemFixture.guid);
		session.emit({
			type: "object-inspection-result",
			result: itemFixture,
		});
		expect(owner.read()).toEqual({
			kind: "ready",
			guid: itemFixture.guid,
			inspection: itemInspectionFixture,
		});
		owner.close();
		expect(owner.read()).toEqual({ kind: "idle" });
		expect(session.requests).toEqual([itemFixture.guid]);
		expect(states.map((state) => state.kind)).toEqual([
			"pending",
			"ready",
			"idle",
		]);
	});

	it("clears pending before reporting distinct result and transport failures", async () => {
		for (const [result, message] of [
			[rejectedFixture, "You could not examine that object."],
			[missingFixture, "That object is no longer available."],
		] as const) {
			const session = new FakeInspectionSession();
			const observed: Array<{
				state: ClientObjectInspectionState;
				message: string;
			}> = [];
			const owner = new ClientObjectInspection(session, (reported) =>
				observed.push({ state: owner.read(), message: reported }),
			);
			await owner.examine(result.guid);
			session.emit({ type: "object-inspection-result", result });
			expect(observed).toEqual([{ state: { kind: "idle" }, message }]);
		}

		const session = new FakeInspectionSession();
		session.failNext(new Error("transport unavailable"));
		const failures: string[] = [];
		const owner = new ClientObjectInspection(session, (message) =>
			failures.push(message),
		);
		await owner.examine(5);
		expect(owner.read()).toEqual({ kind: "idle" });
		expect(failures).toEqual(["transport unavailable"]);
	});

	it("invalidates on resync, leaving the world, and teardown", async () => {
		const session = new FakeInspectionSession();
		const owner = new ClientObjectInspection(session, () => undefined);
		await owner.examine(1);
		session.emit({ type: "resyncing" });
		expect(owner.read()).toEqual({ kind: "idle" });
		await owner.examine(2);
		session.emit({
			type: "lifecycle",
			lifecycle: {
				kind: "portal-space",
				worldGeneration: 2,
				cause: "teleport",
			},
		});
		expect(owner.read()).toEqual({ kind: "idle" });
		await owner.examine(3);
		owner.destroy();
		expect(owner.read()).toEqual({ kind: "idle" });
		await expect(owner.examine(4)).rejects.toThrow("unavailable");
	});
});
