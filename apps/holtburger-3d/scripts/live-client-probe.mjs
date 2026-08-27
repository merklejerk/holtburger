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

function entitiesInPayload(event, payload) {
	if (event === "client-current-state") return payload?.dynamic?.entities ?? [];
	if (event !== "client-dynamic-entity") return [];
	if (payload?.kind === "snapshot") return payload.snapshot?.entities ?? [];
	if (payload?.kind === "upserted")
		return payload.entity ? [payload.entity] : [];
	if (payload?.kind === "advanced") {
		return payload.batch?.advances?.map((advance) => advance.entity) ?? [];
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
		wait(event, predicate, milliseconds) {
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
						new Error(`timed out waiting for ${event} after ${milliseconds}ms`),
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
	const census = createCensus();
	const waiter = createWaiter();
	const lifecycle = [];
	const cameras = [];
	const discontinuities = [];
	const terminalEvents = [];
	const latestEntities = new Map();
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
					} else if (payload?.kind === "advanced") {
						for (const advance of payload.batch?.advances ?? []) {
							latestEntities.set(advance.entity.identity.guid, advance.entity);
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

		const selectionPromise = waiter.wait(
			"client-lifecycle-changed",
			(payload) => payload?.kind === "character-selection",
			timeoutMs,
		);
		void selectionPromise.catch(() => undefined);
		try {
			await client.startClient({
				host: serverHost,
				port: serverPort,
				account,
				password,
			});
		} catch (error) {
			waiter.cancel(error);
			throw error;
		}
		const selection = await selectionPromise;
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
		);
		void inWorldPromise.catch(() => undefined);
		const localPlayerPromise = waiter.wait(
			"client-local-player-established",
			(payload) => Number.isInteger(payload?.playerGuid),
			timeoutMs,
		);
		void localPlayerPromise.catch(() => undefined);
		await client.invoke("select_client_character", { guid: selected.guid });
		await inWorldPromise;
		const { playerGuid } = await localPlayerPromise;
		census.setFocusGuid(playerGuid);

		const currentStatePromise = waiter.wait(
			"client-current-state",
			(payload) => payload?.lifecycle?.kind === "in-world",
			timeoutMs,
		);
		void currentStatePromise.catch(() => undefined);
		await client.invoke("request_client_current_state");
		const currentState = await currentStatePromise;
		if (currentState.localPlayerGuid !== playerGuid) {
			throw new Error(
				"current state disagreed with established local-player identity",
			);
		}
		let player = currentState.dynamic?.entities?.find(
			(entity) => entity.identity?.guid === playerGuid,
		);
		if (player === undefined) {
			const playerEventPromise = waiter.wait(
				"client-dynamic-entity",
				(payload) =>
					(payload?.kind === "upserted" &&
						payload.entity?.identity?.guid === playerGuid) ||
					(payload?.kind === "advanced" &&
						payload.batch?.advances?.some(
							(advance) => advance.entity?.identity?.guid === playerGuid,
						)),
				timeoutMs,
			);
			void playerEventPromise.catch(() => undefined);
			const event = await playerEventPromise;
			player =
				event.kind === "upserted"
					? event.entity
					: event.batch.advances.find(
							(advance) => advance.entity.identity.guid === playerGuid,
						)?.entity;
		}
		player ??= latestEntities.get(playerGuid);
		if (player !== undefined) census.seedFocusEntity(player);
		let cameraStartError = null;
		if (player?.placement?.kind === "world") {
			try {
				await client.invoke("start_client_camera", {
					request: {
						playerGuid,
						entityGeneration: player.generation,
						initialReach: 4.5,
						minimumReach: 1.2,
						maximumReach: 8,
						inputSequence: 1,
						viewDirection: [0, -0.2, -1],
						cumulativeZoomDisplacement: 0,
						projectionRevision: 1,
						clearanceRadius: 0.2,
					},
				});
			} catch (error) {
				cameraStartError = safeError(error);
			}
		}

		let driveError = null;
		try {
			await client.invoke("replace_client_drive", {
				request: { gait: "run", longitudinal: "forward", turning: null },
			});
		} catch (error) {
			driveError = safeError(error);
		}
		await delay(observationMs);
		if (driveError === null) {
			await client
				.invoke("replace_client_drive", {
					request: { gait: "walk", longitudinal: null, turning: null },
				})
				.catch(() => undefined);
		}
		await client.invoke("disconnect_client").catch(() => undefined);
		await client.shutdown();
		const result = await withTimeout(
			exited,
			EXIT_TIMEOUT_MS,
			"client sidecar did not exit after shutdown",
		);
		return {
			ok: true,
			server: { host: serverHost, port: serverPort },
			selectedCharacter: {
				guid: guidString(selected.guid),
				name: selected.name,
			},
			lifecycle,
			camera: {
				startError: cameraStartError,
				eventCount: cameras.length,
			},
			driveError,
			discontinuityCount: discontinuities.length,
			terminalEvents,
			census: census.toJSON(),
			process: result,
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
		// Stderr is intentionally not printed: a server diagnostic must not accidentally echo a
		// credential supplied through the environment. Keep it available to the debugger without
		// making it part of the machine-readable output.
		void stderr;
	}
}

function safeError(error) {
	const message = error instanceof Error ? error.message : String(error);
	return {
		...(error instanceof Error ? { name: error.name } : {}),
		message: redactText(message),
	};
}

function redactText(value) {
	const text = String(value);
	const withoutAccount =
		redactionValues.account.length > 0
			? text.replaceAll(redactionValues.account, "<account>")
			: text;
	return redactionValues.password.length > 0
		? withoutAccount.replaceAll(redactionValues.password, "<password>")
		: withoutAccount;
}

try {
	console.log(JSON.stringify(await main()));
} catch (error) {
	console.error(JSON.stringify({ ok: false, error: safeError(error) }));
	process.exitCode = 1;
}
