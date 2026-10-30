import { allocateItemUseOperation } from "./client-item-use-sequence";
import { ClientEntitySelection } from "./client-entity-selection";
import { ClientAppraisalRequests } from "./client-appraisal-requests";
import inspectionWire from "./fixtures/object-inspection-wire.json";
import { decodeObjectInspectionResult } from "./client-object-inspection-contract";
import type { CharacterSheet } from "./client-character-sheet-contract";
import { describe, expect, it, vi } from "vitest";
import { ClientLocksState } from "./client-locks-state";
import {
	ClientEntityMirror,
	type ClientEntityFacts,
} from "./client-entity-mirror";
import {
	entityFacts,
	playerEntitySnapshot,
} from "./client-entity-mirror.test-support";
import type { ClientLifecycleSessionEvent } from "./client-lifecycle-session";
import { KeyboardInputPolicy } from "../lib/input/keyboard-input-policy";
import { ViewportInputGate } from "../lib/input/viewport-input-gate";

function tool(
	guid: number,
	wcid: number | null,
	bonus?: number | null,
): ClientEntityFacts {
	const item = entityFacts(guid, {
		ownedByPlayer: true,
		location: {
			kind: "contained",
			parentGuid: 1,
			slot: { kind: "item", index: guid },
		},
		lockTool:
			bonus === undefined ? { kind: "key" } : { kind: "lockpick", bonus },
	});
	if (item.description.kind !== "known")
		throw new Error("Known fixture required");
	return {
		...item,
		description: {
			...item.description,
			name: `Tool ${guid}`,
			wcid,
			useCapability: "targeted",
			structure: { current: 5, max: 5 },
		},
	};
}
/** Named locked subjects keep selection-driven titles grounded in mirror facts. */
function lockedTarget(guid: number, name: string): ClientEntityFacts {
	const entity = entityFacts(guid, { isLocked: true });
	if (entity.description.kind !== "known")
		throw new Error("Known target required");
	return { ...entity, description: { ...entity.description, name } };
}
function withUses(
	item: ClientEntityFacts,
	uses: number | null,
): ClientEntityFacts {
	if (item.description.kind !== "known")
		throw new Error("Known tool fixture required");
	return {
		...item,
		description: { ...item.description, structure: { current: uses, max: 5 } },
	};
}

function fixture(
	tools: ClientEntityFacts[] = [tool(2, 12), tool(3, 12), tool(4, 14)],
) {
	const entities = new ClientEntityMirror();
	let records = [
		...playerEntitySnapshot(1).entities,
		lockedTarget(9, "Chest"),
		...tools,
	];
	const listeners = new Set<(event: ClientLifecycleSessionEvent) => void>();
	const examine = vi
		.fn<(guid: number) => Promise<void>>()
		.mockResolvedValue(undefined);
	const appraisals = new ClientAppraisalRequests(examine);
	const emit = (event: ClientLifecycleSessionEvent) => {
		appraisals.receive(event);
		for (const receive of listeners) receive(event);
	};
	const snapshot = () =>
		entities.commit(
			entities.prepareSnapshot(
				{ ...playerEntitySnapshot(1), entities: records },
				1,
			),
		);
	snapshot();
	const submitItemUse = vi
		.fn<ConstructorParameters<typeof ClientLocksState>[0]["submitItemUse"]>()
		.mockResolvedValue(undefined);
	const queryItemUseTarget = vi
		.fn<
			ConstructorParameters<typeof ClientLocksState>[0]["queryItemUseTarget"]
		>()
		.mockResolvedValue(undefined);
	const keyboard = new KeyboardInputPolicy(new ViewportInputGate());
	const menu = vi.fn();
	keyboard.bindGame({ keydown: menu, keyup: () => {}, cancel: () => {} });
	const closeWindow = vi.fn();
	keyboard.bindEscapeContext(closeWindow);
	let training: CharacterSheet["skills"][number]["stat"]["training"] | null =
		"Trained";
	const notice = vi.fn();
	const chat = vi.fn();
	let autoUseKeys = false;
	let enabled = true;
	const selection = new ClientEntitySelection({
		lifecycle: {
			entities,
			subscribe: (receive) => {
				listeners.add(receive);
				return () => listeners.delete(receive);
			},
		},
		presentation: () => null,
	});
	selection.select(9);
	const model = new ClientLocksState(
		{
			entities,
			appraisals,
			characterSheet: {
				read: () => ({
					sheet:
						training === null
							? null
							: {
									character: 1,
									skills: [{ stat: { skill_type: "Lockpick", training } }],
								},
				}),
			},
			state: () => ({ playerGuid: 1 }),
			subscribe: (receive) => {
				listeners.add(receive);
				return () => listeners.delete(receive);
			},
			submitItemUse,
			queryItemUseTarget,
		},
		keyboard,
		vi.fn(),
		notice,
		() => ({ enabled, autoUseKeys }),
		chat,
		selection,
	);
	let openingSequence = allocateItemUseOperation();
	const open = (finishOpening = true) => {
		openingSequence = allocateItemUseOperation();
		emit({
			type: "locked-target",
			target: { target: 9, name: "Chest", sequence: openingSequence },
		});
		if (finishOpening)
			emit({
				type: "item-use-finished",
				result: {
					sequence: openingSequence,
					outcome: { kind: "completed", error: "None", message: "" },
				},
			});
	};
	const currentQuery = () => {
		const query = queryItemUseTarget.mock.calls.at(-1)?.[0];
		if (query === undefined) throw new Error("Expected compatibility query");
		return query;
	};
	const accept = (eligible = true) =>
		emit({
			type: "item-use-target-result",
			result: {
				sequence: currentQuery().sequence,
				eligible,
				lockpickSuccessPercent: null,
			},
		});
	const finish = (error: string) => {
		const request = submitItemUse.mock.calls.at(-1)?.[0];
		if (request === undefined) throw new Error("Expected submitted use");
		emit({
			type: "item-use-finished",
			result: {
				sequence: request.sequence,
				outcome: { kind: "completed", error, message: `Result: ${error}` },
			},
		});
	};

	const update = (
		change: (records: ClientEntityFacts[]) => ClientEntityFacts[],
	) => {
		records = change(records);
		snapshot();
		emit({ type: "entities" });
	};
	const escape = () =>
		keyboard.keydown(
			Object.assign(new Event("keydown", { cancelable: true }), {
				key: "Escape",
				code: "Escape",
				repeat: false,
				isComposing: false,
			}) as KeyboardEvent,
		);
	return {
		model,
		selection,
		setEnabled: (value: boolean) => {
			enabled = value;
			if (!value) model.close();
		},
		setAutoUseKeys: (value: boolean) => {
			autoUseKeys = value;
		},
		examine,
		notice,
		chat,
		setTraining: (value: typeof training) => {
			training = value;
			emit({ type: "character-sheet" });
		},
		emit,
		open,
		openingSequence: () => openingSequence,
		accept,
		finish,
		update,
		submitItemUse,
		queryItemUseTarget,
		currentQuery,
		keyboard,
		escape,
		closeWindow,
		menu,
	};
}

describe("compact Locks workflow", () => {
	it("waits for the exact opening receipt before starting automatic keys", () => {
		const f = fixture();
		f.setAutoUseKeys(true);
		f.open(false);
		expect(f.model.visible).toBe(false);
		expect(f.model.read().pending).toBe(true);
		expect(f.queryItemUseTarget).not.toHaveBeenCalled();
		f.emit({
			type: "item-use-finished",
			result: {
				sequence: allocateItemUseOperation(),
				outcome: { kind: "completed", error: "None", message: "" },
			},
		});
		expect(f.queryItemUseTarget).not.toHaveBeenCalled();
		f.emit({
			type: "item-use-finished",
			result: {
				sequence: f.openingSequence(),
				outcome: { kind: "completed", error: "None", message: "" },
			},
		});
		expect(f.queryItemUseTarget).toHaveBeenCalledOnce();
		f.accept();
		expect(f.submitItemUse).toHaveBeenCalledOnce();
		f.model.destroy();
	});
	it.each([
		"escape",
		"movement",
		"selection",
		"disabled",
		"timeout",
		"abort",
		"error",
		"removed",
	] as const)("does not resume or open fallback after opening %s", (reason) => {
		const f = fixture([tool(2, 12), tool(5, 15, 20)]);
		f.setAutoUseKeys(true);
		f.open(false);
		const sequence = f.openingSequence();
		switch (reason) {
			case "escape":
				f.escape();
				break;
			case "movement":
				f.model.cancel();
				break;
			case "selection":
				f.selection.select(null);
				break;
			case "disabled":
				f.setEnabled(false);
				break;
			case "removed":
				f.update((rows) => rows.filter((row) => row.guid !== 9));
				break;
			case "timeout":
			case "abort":
				f.emit({
					type: "item-use-finished",
					result: {
						sequence,
						outcome: { kind: reason === "timeout" ? "timed-out" : "aborted" },
					},
				});
				break;
			case "error":
				f.emit({
					type: "item-use-finished",
					result: {
						sequence,
						outcome: {
							kind: "completed",
							error: "LockUsedTooRecently",
							message: "Denied",
						},
					},
				});
				break;
		}
		// A repeat of the original broadcast cannot revive the cancelled workflow.
		f.emit({
			type: "locked-target",
			target: { target: 9, name: "Chest", sequence },
		});
		f.emit({
			type: "item-use-finished",
			result: {
				sequence,
				outcome: { kind: "completed", error: "None", message: "" },
			},
		});
		expect(f.queryItemUseTarget).not.toHaveBeenCalled();
		expect(f.submitItemUse).not.toHaveBeenCalled();
		expect(f.model.visible).toBe(false);
		expect(f.model.read().pending).toBe(false);
		f.model.destroy();
	});
	it("disables manual actions until the opening use finishes", () => {
		const f = fixture([tool(2, 12), tool(5, 15, 20)]);
		f.open(false);
		expect(f.model.visible).toBe(true);
		expect(f.model.read().pending).toBe(true);
		f.model.attemptAll();
		f.model.lockpick();
		expect(f.submitItemUse).not.toHaveBeenCalled();
		f.emit({
			type: "item-use-finished",
			result: {
				sequence: f.openingSequence(),
				outcome: { kind: "completed", error: "None", message: "" },
			},
		});
		expect(f.model.read().pending).toBe(false);
		f.model.attemptAll();
		f.accept();
		expect(f.submitItemUse).toHaveBeenCalledOnce();
		f.model.destroy();
	});

	it("retains the cancelled opening receipt while retargeting manual controls", () => {
		const f = fixture([tool(2, 12), tool(5, 15, 20)]);
		f.update((rows) => [...rows, lockedTarget(10, "Door")]);
		f.open(false);
		f.model.cancel();
		f.selection.select(10);
		expect(f.model.visible).toBe(true);
		expect(f.model.windowTitle).toBe("Unlock Door");
		expect(f.model.read().pending).toBe(true);
		const queries = f.queryItemUseTarget.mock.calls.length;
		f.model.attemptAll();
		f.model.lockpick();
		expect(f.queryItemUseTarget).toHaveBeenCalledTimes(queries);
		expect(f.submitItemUse).not.toHaveBeenCalled();
		f.emit({
			type: "item-use-finished",
			result: {
				sequence: f.openingSequence(),
				outcome: { kind: "completed", error: "None", message: "" },
			},
		});
		expect(f.model.read().pending).toBe(false);
		expect(f.submitItemUse).not.toHaveBeenCalled();
		f.model.lockpick();
		f.accept();
		expect(f.submitItemUse.mock.lastCall?.[0].intent).toEqual({
			kind: "targeted",
			source: 5,
			target: 10,
		});
		f.model.destroy();
	});
	it("refreshes the preferred-pick estimate during the original manual use", () => {
		const f = fixture([tool(5, 15, 20)]);
		f.open(false);
		expect(f.currentQuery().source).toBe(5);
		f.update((rows) => [
			...rows.filter((row) => row.guid !== 5),
			tool(6, 16, 30),
		]);
		expect(f.model.read().pending).toBe(true);
		expect(f.currentQuery().source).toBe(6);
		f.model.destroy();
	});
	it.each([false, true])(
		"disabled helper ignores locked feedback with automatic keys %s",
		(automatic) => {
			const f = fixture([tool(2, 12), tool(5, 15, 20)]);
			f.setAutoUseKeys(automatic);
			f.setEnabled(false);
			f.open();
			expect(f.model.visible).toBe(false);
			expect(f.queryItemUseTarget).not.toHaveBeenCalled();
			expect(f.examine).not.toHaveBeenCalled();
			f.model.attemptAll();
			f.model.lockpick();
			expect(f.submitItemUse).not.toHaveBeenCalled();
			f.model.destroy();
		},
	);
	it.each(["checking", "submitted"] as const)(
		"disabling during %s stops keys, preserves receipts, and does not resume on enable",
		(phase) => {
			const f = fixture([tool(2, 12), tool(4, 14), tool(5, 15, 20)]);
			f.setAutoUseKeys(true);
			f.open();
			if (phase === "submitted") f.accept();
			f.setEnabled(false);
			if (phase === "checking") f.accept();
			else f.finish("KeyDoesntFitThisLock");
			expect(f.model.visible).toBe(false);
			expect(f.model.read().pending).toBe(false);
			expect(f.submitItemUse).toHaveBeenCalledTimes(
				phase === "submitted" ? 1 : 0,
			);
			const before = f.queryItemUseTarget.mock.calls.length;
			f.setEnabled(true);
			expect(f.queryItemUseTarget).toHaveBeenCalledTimes(before);
			f.open();
			expect(f.queryItemUseTarget).toHaveBeenCalledTimes(before + 1);
			f.model.destroy();
		},
	);

	it("retargets visible controls and cancels the old key sequence without redirecting its receipt", () => {
		const f = fixture([tool(2, 12), tool(4, 14), tool(5, 15, 20)]);
		f.update((rows) => [...rows, lockedTarget(10, "Door")]);
		f.open();
		f.model.attemptAll();
		f.accept();
		f.selection.select(10);
		expect(f.model.visible).toBe(true);
		expect(f.model.windowTitle).toBe("Unlock Door");
		expect(f.model.read().pending).toBe(true);
		f.finish("KeyDoesntFitThisLock");
		expect(f.submitItemUse).toHaveBeenCalledTimes(1);
		expect(f.model.read().pending).toBe(false);
		f.model.lockpick();
		f.accept();
		expect(f.submitItemUse.mock.lastCall?.[0].intent).toEqual({
			kind: "targeted",
			source: 5,
			target: 10,
		});
		f.model.destroy();
	});
	it.each([null, 1, 2])(
		"closes on ineligible selection %s and rejects an old compatibility reply",
		(guid) => {
			const f = fixture();
			f.open();
			f.model.attemptAll();
			const query = f.currentQuery();
			f.selection.select(guid);
			f.emit({
				type: "item-use-target-result",
				result: { ...query, eligible: true, lockpickSuccessPercent: null },
			});
			expect(f.model.visible).toBe(false);
			expect(f.model.read().pending).toBe(false);
			expect(f.submitItemUse).not.toHaveBeenCalled();
			f.model.destroy();
		},
	);
	it("selection changes stop hidden automation and ignore locked feedback for its old subject", () => {
		const f = fixture([tool(2, 12), tool(4, 14), tool(5, 15, 20)]);
		f.update((rows) => [...rows, lockedTarget(10, "Door")]);
		f.setAutoUseKeys(true);
		f.open();
		f.accept();
		const before = f.queryItemUseTarget.mock.calls.length;
		f.selection.select(10);
		f.open(); // Delayed feedback still names the old chest.
		f.finish("KeyDoesntFitThisLock");
		expect(f.model.visible).toBe(false);
		expect(f.model.read().pending).toBe(false);
		expect(f.queryItemUseTarget).toHaveBeenCalledTimes(before);
		expect(f.submitItemUse).toHaveBeenCalledTimes(1);
		f.model.destroy();
	});
	it("keeps late unlock attribution on the submitted target after selection changes", () => {
		const f = fixture();
		f.setAutoUseKeys(true);
		f.open();
		f.accept();
		f.selection.select(null);
		f.update((rows) =>
			rows.map((row) => (row.guid === 9 ? { ...row, isLocked: false } : row)),
		);
		f.finish("None");
		expect(f.chat).toHaveBeenCalledExactlyOnceWith(
			"Used Tool 2 to unlock Chest.",
		);
		expect(f.model.visible).toBe(false);
		expect(f.submitItemUse).toHaveBeenCalledTimes(1);
		f.model.destroy();
	});
	it("reselecting the same subject preserves an active sequence", () => {
		const f = fixture();
		f.open();
		f.model.attemptAll();
		f.accept();
		f.selection.select(9);
		f.finish("KeyDoesntFitThisLock");
		f.accept();
		expect(f.submitItemUse).toHaveBeenCalledTimes(2);
		f.model.destroy();
	});

	it("offers distinct keys and the highest-bonus least-used pick without a selection step", async () => {
		const f = fixture([
			tool(2, 12),
			tool(3, 12),
			tool(4, 14),
			withUses(tool(5, 15, 10), 1),
			withUses(tool(6, 16, 20), 4),
			withUses(tool(7, 17, 20), 1),
		]);
		f.open();
		expect(f.model.read()).toMatchObject({
			keyCount: 2,
			showKeys: true,
			preferredPick: { item: { guid: 7 }, successPercent: null },
		});
		expect(f.model.windowTitle).toBe("Unlock Chest");
		expect(f.currentQuery().source).toBe(7);
		expect(f.submitItemUse).not.toHaveBeenCalled();
		await Promise.resolve();
		expect(f.examine).toHaveBeenCalledExactlyOnceWith(9);
		f.model.lockpick();
		f.accept();
		expect(f.submitItemUse.mock.calls.at(-1)?.[0].intent).toEqual({
			kind: "targeted",
			source: 7,
			target: 9,
		});
		f.finish("None");
		expect(f.model.visible).toBe(true);
		expect(f.submitItemUse).toHaveBeenCalledOnce();
		f.model.destroy();
	});
	it("ranks unknown pick bonuses as zero and unknown uses after known ties", () => {
		const f = fixture([
			tool(2, 12, -10),
			withUses(tool(3, 13, null), null),
			withUses(tool(4, 14, 0), 1),
		]);
		f.open();
		expect(f.model.read().preferredPick?.item.guid).toBe(4);
		f.update((rows) => rows.filter((row) => row.guid !== 4));
		expect(f.model.read().preferredPick?.item.guid).toBe(3);
		f.model.destroy();
	});
	it("replaces a consumed preferred pick, refreshes chances, and ignores stale estimates", () => {
		const f = fixture([tool(2, 12, 20), tool(3, 13, 10)]);
		f.open();
		const first = f.currentQuery();
		f.emit({
			type: "item-use-target-result",
			result: {
				sequence: first.sequence,
				eligible: true,
				lockpickSuccessPercent: 75,
			},
		});
		expect(f.model.read().preferredPick?.successPercent).toBe(75);
		f.update((rows) => rows.filter((row) => row.guid !== 2));
		const next = f.currentQuery();
		expect(next.source).toBe(3);
		f.emit({
			type: "item-use-target-result",
			result: {
				sequence: first.sequence,
				eligible: true,
				lockpickSuccessPercent: 99,
			},
		});
		expect(f.model.read().preferredPick?.successPercent).toBeNull();
		f.emit({
			type: "item-use-target-result",
			result: {
				sequence: next.sequence,
				eligible: true,
				lockpickSuccessPercent: 40,
			},
		});
		expect(f.model.read().preferredPick?.successPercent).toBe(40);
		f.setTraining("Specialized");
		expect(f.currentQuery().sequence).not.toBe(next.sequence);
		f.model.close();
		f.model.destroy();
	});
	it("refreshes preferred estimates after target appraisal without reopening Examine", () => {
		const f = fixture([tool(2, 12, 20)]);
		f.open();
		const first = f.currentQuery();
		f.emit({
			type: "object-inspection-result",
			result: { ...decodeObjectInspectionResult(inspectionWire.item), guid: 9 },
		});
		expect(f.currentQuery().sequence).not.toBe(first.sequence);
		expect(f.submitItemUse).not.toHaveBeenCalled();
		f.model.destroy();
	});
	it("tries lower remaining uses first across key groups and duplicate copies", () => {
		const f = fixture([
			withUses(tool(2, 12), 4),
			withUses(tool(3, 12), 2),
			withUses(tool(4, 14), 1),
			withUses(tool(6, 16), null),
		]);
		f.open();
		f.model.attemptAll();
		expect(f.currentQuery().source).toBe(4);
		f.accept();
		f.finish("KeyDoesntFitThisLock");
		expect(f.currentQuery().source).toBe(3);
		f.accept();
		f.finish("KeyDoesntFitThisLock");
		expect(f.currentQuery().source).toBe(6);
		f.model.destroy();
	});
	it("checks another duplicate only when its lower-use instance is incompatible", () => {
		const f = fixture([
			withUses(tool(2, 12), 1),
			withUses(tool(3, 12), 2),
			tool(4, 14),
		]);
		f.open();
		f.model.attemptAll();
		expect(f.currentQuery().source).toBe(2);
		f.accept(false);
		expect(f.currentQuery().source).toBe(3);
		f.accept();
		f.finish("KeyDoesntFitThisLock");
		expect(f.currentQuery().source).toBe(4);
		f.model.destroy();
	});
	it("keeps automatic keys hidden and shows only the preferred pick after exhaustion", async () => {
		const f = fixture([tool(2, 12), tool(3, 12), tool(4, 14), tool(5, 15, 20)]);
		f.setAutoUseKeys(true);
		f.open();
		expect(f.model.visible).toBe(false);
		f.open();
		expect(f.queryItemUseTarget).toHaveBeenCalledOnce();
		f.accept();
		f.finish("KeyDoesntFitThisLock");
		expect(f.currentQuery().source).toBe(4);
		f.accept();
		f.finish("KeyDoesntFitThisLock");
		expect(f.model.visible).toBe(true);
		expect(f.model.read()).toMatchObject({
			showKeys: false,
			preferredPick: { item: { guid: 5 } },
		});
		expect(f.submitItemUse).toHaveBeenCalledTimes(2);
		await Promise.resolve();
		expect(f.examine).toHaveBeenCalledExactlyOnceWith(9);
		f.model.destroy();
	});
	it.each(["before-receipt", "after-receipt", "after-cancellation"] as const)(
		"reports a consumed automatic key once when unlock arrives %s",
		(order) => {
			const f = fixture([tool(2, 12), tool(5, 15, 20)]);
			f.setAutoUseKeys(true);
			f.open();
			f.accept();
			if (order === "after-receipt") f.finish("None");
			if (order === "after-cancellation") f.escape();
			f.update((rows) =>
				rows
					.filter((row) => row.guid !== 2)
					.map((row) => (row.guid === 9 ? { ...row, isLocked: false } : row)),
			);
			if (order !== "after-receipt") f.finish("None");
			f.update((rows) => rows);
			expect(f.chat).toHaveBeenCalledExactlyOnceWith(
				"Used Tool 2 to unlock Chest.",
			);
			expect(f.notice).toHaveBeenLastCalledWith("Chest unlocked.", "status");
			expect(f.model.visible).toBe(false);
			f.model.destroy();
		},
	);
	it.each([
		"escape",
		"movement",
		"dismissal",
		"timeout",
		"abort",
		"busy",
		"target-removed",
		"inventory-changed",
	] as const)(
		"does not open fallback or continue after automatic %s",
		(interruption) => {
			const f = fixture([tool(2, 12), tool(4, 14), tool(5, 15, 20)]);
			f.setAutoUseKeys(true);
			f.open();
			f.accept();
			const sequence = f.currentQuery().sequence;
			switch (interruption) {
				case "escape":
					f.escape();
					break;
				case "movement":
					f.model.cancel();
					break;
				case "dismissal":
					f.model.close();
					break;
				case "timeout":
				case "abort":
					f.emit({
						type: "item-use-finished",
						result: {
							sequence,
							outcome: {
								kind: interruption === "timeout" ? "timed-out" : "aborted",
							},
						},
					});
					break;
				case "busy":
					f.emit({
						type: "item-use-result",
						result: { sequence, outcome: { kind: "rejected", reason: "Busy" } },
					});
					break;
				case "target-removed":
					f.update((rows) => rows.filter((row) => row.guid !== 9));
					break;
				case "inventory-changed":
					f.update((rows) => rows.filter((row) => row.guid !== 4));
					break;
			}
			f.finish("KeyDoesntFitThisLock");
			expect(f.model.visible).toBe(false);
			expect(f.chat).not.toHaveBeenCalled();
			expect(f.queryItemUseTarget).toHaveBeenCalledOnce();
			f.model.destroy();
		},
	);
	it("cancels a manual key sequence before window dismissal through the Escape stack", () => {
		const f = fixture();
		f.open();
		f.model.attemptAll();
		f.accept();
		f.escape();
		f.finish("KeyDoesntFitThisLock");
		expect(f.model.visible).toBe(true);
		expect(f.queryItemUseTarget).toHaveBeenCalledOnce();
		f.escape();
		expect(f.closeWindow).toHaveBeenCalledOnce();
		f.model.destroy();
	});
	it("does not execute a cancelled compatibility query or queue automatic incompatibilities", () => {
		for (const cancel of [true, false]) {
			const f = fixture([tool(2, 12), tool(5, 15, 20)]);
			f.setAutoUseKeys(true);
			f.open();
			if (cancel) f.escape();
			f.accept(cancel);
			expect(f.model.visible).toBe(false);
			expect(f.submitItemUse).not.toHaveBeenCalled();
			f.model.destroy();
		}
	});
	it("retains the new subject when an older cancelled automatic attempt unlocks its own target", () => {
		const f = fixture([tool(2, 12)]);
		f.setAutoUseKeys(true);
		f.open();
		f.accept();
		f.update((rows) => [...rows, lockedTarget(10, "Door")]);
		f.setAutoUseKeys(false);
		f.selection.select(10);
		// Core retires the old use before admitting another direct interaction. Unlock facts
		// may arrive later, so their attribution still needs the old captured subject.
		f.finish("None");
		f.emit({
			type: "locked-target",
			target: {
				target: 10,
				name: "Door",
				sequence: allocateItemUseOperation(),
			},
		});
		f.update((rows) =>
			rows.map((row) => (row.guid === 9 ? { ...row, isLocked: false } : row)),
		);
		expect(f.model.visible).toBe(true);
		expect(f.model.windowTitle).toBe("Unlock Door");
		expect(f.chat).toHaveBeenCalledExactlyOnceWith(
			"Used Tool 2 to unlock Chest.",
		);
		f.model.destroy();
	});
	it("waits for an explicit unlock and keeps manual lockpick success out of automatic-key chat", () => {
		const f = fixture([tool(2, 12, 20)]);
		f.open();
		f.model.lockpick();
		f.accept();
		f.finish("None");
		expect(f.model.visible).toBe(true);
		expect(f.notice).not.toHaveBeenCalledWith("Chest unlocked.", "status");
		f.update((rows) =>
			rows.map((row) => (row.guid === 9 ? { ...row, isLocked: false } : row)),
		);
		expect(f.model.visible).toBe(false);
		expect(f.chat).not.toHaveBeenCalled();
		f.model.destroy();
	});
	it.each([null, "Untrained", "Trained", "Specialized"] as const)(
		"gates the pick action on %s training",
		(training) => {
			const f = fixture([tool(2, 12, 20)]);
			f.setTraining(training);
			f.open();
			expect(f.model.visible).toBe(
				training === "Trained" || training === "Specialized",
			);
			f.model.destroy();
		},
	);
	it("suppresses unusable tools and empty windows in either preference mode", () => {
		for (const automatic of [true, false]) {
			const f = fixture([
				withUses(tool(2, 12), 0),
				{ ...tool(3, 13), ownedByPlayer: false },
				{ ...tool(4, 14), description: { kind: "pending" } },
			]);
			f.setAutoUseKeys(automatic);
			f.open();
			expect(f.model.visible).toBe(false);
			f.model.destroy();
		}
	});
	it("resets lifecycle ownership and ignores late replies", () => {
		const f = fixture();
		f.setAutoUseKeys(true);
		f.open();
		const query = f.currentQuery();
		f.emit({ type: "resyncing" });
		f.emit({
			type: "item-use-target-result",
			result: {
				sequence: query.sequence,
				eligible: true,
				lockpickSuccessPercent: null,
			},
		});
		expect(f.model.visible).toBe(false);
		expect(f.submitItemUse).not.toHaveBeenCalled();
		f.model.destroy();
	});
	it("stops hidden automatic work on a query send failure", async () => {
		const f = fixture([tool(2, 12), tool(5, 15, 20)]);
		f.queryItemUseTarget.mockRejectedValueOnce(new Error("Transport stopped"));
		f.setAutoUseKeys(true);
		f.open();
		await Promise.resolve();
		expect(f.model.visible).toBe(false);
		expect(f.notice).toHaveBeenLastCalledWith(
			"Error: Transport stopped",
			"status",
		);
		f.model.destroy();
	});
});
