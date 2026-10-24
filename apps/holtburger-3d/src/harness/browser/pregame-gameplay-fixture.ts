import type {
	HostCommandName,
	HostCommandArguments,
	HostEventName,
} from "../../lib/host/host-transport";
import { z } from "zod";
import {
	ClientLifecycleSession,
	type ClientLifecycleTransport,
} from "../../client/client-lifecycle-session";
import type {
	ClientCurrentState,
	ClientCameraTick,
} from "../../client/client-host-contract";
import type { ObjectPreviewVisual } from "../../lib/game/runtime/object-preview-source";
import {
	cellId,
	type DynamicEntityView,
} from "../../lib/game/runtime/dynamic-entity-feed";
import { emptyHousing } from "../../client/client-housing-contract";
import { playerEntitySnapshot } from "../../client/client-entity-mirror.test-support";
import { CLIENT_PREGAME_BACKDROP_TUNING } from "../../client/client-pregame-backdrop";
import { createLandblockWorldOrigin } from "../../lib/game/landblocks";

type ClientEventName = HostEventName;

/** Controlled authority only: production lifecycle/camera/portal consumers still validate each event. */
export function pregameGameplayFixture(body: ObjectPreviewVisual) {
	const guid = 0x50000043;
	const tuning = CLIENT_PREGAME_BACKDROP_TUNING;
	const origin = createLandblockWorldOrigin(tuning.landblockId);
	const point = {
		landblockId: Number(tuning.envCellId),
		coords: {
			x: tuning.position.x - origin.x,
			y: origin.z - tuning.position.z,
			z: tuning.position.y,
		},
	};
	const player: DynamicEntityView = {
		generation: 1,
		identity: { guid, wcid: 1 },
		display: { name: "Presentation fixture", level: null },
		presentation: {
			placementFrame: 0,
			entityClass: "other",
			content: {
				setupDid: body.setupDid,
				motionTableDid: null,
				soundTableDid: null,
				physicsEffectTableDid: null,
			},
			appearance: {
				...body.appearance,
				subPalettes: [...body.appearance.subPalettes],
				textureChanges: [...body.appearance.textureChanges],
				partChanges: [...body.appearance.partChanges],
			},
			objectScale: body.scale,
			radar: { behavior: null, category: "other", obviousRange: null },
		},
		physics: {
			semanticMask: 0,
			participation: "pose-only",
			noDraw: false,
			hidden: false,
			cloaked: false,
			translucency: 0,
			lighting: true,
			defaultAnimation: false,
			defaultScript: false,
		},
		placement: {
			kind: "world",
			pose: {
				...point,
				landblockId: cellId(point.landblockId),
				rotation: { w: 1, x: 0, y: 0, z: 0 },
			},
			spatialMembership: {
				reachesOutdoors: false,
				reachedEnvCellIds: [cellId(point.landblockId)],
			},
			contact: "grounded",
			sampleMode: "authoritative-only",
		},
		motion: null,
	};
	const handlers = new Map<ClientEventName, (payload: unknown) => void>();
	let state = currentState(player);
	let cameraGeneration = 0;
	let acknowledgements = 0;
	const emit = (event: ClientEventName, payload: unknown) =>
		handlers.get(event)?.(payload);
	const enter = async () => {
		state = {
			...currentState(player),
			lifecycle: {
				kind: "portal-space",
				worldGeneration: 1,
				cause: "initial-entry",
			},
		};
		emit("client-current-state", state);
	};
	const selection = (empty = false) => {
		state = {
			...currentState(player),
			localPlayerGuid: null,
			playerName: null,
			lifecycle: {
				kind: "character-selection",
				maxSlots: 10,
				characters: empty
					? []
					: [
							{ guid, name: "Cached appearance", slot: 0, deleteTime: 0 },
							{
								guid: guid + 1,
								name: "No saved appearance",
								slot: 1,
								deleteTime: 0,
							},
						],
			},
			entities: { ...playerEntitySnapshot(guid), entities: [] },
			dynamic: { hostTime: { seconds: 75 }, entities: [] },
		};
		emit("client-current-state", state);
	};

	const listen = async (
		event: HostEventName,
		handler: (payload: unknown) => void,
	) => {
		handlers.set(event, handler);
		return () => {
			handlers.delete(event);
		};
	};
	const invoke = async (
		command: HostCommandName,
		args?: HostCommandArguments,
	) => {
		if (command === "request_client_current_state")
			emit("client-current-state", state);
		else if (command === "select_client_character") await enter();
		else if (command === "start_client_camera") {
			const request = z
				.object({
					playerGuid: z.number(),
					entityGeneration: z.number(),
					projectionRevision: z.number(),
					clearanceRadius: z.number(),
				})
				.parse(args?.request);
			const identity = {
				cameraGeneration: ++cameraGeneration,
				playerGuid: request.playerGuid,
				entityGeneration: request.entityGeneration,
			};
			emit("client-camera-started", identity);
			const endpoint = { position: point, visualPivot: point };
			const tick: ClientCameraTick = {
				kind: "reseeded",
				...identity,
				sequence: 1,
				durationMs: 30,
				targetSphereRole: "primary",
				clearance: {
					projectionRevision: request.projectionRevision,
					radius: request.clearanceRadius,
				},
				desiredReach: 4.5,
				renderedReach: 4.5,
				convergence: "settled",
				path: {
					initial: endpoint,
					legs: [{ endFraction: 1, end: endpoint }],
				},
				reason: "initial-placement",
				diagnostics: {
					collisionProof: { status: "covered" },
					controlLegs: 0,
					clearanceSweeps: 0,
					continuitySweeps: 0,
					contactPasses: 0,
				},
			};
			emit("client-camera", tick);
		} else if (command === "acknowledge_client_world_reveal") {
			acknowledgements++;
			state = { ...state, lifecycle: { kind: "in-world" } };
			emit("client-lifecycle-changed", state.lifecycle);
		}
	};
	const transport: ClientLifecycleTransport = { listen, invoke };
	const session = new ClientLifecycleSession(transport);
	return {
		session,
		transport,
		listen,
		invoke,
		enter,
		selection,
		// Progress can arrive before the held current-state response supplies the roster.
		authenticate: () =>
			emit("client-lifecycle-changed", { kind: "authenticating" }),
		exit: () => {
			state = {
				...state,
				lifecycle: { kind: "exiting", cause: "explicit-disconnect" },
			};
			emit("client-exit-requested", {
				cause: "explicit-disconnect",
				diagnostic: "Fixture disconnected",
			});
		},
		snapshot: () => state,
		acknowledgements: () => acknowledgements,
	};
}

function currentState(player: DynamicEntityView): ClientCurrentState {
	const playerGuid = player.identity.guid;
	return {
		characterSheet: null,
		trade: { trade: null, pending_items: [] },
		lifecycle: { kind: "in-world" },
		characterManagement: { kind: "idle" },
		playerVisualCapture: null,
		entityCollisionDisabled: false,
		canTeleportFromMap: false,
		recallDestinations: [],
		housing: emptyHousing(),
		localPlayerGuid: playerGuid,
		entities: playerEntitySnapshot(playerGuid),
		serverTime: 75,
		worldGeneration: 1,
		connection: null,
		worldName: "Leafcull",
		playerName: "Player",
		knownSpells: null,
		enchantments: null,
		appearanceOptions: null,
		party: null,
		partyPreferences: null,
		friends: null,
		contracts: null,
		squelch: null,
		allegiance: {
			playerGuid: null,
			profile: null,
			refreshing: false,
			canSwear: false,
		},
		allegiancePreferences: null,
		friendsPreferences: null,
		combatMode: "peace",
		combat: { desired: null, state: "idle", refill: null },
		vitals: [],
		characterMotion: null,
		activeConfirmation: null,
		dynamic: {
			hostTime: { seconds: 75 },
			entities: [player],
		},
	};
}
