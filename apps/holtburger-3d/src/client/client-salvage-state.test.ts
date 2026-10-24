import { LOCAL_CONFIRMATION_SUPPRESSION_MS } from "./client-confirmation-suppression";
import { ClientAppraisalRequests } from "./client-appraisal-requests";
import inspectionWire from "./fixtures/object-inspection-wire.json";
import { decodeObjectInspectionResult } from "./client-object-inspection-contract";
import { describe, expect, it, vi } from "vitest";
import {
	ClientSalvageState,
	type SalvageSession,
} from "./client-salvage-state";
import {
	ClientEntityMirror,
	type ClientEntityFacts,
} from "./client-entity-mirror";
import {
	entityFacts,
	playerEntitySnapshot,
} from "./client-entity-mirror.test-support";
import type { ClientLifecycleSessionEvent } from "./client-lifecycle-session";
import type {
	SalvageEvaluation,
	SalvageReview,
} from "./client-salvage-contract";

function source(guid: number, material = "Steel"): ClientEntityFacts {
	return entityFacts(guid, {
		ownedByPlayer: true,
		location: {
			kind: "contained",
			parentGuid: 1,
			slot: { kind: "item", index: guid },
		},
		salvage: {
			kind: "ready",
			source: {
				guid,
				instance: 1,
				input: {
					itemType: 1,
					materialType: material,
					stackSize: 2,
					structure: 0,
					itemWorkmanship: 7,
					numItemsInMaterial: 1,
				},
			},
		},
	});
}
function fixture() {
	const mirror = new ClientEntityMirror();
	const records = [entityFacts(1), source(2), source(3), source(4)];
	const listeners = new Set<(event: ClientLifecycleSessionEvent) => void>();
	const preview = vi
		.fn<SalvageSession["previewSalvage"]>()
		.mockResolvedValue(undefined);
	const submit = vi
		.fn<SalvageSession["submitSalvage"]>()
		.mockResolvedValue(undefined);
	const appraise = vi.fn().mockResolvedValue(undefined);
	const appraisals = new ClientAppraisalRequests(appraise);
	const notice = vi.fn();
	const showInventory = vi.fn();
	const replace = () => {
		const baseline = playerEntitySnapshot(1);
		mirror.commit(
			mirror.prepareSnapshot(
				{
					...baseline,
					entities: records,
					salvage: baseline.salvage,
				},
				1,
			),
		);
	};
	replace();
	const session: SalvageSession = {
		entities: mirror,
		appraisals,
		state: () => ({ lifecycle: { kind: "in-world" } }),
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		previewSalvage: preview,
		submitSalvage: submit,
	};
	const model = new ClientSalvageState(session, notice, showInventory);
	const emit = (event: ClientLifecycleSessionEvent) => {
		appraisals.receive(event);
		for (const listener of listeners) listener(event);
	};
	const request = () => {
		const last = preview.mock.calls.at(-1);
		if (last === undefined) throw new Error("Expected a preview request.");
		return last[0];
	};
	const ready = (): Extract<SalvageEvaluation, { kind: "ready" }> => {
		const read = mirror.read();
		if (read.kind !== "current") throw new Error("Expected current entities.");
		const review: SalvageReview = {
			player: 1,
			tool: { guid: 2, instance: 1 },
			skills: read.level.salvage.skills,
			sources: request().items.map((item) => {
				const candidate = read.level.entities.get(item)?.salvage;
				if (candidate?.kind !== "ready")
					throw new Error("Expected a ready fixture source.");
				return candidate.source;
			}),
		};
		return {
			kind: "ready",
			review,
			bags:
				request().items.length === 0
					? []
					: [{ materialType: "Steel", units: 42, workmanship: 7 }],
		};
	};
	const reply = (evaluation: SalvageEvaluation = ready()) =>
		emit({
			type: "salvage-preview",
			result: { sequence: request().sequence, evaluation },
		});
	const confirm = (suppress?: boolean) => {
		model.confirm();
		const question = model.question();
		if (question === null) throw new Error("Expected salvage confirmation.");
		model.respond(question.requestId, true, suppress);
	};
	return {
		model,
		appraise,
		appraisals,
		mirror,
		preview,
		submit,
		notice,
		showInventory,
		records,
		replace,
		request,
		ready,
		reply,
		confirm,
		emit,
	};
}

function rejectSubmission(f: ReturnType<typeof fixture>) {
	const request = f.submit.mock.calls.at(-1)?.[0];
	if (request === undefined) throw new Error("Expected salvage submission.");
	f.emit({
		type: "salvage-result",
		result: {
			sequence: request.sequence,
			outcome: { kind: "rejected", reason: "Busy" },
		},
	});
}

function appraised(guid: number) {
	const result = decodeObjectInspectionResult(inspectionWire.item);
	if (result.outcome.kind !== "ready")
		throw new Error("Expected ready inspection fixture.");
	return {
		guid,
		outcome: {
			kind: "ready",
			inspection: { ...result.outcome.inspection, guid },
		},
	} as const;
}

describe("salvage draft", () => {
	it("discovers a tool and queues the captured item only after evaluation", () => {
		const f = fixture();
		f.model.add(3);
		expect(f.request()).toMatchObject({
			tool: { kind: "discover", preferred: null },
			items: [3],
		});
		expect(f.model.visible).toBe(false);
		f.reply();
		expect(f.model.read()?.items).toEqual([3]);
		expect(f.showInventory).toHaveBeenCalledOnce();
	});
	it("missing Ust leaves the closed window and existing draft unchanged", () => {
		const f = fixture();
		f.model.add(3);
		f.reply({
			kind: "rejected",
			reason: "You do not have an Ust in your inventory.",
		});
		expect(f.model.visible).toBe(false);
		expect(f.notice).toHaveBeenCalledWith(
			"You do not have an Ust in your inventory.",
		);
		expect(f.submit).not.toHaveBeenCalled();
	});
	it("serializes rapid additions without losing earlier proposals or duplicating identities", () => {
		const f = fixture();
		f.model.add(3);
		f.model.add(4);
		f.model.add(3);
		expect(f.preview).toHaveBeenCalledOnce();
		f.reply();
		expect(f.request().items).toEqual([3, 4]);
		f.reply();
		expect(f.model.read()?.items).toEqual([3, 4]);
		expect(f.preview).toHaveBeenCalledTimes(2);
	});
	it("accepts dropping an already queued item as a no-op", () => {
		const f = fixture();
		f.model.add(3);
		f.reply();
		expect(f.model.acceptsDrop(3)).toBe(true);
		f.model.add(3);
		expect(f.model.read()?.items).toEqual([3]);
		expect(f.preview).toHaveBeenCalledOnce();
		expect(f.notice).not.toHaveBeenCalled();
		expect(f.submit).not.toHaveBeenCalled();
	});
	it("keeps pending-appraisal sources visible and prevents destruction", () => {
		const f = fixture();
		f.records[1] = source(2);
		f.records[2] = {
			...source(3),
			salvage: { kind: "pending-details", material: "Steel" },
		};
		f.replace();
		f.model.add(3);
		f.reply({
			kind: "pending-details",
			tool: { guid: 2, instance: 1 },
			items: [3],
		});
		expect(f.model.read()).toMatchObject({ items: [3], canSalvage: false });
		f.model.confirm();
		expect(f.model.question()).toBeNull();
	});
	it("preserves a draft when a proposed addition is rejected", () => {
		const f = fixture();
		f.model.add(3);
		f.reply();
		f.model.add(4);
		f.reply({ kind: "rejected", reason: "Item is now retained." });
		expect(f.model.read()?.items).toEqual([3]);
	});
	it("reviews and submits all materials in a mixed queue", () => {
		const f = fixture();
		f.records[3] = source(4, "Oak");
		f.replace();
		f.model.add(3);
		f.reply();
		expect(f.model.acceptsDrop(4)).toBe(true);
		f.model.add(4);
		expect(f.request().items).toEqual([3, 4]);
		const evaluation = {
			...f.ready(),
			bags: [
				{ materialType: "Steel", units: 42, workmanship: 7 },
				{ materialType: "Oak", units: 20, workmanship: 6 },
			],
		};
		f.reply(evaluation);
		expect(f.model.read()).toMatchObject({
			items: [3, 4],
			canSalvage: true,
			evaluation,
		});
		f.confirm();
		expect(f.submit).toHaveBeenCalledWith(
			expect.objectContaining({ review: evaluation.review }),
		);
		expect(f.notice).not.toHaveBeenCalled();
	});

	it("invalidates approval on changed quantities but not unrelated descriptions", () => {
		const f = fixture();
		f.model.add(3);
		f.reply();
		f.model.confirm();
		expect(f.model.question()).not.toBeNull();
		f.records[2] = { ...source(3), canOfferTrade: true };
		f.replace();
		f.model.read();
		expect(f.model.question()).not.toBeNull();
		const changed = source(3);
		if (changed.salvage.kind !== "ready")
			throw new Error("Expected ready source.");
		changed.salvage.source.input.stackSize++;
		f.records[2] = changed;
		f.replace();
		f.model.read();
		expect(f.model.question()).toBeNull();
		expect(f.model.read()?.pending).toBe(true);
		expect(f.submit).not.toHaveBeenCalled();
	});
	it("enqueue acceptance does not clear a submitted draft; dispatched does", () => {
		const f = fixture();
		f.model.add(3);
		f.reply();
		f.confirm();
		const request = f.submit.mock.calls[0]?.[0];
		if (request === undefined) throw new Error("Expected submit.");
		expect(f.model.read()?.items).toEqual([3]);
		expect(f.model.read()?.locked).toBe(true);
		f.emit({
			type: "salvage-result",
			result: { sequence: request.sequence, outcome: { kind: "dispatched" } },
		});
		expect(f.model.read()?.items).toEqual([]);
		expect(f.submit).toHaveBeenCalledOnce();
	});
	it("busy rejection retains the reviewed draft and permits a deliberate retry", () => {
		const f = fixture();
		f.model.add(3);
		f.reply();
		f.confirm();
		const request = f.submit.mock.calls[0]?.[0];
		if (request === undefined) throw new Error("Expected submit.");
		f.emit({
			type: "salvage-result",
			result: {
				sequence: request.sequence,
				outcome: { kind: "rejected", reason: "Your character is busy." },
			},
		});
		expect(f.model.read()).toMatchObject({ items: [3], canSalvage: true });
		expect(f.submit).toHaveBeenCalledOnce();
	});
	it("ignores retired opening and dispatch results after explicit closure", () => {
		const f = fixture();
		f.model.add(3);
		const old = { sequence: f.request().sequence, evaluation: f.ready() };
		f.model.close();
		f.emit({ type: "salvage-preview", result: old });
		expect(f.model.visible).toBe(false);
		f.model.add(4);
		f.reply();
		f.confirm();
		const submitted = f.submit.mock.calls[0]?.[0];
		if (submitted === undefined) throw new Error("Expected submit.");
		f.model.close();
		f.model.add(3);
		f.reply();
		f.emit({
			type: "salvage-result",
			result: { sequence: submitted.sequence, outcome: { kind: "dispatched" } },
		});
		expect(f.model.read()?.items).toEqual([3]);
	});
	it("resync and portal entry retire ephemeral drafts and confirmations", () => {
		const f = fixture();
		f.model.add(3);
		f.reply();
		f.model.confirm();
		f.emit({ type: "resyncing" });
		expect(f.model.question()).toBeNull();
		expect(f.model.visible).toBe(false);
		f.model.add(4);
		f.reply();
		f.emit({
			type: "lifecycle",
			lifecycle: {
				kind: "portal-space",
				worldGeneration: 1,
				cause: "teleport",
			},
		});
		expect(f.model.visible).toBe(false);
	});
	it("removal and Clear re-evaluate the retained ordered queue", () => {
		const f = fixture();
		f.model.add(3);
		f.reply();
		f.model.add(4);
		f.reply();
		f.model.remove(3);
		expect(f.request().items).toEqual([4]);
		f.reply();
		expect(f.model.read()?.items).toEqual([4]);
		f.model.clear();
		expect(f.request().items).toEqual([]);
		f.reply();
		expect(f.model.read()).toMatchObject({ items: [], canSalvage: false });
	});

	it("a rejected refresh cannot leave an older successful estimate eligible for approval", () => {
		const f = fixture();
		f.model.add(3);
		f.reply();
		const changed = source(3);
		if (changed.salvage.kind !== "ready")
			throw new Error("Expected ready source.");
		changed.salvage.source.input.stackSize++;
		f.records[2] = changed;
		f.replace();
		f.model.read();
		f.reply({ kind: "rejected", reason: "Item details changed." });
		expect(f.model.read()).toMatchObject({
			items: [3],
			canSalvage: false,
			evaluation: { kind: "rejected" },
		});
		f.model.confirm();
		expect(f.model.question()).toBeNull();
	});
	it("uses ready source facts immediately without requesting appraisal", async () => {
		const f = fixture();
		f.model.add(3);
		f.reply();
		await Promise.resolve();
		expect(f.model.read()?.canSalvage).toBe(true);
		expect(f.appraise).not.toHaveBeenCalled();
	});

	it.each(["facts-first", "response-first"])(
		"automatically appraises pending sources and refreshes the full estimate (%s)",
		async (order) => {
			const f = fixture();
			f.records[2] = {
				...source(3),
				salvage: { kind: "pending-details", material: "Steel" },
			};
			f.replace();
			f.model.add(3);
			f.reply({
				kind: "pending-details",
				tool: { guid: 2, instance: 1 },
				items: [3],
			});
			await Promise.resolve();
			expect(f.appraise).toHaveBeenCalledExactlyOnceWith(3);
			for (let index = 0; index < 3; index++) f.model.read();
			expect(f.appraise).toHaveBeenCalledOnce();
			if (order === "facts-first") {
				f.records[2] = source(3);
				f.replace();
			}
			f.emit({ type: "object-inspection-result", result: appraised(3) });
			if (order === "response-first") {
				f.records[2] = source(3);
				f.replace();
			}
			f.reply();
			if (order === "response-first") f.reply(); // First preview's dependency key predates the new entity facts.
			expect(f.model.read()).toMatchObject({
				items: [3],
				canSalvage: true,
				appraisalFailures: [],
			});
			expect(f.appraise).toHaveBeenCalledOnce();
		},
	);

	it("serializes appraisal and continues past a failed item without retrying it automatically", async () => {
		const f = fixture();
		f.records[2] = {
			...source(3),
			salvage: { kind: "pending-details", material: "Steel" },
		};
		f.records[3] = {
			...source(4),
			salvage: { kind: "pending-details", material: "Oak" },
		};
		f.replace();
		f.model.add(3);
		f.model.add(4);
		f.reply({
			kind: "pending-details",
			tool: { guid: 2, instance: 1 },
			items: [3],
		});
		f.reply({
			kind: "pending-details",
			tool: { guid: 2, instance: 1 },
			items: [3, 4],
		});
		await Promise.resolve();
		expect(f.appraise.mock.calls).toEqual([[3]]);
		f.emit({
			type: "object-inspection-result",
			result: { guid: 3, outcome: { kind: "rejected" } },
		});
		await Promise.resolve();
		expect(f.appraise.mock.calls).toEqual([[3], [4]]);
		f.emit({
			type: "object-inspection-result",
			result: {
				guid: 4,
				outcome: { kind: "unavailable", reason: "Missing properties" },
			},
		});
		expect(f.model.read()).toMatchObject({
			items: [3, 4],
			canSalvage: false,
			appraisalFailures: [
				{ guid: 3, reason: "The item could not be appraised." },
				{ guid: 4, reason: "Appraisal unavailable: Missing properties" },
			],
		});
		for (let index = 0; index < 3; index++) f.model.read();
		expect(f.appraise).toHaveBeenCalledTimes(2);
		f.model.retryDetails();
		await Promise.resolve();
		expect(f.appraise.mock.calls).toEqual([[3], [4], [3]]);
		expect(f.model.read()?.appraisalFailures).toEqual([]);
	});

	it("reports transport failure and retries only after explicit intent", async () => {
		const f = fixture();
		f.appraise.mockRejectedValueOnce(new Error("offline"));
		f.records[2] = {
			...source(3),
			salvage: { kind: "pending-details", material: "Steel" },
		};
		f.replace();
		f.model.add(3);
		f.reply({
			kind: "pending-details",
			tool: { guid: 2, instance: 1 },
			items: [3],
		});
		await vi.waitFor(() =>
			expect(f.model.read()?.appraisalFailures).toEqual([
				{ guid: 3, reason: "Could not request appraisal: Error: offline" },
			]),
		);
		expect(f.appraise).toHaveBeenCalledOnce();
		f.model.retryDetails();
		await Promise.resolve();
		expect(f.appraise).toHaveBeenCalledTimes(2);
	});

	it("does not loop when a successful appraisal still leaves required facts missing", async () => {
		const f = fixture();
		f.records[2] = {
			...source(3),
			salvage: { kind: "pending-details", material: "Steel" },
		};
		f.replace();
		f.model.add(3);
		const pending = {
			kind: "pending-details",
			tool: { guid: 2, instance: 1 },
			items: [3],
		} as const;
		f.reply({ ...pending, items: [...pending.items] });
		await Promise.resolve();
		f.emit({ type: "object-inspection-result", result: appraised(3) });
		f.reply({ ...pending, items: [...pending.items] });
		expect(f.model.read()).toMatchObject({
			canSalvage: false,
			appraisalFailures: [
				{
					guid: 3,
					reason:
						"The appraisal did not provide the details needed for salvage.",
				},
			],
		});
		expect(f.appraise).toHaveBeenCalledOnce();
	});

	it.each(["remove", "clear", "close"] as const)(
		"%s retires the salvage consumer without cancelling a shared appraisal",
		async (action) => {
			const f = fixture();
			f.records[2] = {
				...source(3),
				salvage: { kind: "pending-details", material: "Steel" },
			};
			f.replace();
			f.model.add(3);
			f.reply({
				kind: "pending-details",
				tool: { guid: 2, instance: 1 },
				items: [3],
			});
			await Promise.resolve();
			const background = vi.fn();
			await f.appraisals.request(3, background).sent;
			if (action === "remove") f.model.remove(3);
			else if (action === "clear") f.model.clear();
			else f.model.close();
			if (action !== "close") f.reply();
			const previews = f.preview.mock.calls.length;
			f.emit({ type: "object-inspection-result", result: appraised(3) });
			expect(background).toHaveBeenCalledOnce();
			expect(f.preview).toHaveBeenCalledTimes(previews);
			expect(f.model.read()?.items ?? []).toEqual([]);
			expect(f.appraise).toHaveBeenCalledOnce();
		},
	);
	it("surfaces a missing-item appraisal without silently dropping the queued source", async () => {
		const f = fixture();
		f.records[2] = {
			...source(3),
			salvage: { kind: "pending-details", material: "Steel" },
		};
		f.replace();
		f.model.add(3);
		f.reply({
			kind: "pending-details",
			tool: { guid: 2, instance: 1 },
			items: [3],
		});
		await Promise.resolve();
		f.emit({
			type: "object-inspection-result",
			result: { guid: 3, outcome: { kind: "missing" } },
		});
		expect(f.model.read()).toMatchObject({
			items: [3],
			canSalvage: false,
			appraisalFailures: [
				{ guid: 3, reason: "The item is no longer available." },
			],
		});
		expect(f.appraise).toHaveBeenCalledOnce();
	});

	it.each(["resync", "portal"])(
		"%s retires automatic appraisal without later refreshes or reopening",
		async (kind) => {
			const f = fixture();
			f.records[2] = {
				...source(3),
				salvage: { kind: "pending-details", material: "Steel" },
			};
			f.replace();
			f.model.add(3);
			f.reply({
				kind: "pending-details",
				tool: { guid: 2, instance: 1 },
				items: [3],
			});
			await Promise.resolve();
			if (kind === "resync") f.emit({ type: "resyncing" });
			else
				f.emit({
					type: "lifecycle",
					lifecycle: {
						kind: "portal-space",
						worldGeneration: 1,
						cause: "teleport",
					},
				});
			const previews = f.preview.mock.calls.length;
			f.emit({ type: "object-inspection-result", result: appraised(3) });
			expect(f.model.visible).toBe(false);
			expect(f.preview).toHaveBeenCalledTimes(previews);
		},
	);
	it("suppresses confirmations for one hour without extending the deadline on later batches", () => {
		const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
		const f = fixture();
		try {
			f.model.add(3);
			f.reply();
			f.confirm(true);
			rejectSubmission(f);
			now.mockReturnValue(1_000 + LOCAL_CONFIRMATION_SUPPRESSION_MS - 1);
			f.model.confirm();
			expect(f.model.question()).toBeNull();
			expect(f.submit).toHaveBeenCalledTimes(2);
			rejectSubmission(f);
			now.mockReturnValue(1_000 + LOCAL_CONFIRMATION_SUPPRESSION_MS);
			f.model.confirm();
			expect(f.model.question()).toMatchObject({
				suppressionLabel: "Suppress confirmation for the next hour",
			});
			expect(f.submit).toHaveBeenCalledTimes(2);
		} finally {
			now.mockRestore();
			f.model.destroy();
		}
	});

	it("cancelled or retired confirmation answers cannot enable suppression", () => {
		const f = fixture();
		f.model.add(3);
		f.reply();
		f.model.confirm();
		const question = f.model.question();
		if (question === null) throw new Error("Expected confirmation.");
		f.model.respond(question.requestId, false, true);
		f.model.respond(question.requestId, true, true);
		f.model.confirm();
		expect(f.model.question()).not.toBeNull();
		expect(f.submit).not.toHaveBeenCalled();
	});

	it("keeps suppression across window closure, resync, and portals but clears it on logout", () => {
		const f = fixture();
		f.model.add(3);
		f.reply();
		f.confirm(true);
		rejectSubmission(f);
		f.model.close();
		f.model.add(4);
		f.reply();
		f.model.confirm();
		expect(f.model.question()).toBeNull();
		expect(f.submit).toHaveBeenCalledTimes(2);
		rejectSubmission(f);
		f.emit({ type: "resyncing" });
		f.emit({
			type: "lifecycle",
			lifecycle: {
				kind: "portal-space",
				worldGeneration: 2,
				cause: "teleport",
			},
		});
		f.model.add(3);
		f.reply();
		f.model.confirm();
		expect(f.model.question()).toBeNull();
		expect(f.submit).toHaveBeenCalledTimes(3);
		rejectSubmission(f);
		f.emit({
			type: "lifecycle",
			lifecycle: { kind: "character-selection", maxSlots: 11, characters: [] },
		});
		f.model.add(4);
		f.reply();
		f.model.confirm();
		expect(f.model.question()).not.toBeNull();
		expect(f.submit).toHaveBeenCalledTimes(3);
	});

	it("suppression still requires a current complete batch review", () => {
		const f = fixture();
		f.model.add(3);
		f.reply();
		f.confirm(true);
		rejectSubmission(f);
		f.records[2] = {
			...source(3),
			salvage: { kind: "pending-details", material: "Steel" },
		};
		f.replace();
		f.model.confirm();
		expect(f.model.read()?.canSalvage).toBe(false);
		expect(f.submit).toHaveBeenCalledOnce();
	});
	it("drag-out removes only the captured accepted draft entry", () => {
		const f = fixture();
		f.model.add(3);
		f.reply();
		const remove = f.model.captureRemoval(3);
		if (remove === null) throw new Error("Expected queued-item removal.");
		remove();
		expect(f.request().items).toEqual([]);
		f.reply();
		expect(f.model.read()?.items).toEqual([]);
		expect(f.submit).not.toHaveBeenCalled();
	});

	it("a retired drag cannot remove the same GUID from a replacement queue", () => {
		const f = fixture();
		f.model.add(3);
		f.reply();
		const remove = f.model.captureRemoval(3);
		if (remove === null) throw new Error("Expected queued-item removal.");
		f.model.close();
		f.model.add(3);
		f.reply();
		const previews = f.preview.mock.calls.length;
		remove();
		expect(f.model.read()?.items).toEqual([3]);
		expect(f.preview).toHaveBeenCalledTimes(previews);
	});

	it("cannot start queue removal for absent items or while confirming", () => {
		const f = fixture();
		expect(f.model.captureRemoval(3)).toBeNull();
		f.model.add(3);
		f.reply();
		expect(f.model.captureRemoval(4)).toBeNull();
		f.model.confirm();
		expect(f.model.captureRemoval(3)).toBeNull();
	});
});
