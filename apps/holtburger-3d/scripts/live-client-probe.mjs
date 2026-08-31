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

function optionalPlanarOffset(value) {
	if (value === undefined) return [0, 0];
	const components = value.split(",").map(Number);
	if (
		components.length !== 2 ||
		components.some((component) => !Number.isFinite(component))
	) {
		throw new Error(
			"HOLTBURGER_PROBE_PRECISE_JUMP_LOCAL_OFFSET must be two finite comma-separated numbers.",
		);
	}
	return components;
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
		const clipChanged = previous === undefined || previous.clip !== clip;
		actorMotion.set(entity.identity.guid, {
			point,
			name: entity.identity.name,
			wcid: entity.identity.wcid,
			category: entity.presentation?.category ?? null,
			setupDid: entity.presentation?.content?.setupDid ?? null,
			motionTableDid: entity.presentation?.content?.motionTableDid ?? null,
			sampleCount: (previous?.sampleCount ?? 0) + 1,
			totalDistance: (previous?.totalDistance ?? 0) + step,
			maximumStep: Math.max(previous?.maximumStep ?? 0, step),
			clip,
			clipHistory: clipChanged
				? [...(previous?.clipHistory ?? []), entity.playingClip ?? null]
				: previous.clipHistory,
			contacts: new Set([
				...(previous?.contacts ?? []),
				entity.placement.contact,
			]),
			clipTransitions:
				(previous?.clipTransitions ?? 0) +
				(previous !== undefined && clipChanged ? 1 : 0),
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
								name: motion.name,
								wcid: motion.wcid,
								category: motion.category,
								setupDid: motion.setupDid,
								motionTableDid: motion.motionTableDid,
								sampleCount: motion.sampleCount,
								totalDistance: motion.totalDistance,
								maximumStep: motion.maximumStep,
								clipTransitions: motion.clipTransitions,
								clipHistory: motion.clipHistory,
								contacts: [...motion.contacts].sort(),
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
		cellId: entity.placement.pose.landblockId,
		contact: entity.placement.contact,
		heading: entityHeading(entity),
		point: worldPoint(entity.placement.pose),
		playingClip: entity.playingClip ?? null,
		sampleMode: entity.placement.sampleMode,
	};
}

function isGroundedWorldEntity(entity, guid) {
	return (
		entity?.identity?.guid === guid &&
		entity.placement?.kind === "world" &&
		entity.placement.contact === "grounded"
	);
}

async function waitForGroundedPlayer(waiter, latestEntities, guid, timeoutMs) {
	const current = latestEntities.get(guid);
	if (isGroundedWorldEntity(current, guid)) return current;
	const payload = await waiter.wait(
		"client-dynamic-entity",
		(candidate) =>
			entitiesInPayload("client-dynamic-entity", candidate).some((entity) =>
				isGroundedWorldEntity(entity, guid),
			),
		timeoutMs,
		"grounded local-player collision body",
	);
	return entitiesInPayload("client-dynamic-entity", payload).find((entity) =>
		isGroundedWorldEntity(entity, guid),
	);
}

function firstGroundedSampleAfterAirborne(trajectory) {
	let observedAirborne = false;
	for (const sample of trajectory) {
		if (sample.contact === "airborne") observedAirborne = true;
		if (observedAirborne && sample.contact === "grounded") return sample;
	}
	return null;
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
	const probePreciseJump = process.env.HOLTBURGER_PROBE_PRECISE_JUMP === "1";
	const preciseJumpTargetGuid = optionalGuid(
		process.env.HOLTBURGER_PROBE_PRECISE_JUMP_TARGET_GUID,
	);
	const preciseJumpLocalOffset = optionalPlanarOffset(
		process.env.HOLTBURGER_PROBE_PRECISE_JUMP_LOCAL_OFFSET,
	);
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
	const characterMotionFeedback = [];
	let characterMotionCapabilities = null;
	let jump = null;
	let preciseJump = null;
	const terminalEvents = [];
	const latestEntities = new Map();
	let teleport = null;
	const teleports = [];
	const events = [
		"client-current-state",
		"client-lifecycle-changed",
		"client-character-motion-capabilities-updated",
		"client-character-motion-feedback",
		"client-precise-jump-evaluation",
		"client-precise-jump-transaction-feedback",
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
				if (event === "client-character-motion-capabilities-updated")
					characterMotionCapabilities = payload;
				if (event === "client-character-motion-feedback")
					characterMotionFeedback.push(payload);
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
		characterMotionCapabilities = currentState.characterMotion;
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
		}
		if (mode === "passive") {
			await delay(observationMs);
			lastCompletedPhase = "passive-observation-completed";
		} else {
			if (probePreciseJump) {
				const entity = await waitForGroundedPlayer(
					waiter,
					latestEntities,
					playerGuid,
					timeoutMs,
				);
				if (entity?.placement?.kind !== "world") {
					throw new Error("precise-jump probe requires a world-placed player");
				}
				const camera = [...cameras]
					.reverse()
					.find(({ event }) => event === "client-camera-started")?.payload;
				if (camera === undefined) {
					throw new Error("precise-jump probe has no active camera identity");
				}
				const pose = entity.placement.pose;
				const targetEntity =
					preciseJumpTargetGuid === undefined
						? null
						: latestEntities.get(preciseJumpTargetGuid);
				if (
					preciseJumpTargetGuid !== undefined &&
					targetEntity?.placement?.kind !== "world"
				) {
					throw new Error(
						"precise-jump target entity is absent or not world-placed",
					);
				}
				const before = actorPhaseSample(entity);
				if (before === null) {
					throw new Error("precise-jump probe has no world-space actor sample");
				}
				const [localRight, localForward] = preciseJumpLocalOffset;
				const offsetX =
					Math.sin(before.heading) * localRight -
					Math.cos(before.heading) * localForward;
				const offsetY =
					Math.cos(before.heading) * localRight +
					Math.sin(before.heading) * localForward;
				const targetPose = targetEntity?.placement.pose;
				const exactCell =
					Number(targetPose?.landblockId ?? pose.landblockId) >>> 0;
				const anchor = ((exactCell & 0xffff0000) | 0x0000ffff) >>> 0;
				const cellSelector = exactCell & 0xffff;
				const aimSequence = 20_000;
				const evaluationPromise = waiter.wait(
					"client-precise-jump-evaluation",
					(payload) => payload?.sequence === aimSequence,
					timeoutMs,
					"precise-jump evaluation",
				);
				void evaluationPromise.catch(() => undefined);
				const evaluationStartedAt = performance.now();
				await invokeMovement("set_client_precise_jump_aim", {
					request: {
						camera,
						sequence: aimSequence,
						anchor,
						start:
							targetPose === undefined
								? [
										pose.coords.x + offsetX,
										pose.coords.y + offsetY,
										pose.coords.z + 2,
									]
								: [
										targetPose.coords.x,
										targetPose.coords.y,
										targetPose.coords.z + 5,
									],
						direction: [0, 0, -1],
						maximumDistance: 8,
						previousCell:
							cellSelector >= 0x0100 && cellSelector !== 0xffff
								? exactCell
								: null,
					},
				});
				const evaluation = await evaluationPromise;
				const evaluationLatencyMs = performance.now() - evaluationStartedAt;
				preciseJump = { evaluation };
				if (evaluation.status !== "reachable" || evaluation.target === null) {
					throw new Error(
						`precise-jump standing target was ${evaluation.status}`,
					);
				}
				const actionSequence = 20_001;
				const feedbackPromise = waiter.wait(
					"client-precise-jump-transaction-feedback",
					(payload) => payload?.sequence === actionSequence,
					timeoutMs,
					"precise-jump commit feedback",
				);
				void feedbackPromise.catch(() => undefined);
				await invokeMovement("commit_client_precise_jump", {
					request: {
						sequence: actionSequence,
						evaluationId: evaluation.evaluationId,
					},
				});
				const feedback = await feedbackPromise;
				if (feedback.outcome?.kind !== "committed") {
					throw new Error(
						`precise-jump commit was ${feedback.outcome?.reason ?? feedback.outcome?.kind ?? "unknown"}`,
					);
				}
				const trajectory = [];
				for (let elapsed = 0; elapsed <= 5_000; elapsed += 50) {
					const sample = actorPhaseSample(latestEntities.get(playerGuid));
					if (sample !== null) trajectory.push(sample);
					await delay(50);
				}
				const firstLanding = firstGroundedSampleAfterAirborne(trajectory);
				const after = trajectory.at(-1) ?? null;
				const predicted = worldPoint({
					landblockId: evaluation.target.anchor,
					coords: {
						x: evaluation.target.point[0],
						y: evaluation.target.point[1],
						z: evaluation.target.point[2],
					},
				});
				const closestApproach = trajectory.reduce((closest, sample) => {
					const separation = distance(predicted, sample.point);
					return closest === null || separation < closest.separation
						? { sample, separation }
						: closest;
				}, null);
				preciseJump = {
					aimSequence,
					actionSequence,
					localTargetOffset: preciseJumpLocalOffset,
					evaluationLatencyMs,
					targetEntityGuid:
						preciseJumpTargetGuid === undefined
							? null
							: guidString(preciseJumpTargetGuid),
					evaluation,
					feedback,
					before,
					after,
					predictedFirstLanding: predicted,
					observedFirstLanding: firstLanding,
					observedLandingError:
						firstLanding === null
							? null
							: distance(predicted, firstLanding.point),
					closestObservedApproach: closestApproach,
					contactStates: [
						...new Set(trajectory.map((sample) => sample.contact)),
					],
				};
			}
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
					{
						gait: "run",
						longitudinal: "forward",
						lateral: null,
						turning: null,
					},
					observationMs,
				);
				await runDrivePhase(
					"strafe-left",
					{
						gait: "run",
						longitudinal: null,
						lateral: "left",
						turning: null,
					},
					Math.max(500, Math.floor(observationMs / 4)),
				);
				await runDrivePhase(
					"forward-and-strafe-right",
					{
						gait: "run",
						longitudinal: "forward",
						lateral: "right",
						turning: null,
					},
					Math.max(500, Math.floor(observationMs / 4)),
				);
				await runDrivePhase(
					"forward-and-turn",
					{
						gait: "run",
						longitudinal: "forward",
						lateral: null,
						turning: "right",
					},
					Math.max(500, Math.floor(observationMs / 4)),
				);
				await runDrivePhase(
					"turn-after-forward-release",
					{
						gait: "run",
						longitudinal: null,
						lateral: null,
						turning: "right",
					},
					Math.max(1_000, Math.floor(observationMs / 2)),
				);
				await runDrivePhase(
					"stop",
					{
						gait: "walk",
						longitudinal: null,
						lateral: null,
						turning: null,
					},
					1_000,
				);
				if (characterMotionCapabilities === null) {
					throw new Error(
						"current state did not contain authoritative character-motion capability",
					);
				}
				const idleDrive = {
					gait: "run",
					longitudinal: null,
					lateral: null,
					turning: null,
				};
				const releaseDrive = {
					gait: "run",
					longitudinal: "forward",
					lateral: "right",
					turning: null,
				};
				const beginSequence = 10_000;
				const releaseSequence = beginSequence + 1;
				const acceptedPromise = waiter.wait(
					"client-character-motion-feedback",
					(payload) =>
						payload?.sequence === beginSequence &&
						(payload.outcome?.kind === "charge-accepted" ||
							payload.outcome?.kind === "rejected"),
					timeoutMs,
					"jump charge feedback",
				);
				void acceptedPromise.catch(() => undefined);
				await invokeMovement("queue_client_character_motion_event", {
					request: {
						kind: "begin-jump",
						sequence: beginSequence,
						drive: idleDrive,
					},
				});
				const accepted = await acceptedPromise;
				if (accepted.outcome.kind !== "charge-accepted") {
					throw new Error(
						`jump charge was rejected: ${accepted.outcome.reason ?? "unknown"}`,
					);
				}
				await delay(
					Math.max(
						50,
						Math.floor(characterMotionCapabilities.fullChargeDurationMs / 2),
					),
				);
				const beforeJump = actorPhaseSample(latestEntities.get(playerGuid));
				const committedPromise = waiter.wait(
					"client-character-motion-feedback",
					(payload) =>
						payload?.sequence === releaseSequence &&
						(payload.outcome?.kind === "jump-committed" ||
							payload.outcome?.kind === "rejected"),
					timeoutMs,
					"jump release feedback",
				);
				void committedPromise.catch(() => undefined);
				await invokeMovement("queue_client_character_motion_event", {
					request: {
						kind: "release-jump",
						sequence: releaseSequence,
						drive: releaseDrive,
						extent: 0.5,
					},
				});
				const committed = await committedPromise;
				if (committed.outcome.kind !== "jump-committed") {
					throw new Error(
						`jump release was rejected: ${committed.outcome.reason ?? "unknown"}`,
					);
				}
				await invokeMovement("replace_client_drive", { request: idleDrive });
				const trajectory = [];
				for (let elapsed = 0; elapsed <= 5_000; elapsed += 50) {
					const sample = actorPhaseSample(latestEntities.get(playerGuid));
					if (sample !== null) trajectory.push(sample);
					await delay(50);
				}
				const afterJump = actorPhaseSample(latestEntities.get(playerGuid));
				const lateTrajectory = trajectory.slice(-10);
				const trajectoryStates = trajectory.map((sample) => ({
					cellId: sample.cellId,
					contact: sample.contact,
					sampleMode: sample.sampleMode,
				}));
				const airborneTrajectory = trajectory.filter(
					(sample) => sample.contact === "airborne",
				);
				const playingClipTransitions = trajectory
					.filter(
						(sample, index, samples) =>
							index === 0 ||
							sample.playingClip?.animationId !==
								samples[index - 1].playingClip?.animationId,
					)
					.map((sample) => ({
						animationId: sample.playingClip?.animationId ?? null,
						contact: sample.contact,
					}));
				const contactTransitions = trajectoryStates.filter(
					(state, index, states) =>
						index === 0 || state.contact !== states[index - 1].contact,
				);
				jump = {
					beginSequence,
					releaseSequence,
					extent: 0.5,
					chargeDurationMs: characterMotionCapabilities.fullChargeDurationMs,
					feedback: [accepted, committed],
					peakVerticalDisplacement:
						beforeJump === null || trajectory.length === 0
							? null
							: Math.max(
									...trajectory.map(
										(sample) => sample.point.z - beforeJump.point.z,
									),
								),
					airbornePeakVerticalDisplacement:
						beforeJump === null || airborneTrajectory.length === 0
							? null
							: Math.max(
									...airborneTrajectory.map(
										(sample) => sample.point.z - beforeJump.point.z,
									),
								),
					planarDisplacement:
						beforeJump === null || afterJump === null
							? null
							: Math.hypot(
									afterJump.point.x - beforeJump.point.x,
									afterJump.point.y - beforeJump.point.y,
								),
					finalVerticalDisplacement:
						beforeJump === null || afterJump === null
							? null
							: afterJump.point.z - beforeJump.point.z,
					lateVerticalRange:
						lateTrajectory.length === 0
							? null
							: Math.max(...lateTrajectory.map((sample) => sample.point.z)) -
								Math.min(...lateTrajectory.map((sample) => sample.point.z)),
					contactStates: [
						...new Set(trajectoryStates.map((state) => state.contact)),
					],
					contactTransitions,
					playingClipTransitions,
					sampleModes: [
						...new Set(trajectoryStates.map((state) => state.sampleMode)),
					],
					cellIds: [...new Set(trajectoryStates.map((state) => state.cellId))],
					finalContact: afterJump?.contact ?? null,
					finalSampleMode: afterJump?.sampleMode ?? null,
					playingClipAfter: afterJump?.playingClip ?? null,
				};
			} catch (error) {
				driveError = safeError(error);
			}
			lastCompletedPhase = "drive-start-attempted";
			lastCompletedPhase = "observation-completed";
			if (driveError === null) {
				await invokeMovement("replace_client_drive", {
					request: {
						gait: "walk",
						longitudinal: null,
						lateral: null,
						turning: null,
					},
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
			characterMotionCapabilities,
			characterMotionFeedback,
			jump,
			preciseJump,
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
			characterMotionCapabilities,
			characterMotionFeedback,
			jump,
			preciseJump,
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
