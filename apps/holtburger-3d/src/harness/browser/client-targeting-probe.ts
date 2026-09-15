import { ClientEntityMirror } from "../../client/client-entity-mirror";
import { entityFacts } from "../../client/client-entity-mirror.test-support";
import { ClientEntitySelection } from "../../client/client-entity-selection";
import { ClientPointerSelectionController } from "../../client/client-pointer-selection-controller";
import {
	ClientCycleSelectionController,
	sampleCycleCandidates,
} from "../../client/client-cycle-selection-controller";
import { ClientSelectionInput } from "../../client/client-selection-input";
import { ClientInputArbiter } from "../../client/client-input-arbiter";
import { CLIENT_TUNING } from "../../client/client-tuning";
import {
	targetingEntity,
	TARGETING_TEST_VIEW,
} from "../../client/client-targeting.test-support";
import type { ClientLifecycleSessionEvent } from "../../client/client-lifecycle-session";
import type { ClientEntitySelectionQueryRequest } from "../../client/client-host-contract";
import {
	DynamicEntityMirror,
	cellId,
} from "../../lib/game/runtime/dynamic-entity-feed";
import type { KeyboardInputPolicy } from "../../lib/input/keyboard-input-policy";
import { APP_INPUT } from "../../lib/input/app-input";
import { landblockVector3 } from "../../lib/assets/ac-frame";
import { Vec3 } from "../../lib/game/math/types";

/** Real browser input with production acquisition owners and asset-free accepted host records. */
export async function probeClientTargeting(keyboard: KeyboardInputPolicy) {
	const entities = new ClientEntityMirror();
	const motion = new DynamicEntityMirror();
	const listeners = new Set<(event: ClientLifecycleSessionEvent) => void>();
	const emit = (event: ClientLifecycleSessionEvent) => {
		for (const listener of listeners) listener(event);
	};
	const requests: ClientEntitySelectionQueryRequest[] = [];
	const lifecycle = {
		entities,
		subscribe: (listener: (event: ClientLifecycleSessionEvent) => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		queryEntitySelectionCandidates: async (
			request: ClientEntitySelectionQueryRequest,
		) => {
			requests.push(request);
		},
	};
	const selection = new ClientEntitySelection({
		lifecycle,
		presentation: () => null,
	});
	const pointer = new ClientPointerSelectionController({
		selection,
		lifecycle,
		onSelectionSubmissionFailed: (error) => {
			throw error;
		},
		presentation: () => ({
			samplePresentedCameraRay: () => ({
				query: {
					camera: { cameraGeneration: 1, entityGeneration: 1, playerGuid: 1 },
					anchor: 0xffff,
					start: landblockVector3([0, 0, 0]),
					direction: [0, 1, 0],
					previousCell: null,
				},
				refinement: { start: Vec3.zero(), direction: new Vec3(0, 0, -1) },
			}),
			refineEntitySelection: () => ({
				complete: true,
				selectedGuid: 2,
				distance: 1,
			}),
		}),
	});
	let scans = 0;
	const cycle = new ClientCycleSelectionController({
		selection,
		policy: CLIENT_TUNING.entitySelection.cycle,
		sample: (category) => {
			scans++;
			return sampleCycleCandidates(
				entities,
				motion,
				TARGETING_TEST_VIEW,
				category,
				CLIENT_TUNING.entitySelection.cycle,
			);
		},
	});
	const arbiter = new ClientInputArbiter({
		ordinary: { applyAction() {}, restoreHeldAction() {}, reset() {} },
		onEnter() {},
		onActivate() {},
		onCancel() {},
	});
	let nowMs = 0;
	const input = new ClientSelectionInput({
		selection,
		cycle,
		holdDelayMs: CLIENT_TUNING.entitySelection.holdDelayMs,
	});
	const unbind = keyboard.bindGame({
		keydown: (event) => {
			if (
				APP_INPUT.shortcut("cancel", event) &&
				arbiter.applyCancel(true, event.repeat)
			) {
				input.cancel();
				event.preventDefault();
				return;
			}
			input.keydown(event, nowMs);
		},
		keyup: (event) => input.keyup(event, nowMs),
		cancel: () => input.cancel(),
	});
	const editor = document.createElement("input");
	document.body.append(editor);
	const press = (key: string, ctrlKey = false, shiftKey = false) => {
		nowMs++;
		const target = document.activeElement ?? document.body;
		target.dispatchEvent(
			new KeyboardEvent("keydown", {
				key,
				code: key,
				bubbles: true,
				cancelable: true,
				ctrlKey,
				shiftKey,
			}),
		);
		target.dispatchEvent(
			new KeyboardEvent("keyup", {
				key,
				code: key,
				bubbles: true,
				cancelable: true,
				ctrlKey,
				shiftKey,
			}),
		);
	};
	const expectSelected = (guid: number | null, scenario: string) => {
		if (selection.selectedGuid() !== guid)
			throw new Error(
				`Targeting ${scenario}: expected ${guid}, received ${selection.selectedGuid()}.`,
			);
	};
	const replace = (
		records: readonly { guid: number; distance: number; creature: boolean }[],
	) => {
		const player = targetingEntity(1, 1);
		const dynamic = records.map((record) => {
			const entity = targetingEntity(record.guid, 1);
			entity.placement.pose.coords.y = record.distance;
			entity.placement.pose.landblockId = cellId(0x00000123);
			entity.placement.spatialMembership = {
				reachesOutdoors: false,
				reachedEnvCellIds: [cellId(0x00000123)],
			};
			return entity;
		});
		entities.commit(
			entities.prepareSnapshot(
				{
					entities: [
						entityFacts(1, { targeting: "creature" }),
						...records.map((record) =>
							entityFacts(record.guid, {
								targeting: record.creature ? "creature" : "non-creature",
							}),
						),
					],
				},
				1,
			),
		);
		motion.prepareSnapshot({
			entities: [player, ...dynamic],
			hostTime: { seconds: 0 },
		})();
	};
	try {
		keyboard.returnToGame();
		const base = [
			{ guid: 2, distance: 5, creature: true },
			{ guid: 3, distance: 10, creature: true },
			{ guid: 4, distance: 15, creature: true },
			{ guid: 9, distance: -5, creature: false },
			{ guid: 10, distance: -8, creature: false },
		];
		replace(base);
		press("Tab");
		expectSelected(2, "cross-EnvCell acquisition without realization");
		replace(
			base.map((record) => ({
				...record,
				distance:
					record.guid === 2 ? 12 : record.guid === 3 ? 4 : record.distance,
			})),
		);
		press("Tab");
		expectSelected(3, "distance crossing preserves order");
		replace([...base, { guid: 5, distance: 2, creature: true }]);
		press("Tab");
		expectSelected(4, "newcomer does not reorder survivors");
		press("Tab");
		expectSelected(5, "newcomer admitted immediately");
		press("Tab", false, true);
		expectSelected(4, "reverse traversal");
		replace(base.filter((record) => record.guid !== 4));
		press("Tab", false, true);
		expectSelected(3, "removed cursor retains reverse gap");
		press("Tab", true);
		expectSelected(9, "rear non-creature");
		press("Tab", true, true);
		expectSelected(10, "reverse non-creature traversal");
		press("x");
		expectSelected(1, "self binding");
		pointer.acquireViewportPoint(0, 0);
		const request = requests.at(-1);
		if (request === undefined)
			throw new Error("Pointer query was not submitted.");
		press("Tab");
		press("Tab");
		expectSelected(3, "keyboard supersedes pointer");
		emit({
			type: "entity-selection-query-result",
			result: {
				status: "available",
				sequence: request.sequence,
				candidateGuids: [2],
				staticLimitDistance: 20,
			},
		});
		expectSelected(3, "late pointer result");
		// A stale result returning a different identity must also be rejected after an empty cycle.
		replace([]);
		selection.select(9);
		pointer.acquireViewportPoint(0, 0);
		const emptyRequest = requests.at(-1);
		if (emptyRequest === undefined)
			throw new Error("Empty-cycle pointer query missing.");
		press("Tab");
		emit({
			type: "entity-selection-query-result",
			result: {
				status: "available",
				sequence: emptyRequest.sequence,
				candidateGuids: [2],
				staticLimitDistance: 20,
			},
		});
		expectSelected(9, "empty cycle keeps newer intent");
		arbiter.enterPrecise();
		press("Escape");
		expectSelected(9, "precise-jump Escape priority");
		editor.focus();
		press("Escape");
		expectSelected(9, "editor Escape priority");
		press("Escape");
		expectSelected(null, "gameplay Escape clears");
		const before = scans;
		for (let frame = 0; frame < 3; frame++)
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => resolve()),
			);
		if (scans !== before)
			throw new Error("Idle frames performed targeting scans.");
		const dispatchHeld = (
			type: "keydown" | "keyup",
			ctrlKey: boolean,
			shiftKey: boolean,
		) => {
			(document.activeElement ?? document.body).dispatchEvent(
				new KeyboardEvent(type, {
					key: "Tab",
					code: "Tab",
					ctrlKey,
					shiftKey,
					bubbles: true,
					cancelable: true,
				}),
			);
		};
		const waitForHold = () =>
			new Promise<void>((resolve) =>
				setTimeout(resolve, CLIENT_TUNING.entitySelection.holdDelayMs),
			);
		replace(base);
		for (const ctrlKey of [false, true]) {
			for (const shiftKey of [false, true]) {
				selection.select(3);
				dispatchHeld("keydown", ctrlKey, shiftKey);
				expectSelected(
					3,
					"held chord leaves selection unchanged before threshold",
				);
				await waitForHold();
				expectSelected(
					ctrlKey ? 9 : 2,
					"held chord selects nearest in its category",
				);
				dispatchHeld("keyup", ctrlKey, shiftKey);
				expectSelected(ctrlKey ? 9 : 2, "completed hold consumes release");
			}
		}
		selection.select(3);
		dispatchHeld("keydown", false, false);
		const beforeFocusWait = scans;
		editor.focus();
		await waitForHold();
		expectSelected(3, "focus cancels held acquisition");
		if (scans !== beforeFocusWait)
			throw new Error("Cancelled hold scanned candidates.");
		dispatchHeld("keyup", false, false);
		keyboard.returnToGame();

		// Explicit population measurement, not a general renderer performance claim.
		const population = 1000;
		replace(
			Array.from({ length: population }, (_, index) => ({
				guid: index + 2,
				distance: 1 + (index % 20),
				creature: true,
			})),
		);
		const timed = [];
		for (let index = 0; index < 20; index++) {
			const start = performance.now();
			press("Tab");
			timed.push(performance.now() - start);
		}
		timed.sort((a, b) => a - b);
		return {
			passed: true,
			holdDelayMs: CLIENT_TUNING.entitySelection.holdDelayMs,
			holdAndFocusChecks: true,
			scans,
			idleFrames: 3,
			population,
			keypressSamples: timed,
			medianKeypressMs: timed[Math.floor(timed.length / 2)],
			viewMarginMeters: CLIENT_TUNING.entitySelection.cycle.viewMarginMeters,
		};
	} finally {
		unbind();
		editor.remove();
		input.destroy();
		cycle.destroy();
		pointer.destroy();
		selection.destroy();
		keyboard.returnToGame();
	}
}
