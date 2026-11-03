import { formatError } from "../../lib/format-error";
import { ClientGameplayPresentation } from "../../client/client-gameplay-presentation";
import {
	ClientCycleSelectionController,
	sampleCycleCandidates,
	type CycleSelectionPolicy,
} from "../../client/client-cycle-selection-controller";
import { ClientEntitySelection } from "../../client/client-entity-selection";
import { ClientSelectionInput } from "../../client/client-selection-input";
import { CLIENT_TUNING } from "../../client/client-tuning";
import {
	entityFacts,
	playerEntitySnapshot,
} from "../../client/client-entity-mirror.test-support";
import { targetingEntity } from "../../client/client-targeting.test-support";
import { AppInput } from "../../lib/input/app-input";
import { createInputDefaults } from "../../lib/input/input-defaults";
import { KeyboardInputPolicy } from "../../lib/input/keyboard-input-policy";
import { ViewportInputGate } from "../../lib/input/viewport-input-gate";
import type { GamePresentationRuntime } from "../../lib/game/runtime/game-presentation-runtime";
import type { DynamicEntityView } from "../../lib/game/runtime/dynamic-entity-feed";
import type { HttpLandblockContentSource } from "../../lib/assets/http-landblock-content-source";
import { pregameGameplayFixture } from "./pregame-gameplay-fixture";
import {
	SYNTHETIC_NAMEPLATE_SETUP_DID,
	SYNTHETIC_TARGETING_SETUP_DID,
	SYNTHETIC_TARGETING_ANIMATION_ID,
	SYNTHETIC_TARGETING_MOTION_TABLE_DID,
} from "./synthetic-nameplate-workload";

/** Fixture-owned query conditions keep opening-door expectations independent of editable tuning. */
const CYCLE_POLICY: CycleSelectionPolicy = {
	radiusMeters: 30,
	initialDistanceBandMeters: 4,
	immediateMaxAngleDegrees: 15,
	viewMarginMeters: 0.4,
	forwardHalfSpaceRearOffsetMeters: 0.2,
};

/** Real WebGL/runtime, gameplay adapter and input owners; only authority and asset content are synthetic. */
export async function probeRealizedCycleTargeting(
	runtime: GamePresentationRuntime,
	anchor: DynamicEntityView,
	canvas: HTMLCanvasElement,
	content: HttpLandblockContentSource,
) {
	if (anchor.placement.kind !== "world")
		throw new Error("Targeting probe requires a realized world anchor.");
	const fixture = pregameGameplayFixture(
		{
			setupDid: SYNTHETIC_NAMEPLATE_SETUP_DID,
			appearance: anchor.presentation.appearance,
			scale: 1,
			translucency: 0,
			pose: { kind: "setup-pose" },
		},
		{
			landblockId: anchor.placement.pose.landblockId,
			coords: anchor.placement.pose.coords,
		},
	);
	const initialPlayer = fixture.snapshot().dynamic.entities[0];
	if (initialPlayer === undefined || initialPlayer.placement.kind !== "world")
		throw new Error("Targeting fixture requires a world player.");
	const player = { ...initialPlayer, placement: initialPlayer.placement };
	const door = targetingEntity(player.identity.guid + 1, 1);
	door.presentation.content.setupDid = SYNTHETIC_TARGETING_SETUP_DID;
	door.presentation.content.motionTableDid =
		SYNTHETIC_TARGETING_MOTION_TABLE_DID;
	door.physics.defaultAnimation = true;
	door.placement = {
		...player.placement,
		pose: {
			...player.placement.pose,
			coords: {
				...player.placement.pose.coords,
				x: player.placement.pose.coords.x + 0.6,
				y: player.placement.pose.coords.y + 0.5,
			},
		},
	};
	const npc = targetingEntity(player.identity.guid + 2, 1);
	npc.presentation.content.setupDid = SYNTHETIC_NAMEPLATE_SETUP_DID;
	npc.placement = {
		...player.placement,
		pose: {
			...player.placement.pose,
			coords: {
				...player.placement.pose.coords,
				y: player.placement.pose.coords.y + 3,
			},
		},
	};
	const doorSemantic = entityFacts(door.identity.guid);
	if (doorSemantic.description.kind !== "known")
		throw new Error("Door semantic fixture requires a description.");
	const facts = {
		...playerEntitySnapshot(player.identity.guid),
		entities: [
			entityFacts(player.identity.guid),
			{
				...doorSemantic,
				description: {
					...doorSemantic.description,
					mapCategory: "door" as const,
				},
			},
			entityFacts(npc.identity.guid, { targeting: "creature" }),
		],
	};
	const errors: unknown[] = [];
	const presentation = new ClientGameplayPresentation({
		session: fixture.session,
		canvas,
		resources: {
			runtime,
			activeRegion: content.activeRegion,
			profileSource: content,
		},
		onError: (error) => errors.push(error),
	});
	const selection = new ClientEntitySelection({
		lifecycle: fixture.session,
		presentation: () => presentation,
	});
	let targetOnlyInView = false;
	const sample = () => {
		const candidates = presentation.withCycleSelectionFrame((frame) =>
			sampleCycleCandidates(
				fixture.session.entities,
				fixture.session.mirror,
				frame,
				CYCLE_POLICY,
				{ targetOnlyInView, smartTabHostileOnly: false },
				{ combatMode: "peace", partyMembers: new Set() },
			),
		);
		if (candidates === null)
			throw new Error(
				"Ready targeting probe must supply an acquisition frame.",
			);
		return candidates;
	};
	const cycle = new ClientCycleSelectionController({ selection, sample });
	const keyboard = new KeyboardInputPolicy(new ViewportInputGate());
	const input = new ClientSelectionInput({
		input: new AppInput(createInputDefaults("windows")),
		keyboard,
		selection,
		cycle,
		holdDelayMs: CLIENT_TUNING.entitySelection.holdDelayMs,
	});
	const nextFrame = () =>
		new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	const settle = async () => {
		const deadline = performance.now() + 20_000;
		while (performance.now() < deadline) {
			const frame = presentation.frame(performance.now());
			if (errors.length > 0)
				throw new AggregateError(errors, "Targeting presentation failed.");
			if (frame.status.kind === "error")
				throw new Error(
					frame.status.diagnostic ??
						"Targeting presentation failed without a diagnostic.",
				);
			if (frame.status.kind === "ready") {
				await nextFrame();
				presentation.frame(performance.now());
				return;
			}
			await nextFrame();
		}
		throw new Error(
			`Targeting presentation did not become ready: ${JSON.stringify(presentation.status())}`,
		);
	};
	const publish = async (
		frame: number,
		entities: readonly DynamicEntityView[] = [player, door, npc],
	) => {
		door.motion = {
			restPosture: null,
			locomotionCommandActive: false,
			ordinary: {
				playbackId: String(frame + 1),
				clip: {
					kind: "settled",
					animationId: Number.parseInt(
						SYNTHETIC_TARGETING_ANIMATION_ID.slice(2),
						16,
					),
					frame,
				},
			},
			locomotion: null,
			activity: "explicit",
		};
		fixture.publishEntities(entities, facts);
		await settle();
		await runtime.reevaluateDynamicEntityEligibility();
		presentation.frame(performance.now());
	};
	const tap = () => {
		const now = performance.now();
		input.keydown(
			new KeyboardEvent("keydown", {
				key: "Tab",
				code: "Tab",
				cancelable: true,
			}),
			now,
		);
		input.keyup(
			new KeyboardEvent("keyup", { key: "Tab", code: "Tab", cancelable: true }),
			now,
		);
	};
	const expectSelected = (guid: number, label: string) => {
		if (selection.selectedGuid() !== guid)
			throw new Error(
				`${label}: expected ${guid}, got ${selection.selectedGuid()}`,
			);
	};
	const evidence: Record<string, unknown> = {};
	try {
		await fixture.session.start();
		fixture.publishEntities([player, door, npc], facts);
		await presentation.start();
		await publish(0);
		selection.select(null);
		tap();
		expectSelected(
			door.identity.guid,
			"Closed offset door must win cold Tab by its volume",
		);
		evidence.closed = {
			selected: selection.selectedGuid(),
			candidates: sample(),
		};
		await publish(1);
		selection.select(null);
		tap();
		expectSelected(
			npc.identity.guid,
			"Opening pose must remove the door from immediate admission",
		);
		evidence.open = {
			selected: selection.selectedGuid(),
			candidates: sample(),
		};
		await publish(0);
		selection.select(null);
		const now = performance.now();
		input.keydown(
			new KeyboardEvent("keydown", {
				key: "Tab",
				code: "Tab",
				cancelable: true,
			}),
			now,
		);
		input.keyup(
			new KeyboardEvent("keyup", { key: "Tab", code: "Tab", cancelable: true }),
			now + CLIENT_TUNING.entitySelection.holdDelayMs,
		);
		expectSelected(
			door.identity.guid,
			"Hold must use the same realized volume",
		);
		evidence.hold = selection.selectedGuid();
		// Physically move the door beyond the fixed innermost band without changing its membership.
		const originalY = door.placement.pose.coords.y;
		door.placement.pose.coords.y =
			player.placement.pose.coords.y +
			CYCLE_POLICY.initialDistanceBandMeters * 3;
		await publish(0);
		selection.select(null);
		tap();
		expectSelected(
			npc.identity.guid,
			"A distant door must not enter Smart Tab traversal",
		);
		evidence.distant = {
			selected: selection.selectedGuid(),
			candidates: sample(),
		};
		door.placement.pose.coords.y = originalY;
		await publish(0, [player, npc]);
		selection.select(null);
		tap();
		expectSelected(npc.identity.guid, "Unrealized door must not be acquired");
		evidence.unrealized = sample();
		await publish(0);
		selection.select(null);
		tap();
		expectSelected(
			door.identity.guid,
			"Re-realization must restore door eligibility",
		);
		evidence.restored = selection.selectedGuid();
		fixture.reseedCamera(
			{
				landblockId: player.placement.pose.landblockId,
				coords: {
					...player.placement.pose.coords,
					y: player.placement.pose.coords.y + 1,
					z: player.placement.pose.coords.z + 1,
				},
			},
			{
				landblockId: player.placement.pose.landblockId,
				coords: {
					...player.placement.pose.coords,
					z: player.placement.pose.coords.z + 1,
				},
			},
		);
		presentation.frame(performance.now());
		await nextFrame();
		presentation.frame(performance.now());
		const offscreen = sample();
		if (
			!offscreen.some(
				(c) =>
					c.guid === npc.identity.guid && c.filters["smart-combat"] === "cycle",
			)
		)
			throw new Error(
				"Looking away evicted the behind-camera NPC from unrestricted targeting.",
			);
		targetOnlyInView = true;
		const viewRestricted = sample();
		if (viewRestricted.some((c) => c.guid === npc.identity.guid))
			throw new Error(
				"View-restricted Smart Tab retained a behind-camera NPC.",
			);
		evidence.offscreen = offscreen;
		evidence.viewRestricted = viewRestricted;
		return { passed: true, ...evidence };
	} catch (error) {
		throw new Error(formatError(error), { cause: error });
	} finally {
		input.destroy();
		cycle.destroy();
		selection.destroy();
		keyboard.cancel();
		await presentation.destroy();
		fixture.session.stop();
	}
}
