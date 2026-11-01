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
import type {
	ClientCombatMode,
	ClientEntitySelectionQueryRequest,
} from "../../client/client-host-contract";
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
	initialDistanceBandMeters: 5,
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
	let targetOnlyInView = true;
	let combatMode: ClientCombatMode = "peace";
	let partyMembers = new Set<number>();
	const cycle = new ClientCycleSelectionController({
		selection,
		sample: () => {
			scans++;
			return sampleCycleCandidates(
				entities,
				motion,
				view,
				CYCLE_POLICY,
				targetOnlyInView,
				{ combatMode, partyMembers },
			);
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
			/** Forward displacement in AC coordinates. */
			distance: number;
			/** Sideways displacement for 3D alignment scenarios. */
			lateral?: number;
			/** Height above the player. */
			height?: number;
			creature: boolean;
			/** Player identity, independent of whether PvP permits harm. */
			player?: boolean;
			/** World-produced PvP relationship; fixtures never reconstruct it from radar style. */
			playerThreat?: boolean;
			monster?: boolean;
			usable?: boolean;
			corpse?: "unopened" | "opened";
		}[],
	) => {
		const player = targetingEntity(1, 1);
		const dynamic = records.map((record) => {
			const entity = targetingEntity(record.guid, 1);
			entity.placement.pose.coords.y = record.distance;
			entity.placement.pose.coords.x = record.lateral ?? 0;
			entity.placement.pose.coords.z = record.height ?? 0;
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
								playerThreat: record.playerThreat ?? false,
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
									useCapability:
										record.creature || record.usable ? "direct" : "unsupported",
									mapCategory: record.player
										? "player"
										: record.monster
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
		const bandWidth = CYCLE_POLICY.initialDistanceBandMeters;
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
		press("Tab");
		expectSelected(3, "forward traversal");
		press("Tab", false, true);
		expectSelected(2, "reverse traversal");
		replace([...base, { guid: 5, distance: bandWidth * 1.05, creature: true }]);
		press("Tab", false, true);
		expectSelected(5, "new immediate interrupts reverse traversal");
		press("Tab");
		expectSelected(2, "unchanged immediate permits traversal");
		press("Tab", true);
		expectSelected(9, "first object operation acquires its immediate");
		press("v");
		expectSelected(10, "already selected corpse immediate advances");
		press("V", false, true);
		expectSelected(9, "reverse corpse traversal");

		selection.select(null);
		replace([
			{ guid: 50, distance: 7, creature: true, monster: true },
			{ guid: 51, distance: 6, creature: false, usable: true },
			{ guid: 52, distance: 6.5, creature: false },
			{ guid: 53, distance: 8, creature: false, usable: true },
			{ guid: 54, distance: -5.5, creature: false, usable: true },
			{
				guid: 55,
				distance: 4,
				creature: false,
				usable: true,
				corpse: "opened",
			},
			{
				guid: 56,
				distance: 4.5,
				creature: false,
				usable: true,
				corpse: "unopened",
			},
			{ guid: 57, distance: -5.25, creature: true, monster: true },
		]);
		for (const guid of [51, 50, 53]) {
			press("Tab");
			expectSelected(
				guid,
				"smart combat traverses usable objects and creatures when the immediate is usable",
			);
		}
		press("Tab", true);
		expectSelected(55, "object acquisition includes opened corpses");
		press("Tab", true);
		expectSelected(56, "object traversal includes unopened corpses");
		press("Tab", true);
		expectSelected(51, "object traversal crosses distance bands");
		press("Tab", true);
		expectSelected(52, "object traversal includes unsupported uses");
		press("v");
		expectSelected(56, "corpse filter excludes opened corpses");
		targetOnlyInView = false;
		selection.select(null);
		for (const guid of [51, 50, 53, 57, 54]) {
			press("Tab");
			expectSelected(
				guid,
				"unrestricted traversal ranks rear targets after forward targets in a band",
			);
		}
		targetOnlyInView = true;
		selection.select(null);
		press("Tab");
		expectSelected(51, "restoring view restriction excludes rear targets");
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
					"held chord selects immediate in its category",
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
				{ kind: "client", action: "nextSmartCombat" },
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
		expectSelected(2, "new cycle binding acquires immediate");
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

		// Ranking includes vertical displacement, with no cell or renderer dependency.
		selection.select(null);
		replace([
			{ guid: 20, distance: 8, lateral: 2, creature: true },
			{ guid: 21, distance: 8, height: 6, creature: true },
			{ guid: 22, distance: 16, creature: true },
		]);
		press("Tab");
		expectSelected(
			20,
			"same-floor target outranks upstairs target in the same band",
		);
		press("Tab");
		expectSelected(21, "nearest band outranks farther straight-ahead target");
		replace([
			{ guid: 20, distance: 8, lateral: 4, creature: true },
			{ guid: 21, distance: 8, height: 6, creature: true },
			{ guid: 22, distance: 8, creature: true },
		]);
		press("Tab");
		expectSelected(
			22,
			"changed alignment immediately reacquires preferred target",
		);
		press("Tab");
		expectSelected(20, "already selected immediate advances");

		// Camera sees behind the player; only the unrestricted filters may acquire there.
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
		replace([{ guid: 23, distance: -8, creature: true, monster: true }]);
		press("Tab");
		expectSelected(
			20,
			"camera visibility cannot admit targets behind the player",
		);
		targetOnlyInView = false;
		press("Tab");
		expectSelected(23, "unrestricted targets ignore the forward half-space");
		view = TARGETING_TEST_VIEW;
		targetOnlyInView = true;

		const combatTargets: Parameters<typeof replace>[0] = [
			{ guid: 2, distance: 1, creature: false },
			{ guid: 3, distance: 2, creature: true, player: true },
			{ guid: 4, distance: 3, creature: true, monster: true },
			{ guid: 5, distance: 4, creature: true },
			{ guid: 6, distance: 6, creature: true, player: true },
			{
				guid: 7,
				distance: 7,
				creature: true,
				player: true,
				playerThreat: true,
			},
			{ guid: 8, distance: 8, creature: false, usable: true },
			{ guid: 9, distance: 9, creature: false, corpse: "unopened" },
		];
		replace(combatTargets);
		partyMembers = new Set([6]);
		for (const [mode, expected] of [
			["peace", [2, 3, 4, 5, 6, 7, 8, 2]],
			["melee", [2, 4, 5, 7, 8, 2]],
			["missile", [2, 4, 5, 7, 8, 2]],
			["magic", [2, 4, 5, 6, 7, 8, 2]],
		] as const) {
			combatMode = mode;
			selection.select(null);
			for (const guid of expected) {
				press("Tab");
				expectSelected(guid, `${mode} smart combat player and NPC admission`);
			}
		}
		replace(combatTargets.filter((record) => record.guid !== 2));
		press("Tab");
		expectSelected(
			3,
			"non-threatening player wins immediate before stance filtering",
		);
		press("Tab");
		expectSelected(
			4,
			"selected non-threatening immediate advances into combat traversal",
		);
		combatMode = "peace";
		partyMembers = new Set();

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
			immediateTargetChecks: true,
			sharedCursorChecks: true,
			smartCombatObjectTraversal: true,
			smartCombatStances: true,
			immediateOnlyAdmission: true,
			targetViewOption: true,
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
