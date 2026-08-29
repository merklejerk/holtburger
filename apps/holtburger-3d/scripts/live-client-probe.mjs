#!/usr/bin/env node

import { spawn } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	encodeSidecarFrame,
	SidecarHostClient,
} from "../dist-electron/electron/host-protocol.js";
import {
	createProbeFailureResult,
	probeError,
	redactProbeText,
} from "./live-client-probe-report.mjs";
import { acknowledgeProbeWorldReveal } from "./live-client-probe-lifecycle.mjs";

const DEFAULT_OBSERVATION_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const EXIT_TIMEOUT_MS = 5_000;

const appRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const workspaceRoot = resolve(appRoot, "../..");
const hostExecutable =
	process.platform === "win32"
		? "holtburger-3d-host.exe"
		: "holtburger-3d-host";
const hostPath = resolve(
	process.env.HOLTBURGER_HOST_BIN ??
		join(workspaceRoot, "target/release", hostExecutable),
);

let redactionValues = { account: "", password: "" };

function requiredEnvironment(name) {
	const value = process.env[name];
	if (value === undefined || value.length === 0) {
		throw new Error(
			`${name} must be set; credentials are never accepted as arguments.`,
		);
	}
	return value;
}

function parseInteger(value, name) {
	if (!/^[0-9]+$/.test(value)) {
		throw new Error(`${name} must be a non-negative integer.`);
	}
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed)) {
		throw new Error(`${name} is outside the safe integer range.`);
	}
	return parsed;
}

function optionalGuid(value) {
	if (value === undefined) return undefined;
	const guid = parseInteger(value, "HOLTBURGER_PROBE_CHARACTER_GUID");
	if (guid > 0xffff_ffff) {
		throw new Error("HOLTBURGER_PROBE_CHARACTER_GUID must fit in a u32.");
	}
	return guid;
}

function probeMode(value) {
	const mode = value ?? "drive";
	if (mode !== "drive" && mode !== "passive") {
		throw new Error("HOLTBURGER_PROBE_MODE must be drive or passive.");
	}
	return mode;
}

function cameraStartRequest(playerGuid, entityGeneration, sequence) {
	return {
		playerGuid,
		entityGeneration,
		initialReach: 4.5,
		minimumReach: 1.2,
		maximumReach: 8,
		inputSequence: sequence,
		viewDirection: [0, -0.2, -1],
		cumulativeZoomDisplacement: 0,
		projectionRevision: sequence,
		clearanceRadius: 0.2,
	};
}

function waitForExit(child) {
	return new Promise((resolvePromise, rejectPromise) => {
		child.once("error", rejectPromise);
		child.once("exit", (code, signal) => resolvePromise({ code, signal }));
	});
}

function delay(milliseconds) {
	return new Promise((resolvePromise) =>
		setTimeout(resolvePromise, milliseconds),
	);
}

function withTimeout(promise, milliseconds, message) {
	let timeout;
	return Promise.race([
		promise,
		new Promise((_, rejectPromise) => {
			timeout = setTimeout(
				() => rejectPromise(new Error(message)),
				milliseconds,
			);
		}),
	]).finally(() => clearTimeout(timeout));
}

function guidString(value) {
	return `0x${Number(value).toString(16).padStart(8, "0")}`;
}

function payloadFrameBytes(event, payload) {
	return encodeSidecarFrame({
		kind: "event",
		event: { event, payload },
	}).byteLength;
}

function createCensus() {
	const byEvent = new Map();
	const entityGuids = new Set();
	const actorMotion = new Map();
	const frameSizes = [];
	let focusGuid;
	let focusPoint;
	let travelledDistance = 0;
	let peakSnapshotEntities = 0;
	let peakEntityBatchEntities = 0;
	let totalBytes = 0;
	let largestFrameBytes = 0;

	function observe(event, payload) {
		const bytes = payloadFrameBytes(event, payload);
		frameSizes.push(bytes);
		totalBytes += bytes;
		largestFrameBytes = Math.max(largestFrameBytes, bytes);
		const record = byEvent.get(event) ?? {
			count: 0,
			bytes: 0,
			maxBytes: 0,
			maxEntities: 0,
		};
		record.count += 1;
		record.bytes += bytes;
		record.maxBytes = Math.max(record.maxBytes, bytes);
		const entities = entitiesInPayload(event, payload);
		record.maxEntities = Math.max(record.maxEntities, entities.length);
		for (const entity of entities) {
			if (entity && typeof entity.identity?.guid === "number") {
				entityGuids.add(entity.identity.guid);
				rememberActorMotion(entity);
			}
		}
		if (event === "client-current-state") {
			const entity = entities.find(
				(candidate) => candidate?.identity?.guid === focusGuid,
			);
			if (entity !== undefined) rememberFocusEntity(entity);
		} else if (event === "client-dynamic-entity") {
			for (const entity of entities) {
				if (entity?.identity?.guid === focusGuid) rememberFocusEntity(entity);
			}
		}
		const entityCount = entitiesInPayload(event, payload).length;
		if (isSnapshotPayload(event, payload)) {
			peakSnapshotEntities = Math.max(peakSnapshotEntities, entityCount);
		} else {
			peakEntityBatchEntities = Math.max(peakEntityBatchEntities, entityCount);
		}
		byEvent.set(event, record);
	}

	function rememberActorMotion(entity) {
		if (entity.placement?.kind !== "world") return;
		const point = worldPoint(entity.placement.pose);
		const clip = JSON.stringify(entity.playingClip ?? null);
		const previous = actorMotion.get(entity.identity.guid);
		const step = previous === undefined ? 0 : distance(previous.point, point);
		actorMotion.set(entity.identity.guid, {
			point,
			sampleCount: (previous?.sampleCount ?? 0) + 1,
			totalDistance: (previous?.totalDistance ?? 0) + step,
			maximumStep: Math.max(previous?.maximumStep ?? 0, step),
			clip,
			clipTransitions:
				(previous?.clipTransitions ?? 0) +
				(previous !== undefined && previous.clip !== clip ? 1 : 0),
		});
	}

	function rememberFocusEntity(entity) {
		if (entity.placement?.kind === "world") {
			const nextPoint = worldPoint(entity.placement.pose);
			if (focusPoint !== undefined) {
				travelledDistance += distance(focusPoint, nextPoint);
			}
			focusPoint = nextPoint;
		}
	}

	return {
		observe,
		setFocusGuid(guid) {
			focusGuid = guid;
		},
		seedFocusEntity(entity) {
			rememberFocusEntity(entity);
		},
		toJSON() {
			const sortedFrameSizes = [...frameSizes].sort(
				(left, right) => left - right,
			);
			return {
				uniqueEntityGuids: [...entityGuids]
					.sort((left, right) => left - right)
					.map(guidString),
				peakSnapshotEntities,
				peakEntityBatchEntities,
				frameCount: frameSizes.length,
				totalEventFrameBytes: totalBytes,
				largestEventFrameBytes: largestFrameBytes,
				p95EventFrameBytes:
					sortedFrameSizes.length === 0
						? 0
						: sortedFrameSizes[Math.ceil(sortedFrameSizes.length * 0.95) - 1],
				travelledDistance,
				actorMotion: Object.fromEntries(
					[...actorMotion.entries()]
						.sort(([left], [right]) => left - right)
						.map(([guid, motion]) => [
							guidString(guid),
							{
								sampleCount: motion.sampleCount,
								totalDistance: motion.totalDistance,
								maximumStep: motion.maximumStep,
								clipTransitions: motion.clipTransitions,
							},
						]),
				),
				byEvent: Object.fromEntries(
					[...byEvent.entries()].map(([event, record]) => [event, record]),
				),
			};
		},
	};
}

function worldPoint(pose) {
	const cellId = Number(pose.landblockId) >>> 0;
	return {
		x: ((cellId >>> 24) & 0xff) * 192 + pose.coords.x,
		y: ((cellId >>> 16) & 0xff) * 192 + pose.coords.y,
		z: pose.coords.z,
	};
}

function distance(left, right) {
	return Math.hypot(right.x - left.x, right.y - left.y, right.z - left.z);
}

function entityHeading(entity) {
	const rotation = entity.placement.pose.rotation;
	return Math.atan2(
		2 * (rotation.w * rotation.z + rotation.x * rotation.y),
		1 - 2 * (rotation.y * rotation.y + rotation.z * rotation.z),
	);
}

function wrappedAngleDelta(from, to) {
	return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function actorPhaseSample(entity) {
	if (entity?.placement?.kind !== "world") return null;
	return {
		heading: entityHeading(entity),
		point: worldPoint(entity.placement.pose),
		playingClip: entity.playingClip ?? null,
	};
}

const TELEPORT_DESTINATIONS = [
	{ coordinates: "22n 2w", point: { x: 23_988, y: 29_748, z: 0 } },
	{ coordinates: "11n 2w", point: { x: 23_988, y: 27_108, z: 0 } },
];

function selectTeleportDestination(requested, pose) {
	if (requested === undefined) return null;
	if (requested !== "auto") {
		const destination = TELEPORT_DESTINATIONS.find(
			(candidate) => candidate.coordinates === requested,
		);
		if (destination === undefined) {
			throw new Error(
				"HOLTBURGER_PROBE_TELEPORT must be auto, 22n 2w, or 11n 2w.",
			);
		}
		return destination;
	}
	const source = worldPoint(pose);
	return TELEPORT_DESTINATIONS.reduce((farthest, candidate) =>
		distance(source, candidate.point) > distance(source, farthest.point)
			? candidate
			: farthest,
	);
}

function requestedTeleportCommands(requestedTeleport, requestedSequence, pose) {
	if (requestedSequence !== undefined) {
		const commands = requestedSequence
			.split("|")
			.map((command) => command.trim())
			.filter((command) => command.length > 0);
		if (
			commands.length === 0 ||
			commands.some((command) => !command.startsWith("@"))
		) {
			throw new Error(
				"HOLTBURGER_PROBE_TELEPORT_SEQUENCE must contain pipe-separated chat commands.",
			);
		}
		return commands;
	}
	const destination = selectTeleportDestination(requestedTeleport, pose);
	return destination === null ? [] : [`@tele ${destination.coordinates}`];
}

function entitiesInPayload(event, payload) {
	if (event === "client-current-state") return payload?.dynamic?.entities ?? [];
	if (event !== "client-dynamic-entity") return [];
	if (payload?.kind === "snapshot") return payload.snapshot?.entities ?? [];
	if (payload?.kind === "upserted")
		return payload.entity ? [payload.entity] : [];
	if (payload?.kind === "ticked") {
		return [
			...(payload.batch?.advances?.map((advance) => advance.entity) ?? []),
			...(payload.batch?.updates ?? []),
		];
	}
	return [];
}

function isSnapshotPayload(event, payload) {
	return (
		event === "client-current-state" ||
		(event === "client-dynamic-entity" && payload?.kind === "snapshot")
	);
}

function createWaiter() {
	const pending = [];
	return {
		push(event, payload) {
			for (let index = pending.length - 1; index >= 0; index -= 1) {
				const wait = pending[index];
				if (wait.event !== event || !wait.predicate(payload)) continue;
				pending.splice(index, 1);
				wait.resolve(payload);
			}
		},
		wait(event, predicate, milliseconds, description = event) {
			return new Promise((resolvePromise, rejectPromise) => {
				const entry = {
					event,
					predicate,
					reject: rejectPromise,
					resolve: (value) => {
						clearTimeout(timeout);
						resolvePromise(value);
					},
				};
				const timeout = setTimeout(() => {
					const index = pending.indexOf(entry);
					if (index >= 0) pending.splice(index, 1);
					rejectPromise(
						new Error(
							`timed out waiting for ${description} after ${milliseconds}ms`,
						),
					);
				}, milliseconds);
				pending.push(entry);
			});
		},
		cancel(reason = new Error("probe stopped")) {
			for (const entry of pending.splice(0)) entry.reject(reason);
		},
	};
}

async function main() {
	const account = requiredEnvironment("HOLTBURGER_PROBE_ACCOUNT");
	const password = requiredEnvironment("HOLTBURGER_PROBE_PASSWORD");
	redactionValues = { account, password };
	const serverHost = process.env.HOLTBURGER_PROBE_HOST ?? "127.0.0.1";
	const serverPort = parseInteger(
		process.env.HOLTBURGER_PROBE_PORT ?? "9000",
		"HOLTBURGER_PROBE_PORT",
	);
	const observationMs = parseInteger(
		process.env.HOLTBURGER_PROBE_DURATION_MS ?? String(DEFAULT_OBSERVATION_MS),
		"HOLTBURGER_PROBE_DURATION_MS",
	);
	const timeoutMs = parseInteger(
		process.env.HOLTBURGER_PROBE_TIMEOUT_MS ?? String(DEFAULT_TIMEOUT_MS),
		"HOLTBURGER_PROBE_TIMEOUT_MS",
	);
	const requestedCharacterGuid = optionalGuid(
		process.env.HOLTBURGER_PROBE_CHARACTER_GUID,
	);
	const mode = probeMode(process.env.HOLTBURGER_PROBE_MODE);
	const requestedTeleport = process.env.HOLTBURGER_PROBE_TELEPORT;
	const requestedTeleportSequence =
		process.env.HOLTBURGER_PROBE_TELEPORT_SEQUENCE;
	if (
		mode === "passive" &&
		(requestedTeleport !== undefined || requestedTeleportSequence !== undefined)
	) {
		throw new Error(
			"passive client probe cannot be combined with teleport commands.",
		);
	}
	await access(hostPath, constants.X_OK);
	const environment = { ...process.env };
	if (environment.HOLTBURGER_DATS === undefined) {
		const workspaceDats = join(workspaceRoot, "dats");
		if (existsSync(workspaceDats)) environment.HOLTBURGER_DATS = workspaceDats;
	}
	const child = spawn(hostPath, ["--mode=client"], {
		env: environment,
		stdio: "pipe",
		windowsHide: true,
	});
	const exited = waitForExit(child);
	let stderr = "";
	child.stderr.on("data", (chunk) => {
		stderr += chunk.toString();
	});
	const client = new SidecarHostClient(child, "client");
	const invokeMovement = (command, args) => {
		if (mode === "passive") {
			throw new Error(`passive client probe rejected ${command}`);
		}
		return client.invoke(command, args);
	};
	let lastCompletedPhase = "host-started";
	const census = createCensus();
	const waiter = createWaiter();
	const lifecycle = [];
	const cameras = [];
	const discontinuities = [];
	const terminalEvents = [];
	const latestEntities = new Map();
	let teleport = null;
	const teleports = [];
	const events = [
		"client-current-state",
		"client-lifecycle-changed",
		"client-local-player-established",
		"client-server-time-updated",
		"client-dynamic-entity",
		"client-camera-started",
		"client-camera",
		"client-presentation-discontinuity",
		"client-exit-requested",
	];
	try {
		await client.connect();
		lastCompletedPhase = "sidecar-connected";
		for (const event of events) {
			await client.listen(event, (payload) => {
				census.observe(event, payload);
				waiter.push(event, payload);
				if (event === "client-lifecycle-changed") lifecycle.push(payload);
				if (event === "client-current-state") {
					for (const entity of payload?.dynamic?.entities ?? []) {
						latestEntities.set(entity.identity.guid, entity);
					}
				}
				if (event === "client-dynamic-entity") {
					if (payload?.kind === "snapshot") {
						latestEntities.clear();
						for (const entity of payload.snapshot?.entities ?? []) {
							latestEntities.set(entity.identity.guid, entity);
						}
					} else if (payload?.kind === "upserted") {
						latestEntities.set(payload.entity.identity.guid, payload.entity);
					} else if (payload?.kind === "ticked") {
						for (const advance of payload.batch?.advances ?? []) {
							latestEntities.set(advance.entity.identity.guid, advance.entity);
						}
						for (const entity of payload.batch?.updates ?? []) {
							latestEntities.set(entity.identity.guid, entity);
						}
					} else if (payload?.kind === "removed") {
						latestEntities.delete(payload.guid);
					}
				}
				if (event === "client-camera" || event === "client-camera-started")
					cameras.push({ event, payload });
				if (event === "client-presentation-discontinuity")
					discontinuities.push(payload);
				if (event === "client-exit-requested") {
					terminalEvents.push({
						...payload,
						diagnostic: redactText(payload?.diagnostic),
					});
				}
			});
		}
		lastCompletedPhase = "event-subscriptions-installed";

		const selectionPromise = waiter.wait(
			"client-lifecycle-changed",
			(payload) => payload?.kind === "character-selection",
			timeoutMs,
			"character-selection lifecycle",
		);
		void selectionPromise.catch(() => undefined);
		try {
			await client.startClient({
				host: serverHost,
				port: serverPort,
				account,
				password,
			});
			lastCompletedPhase = "client-start-requested";
		} catch (error) {
			waiter.cancel(error);
			throw error;
		}
		const selection = await selectionPromise;
		lastCompletedPhase = "character-selection-received";
		const characters = Array.isArray(selection.characters)
			? selection.characters
			: [];
		if (characters.length === 0) {
			throw new Error("client account returned no selectable characters");
		}
		const selected =
			(requestedCharacterGuid === undefined
				? characters[0]
				: characters.find(
						(character) => character.guid === requestedCharacterGuid,
					)) ?? null;
		if (selected === null) {
			throw new Error(
				`HOLTBURGER_PROBE_CHARACTER_GUID ${guidString(requestedCharacterGuid)} was not in the character list`,
			);
		}
		const inWorldPromise = waiter.wait(
			"client-lifecycle-changed",
			(payload) => payload?.kind === "in-world",
			timeoutMs,
			"in-world lifecycle",
		);
		void inWorldPromise.catch(() => undefined);
		const localPlayerPromise = waiter.wait(
			"client-local-player-established",
			(payload) => Number.isInteger(payload?.playerGuid),
			timeoutMs,
			"local-player establishment",
		);
		void localPlayerPromise.catch(() => undefined);
		const portalSpacePromise = waiter.wait(
			"client-lifecycle-changed",
			(payload) => payload?.kind === "portal-space",
			timeoutMs,
			"portal-space lifecycle",
		);
		void portalSpacePromise.catch(() => undefined);
		await client.invoke("select_client_character", { guid: selected.guid });
		lastCompletedPhase = "character-selection-requested";
		const portalSpace = await portalSpacePromise;
		lastCompletedPhase = "portal-space-received";
		const { playerGuid } = await localPlayerPromise;
		lastCompletedPhase = "local-player-established";
		census.setFocusGuid(playerGuid);
		const portalStatePromise = waiter.wait(
			"client-current-state",
			(payload) =>
				payload?.lifecycle?.kind === "portal-space" &&
				payload.lifecycle.worldGeneration === portalSpace.worldGeneration,
			timeoutMs,
			"portal-space current state",
		);
		void portalStatePromise.catch(() => undefined);
		await client.invoke("request_client_current_state");
		const portalState = await portalStatePromise;
		lastCompletedPhase = "portal-state-received";
		if (portalState.localPlayerGuid !== playerGuid) {
			throw new Error(
				"portal state disagreed with established local-player identity",
			);
		}
		let player = portalState.dynamic?.entities?.find(
			(entity) => entity.identity?.guid === playerGuid,
		);
		player ??= latestEntities.get(playerGuid);
		if (player === undefined) {
			const playerEventPromise = waiter.wait(
				"client-dynamic-entity",
				(payload) =>
					(payload?.kind === "upserted" &&
						payload.entity?.identity?.guid === playerGuid) ||
					(payload?.kind === "ticked" &&
						(payload.batch?.advances?.some(
							(advance) => advance.entity?.identity?.guid === playerGuid,
						) ||
							payload.batch?.updates?.some(
								(entity) => entity?.identity?.guid === playerGuid,
							))),
				timeoutMs,
				"local-player dynamic entity",
			);
			void playerEventPromise.catch(() => undefined);
			const event = await playerEventPromise;
			player =
				event.kind === "upserted"
					? event.entity
					: (event.batch.advances.find(
							(advance) => advance.entity.identity.guid === playerGuid,
						)?.entity ??
						event.batch.updates.find(
							(entity) => entity.identity.guid === playerGuid,
						));
		}
		if (player?.placement?.kind !== "world") {
			throw new Error(
				"local player has no world placement for the portal-space camera",
			);
		}
		census.seedFocusEntity(player);
		const cameraStartedPromise = waiter.wait(
			"client-camera-started",
			(payload) =>
				payload?.playerGuid === playerGuid &&
				payload.entityGeneration === player.generation,
			timeoutMs,
			"portal-space camera registration",
		);
		void cameraStartedPromise.catch(() => undefined);
		const cameraPathPromise = waiter.wait(
			"client-camera",
			(payload) =>
				payload?.playerGuid === playerGuid &&
				payload.entityGeneration === player.generation &&
				payload.diagnostics?.collisionProof?.status === "covered",
			timeoutMs,
			"first collision-backed portal-space camera path",
		);
		void cameraPathPromise.catch(() => undefined);
		await client.invoke("start_client_camera", {
			request: cameraStartRequest(playerGuid, player.generation, 1),
		});
		await cameraStartedPromise;
		lastCompletedPhase = "portal-camera-registered";
		await cameraPathPromise;
		lastCompletedPhase = "portal-camera-path-received";
		await acknowledgeProbeWorldReveal(client, portalSpace);
		lastCompletedPhase = "world-reveal-acknowledged";
		await inWorldPromise;
		lastCompletedPhase = "in-world-established";

		const currentStatePromise = waiter.wait(
			"client-current-state",
			(payload) => payload?.lifecycle?.kind === "in-world",
			timeoutMs,
			"in-world current state",
		);
		void currentStatePromise.catch(() => undefined);
		await client.invoke("request_client_current_state");
		const currentState = await currentStatePromise;
		lastCompletedPhase = "current-state-received";
		if (currentState.localPlayerGuid !== playerGuid) {
			throw new Error(
				"current state disagreed with established local-player identity",
			);
		}
		player = currentState.dynamic?.entities?.find(
			(entity) => entity.identity?.guid === playerGuid,
		);
		player ??= latestEntities.get(playerGuid);
		if (player !== undefined) census.seedFocusEntity(player);
		const teleportCommands =
			player?.placement?.kind === "world"
				? requestedTeleportCommands(
						requestedTeleport,
						requestedTeleportSequence,
						player.placement.pose,
					)
				: [];
		if (
			(requestedTeleport !== undefined ||
				requestedTeleportSequence !== undefined) &&
			teleportCommands.length === 0
		) {
			throw new Error("teleport probe requires a world-placed local player");
		}
		let driveError = null;
		const drivePhases = [];
		if (teleportCommands.length > 0) {
			let sourcePlayer = player;
			let previousLifecycle = portalSpace;
			for (const [index, command] of teleportCommands.entries()) {
				const sourcePose = sourcePlayer.placement.pose;
				const teleportLifecyclePromise = waiter.wait(
					"client-lifecycle-changed",
					(payload) =>
						payload?.kind === "portal-space" &&
						payload.cause === "teleport" &&
						payload.worldGeneration > previousLifecycle.worldGeneration,
					timeoutMs,
					`teleport ${index + 1} portal-space lifecycle`,
				);
				void teleportLifecyclePromise.catch(() => undefined);
				const inWorldPromise = waiter.wait(
					"client-lifecycle-changed",
					(payload) => payload?.kind === "in-world",
					timeoutMs,
					`teleport ${index + 1} in-world lifecycle`,
				);
				void inWorldPromise.catch(() => undefined);
				const destinationEntityPromise = waiter.wait(
					"client-dynamic-entity",
					(payload) =>
						entitiesInPayload("client-dynamic-entity", payload).some(
							(entity) =>
								entity.identity?.guid === playerGuid &&
								entity.placement?.kind === "world" &&
								entity.placement.pose.landblockId !== sourcePose.landblockId,
						),
					timeoutMs,
					`teleport ${index + 1} destination player placement`,
				);
				void destinationEntityPromise.catch(() => undefined);
				await invokeMovement("send_client_chat", { message: command });
				lastCompletedPhase = `teleport-${index + 1}-command-sent`;
				const [teleportLifecycle] = await Promise.all([
					teleportLifecyclePromise,
					destinationEntityPromise,
				]);
				const destinationStatePromise = waiter.wait(
					"client-current-state",
					(payload) =>
						payload?.lifecycle?.kind === "portal-space" &&
						payload.lifecycle.worldGeneration ===
							teleportLifecycle.worldGeneration,
					timeoutMs,
					`teleport ${index + 1} destination current state`,
				);
				void destinationStatePromise.catch(() => undefined);
				await client.invoke("request_client_current_state");
				const destinationState = await destinationStatePromise;
				lastCompletedPhase = `teleport-${index + 1}-destination-received`;
				if (destinationState.localPlayerGuid !== playerGuid) {
					throw new Error(
						"teleport state disagreed with local-player identity",
					);
				}
				const destinationPlayer = destinationState.dynamic?.entities?.find(
					(entity) => entity.identity?.guid === playerGuid,
				);
				if (destinationPlayer?.placement?.kind !== "world") {
					throw new Error("teleport destination player is not world-placed");
				}
				teleport = {
					command,
					sourcePose,
					destinationPose: destinationPlayer.placement.pose,
					lifecycle: teleportLifecycle,
				};
				teleports.push(teleport);
				const cameraStartedPromise = waiter.wait(
					"client-camera-started",
					(payload) =>
						payload?.playerGuid === playerGuid &&
						payload.entityGeneration === destinationPlayer.generation,
					timeoutMs,
					`teleport ${index + 1} camera registration`,
				);
				void cameraStartedPromise.catch(() => undefined);
				await client.invoke("start_client_camera", {
					request: cameraStartRequest(
						playerGuid,
						destinationPlayer.generation,
						index + 2,
					),
				});
				await cameraStartedPromise;
				lastCompletedPhase = `teleport-${index + 1}-camera-registered`;
				await acknowledgeProbeWorldReveal(client, teleportLifecycle);
				lastCompletedPhase = `teleport-${index + 1}-world-reveal-acknowledged`;
				await inWorldPromise;
				lastCompletedPhase = `teleport-${index + 1}-in-world`;
				await delay(observationMs);
				lastCompletedPhase = `teleport-${index + 1}-observation-completed`;
				sourcePlayer = destinationPlayer;
				previousLifecycle = teleportLifecycle;
			}
		} else if (mode === "passive") {
			await delay(observationMs);
			lastCompletedPhase = "passive-observation-completed";
		} else {
			const runDrivePhase = async (label, request, durationMilliseconds) => {
				const before = actorPhaseSample(latestEntities.get(playerGuid));
				await invokeMovement("replace_client_drive", { request });
				await delay(durationMilliseconds);
				const after = actorPhaseSample(latestEntities.get(playerGuid));
				drivePhases.push({
					label,
					durationMilliseconds,
					displacement:
						before === null || after === null
							? null
							: distance(before.point, after.point),
					headingDelta:
						before === null || after === null
							? null
							: wrappedAngleDelta(before.heading, after.heading),
					playingClipBefore: before?.playingClip ?? null,
					playingClipAfter: after?.playingClip ?? null,
				});
			};
			try {
				await runDrivePhase(
					"forward",
					{ gait: "run", longitudinal: "forward", turning: null },
					observationMs,
				);
				await runDrivePhase(
					"forward-and-turn",
					{ gait: "run", longitudinal: "forward", turning: "right" },
					Math.max(500, Math.floor(observationMs / 4)),
				);
				await runDrivePhase(
					"turn-after-forward-release",
					{ gait: "run", longitudinal: null, turning: "right" },
					Math.max(1_000, Math.floor(observationMs / 2)),
				);
				await runDrivePhase(
					"stop",
					{ gait: "walk", longitudinal: null, turning: null },
					1_000,
				);
			} catch (error) {
				driveError = safeError(error);
			}
			lastCompletedPhase = "drive-start-attempted";
			lastCompletedPhase = "observation-completed";
			if (driveError === null) {
				await invokeMovement("replace_client_drive", {
					request: { gait: "walk", longitudinal: null, turning: null },
				}).catch(() => undefined);
			}
		}
		await client.invoke("disconnect_client").catch(() => undefined);
		await client.shutdown();
		lastCompletedPhase = "shutdown-requested";
		const result = await withTimeout(
			exited,
			EXIT_TIMEOUT_MS,
			"client sidecar did not exit after shutdown",
		);
		lastCompletedPhase = "complete";
		return {
			ok: true,
			mode,
			server: { host: serverHost, port: serverPort },
			selectedCharacter: {
				guid: guidString(selected.guid),
				name: selected.name,
			},
			lifecycle,
			teleport,
			teleports,
			camera: {
				eventCount: cameras.length,
			},
			driveError,
			drivePhases,
			discontinuityCount: discontinuities.length,
			terminalEvents,
			census: census.toJSON(),
			process: result,
		};
	} catch (error) {
		return {
			...createProbeFailureResult(error, {
				credentials: redactionValues,
				lastCompletedPhase,
				lifecycle,
				terminalEvents,
				stderr,
			}),
			mode,
			teleport,
			teleports,
			census: census.toJSON(),
		};
	} finally {
		if (child.exitCode === null && child.signalCode === null) {
			await client.shutdown().catch(() => undefined);
			child.kill();
			await withTimeout(
				exited.catch(() => undefined),
				EXIT_TIMEOUT_MS,
				"sidecar cleanup timed out",
			).catch(() => undefined);
		}
	}
}

function safeError(error) {
	return probeError(error, redactionValues);
}

function redactText(value) {
	return redactProbeText(value, redactionValues);
}

try {
	const result = await main();
	console.log(JSON.stringify(result));
	if (!result.ok) process.exitCode = 1;
} catch (error) {
	console.error(JSON.stringify({ ok: false, error: safeError(error) }));
	process.exitCode = 1;
}
