import { probeClientCombatTargetIndicator } from "./client-combat-target-indicator-probe";
import {
	ClientEntityMirror,
	type ClientEntityFacts,
} from "../../client/client-entity-mirror";
import {
	entityFacts,
	playerEntitySnapshot,
} from "../../client/client-entity-mirror.test-support";
import { ClientEntitySelection } from "../../client/client-entity-selection";
import { ClientPointerSelectionController } from "../../client/client-pointer-selection-controller";
import {
	ClientCycleSelectionController,
	sampleCycleCandidates,
	type CycleSelectionPolicy,
} from "../../client/client-cycle-selection-controller";
import { ClientSelectionInput } from "../../client/client-selection-input";
import { AppInput } from "../../lib/input/app-input";
import {
	clientInputConfiguration,
	clientKeyboardSettingsSchema,
	CLIENT_KEYBOARD_DEFAULTS,
} from "../../client/client-input-settings";
import { replaceClientBinding } from "../../lib/input/client-keyboard-bindings";
import { INPUT_DEFAULTS } from "../../lib/input/input-defaults";
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
import { landblockVector3 } from "../../lib/assets/ac-frame";
import { Quat, Vec3 } from "../../lib/game/math/types";

/** Fixture-owned geometry policy; changing production tuning must not rewrite targeting scenarios. */
const CYCLE_POLICY: CycleSelectionPolicy = {
	radiusMeters: 75,
	distanceBandMeters: 5,
	angularSectorCount: 8,
	resetDivergence: 0.5,
	adjacentRegionWeight: 0.25,
	viewMarginMeters: 2,
};

/** Real browser input with production acquisition owners and asset-free accepted host records. */
export async function probeClientTargeting(keyboard: KeyboardInputPolicy) {
	const combatTargetIndicator = await probeClientCombatTargetIndicator();
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
	let view = TARGETING_TEST_VIEW;
	const cycle = new ClientCycleSelectionController({
		selection,
		policy: CYCLE_POLICY,
		sample: () => {
			scans++;
			return sampleCycleCandidates(entities, motion, view, CYCLE_POLICY);
		},
	});
	const arbiter = new ClientInputArbiter({
		powerBindings: INPUT_DEFAULTS.preciseJump,
		ordinary: {
			applyAction: () => false,
			restoreHeldAction() {},
			releaseHeldActions() {},
			reset() {},
			setPersistentForward() {},
		},
		onEnter() {},
		onActivate() {},
		onCancel() {},
		onAutoRunChanged() {},
	});
	let nowMs = 0;
	const appInput = new AppInput(INPUT_DEFAULTS);
	const character = appInput.characterContext(() => {});
	const input = new ClientSelectionInput({
		keyboard,
		input: appInput,
		selection,
		cycle,
		holdDelayMs: CLIENT_TUNING.entitySelection.holdDelayMs,
	});
	let systemMenuRequests = 0;
	const unbind = keyboard.bindGame({
		keydown: (event) => {
			if (!input.keydown(event, nowMs) && event.key === "Escape")
				systemMenuRequests++;
		},
		keyup: (event) => input.keyup(event, nowMs),
		cancel: () => {
			input.cancel();
			character.reset();
		},
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
		records: readonly {
			guid: number;
			distance: number;
			creature: boolean;
			hostile?: boolean;
			corpse?: "unopened" | "opened";
		}[],
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
					...playerEntitySnapshot(1),
					entities: [
						entityFacts(1, { targeting: "creature" }),
						...records.map((record): ClientEntityFacts => {
							const facts = entityFacts(record.guid, {
								corpse: record.corpse ?? null,
								targeting: record.creature ? "creature" : "non-creature",
							});
							if (facts.description.kind !== "known")
								throw new Error(
									"Targeting fixture requires a known description.",
								);
							return {
								...facts,
								description: {
									...facts.description,
									mapCategory: record.hostile
										? "mob"
										: record.creature
											? "npc"
											: "other",
								},
							};
						}),
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
		const bandWidth = CYCLE_POLICY.distanceBandMeters;
		const base: Parameters<typeof replace>[0] = [
			{ guid: 2, distance: bandWidth * 1.2, creature: true },
			{ guid: 3, distance: bandWidth * 1.4, creature: true },
			{ guid: 4, distance: bandWidth * 1.6, creature: true },
			{ guid: 9, distance: -5, creature: false, corpse: "unopened" },
			{ guid: 10, distance: -8, creature: false, corpse: "unopened" },
		];
		replace(base);
		press("Tab");
		expectSelected(2, "cross-EnvCell acquisition without realization");
		replace(
			base.map((record) => ({
				...record,
				distance:
					record.guid === 2
						? bandWidth * 1.5
						: record.guid === 3
							? bandWidth * 1.1
							: record.distance,
			})),
		);
		press("Tab");
		expectSelected(3, "distance crossing preserves order");
		replace([...base, { guid: 5, distance: bandWidth * 1.05, creature: true }]);
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
		expectSelected(10, "object traversal continues from the creature cursor");
		press("Tab", true, true);
		expectSelected(9, "reverse non-creature traversal");
		press("v");
		expectSelected(10, "corpse filter shares forward traversal cursor");
		press("V", false, true);
		expectSelected(9, "corpse filter shares reverse traversal cursor");
		selection.select(null);
		replace([
			{ guid: 30, distance: bandWidth * 1.2, creature: false },
			{ guid: 31, distance: bandWidth * 1.4, creature: true },
			{
				guid: 32,
				distance: bandWidth * 1.6,
				creature: false,
				corpse: "unopened",
			},
			{ guid: 33, distance: bandWidth * 1.8, creature: true },
		]);
		press("Tab");
		expectSelected(31, "interleaved ring starts at nearest creature B");
		press("Tab", true);
		expectSelected(
			32,
			"switching to objects advances to C rather than restarting at A",
		);
		press("Tab");
		expectSelected(33, "switching back to creatures advances to D");
		press("v");
		expectSelected(32, "corpse filter wraps from the shared creature cursor");
		selection.select(null);
		replace([
			{ guid: 40, distance: bandWidth * 1.2, creature: true },
			{ guid: 41, distance: bandWidth * 1.4, creature: true, hostile: true },
			{ guid: 42, distance: bandWidth * 1.6, creature: false },
			{ guid: 43, distance: bandWidth * 1.8, creature: true, hostile: true },
			{ guid: 44, distance: -bandWidth * 1.1, creature: true, hostile: true },
		]);
		press("Tab");
		expectSelected(40, "ordinary creature traversal includes friendly NPCs");
		press("v", true);
		expectSelected(
			41,
			"Ctrl+V advances to the next hostile in the shared ring",
		);
		press("v", true);
		expectSelected(43, "Ctrl+V skips world objects and offscreen hostiles");
		press("V", true, true);
		expectSelected(41, "Ctrl+Shift+V reverses hostile traversal");
		press("Tab", true);
		expectSelected(42, "object traversal continues from the hostile cursor");
		replace(base);
		press("x");
		expectSelected(1, "self binding");
		const remappedSelf = clientKeyboardSettingsSchema.parse(
			replaceClientBinding(
				CLIENT_KEYBOARD_DEFAULTS,
				{ kind: "client", action: "selectSelf" },
				[{ key: "q" }],
			),
		);
		keyboard.cancel();
		character.replaceBindings(remappedSelf.character);
		appInput.replaceConfiguration(clientInputConfiguration(remappedSelf));
		selection.select(3);
		press("x");
		expectSelected(3, "old self binding retired");
		press("q");
		expectSelected(1, "remapped self without rendered presentation");
		keyboard.cancel();
		character.replaceBindings(CLIENT_KEYBOARD_DEFAULTS.character);
		appInput.replaceConfiguration(INPUT_DEFAULTS);
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
		keyboard.bindEscapeContext(() => {
			input.cancel();
			arbiter.cancelPrecise();
		});
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

		selection.select(3);
		dispatchHeld("keydown", false, false);
		const beforeRemap = scans;
		const remappedCycle = clientKeyboardSettingsSchema.parse(
			replaceClientBinding(
				CLIENT_KEYBOARD_DEFAULTS,
				{ kind: "client", action: "nextCreature" },
				[{ key: "q" }],
			),
		);
		keyboard.cancel();
		character.replaceBindings(remappedCycle.character);
		appInput.replaceConfiguration(clientInputConfiguration(remappedCycle));
		await waitForHold();
		expectSelected(3, "configuration replacement cancels hold timer");
		if (scans !== beforeRemap)
			throw new Error("Cancelled remap hold scanned candidates");
		dispatchHeld("keyup", false, false);
		expectSelected(3, "old key release after remap cannot select");
		press("q");
		expectSelected(4, "new cycle binding reaches selection owner");
		keyboard.cancel();
		character.replaceBindings(CLIENT_KEYBOARD_DEFAULTS.character);
		appInput.replaceConfiguration(INPUT_DEFAULTS);

		// The fallback must wait for both selection and a window whose close awaits authority.
		selection.select(2);
		let closeRequests = 0;
		const window = keyboard.bindEscapeContext(() => closeRequests++, {
			untilRelease: true,
		});
		const beforeMenu = systemMenuRequests;
		try {
			press("Escape");
			press("Escape");
			expectSelected(2, "server-delayed window retains Escape");
			if (closeRequests !== 2 || systemMenuRequests !== beforeMenu)
				throw new Error(
					"Pending window close let Escape reach the system menu.",
				);
		} finally {
			window.release();
		}
		press("Escape");
		expectSelected(null, "selection precedes system menu");
		if (systemMenuRequests !== beforeMenu)
			throw new Error("Selection cancellation also opened the system menu.");
		press("Escape");
		if (systemMenuRequests !== beforeMenu + 1)
			throw new Error("Empty Escape stack did not reach the system menu.");

		// Spatial changes, rather than elapsed time, start a fresh nearest acquisition.
		selection.select(null);
		replace(base);
		press("Tab");
		press("Tab");
		expectSelected(3, "spatial baseline cursor");
		replace(
			base.map((record) => ({
				...record,
				distance: record.creature
					? record.distance + bandWidth * 2
					: record.distance,
			})),
		);
		press("Tab");
		expectSelected(
			2,
			"radial divergence reacquires nearest instead of advancing",
		);
		replace(
			base.map((record) => ({
				...record,
				distance: record.creature
					? record.distance + bandWidth * 4
					: record.distance,
			})),
		);
		press("Tab");
		expectSelected(3, "radial reset skips the already selected nearest target");
		replace([
			...base,
			{ guid: 20, distance: -bandWidth * 1.2, creature: true },
			{ guid: 21, distance: -bandWidth * 1.4, creature: true },
		]);
		view = {
			...TARGETING_TEST_VIEW,
			camera: {
				...TARGETING_TEST_VIEW.camera,
				placement: {
					...TARGETING_TEST_VIEW.camera.placement,
					rotation: new Quat(0, 0, 1, 0),
				},
			},
		};
		press("Tab");
		expectSelected(20, "camera turn reacquires nearest in the new view");
		press("Tab");
		expectSelected(21, "new view continues outward");
		view = TARGETING_TEST_VIEW;

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
			combatTargetIndicator,
			holdDelayMs: CLIENT_TUNING.entitySelection.holdDelayMs,
			holdAndFocusChecks: true,
			spatialResetChecks: true,
			sharedFilterTraversal: true,
			hostileTraversal: true,
			escapeFallbackOrdering: true,
			remapCancellation: true,
			remappedSelfWithoutPresentation: true,
			scans,
			idleFrames: 3,
			population,
			keypressSamples: timed,
			medianKeypressMs: timed[Math.floor(timed.length / 2)],
			viewMarginMeters: CYCLE_POLICY.viewMarginMeters,
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
