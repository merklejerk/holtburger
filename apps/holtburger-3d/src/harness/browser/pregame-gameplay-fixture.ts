import type { PlayerVisualCapture } from "../../client/client-object-preview-contract";
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
	ClientExitRequested,
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
	let logoutRequests = 0;
	const emit = (event: ClientEventName, payload: unknown) =>
		handlers.get(event)?.(payload);
	/** Retirement and selection share a complete playerless authority baseline. */
	const playerlessState = (
		lifecycle: ClientCurrentState["lifecycle"],
		worldGeneration: number,
	): ClientCurrentState => ({
		...currentState(player),
		lifecycle,
		worldGeneration,
		localPlayerGuid: null,
		playerName: null,
		entities: { ...playerEntitySnapshot(guid), entities: [] },
		dynamic: { ...state.dynamic, entities: [] },
	});
	const enter = async () => {
		const worldGeneration = state.worldGeneration + 1;
		state = {
			...currentState(player),
			worldGeneration,
			lifecycle: {
				kind: "portal-space",
				worldGeneration,
				cause: "initial-entry",
			},
		};
		emit("client-current-state", state);
	};
	const selection = (empty = false) => {
		state = playerlessState(
			{
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
			state.worldGeneration,
		);
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
		else if (
			command === "delete_client_character" ||
			command === "restore_client_character"
		) {
			const lifecycle = state.lifecycle;
			if (lifecycle.kind !== "character-selection")
				throw new Error("Management fixture requires selection");
			const deleting = command === "delete_client_character";
			const target = deleting
				? lifecycle.characters.find(
						(character) => character.slot === z.number().parse(args?.slot),
					)
				: lifecycle.characters.find(
						(character) => character.guid === z.number().parse(args?.guid),
					);
			if (target === undefined)
				throw new Error("Unknown management fixture character");
			// Authority admission can arrive after the host has accepted the command.
			setTimeout(() => {
				state = {
					...state,
					characterManagement: deleting
						? { kind: "deleting" }
						: { kind: "restoring", guid: target.guid },
				};
				emit("client-character-management-changed", state.characterManagement);
				state = {
					...state,
					characterManagement: { kind: "idle" },
					lifecycle: {
						...lifecycle,
						characters: lifecycle.characters.map((character) =>
							character.guid === target.guid
								? {
										...character,
										deleteTime: deleting
											? Math.floor(Date.now() / 1000) + 3600
											: 0,
									}
								: character,
						),
					},
				};
				emit("client-current-state", state);
			}, 200);
		} else if (command === "logout_client") {
			logoutRequests++;
			state = { ...state, lifecycle: { kind: "logging-out" } };
			emit("client-lifecycle-changed", state.lifecycle);
			state = playerlessState(
				{ kind: "logging-out" },
				state.worldGeneration + 1,
			);
			emit("client-current-state", state);
			selection();
		} else if (command === "start_client_camera") {
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
		authenticate: () => {
			state = { ...state, lifecycle: { kind: "authenticating" } };
			emit("client-lifecycle-changed", state.lifecycle);
		},
		/** Exercise real notice delivery without changing lifecycle or transport readiness. */
		notify: (message: string, tone: "status" | "warning") =>
			emit("client-action-feedback", { message, tone }),
		capture: (capture: PlayerVisualCapture) =>
			emit("client-player-visual-capture-changed", capture),
		exit: (cause: ClientExitRequested["cause"], diagnostic: string) => {
			state = {
				...state,
				lifecycle: { kind: "exiting", cause },
			};
			emit("client-lifecycle-changed", state.lifecycle);
			emit("client-exit-requested", { cause, diagnostic });
		},
		snapshot: () => state,
		acknowledgements: () => acknowledgements,
		logoutRequests: () => logoutRequests,
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
