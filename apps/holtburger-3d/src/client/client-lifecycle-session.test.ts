import {
	entityFacts,
	playerEntitySnapshot,
} from "./client-entity-mirror.test-support";
import { describe, expect, it } from "vitest";

import { landblockVector3 } from "../lib/assets/ac-frame";
import type { DynamicEntityView } from "../lib/game/runtime/dynamic-entity-feed";
import type {
	ClientCurrentState,
	ClientLifecycle,
} from "./client-host-contract";
import {
	ClientLifecycleSession,
	type ClientLifecycleTransport,
} from "./client-lifecycle-session";

class FakeClientTransport implements ClientLifecycleTransport {
	readonly calls: string[] = [];
	readonly invocations: Array<{
		command: string;
		args: Record<string, unknown> | undefined;
	}> = [];
	readonly handlers = new Map<string, (payload: unknown) => void>();
	#currentState: ClientCurrentState = currentState(0x5000_0001);
	#emitLaggedDeltaBeforeSnapshot = false;

	async listen(
		event: string,
		handler: (payload: unknown) => void,
	): Promise<() => void> {
		this.calls.push(`listen:${event}`);
		this.handlers.set(event, handler);
		return () => {
			this.calls.push(`unlisten:${event}`);
			this.handlers.delete(event);
		};
	}

	async invoke(command: string, args?: Record<string, unknown>): Promise<void> {
		this.calls.push(`invoke:${command}`);
		this.invocations.push({ command, args });
		if (command === "request_client_current_state") {
			if (this.#emitLaggedDeltaBeforeSnapshot) {
				this.emit("client-dynamic-entity", {
					kind: "upserted",
					entity: view(0x5000_0003),
				});
			}
			this.emit("client-current-state", this.#currentState);
		}
		void args;
	}

	setCurrentState(state: ClientCurrentState): void {
		this.#currentState = state;
	}

	setEmitLaggedDeltaBeforeSnapshot(enabled: boolean): void {
		this.#emitLaggedDeltaBeforeSnapshot = enabled;
	}

	emit(event: string, payload: unknown): void {
		this.handlers.get(event)?.(payload);
	}
}

describe("ClientLifecycleSession", () => {
	it("delivers validated action feedback and detaches its listener on stop", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		const feedback: unknown[] = [];
		session.subscribe((event) => {
			if (event.type === "action-feedback") feedback.push(event.feedback);
		});
		await session.start();
		transport.emit("client-action-feedback", {
			message: "You're too busy!",
			tone: "warning",
		});
		expect(feedback).toEqual([
			{ message: "You're too busy!", tone: "warning" },
		]);
		expect(() =>
			transport.emit("client-action-feedback", {
				message: "",
				tone: "warning",
			}),
		).toThrow();
		expect(() =>
			transport.emit("client-action-feedback", {
				message: "Invalid tone",
				tone: "fatal",
			}),
		).toThrow();
		session.stop();
		transport.emit("client-action-feedback", {
			message: "Late",
			tone: "warning",
		});
		expect(feedback).toHaveLength(1);
	});

	it("installs every listener before requesting the initial replacement state", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);

		await session.start();

		expect(transport.calls.at(-1)).toBe("invoke:request_client_current_state");
		expect(
			transport.calls.slice(0, -1).every((call) => call.startsWith("listen:")),
		).toBe(true);
		for (const name of [
			"client-current-state",
			"client-state-resyncing",
			"client-entity-facts-changed",
			"client-dynamic-entity",
		]) {
			expect(transport.handlers.has(name)).toBe(true);
		}

		expect(session.state().lifecycle).toEqual({
			kind: "in-world",
		});
		expect(session.state().playerGuid).toBe(0x5000_0001);
		expect(
			session.mirror.entities().map((entity) => entity.identity.guid),
		).toEqual([0x5000_0001]);
	});

	it("accepts the completed character-entry baseline and subsequent inventory deltas", async () => {
		const transport = new FakeClientTransport();
		const startup = currentState(9);
		startup.lifecycle = { kind: "character-selection", characters: [] };
		startup.localPlayerGuid = null;
		startup.entities = { entities: [] };
		startup.dynamic.entities = [];
		transport.setCurrentState(startup);
		const session = new ClientLifecycleSession(transport);
		await session.start();
		// Repeat entry with another character without restarting the transport.
		for (const playerGuid of [9, 19]) {
			transport.emit("client-lifecycle-changed", {
				kind: "portal-space",
				worldGeneration: playerGuid,
				cause: "initial-entry",
			});
			transport.emit("client-local-player-established", { playerGuid });
			const item = entityFacts(playerGuid + 1, {
				ownedByPlayer: true,
				location: {
					kind: "contained",
					parentGuid: playerGuid,
					slot: { kind: "item", index: 0 },
				},
			});
			const baseline = currentState(playerGuid);
			baseline.entities.entities.push(item);
			transport.emit("client-entity-facts-changed", {
				upserts: baseline.entities.entities,
				removed: [],
			});
			expect(session.entities.read().kind).toBe("pending");
			transport.emit("client-lifecycle-changed", { kind: "in-world" });
			transport.emit("client-current-state", baseline);
			transport.emit("client-entity-facts-changed", {
				upserts: [
					entityFacts(item.guid, {
						...item,
						description: {
							kind: "known",
							name: "Updated item",
							healthQuery: "ineligible",
							itemType: 0,
							objectFlags: 0,
							wcid: null,
							weenieType: null,
							pyrealBalance: null,
							stackCount: null,
							structure: { current: null, max: null },
							icon: { base: null, overlay: null, underlay: null, uiEffects: 0 },
						},
					}),
				],
				removed: [],
			});
			const read = session.entities.read();
			if (read.kind !== "current")
				throw new Error("Character entry did not establish inventory.");
			expect(read.level.playerGuid).toBe(playerGuid);
			expect([...read.level.entities.keys()]).toEqual([playerGuid, item.guid]);
			expect(read.level.entities.get(item.guid)?.description).toEqual({
				kind: "known",
				name: "Updated item",
				healthQuery: "ineligible",
				itemType: 0,
				objectFlags: 0,
				wcid: null,
				weenieType: null,
				pyrealBalance: null,
				stackCount: null,
				structure: { current: null, max: null },
				icon: { base: null, overlay: null, underlay: null, uiEffects: 0 },
			});
			// Leaving the character retains the cache until the next entry replaces it.
			transport.emit("client-exit-requested", {
				cause: "server-disconnect",
				diagnostic: "Session ended",
			});
			transport.emit("client-lifecycle-changed", {
				kind: "exiting",
				cause: "server-disconnect",
			});
			transport.emit("client-lifecycle-changed", {
				kind: "character-selection",
				characters: [],
			});
			expect(session.entities.read()).toBe(read);
		}
		session.stop();
	});

	it("retires semantic state on stop and accepts reused GUIDs only from a new baseline", async () => {
		const transport = new FakeClientTransport();
		const initial = currentState(9);
		initial.entities.entities.push(
			entityFacts(10, {
				ownedByPlayer: true,
				location: {
					kind: "contained",
					parentGuid: 9,
					slot: { kind: "item", index: 0 },
				},
			}),
		);
		transport.setCurrentState(initial);
		const session = new ClientLifecycleSession(transport);
		await session.start();
		session.stop();
		expect(session.entities.read()).toEqual({ kind: "pending" });
		expect(transport.handlers.size).toBe(0);
		const replacement = currentState(9);
		replacement.entities = {
			entities: [
				entityFacts(9, {
					description: {
						kind: "known",
						name: "New character",
						healthQuery: "eligible",
						itemType: 0,
						objectFlags: 0,
						wcid: null,
						weenieType: null,
						pyrealBalance: null,
						stackCount: null,
						structure: { current: null, max: null },
						icon: { base: null, overlay: null, underlay: null, uiEffects: 0 },
					},
				}),
			],
		};
		transport.setCurrentState(replacement);
		await session.start();
		const read = session.entities.read();
		if (read.kind !== "current")
			throw new Error("Restart did not establish a baseline.");
		expect([...read.level.entities.keys()]).toEqual([9]);
		expect(read.level.entities.get(9)?.description).toEqual({
			kind: "known",
			name: "New character",
			healthQuery: "eligible",
			itemType: 0,
			objectFlags: 0,
			wcid: null,
			weenieType: null,
			pyrealBalance: null,
			stackCount: null,
			structure: { current: null, max: null },
			icon: { base: null, overlay: null, underlay: null, uiEffects: 0 },
		});
		session.stop();
	});

	it("keeps shell and both mirrors unchanged when replacement validation fails", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		await session.start();
		const before = session.entities.read();
		const player = session.state().playerGuid;
		const invalid = currentState(9);
		invalid.dynamic.entities = [view(9), view(9)];
		expect(() => transport.emit("client-current-state", invalid)).toThrow(
			"duplicate GUID",
		);
		expect(session.state().playerGuid).toBe(player);
		expect(session.entities.read()).toBe(before);
		expect(
			session.mirror.entities().map((record) => record.identity.guid),
		).toEqual([player]);
	});

	it("marks recovery pending, gates both delta paths, and notifies only after replacement", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		await session.start();
		transport.emit("client-state-resyncing", null);
		expect(session.entities.read().kind).toBe("pending");
		transport.emit("client-entity-facts-changed", {
			upserts: playerEntitySnapshot(9).entities,
			removed: [],
		});
		transport.emit("client-dynamic-entity", {
			kind: "upserted",
			entity: view(9),
		});
		expect(session.entities.read().kind).toBe("pending");
		const observed: number[] = [];
		session.subscribe((event) => {
			if (event.type !== "current-state" && event.type !== "dynamic") return;
			const read = session.entities.read();
			if (read.kind !== "current")
				throw new Error("Replacement notified before semantic commit.");
			expect(read.level.entities.has(9)).toBe(true);
			expect(
				session.mirror.entities().map((record) => record.identity.guid),
			).toEqual([9]);
			observed.push(9);
		});
		transport.emit("client-current-state", currentState(9));
		expect(observed).toEqual([9, 9]);
	});

	it("submits and delivers correlated entity-selection queries without mutating state", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		const delivered: unknown[] = [];
		session.subscribe((event) => {
			if (event.type === "entity-selection-query-result")
				delivered.push(event.result);
		});
		await session.start();

		await session.queryEntitySelectionCandidates({
			camera: {
				cameraGeneration: 2,
				playerGuid: 0x5000_0001,
				entityGeneration: 7,
			},
			sequence: 12,
			anchor: 0xda55_ffff,
			start: landblockVector3([10, 20, 4]),
			direction: [0, 1, 0],
			previousCell: null,
		});
		transport.emit("client-entity-selection-query-result", {
			status: "available",
			sequence: 12,
			staticLimitDistance: 45,
			candidateGuids: [0x7000_0001],
		});

		expect(transport.invocations.at(-1)?.command).toBe(
			"query_client_entity_selection_candidates",
		);
		expect(delivered).toEqual([
			{
				status: "available",
				sequence: 12,
				staticLimitDistance: 45,
				candidateGuids: [0x7000_0001],
			},
		]);
		expect(session.state().playerGuid).toBe(0x5000_0001);
	});

	it("validates precise-jump commands and projects correlated results", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		const events: string[] = [];
		session.subscribe((event) => events.push(event.type));
		await session.start();
		events.length = 0;

		const camera = {
			cameraGeneration: 2,
			playerGuid: 0x5000_0001,
			entityGeneration: 7,
		};
		await session.setPreciseJumpAim({
			camera,
			sequence: 9,
			anchor: 0xda55_ffff,
			start: landblockVector3([10, 20, 4]),
			direction: [0, 1, 0],
			maximumDistance: 80,
			previousCell: null,
		});
		await session.commitPreciseJump({ sequence: 3, evaluationId: 11 });
		await session.cancelPreciseJump({ sequence: 4 });

		transport.emit("client-precise-jump-evaluation", {
			evaluationId: 11,
			camera,
			sequence: 9,
			target: {
				anchor: 0xda55_ffff,
				point: [10, 40, 0],
				normal: [0, 0, 1],
				committedCell: null,
			},
			status: "reachable",
			trajectory: {
				anchor: 0xda55_ffff,
				origin: [10, 20, 4],
				velocity: [0, 14, 8],
				acceleration: [0, 0, -9.8],
				durationSeconds: 1.5,
				placements: [
					{
						startFraction: 0,
						endFraction: 1,
						committedCell: null,
					},
				],
			},
			diagnostics: {
				generatedCandidates: 6,
				evaluatedCandidates: 2,
				solverTicks: 71,
			},
		});
		transport.emit("client-precise-jump-transaction-feedback", {
			sequence: 3,
			outcome: { kind: "committed" },
		});

		expect(
			transport.invocations.slice(-3).map(({ command }) => command),
		).toEqual([
			"set_client_precise_jump_aim",
			"commit_client_precise_jump",
			"cancel_client_precise_jump",
		]);
		expect(events).toEqual([
			"precise-jump-evaluation",
			"precise-jump-transaction-feedback",
		]);
		await expect(
			session.setPreciseJumpAim({
				camera,
				sequence: 10,
				anchor: 0xda55_ffff,
				start: landblockVector3([Number.NaN, 0, 0]),
				direction: [0, 1, 0],
				maximumDistance: 80,
				previousCell: null,
			}),
		).rejects.toThrow();
	});

	it("suppresses deltas during recovery and accepts only the replacement snapshot", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		await session.start();

		transport.setCurrentState(currentState(0x5000_0002));
		transport.setEmitLaggedDeltaBeforeSnapshot(true);
		await session.requestCurrentState();

		expect(
			session.mirror.entities().map((entity) => entity.identity.guid),
		).toEqual([0x5000_0002]);
	});

	it("advances world generation atomically with portal lifecycle and rejects stale portals", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		const lifecycles: ClientLifecycle[] = [];
		session.subscribe((event) => {
			if (event.type === "lifecycle") lifecycles.push(event.lifecycle);
		});
		await session.start();
		lifecycles.length = 0;

		const currentPortal: ClientLifecycle = {
			kind: "portal-space",
			cause: "teleport",
			worldGeneration: 4,
		};
		transport.emit("client-lifecycle-changed", currentPortal);
		expect(session.state()).toMatchObject({
			lifecycle: currentPortal,
			worldGeneration: 4,
		});

		transport.emit("client-lifecycle-changed", {
			kind: "portal-space",
			cause: "teleport",
			worldGeneration: 3,
		});
		expect(session.state()).toMatchObject({
			lifecycle: currentPortal,
			worldGeneration: 4,
		});
		expect(lifecycles).toEqual([currentPortal]);
	});

	it("projects strict lifecycle, time, correction, and terminal updates", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		const events: string[] = [];
		session.subscribe((event) => events.push(event.type));
		await session.start();
		transport.emit("client-local-player-established", { playerGuid: 9 });

		const lifecycle: ClientLifecycle = {
			kind: "character-selection",
			characters: [{ guid: 7, name: "Mira", slot: 3, deleteTime: 0 }],
		};
		transport.emit("client-lifecycle-changed", lifecycle);
		transport.emit("client-server-time-updated", { time: 12.5 });
		transport.emit("client-world-name-updated", { name: "Morningthaw" });
		transport.emit("client-player-entered", { playerGuid: 9, name: "Mira" });
		transport.emit("client-player-vitals-updated", {
			vitals: [{ kind: "health", current: 80, maximum: 100 }],
		});
		transport.emit("client-chat-message", {
			kind: "speech",
			sender: "Mira",
			speakerKind: "player",
			message: "Hello",
		});
		transport.emit("client-dynamic-script-cue", {
			guid: 9,
			generation: 3,
			cue: 7,
			intensity: 0.5,
		});
		transport.emit("client-presentation-discontinuity", {
			worldGeneration: 4,
			kind: "reset",
		});
		transport.emit("client-exit-requested", {
			cause: "server-disconnect",
			diagnostic: "server closed the session",
		});

		expect(session.state()).toMatchObject({
			lifecycle: { kind: "exiting", cause: "server-disconnect" },
			serverTime: 12.5,
			worldGeneration: 4,
			playerGuid: 9,
			playerName: "Mira",
			worldName: "Morningthaw",
			vitals: [{ kind: "health", current: 80, maximum: 100 }],
			exit: {
				cause: "server-disconnect",
				diagnostic: "server closed the session",
			},
		});
		expect(events).toEqual([
			"current-state",
			"dynamic",
			"local-player-established",
			"lifecycle",
			"server-time",
			"world-name",
			"player-entered",
			"vitals",
			"chat",
			"dynamic-script-cue",
			"presentation-discontinuity",
			"lifecycle",
			"exit-requested",
		]);
	});

	it("validates the renderer drive before crossing the host command seam", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);

		await session.replaceDrive({
			kind: "acquire",
			drive: {
				gait: "run",
				longitudinal: "forward",
				lateral: "left",
				turning: null,
			},
		});
		expect(transport.calls).toEqual(["invoke:replace_client_drive"]);
		await expect(
			session.replaceDrive({
				kind: "acquire",
				drive: {
					gait: "sprint",
					longitudinal: null,
					lateral: null,
					turning: null,
				},
			} as never),
		).rejects.toThrow();
		expect(transport.calls).toHaveLength(1);
	});

	it("validates and forwards ordered character-motion edges without reshaping them", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		const release = {
			kind: "release-jump" as const,
			sequence: 12,
			drive: {
				gait: "run" as const,
				longitudinal: "forward" as const,
				lateral: "right" as const,
				turning: null,
			},
			extent: 0.625,
		};

		await session.queueCharacterMotionEvent(release);

		expect(transport.invocations).toEqual([
			{
				command: "queue_client_character_motion_event",
				args: { request: release },
			},
		]);
		await expect(
			session.queueCharacterMotionEvent({
				...release,
				sequence: 13,
				extent: 1.1,
			}),
		).rejects.toThrow();
		expect(transport.invocations).toHaveLength(1);
	});

	it("replaces charge timing and projects sequenced character-motion feedback", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);
		const events: string[] = [];
		session.subscribe((event) => events.push(event.type));
		await session.start();
		events.length = 0;

		transport.emit("client-character-motion-capabilities-updated", {
			fullChargeDurationMs: 800,
		});
		transport.emit("client-character-motion-feedback", {
			sequence: 17,
			outcome: { kind: "rejected", reason: "overburdened" },
		});

		expect(session.state().characterMotion).toEqual({
			fullChargeDurationMs: 800,
		});
		expect(events).toEqual([
			"character-motion-capabilities",
			"character-motion-feedback",
		]);
	});

	it("submits one exact character identity for an explicit enter action", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);

		await session.enterWorld(0x5000_0002);
		await session.enterWorld(0x5000_0002);

		expect(transport.calls).toEqual(["invoke:select_client_character"]);
	});

	it("sends visible local speech and rejects empty input before transport", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);

		await session.sendChat("Hello world");
		expect(transport.calls).toEqual(["invoke:send_client_chat"]);
		await expect(session.sendChat("   ")).rejects.toThrow("visible text");
		expect(transport.calls).toHaveLength(1);
	});
});

function currentState(playerGuid: number): ClientCurrentState {
	return {
		lifecycle: { kind: "in-world" },
		entityCollisionDisabled: false,
		localPlayerGuid: playerGuid,
		entities: playerEntitySnapshot(playerGuid),
		serverTime: 10,
		worldGeneration: 2,
		worldName: "Leafcull",
		playerName: "Drudge",
		vitals: [],
		characterMotion: null,
		activeConfirmation: null,
		dynamic: {
			hostTime: { seconds: 10 },
			entities: [view(playerGuid)],
		},
	};
}

function view(guid: number): DynamicEntityView {
	return {
		generation: 1,
		identity: { guid, wcid: 42 },
		display: { name: "Drudge", level: null },
		presentation: {
			entityClass: "other",
			content: {
				motionTableDid: null,
				setupDid: 0x0200_0001,
				soundTableDid: null,
				physicsEffectTableDid: null,
			},
			appearance: {
				paletteDid: null,
				subPalettes: [],
				textureChanges: [],
				partChanges: [],
			},
			objectScale: 1,
			radar: {
				behavior: null,
				category: "other",
				obviousRange: null,
			},
		},
		physics: {
			semanticMask: 0,
			participation: "pose-only",
			noDraw: false,
			hidden: false,
			cloaked: false,
			translucency: 0,
			lighting: false,
			defaultAnimation: false,
			defaultScript: false,
		},
		placement: {
			kind: "attached",
			parent: 0,
			parentLocation: "none",
			placement: "default",
		},
		motion: null,
	};
}
