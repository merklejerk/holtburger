import { describe, expect, it, vi } from "vitest";
import { ClientContractsState } from "./client-contracts-state";
import {
	contractsSnapshotSchema,
	type ContractRow,
} from "./client-contracts-contract";
import fixturePayload from "../harness/browser/fixtures/contracts.json";
import { contractsUpdatedSchema } from "./client-contracts-contract";
import { contractLocationText } from "./client-contracts-view";

function row(id: number): Extract<ContractRow, { kind: "resolved" }> {
	return {
		kind: "resolved",
		id,
		name: "Same quest",
		description: "Notes",
		status: { kind: "waitingToRepeat", remainingSeconds: 20 },
		contact: {
			role: "end",
			name: "Bob",
			location: { kind: "indoor", cellId: 0xda550100 },
		},
		area: { kind: "missing" },
		deadline: { kind: "running", remainingSeconds: 10 },
	};
}
function fixture() {
	let now = 0;
	const submit = vi.fn(async () => {});
	const owner = new ClientContractsState(submit, () => now);
	owner.recover(
		{ rows: [row(2), row(1), { kind: "unresolved", id: 99 }] },
		42,
		true,
	);
	return {
		owner,
		submit,
		advance: (ms: number) => {
			now += ms;
		},
	};
}

describe("contracts journal", () => {
	it("unions selected statuses, intersects search, and clears on character replacement", () => {
		const { owner } = fixture();
		owner.setFilters(["waitingToRepeat", "unresolved"]);
		expect(owner.read().journal?.rows.map((row) => row.id)).toEqual([99, 1, 2]);
		owner.setSearch("quest");
		expect(owner.read().journal?.rows.map((row) => row.id)).toEqual([1, 2]);
		owner.setSearch("");
		owner.setFilters(["unresolved"]);
		expect(owner.read().journal?.rows.map((row) => row.id)).toEqual([99]);
		owner.setFilters([]);
		expect(owner.read().journal?.rows).toHaveLength(3);
		owner.setFilters(["unresolved"]);
		owner.setContext(43, true);
		expect(owner.read().filters).toEqual([]);
	});
	it("matches every abbreviated term across name and description using spell search rules", () => {
		const { owner } = fixture();
		owner.update({
			rows: [
				{
					...row(1),
					name: "Ancient Armor",
					description: "Recover the shattered relic.",
				},
				{ ...row(2), name: "Ancient Armor", description: "Visit the town." },
				{ kind: "unresolved", id: 99 },
			],
		});
		for (const query of ["RELIC", "amr rcv", "shtrd, ancient", "relic relic"]) {
			owner.setSearch(query);
			expect(owner.read().journal?.rows.map((row) => row.id)).toEqual([1]);
		}
		for (const query of ["armor absent", "ancientarmor", "relicvisit"]) {
			owner.setSearch(query);
			expect(owner.read().journal?.rows).toEqual([]);
		}
		owner.setSearch("#99");
		expect(owner.read().journal?.rows.map((row) => row.id)).toEqual([99]);
		owner.setSearch("...");
		expect(owner.read().journal?.rows).toHaveLength(3);
	});
	it("accepts the sidecar-verified payload fixture through the frontend schema", () => {
		const payload = contractsUpdatedSchema.parse(fixturePayload);
		expect(payload.contracts?.rows).toHaveLength(6);
	});
	it("keeps duplicate identities and expansion through filters and prunes only deleted IDs", () => {
		const { owner } = fixture();
		expect(owner.read().journal?.rows.map((row) => row.id)).toEqual([99, 1, 2]);
		owner.toggleExpanded(1);
		owner.toggleExpanded(2);
		owner.setSearch("#99");
		expect(owner.read().journal?.rows.map((row) => row.id)).toEqual([99]);
		owner.setSearch("");
		owner.setFilters(["waitingToRepeat"]);
		expect(owner.read().journal?.rows.map((row) => row.id)).toEqual([1, 2]);
		expect([...owner.read().expanded]).toEqual([1, 2]);
		owner.update({ rows: [row(2)] });
		expect([...owner.read().expanded]).toEqual([2]);
	});
	it("ages repeat/deadline independently and keeps expiry filters coherent", () => {
		const { owner, advance } = fixture();
		advance(12_000);
		expect(owner.read().journal?.rows[1]).toMatchObject({
			status: { kind: "waitingToRepeat", remainingSeconds: 8 },
			deadline: { kind: "finished" },
		});
		owner.setFilters(["waitingToRepeat"]);
		advance(9_000);
		expect(owner.read().journal?.rows).toEqual([]);
		owner.setFilters(["available"]);
		expect(owner.read().journal?.rows.map((row) => row.id)).toEqual([1, 2]);
		owner.recover(
			{
				rows: [
					{
						...row(1),
						status: { kind: "waitingToRepeat", remainingSeconds: 3 },
					},
				],
			},
			42,
			true,
		);
		advance(1_000);
		owner.setFilters([]);
		expect(owner.read().journal?.rows[0]).toMatchObject({
			status: { kind: "waitingToRepeat", remainingSeconds: 2 },
		});
	});
	it("queues removal without hiding rows and rejects stale questions", async () => {
		const { owner, submit } = fixture();
		const failure = vi.fn();
		owner.requestRemove(1, failure);
		const question = owner.question();
		if (question === null) throw new Error("Missing question");
		owner.respond(question.requestId, true);
		await Promise.resolve();
		expect(submit).toHaveBeenCalledWith({ kind: "remove", id: 1 });
		expect(owner.read().journal?.rows).toHaveLength(3);
		expect(owner.question()).toBeNull();
		owner.requestRemove(2, failure);
		const stale = owner.question();
		if (stale === null) throw new Error("Missing question");
		owner.update({ rows: [row(1)] });
		owner.respond(stale.requestId, true);
		expect(submit).toHaveBeenCalledTimes(1);
		owner.requestRemove(1, failure);
		owner.dismissQuestion();
		expect(owner.question()).toBeNull();
	});
	it("reports dispatch failure while retaining authoritative membership", async () => {
		const report = vi.fn();
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const owner = new ClientContractsState(
				async () => {
					throw new Error("Transport unavailable");
				},
				() => 0,
			);
			owner.recover({ rows: [row(1)] }, 42, true);
			owner.requestRemove(1, report);
			const question = owner.question();
			if (question === null) throw new Error("Missing question");
			owner.respond(question.requestId, true);
			await Promise.resolve();
			expect(report).toHaveBeenCalledWith(
				"Couldn’t remove contract from journal.",
			);
			expect(owner.read().journal?.total).toBe(1);
			expect(owner.question()).toBeNull();
		} finally {
			log.mockRestore();
		}
	});
	it("preserves early facts at player establishment and clears retirement state", () => {
		const owner = new ClientContractsState(
			async () => {},
			() => 0,
		);
		owner.update({ rows: [row(1)] });
		owner.setContext(42, true);
		expect(owner.read().journal?.rows).toHaveLength(1);
		owner.toggleExpanded(1);
		owner.setSearch("same");
		owner.setContext(42, false);
		expect(owner.read().journal?.rows).toHaveLength(1);
		owner.setContext(43, true);
		expect(owner.read()).toMatchObject({ journal: null, search: "" });
		expect(owner.read().expanded.size).toBe(0);
		owner.recover({ rows: [] }, 43, true);
		expect(owner.read()).toMatchObject({ journal: { rows: [], total: 0 } });
	});
	it("validates tagged boundary shapes and distinguishes missing/indoor locations", () => {
		expect(contractsSnapshotSchema.parse({ rows: [row(1)] }).rows).toHaveLength(
			1,
		);
		expect(
			contractsSnapshotSchema.safeParse({
				rows: [
					{
						...row(1),
						status: { kind: "waitingToRepeat", remainingSeconds: Number.NaN },
					},
				],
			}).success,
		).toBe(false);
		expect(contractLocationText({ kind: "missing" })).toBe("Not provided");
		expect(contractLocationText({ kind: "indoor", cellId: 0xda550100 })).toBe(
			"Indoors",
		);
		expect(
			contractLocationText({
				kind: "outdoor",
				latitude: -1.2,
				longitude: 3.4,
				position: {
					landblockId: 2155872257,
					coords: { x: 6, y: 12, z: 25 },
					rotation: { w: 1, x: 0, y: 0, z: 0 },
				},
			}),
		).toBe("1.2S, 3.4E");
		expect(
			contractLocationText({
				kind: "outdoor",
				latitude: 0,
				longitude: 0,
				position: {
					landblockId: 2155872257,
					coords: { x: 6, y: 12, z: 25 },
					rotation: { w: 1, x: 0, y: 0, z: 0 },
				},
			}),
		).toBe("0.0, 0.0");
	});
});
