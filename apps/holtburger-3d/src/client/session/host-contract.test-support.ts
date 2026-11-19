import type { ClientCurrentState } from "./host-contract";
import { playerEntitySnapshot } from "../world/entity-mirror.test-support";
import { emptyHousing } from "../housing/housing-contract";

/** Minimal current-state baseline so tests override only the slices under test. */
export function baselineCurrentState(
	playerGuid = 1,
	overrides: Partial<ClientCurrentState> = {},
): ClientCurrentState {
	return {
		barber: { interaction: null, result: null, particles: null },
		lifecycle: { kind: "in-world" },
		characterManagement: { kind: "idle" },
		playerVisualCapture: null,
		entityCollisionDisabled: false,
		canTeleportFromMap: false,
		recallDestinations: [],
		housing: emptyHousing(),
		localPlayerGuid: playerGuid,
		serverTime: 1,
		worldGeneration: 1,
		connection: null,
		worldName: "Fixture",
		accountName: "Fixture account",
		playerName: "Player",
		knownSpells: null,
		enchantments: null,
		party: null,
		friends: null,
		contracts: null,
		squelch: null,
		allegiance: {
			playerGuid: null,
			profile: null,
			refreshing: false,
			canSwear: false,
		},
		characterPreferences: null,
		combatMode: "peace",
		socialMotionReady: true,
		combat: {
			desired: null,
			state: "idle",
			processedIntentSequence: 0,
			refill: null,
		},
		spellCastTarget: null,
		vitals: [],
		characterSheet: null,
		trade: { trade: null, pending_items: [] },
		vendor: null,
		characterMotion: null,
		activeConfirmation: null,
		dynamic: { hostTime: { seconds: 1 }, entities: [] },
		entities: playerEntitySnapshot(playerGuid),
		...overrides,
	};
}
