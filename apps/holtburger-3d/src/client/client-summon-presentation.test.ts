import { describe, expect, it, vi } from "vitest";
import { ClientAppraisalRequests } from "./client-appraisal-requests";
import { ClientEntityMirror } from "./client-entity-mirror";
import type { ClientEntityFacts } from "./client-entity-mirror";
import { entityFacts } from "./client-entity-mirror.test-support";
import type { ClientLifecycleSessionEvent } from "./client-lifecycle-session";
import {
	ClientSummonPresentation,
	SUMMON_ENDED_MESSAGE,
} from "./client-summon-presentation";

const SUMMON: NonNullable<ClientEntityFacts["summon"]> = {
	owner: 1,

	instanceSequence: 4,
	activity: "active",
	lifetime: { kind: "unobserved" },
};

function fixture() {
	const entities = new ClientEntityMirror();
	const send = vi
		.fn<(guid: number) => Promise<void>>()
		.mockResolvedValue(undefined);
	const appraisals = new ClientAppraisalRequests({
		sendFull: (guid) => send(guid),
		sendFacts: vi.fn().mockResolvedValue(undefined),
		cancel: vi.fn().mockResolvedValue(undefined),
	});
	const listeners = new Set<(event: ClientLifecycleSessionEvent) => void>();
	let awaiting = false;
	const notify = vi.fn();
	const reportFailure = vi.fn();
	const session = {
		entities,
		appraisals,
		mirror: { isAwaitingSnapshot: () => awaiting },
		state: () => ({ lifecycle: { kind: "in-world" as const }, playerGuid: 1 }),
		subscribe: (listener: (event: ClientLifecycleSessionEvent) => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
	const owner = new ClientSummonPresentation(session, notify, reportFailure);
	const emit = (event: ClientLifecycleSessionEvent) => {
		appraisals.receive(event);
		for (const listener of listeners) listener(event);
	};
	return {
		owner,
		send,
		appraisals,
		notify,
		reportFailure,
		emit,
		pending() {
			awaiting = true;
			emit({ type: "resyncing" });
		},
		publish(records: readonly ClientEntityFacts[]) {
			entities.commit(
				entities.prepareSnapshot(
					{
						entities: [entityFacts(1), ...records],
						worldContainer: { kind: "closed" },
						projectileSupply: { kind: "not-applicable" },
						salvage: {
							skills: {
								salvagingSkill: 0,
								tinkeringSkill: 0,
								augmentationBonusSalvage: 0,
							},
						},
					},
					1,
				),
			);
			emit({ type: "entities" });
		},
	};
}

describe("summon presentation interests", () => {
	it("shares appraisal with inspection and requests only once per observed incarnation", async () => {
		const f = fixture();
		const receive = vi.fn();
		await f.appraisals.request(7, receive).sent;
		const record = entityFacts(7, {
			summon: SUMMON,
			scenePlacement: "available",
		});
		f.publish([record]);
		f.publish([record]);
		await Promise.resolve();
		expect(f.send).toHaveBeenCalledExactlyOnceWith(7);
		f.emit({
			type: "object-inspection-result",
			result: { guid: 7, outcome: { kind: "rejected" } },
		});
		f.publish([record]);
		await Promise.resolve();
		expect(f.send).toHaveBeenCalledOnce();
		expect(receive).toHaveBeenCalledOnce();
		f.owner.destroy();
	});

	it("cancels before dispatch when the summon disappears", async () => {
		const f = fixture();
		f.publish([
			entityFacts(7, { summon: SUMMON, scenePlacement: "available" }),
		]);
		f.publish([]);
		await Promise.resolve();
		expect(f.send).not.toHaveBeenCalled();
		f.owner.destroy();
	});

	it("does not request timing already disclosed or for an ended summon", async () => {
		const f = fixture();
		f.publish([
			entityFacts(7, {
				summon: { ...SUMMON, lifetime: { kind: "undisclosed" } },
			}),
			entityFacts(8, { summon: { ...SUMMON, activity: "ended" } }),
		]);
		await Promise.resolve();
		expect(f.send).not.toHaveBeenCalled();
		expect(f.notify).not.toHaveBeenCalled();
		f.owner.destroy();
	});

	it("replaces pending incarnation interests and cancels them during reset", async () => {
		const f = fixture();
		f.publish([
			entityFacts(7, { summon: SUMMON, scenePlacement: "available" }),
		]);
		f.publish([
			entityFacts(7, {
				summon: { ...SUMMON, instanceSequence: SUMMON.instanceSequence + 1 },
				scenePlacement: "available",
			}),
		]);
		await Promise.resolve();
		expect(f.send).toHaveBeenCalledExactlyOnceWith(7);
		f.pending();
		// A result already on the wire may still arrive; it cannot notify or resurrect interest.
		f.emit({
			type: "object-inspection-result",
			result: { guid: 7, outcome: { kind: "rejected" } },
		});
		expect(f.notify).not.toHaveBeenCalled();
		expect(f.reportFailure).not.toHaveBeenCalled();
		f.owner.destroy();
	});

	it("notifies a live local-owner edge independently of entity residency and suppresses recovery", () => {
		const f = fixture();
		const edge = {
			guid: 7,
			instanceSequence: 4,
			owner: 1,
			cause: "death" as const,
		};
		f.emit({ type: "summon-ended", summon: { ...edge, owner: 2 } });
		expect(f.notify).not.toHaveBeenCalled();
		f.emit({ type: "summon-ended", summon: edge });
		expect(f.notify).toHaveBeenCalledExactlyOnceWith(SUMMON_ENDED_MESSAGE);
		f.pending();
		f.emit({ type: "summon-ended", summon: edge });
		expect(f.notify).toHaveBeenCalledOnce();
		f.owner.destroy();
		f.emit({ type: "summon-ended", summon: edge });
		expect(f.notify).toHaveBeenCalledOnce();
	});
});
