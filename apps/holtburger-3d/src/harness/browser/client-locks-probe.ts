import { allocateItemUseOperation } from "../../client/client-item-use-sequence";
import type { ClientEntitySelection } from "../../client/client-entity-selection";
import { SHOWCASE_CHARACTER_SHEET } from "./ui-showcase-fixture";
import type { CharacterSheet } from "../../client/client-character-sheet-contract";
import type { ClientToast } from "../../client/client-toast-center";
import { inventoryFixtureItem } from "./client-inventory-probe";
import type { ClientLocksState } from "../../client/client-locks-state";
import {
	itemUseRequestSchema,
	itemUseTargetQuerySchema,
} from "../../client/client-item-use-contract";
import { CLIENT_TUNING } from "../../client/client-tuning";

/** Synthetic server replies exercise the real session, window, rows, and keyboard routing. */
export async function probeClientLocks(options: {
	readonly model: ClientLocksState;
	readonly selection: ClientEntitySelection;
	readonly setAutomaticKeys: (enabled: boolean) => void;
	readonly emit: (event: string, payload: unknown) => void;
	readonly bindMovement: () => () => void;
	readonly readToast: () => ClientToast | null;
	readonly commands: readonly {
		readonly command: string;
		readonly args: Record<string, unknown> | undefined;
	}[];
}) {
	const { model, emit, commands } = options;
	const checks: string[] = [];
	const target = 8609;
	const skillSheet = (training: "Untrained" | "Trained"): CharacterSheet => ({
		...SHOWCASE_CHARACTER_SHEET,
		skills: [
			{
				stat: {
					skill_type: "Lockpick",
					ranks: 0,
					init: 10,
					spent_xp: 0,
					next_rank_xp: null,
					base: 10,
					current: 10,
					training,
					trained_cost: 0,
					specialized_cost: 0,
					breakdown: {
						formula: "NoFormula",
						base_bonuses: [],
						current_bonuses: [],
						vitae: 1,
						modifiers: { contributions: [], multiplier: 1, additive: 0 },
						wide_modifiers: [],
						wide_additive_rounded: 0,
						finalization: {
							before_rounding: 10,
							rounded: 10,
							minimum: 0,
							result: 10,
						},
					},
				},
				description: null,
				availableInEor: true,
			},
		],
	});
	const tools = [8610, 8611, 8612].map((guid, index) => {
		const item = inventoryFixtureItem(guid, {
			ownedByPlayer: true,
			location: {
				kind: "contained",
				parentGuid: 1,
				slot: { kind: "item", index },
			},
			lockTool: { kind: "key" },
		});
		if (item.description.kind !== "known")
			throw new Error("Known Locks fixture required");
		return {
			...item,
			description: {
				...item.description,
				name: `Key ${index < 2 ? "A" : "B"}`,
				wcid: index < 2 ? 100 : 101,
				useCapability: "targeted" as const,
			},
		};
	});
	const update = (
		upserts: typeof tools | ReturnType<typeof inventoryFixtureItem>[],
		removed: number[] = [],
	) =>
		emit("client-entity-facts-changed", {
			upserts,
			removed,
			projectileSupply: null,
			salvage: null,
			worldContainer: null,
		});
	const wait = async (predicate: () => boolean, label: string) => {
		const deadline = performance.now() + 4_000;
		while (!predicate()) {
			if (performance.now() >= deadline)
				throw new Error(`Locks probe timed out: ${label}`);
			await new Promise((resolve) =>
				setTimeout(resolve, CLIENT_TUNING.inventory.displayIntervalMs),
			);
		}
	};
	const click = (selector: string) => {
		const button = document.querySelector<HTMLButtonElement>(selector);
		if (button === null || button.disabled)
			throw new Error(`Unavailable locks action ${selector}`);
		button.click();
	};
	const lastQuery = () =>
		itemUseTargetQuerySchema.parse(
			commands.findLast(
				(entry) => entry.command === "query_client_item_use_target",
			)?.args?.query,
		);
	const accept = () => {
		const query = lastQuery();
		emit("client-item-use-target-result", {
			sequence: query.sequence,
			eligible: true,
			lockpickSuccessPercent: null,
		});
		return itemUseRequestSchema.parse(
			commands.findLast((entry) => entry.command === "submit_client_item_use")
				?.args?.request,
		);
	};
	const finish = (sequence: number, error: string) =>
		emit("client-item-use-finished", {
			sequence,
			outcome: {
				kind: "completed",
				error,
				message:
					error === "KeyDoesntFitThisLock"
						? "The key does not fit."
						: "Attempt completed.",
			},
		});
	const count = () =>
		commands.filter((entry) => entry.command === "submit_client_item_use")
			.length;

	const pick = (guid: number, bonus: number, uses: number) => {
		const item = inventoryFixtureItem(guid, {
			ownedByPlayer: true,
			lockTool: { kind: "lockpick", bonus },
			location: {
				kind: "contained",
				parentGuid: 1,
				slot: { kind: "item", index: guid },
			},
		});
		if (item.description.kind !== "known")
			throw new Error("Known pick required");
		return {
			...item,
			description: {
				...item.description,
				name: `Pick ${guid}`,
				wcid: guid,
				useCapability: "targeted" as const,
				structure: { current: uses, max: 5 },
			},
		};
	};
	const picks = [pick(8613, 10, 1), pick(8614, 20, 4), pick(8615, 20, 1)];
	const keyItems = tools.map((item) => ({
		...item,
		description: {
			...item.description,
			structure: {
				current: item.guid === 8611 ? 1 : item.guid === 8612 ? 2 : 4,
				max: 5,
			},
		},
	}));
	const locked = (finishOpening = true) => {
		options.selection.select(target);
		const sequence = allocateItemUseOperation();
		emit("client-locked-target", { target, name: "Fixture chest", sequence });
		if (finishOpening) finish(sequence, "None");
		return sequence;
	};
	const escape = () =>
		window.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Escape",
				code: "Escape",
				bubbles: true,
				cancelable: true,
			}),
		);
	try {
		options.setAutomaticKeys(false);
		emit("client-character-sheet-updated", skillSheet("Trained"));
		update([
			...keyItems,
			...picks,
			inventoryFixtureItem(target, { isLocked: true }),
		]);
		locked();
		await wait(
			() => document.querySelector("[data-locks-panel]") !== null,
			"compact chooser",
		);
		if (
			document
				.querySelector("[data-attempt-all-keys]")
				?.textContent?.replace(/\s+/g, " ")
				.trim() !== "Try all 2 keys"
		)
			throw new Error(
				`Key count did not describe distinct attempts: ${document.querySelector("[data-attempt-all-keys]")?.textContent}, groups=${model.read().keyCount}`,
			);
		if (!document.querySelector('[aria-label="Unlock Fixture chest"]'))
			throw new Error("Window title did not identify the subject");
		if (
			document.querySelectorAll("[data-locks-panel] [data-item-guid]")
				.length !== 1 ||
			!document.querySelector('[data-locks-pick] [data-item-guid="8615"]')
		)
			throw new Error("Chooser did not expose only the preferred pick");
		const actions = document.querySelector<HTMLDivElement>(".locks-actions");
		const keysButton = document.querySelector<HTMLButtonElement>(
			"[data-attempt-all-keys]",
		);
		const pickButton =
			document.querySelector<HTMLButtonElement>("[data-lockpick]");
		const pickCell = document.querySelector<HTMLSpanElement>(
			'[data-locks-pick] [data-item-guid="8615"]',
		);
		if (
			actions === null ||
			keysButton === null ||
			pickButton === null ||
			pickCell === null
		)
			throw new Error("Missing horizontal lock actions");
		const cellStyle = getComputedStyle(pickCell);
		const standardSize =
			Number.parseFloat(cellStyle.getPropertyValue("--ui-item-cell-min-size")) *
			Number.parseFloat(cellStyle.getPropertyValue("--ui-icon-scale"));
		const assertCellSize = () => {
			const cell = pickCell.getBoundingClientRect();
			if (
				Math.round(cell.width) !== Math.round(standardSize) ||
				Math.round(cell.height) !== Math.round(standardSize)
			)
				throw new Error(
					"Preferred pick cell did not retain the shared normal size",
				);
		};
		assertCellSize();
		const cellBounds = pickCell.getBoundingClientRect();
		const buttonBounds = pickButton.getBoundingClientRect();
		if (
			!pickButton.contains(pickCell) ||
			pickButton.querySelector("button") !== null ||
			cellBounds.left < buttonBounds.left ||
			cellBounds.right > buttonBounds.right ||
			cellBounds.top < buttonBounds.top ||
			cellBounds.bottom > buttonBounds.bottom
		)
			throw new Error(
				"Preferred cell is not embedded inside a single lockpick button",
			);
		if (
			Math.abs(
				(cellBounds.left + cellBounds.right) / 2 -
					(buttonBounds.left + buttonBounds.right) / 2,
			) > 1
		)
			throw new Error("Preferred cell is not centered in the Lockpick button");
		const keysBounds = keysButton.getBoundingClientRect();
		const pickBounds = pickButton.getBoundingClientRect();
		if (keysBounds.top !== pickBounds.top || pickBounds.left <= keysBounds.left)
			throw new Error("Lock actions are not horizontal");
		for (const button of [keysButton, pickButton]) {
			const icon = button.querySelector<HTMLSpanElement>(
				button === pickButton ? ".locks-action-art" : ".locks-action-icon",
			);
			const caption = button.lastElementChild;
			if (
				icon === null ||
				caption === null ||
				icon.getBoundingClientRect().height <= standardSize ||
				caption.getBoundingClientRect().top <
					icon.getBoundingClientRect().bottom
			)
				throw new Error("Lock action lacks artwork with a label underneath");
		}
		actions.style.width = `${actions.getBoundingClientRect().width * 2}px`;
		assertCellSize();
		actions.style.width = "";
		checks.push("horizontal-actions-and-centered-normal-size-preferred-cell");

		const preview = lastQuery();
		if (preview.source !== 8615)
			throw new Error("Preferred pick did not rank bonus then remaining uses");
		emit("client-item-use-target-result", {
			sequence: preview.sequence,
			eligible: true,
			lockpickSuccessPercent: 100,
		});
		await wait(
			() =>
				document
					.querySelector("[data-lockpick]")
					?.textContent?.includes("100%") === true,
			"preferred chance",
		);
		const label = pickButton.querySelector<HTMLElement>(".locks-action-label");
		if (
			label === null ||
			getComputedStyle(label).whiteSpace !== "nowrap" ||
			label.scrollWidth > label.clientWidth
		)
			throw new Error("100% lockpick caption wraps or overflows");
		const locksWindow = pickButton.closest(".hud-window");
		if (
			locksWindow === null ||
			locksWindow.querySelector('[class*="resize-border"]') !== null
		)
			throw new Error("Unlock window exposes resize handles");
		checks.push(
			"full-chance-caption-stays-on-one-line-and-window-is-not-resizable",
		);
		const content = locksWindow.querySelector<HTMLElement>(
			".hud-window-content",
		);
		const panel = locksWindow.querySelector<HTMLElement>("[data-locks-panel]");
		if (
			content === null ||
			panel === null ||
			Math.abs(content.clientHeight - panel.offsetHeight) > 1
		)
			throw new Error("Unlock window reserves unused height below its actions");
		checks.push("unlock-window-height-follows-action-content");
		if (count() !== 0)
			throw new Error("Opening the preferred pick executed use");
		checks.push("two-actions-distinct-key-count-and-preferred-pick-chance");
		if (options.selection.selectedGuid() !== target)
			throw new Error("Locks window did not follow the selected subject");
		checks.push("window-follows-current-selection");
		document
			.querySelector('[data-locks-pick] [data-item-guid="8615"]')
			?.dispatchEvent(
				new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
			);
		await wait(
			() =>
				commands.some(
					(entry) =>
						entry.command === "examine_client_entity" &&
						entry.args?.guid === 8615,
				),
			"right-click preferred examine",
		);
		if (count() !== 0 || options.selection.selectedGuid() !== target)
			throw new Error(
				"Examining the preferred cell attempted use or changed selection",
			);
		checks.push("preferred-cell-retains-right-click-examine");
		pickCell.click();
		const cellAttempt = accept();
		if (cellAttempt.intent.source !== 8615)
			throw new Error(
				"Single-clicking the cell did not use the preferred pick",
			);
		finish(cellAttempt.sequence, "None");
		await wait(() => !pickButton.disabled, "lockpick ready after cell attempt");
		const beforeDoubleClick = count();
		pickCell.dispatchEvent(
			new MouseEvent("click", { bubbles: true, detail: 2 }),
		);
		pickCell.dispatchEvent(
			new MouseEvent("dblclick", { bubbles: true, detail: 2 }),
		);
		if (count() !== beforeDoubleClick || model.read().pending)
			throw new Error("Double-click queued an extra lockpick attempt");
		checks.push(
			"embedded-cell-single-click-attempts-without-double-click-retry",
		);
		click("[data-lockpick]");
		const pickAttempt = accept();
		if (pickAttempt.intent.source !== 8615)
			throw new Error("Lockpick button used a different instance");
		finish(pickAttempt.sequence, "None");
		const beforeReplacement = count();
		update([], [8615]);
		await wait(
			() =>
				document.querySelector('[data-locks-pick] [data-item-guid="8614"]') !==
				null,
			"next preferred pick",
		);
		if (count() !== beforeReplacement)
			throw new Error("Pick replacement automatically attempted use");
		checks.push("consumed-preferred-pick-replaced-without-automatic-retry");
		await wait(
			() =>
				document.querySelector<HTMLButtonElement>("[data-attempt-all-keys]")
					?.disabled === false,
			"key action readiness",
		);
		click("[data-attempt-all-keys]");
		const first = accept();
		if (first.intent.source !== 8611)
			throw new Error("Key runner did not select the lowest-use duplicate");
		finish(first.sequence, "KeyDoesntFitThisLock");
		const second = accept();
		if (second.intent.source !== 8612)
			throw new Error("Key runner did not skip equivalent duplicates");
		escape();
		finish(second.sequence, "KeyDoesntFitThisLock");
		if (!model.visible || !options.readToast()?.message.startsWith("Cancelled"))
			throw new Error("Escape did not cancel before dismissal");
		checks.push("manual-keys-prioritize-uses-and-escape-stops-batch");
		update([inventoryFixtureItem(target + 1, { isLocked: true })]);
		await wait(
			() =>
				!document.querySelector<HTMLButtonElement>("[data-attempt-all-keys]")
					?.disabled,
			"retarget readiness",
		);
		click("[data-attempt-all-keys]");
		const oldSubject = accept();
		const beforeSelection = count();
		options.selection.select(target + 1);
		finish(oldSubject.sequence, "KeyDoesntFitThisLock");
		await wait(
			() =>
				!document.querySelector<HTMLButtonElement>("[data-lockpick]")?.disabled,
			"new selected subject",
		);
		if (
			!model.visible ||
			count() !== beforeSelection ||
			lastQuery().target !== target + 1
		)
			throw new Error(
				"Selection change did not cancel old keys and retarget lockpick preview",
			);
		click("[data-lockpick]");
		const newSubject = accept();
		if (
			newSubject.intent.kind !== "targeted" ||
			newSubject.intent.target !== target + 1
		)
			throw new Error("Lockpick did not use the currently selected subject");
		finish(newSubject.sequence, "None");
		options.selection.select(8614);
		if (model.visible)
			throw new Error("Selecting inventory retained the unlock window");
		checks.push("selection-change-cancels-keys-and-retargets-visible-actions");
		model.close();
		options.setAutomaticKeys(true);
		update([
			...keyItems,
			...picks,
			inventoryFixtureItem(target, { isLocked: true }),
		]);
		const opening = locked(false);
		const beforeOpening = count();
		if (model.visible || !model.read().pending)
			throw new Error(
				"Initial locked use did not retain hidden waiting ownership",
			);
		finish(allocateItemUseOperation(), "None");
		if (count() !== beforeOpening)
			throw new Error("Unrelated receipt started automatic keys");
		escape();
		finish(opening, "None");
		if (model.visible || model.read().pending || count() !== beforeOpening)
			throw new Error(
				"Escape while awaiting initial UseDone continued automation",
			);
		checks.push("escape-cancels-wait-for-exact-opening-receipt");
		locked();
		if (model.visible || !model.read().pending)
			throw new Error("Hidden automation did not retain its subject");
		const changedSelection = accept();
		const beforeHiddenSelection = count();
		options.selection.select(null);
		finish(changedSelection.sequence, "KeyDoesntFitThisLock");
		if (
			model.visible ||
			model.read().pending ||
			count() !== beforeHiddenSelection
		)
			throw new Error(
				"Changing selection continued automatic keys or opened fallback",
			);
		checks.push("selection-change-stops-hidden-automation-without-fallback");
		locked();
		const moving = accept();
		const release = options.bindMovement();
		try {
			window.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "w",
					code: "KeyW",
					bubbles: true,
					cancelable: true,
				}),
			);
			finish(moving.sequence, "KeyDoesntFitThisLock");
		} finally {
			release();
		}
		if (model.visible)
			throw new Error("Interrupted automation opened a window");
		checks.push("movement-retires-hidden-auto-target-without-fallback");
		locked();
		const autoFirst = accept();
		finish(autoFirst.sequence, "KeyDoesntFitThisLock");
		const autoLast = accept();
		finish(autoLast.sequence, "KeyDoesntFitThisLock");
		await wait(
			() => model.visible && document.querySelector("[data-lockpick]") !== null,
			"preferred-only fallback",
		);
		if (document.querySelector("[data-attempt-all-keys]") !== null)
			throw new Error("Automatic fallback offered exhausted keys again");
		checks.push("automatic-exhaustion-opens-only-preferred-lockpick");
		model.close();
		locked();
		const success = accept();
		update(
			[inventoryFixtureItem(target, { isLocked: false })],
			[success.intent.source],
		);
		finish(success.sequence, "None");
		await wait(
			() =>
				document
					.querySelector('[aria-label="Chat messages"]')
					?.textContent?.includes("Used Key A to unlock Fixture chest.") ===
				true,
			"automatic unlock chat",
		);
		if (
			model.visible ||
			options.readToast()?.message !== "Fixture chest unlocked."
		)
			throw new Error("Success retained the interaction or lost its toast");
		checks.push("consumed-automatic-key-reports-chat-and-retires-target");
		options.setAutomaticKeys(false);
		update([
			...keyItems,
			...picks,
			inventoryFixtureItem(target, { isLocked: true }),
		]);
		locked();
		await wait(() => model.visible, "helper before UI opt-out");
		click('button[aria-label="Settings"]');
		await wait(
			() => document.querySelector("#settings-tab-ui") !== null,
			"UI settings tab",
		);
		click("#settings-tab-ui");
		await wait(
			() => document.querySelector("#settings-section-ui") !== null,
			"UI settings content",
		);
		const helperLabel = [
			...document.querySelectorAll("#settings-section-ui label"),
		].find((label) => label.textContent?.trim() === "Use unlock helper");
		const helperToggle = helperLabel?.querySelector<HTMLInputElement>(
			'input[type="checkbox"]',
		);
		if (
			helperToggle === undefined ||
			helperToggle === null ||
			!helperToggle.checked
		)
			throw new Error(
				"UI settings did not offer the enabled unlock helper checkbox",
			);
		helperToggle.click();
		await wait(() => !model.visible, "helper closes on UI opt-out");
		const queriesBeforeOptOut = commands.filter(
			(entry) => entry.command === "query_client_item_use_target",
		).length;
		options.setAutomaticKeys(true);
		locked();
		if (
			model.visible ||
			model.read().pending ||
			commands.filter(
				(entry) => entry.command === "query_client_item_use_target",
			).length !== queriesBeforeOptOut
		)
			throw new Error(
				"Disabled unlock helper opened or automatically attempted keys",
			);
		helperToggle.click();
		await new Promise((resolve) =>
			setTimeout(resolve, CLIENT_TUNING.inventory.displayIntervalMs),
		);
		if (model.visible || model.read().pending)
			throw new Error("Re-enabling unlock helper resumed prior work");
		click('button[aria-label="Close Settings"]');
		checks.push(
			"UI-unlock-helper-checkbox-closes-and-gates-window-and-automatic-keys",
		);
		update(
			[inventoryFixtureItem(target, { isLocked: true })],
			[...keyItems, ...picks].map((item) => item.guid),
		);
		emit("client-character-sheet-updated", skillSheet("Untrained"));
		locked();
		if (model.visible)
			throw new Error("Ineligible empty chooser retained target");
		checks.push("empty-and-untrained-chooser-suppressed");
		emit("client-state-resyncing", null);
		if (model.visible || model.read().pending)
			throw new Error("Resync retained workflow ownership");
		checks.push("resync-retires-workflow");
		return { passed: true, checks };
	} finally {
		options.setAutomaticKeys(false);
		model.close();
	}
}
