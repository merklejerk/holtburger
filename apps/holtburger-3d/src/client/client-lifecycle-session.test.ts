import { describe, expect, it } from "vitest";

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
	it("installs every listener before requesting the initial replacement state", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);

		await session.start();

		expect(transport.calls.slice(0, 14)).toEqual([
			"listen:client-dynamic-entity",
			"listen:client-current-state",
			"listen:client-lifecycle-changed",
			"listen:client-local-player-established",
			"listen:client-server-time-updated",
			"listen:client-world-name-updated",
			"listen:client-player-entered",
			"listen:client-player-vitals-updated",
			"listen:client-chat-message",
			"listen:client-presentation-discontinuity",
			"listen:client-camera-started",
			"listen:client-camera",
			"listen:client-exit-requested",
			"invoke:request_client_current_state",
		]);
		expect(session.state().lifecycle).toEqual({
			kind: "in-world",
		});
		expect(session.state().playerGuid).toBe(0x5000_0001);
		expect(
			session.mirror.entities().map((entity) => entity.identity.guid),
		).toEqual([0x5000_0001]);
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
			channel: null,
			message: "Hello",
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
			"presentation-discontinuity",
			"lifecycle",
			"exit-requested",
		]);
	});

	it("validates the renderer drive before crossing the host command seam", async () => {
		const transport = new FakeClientTransport();
		const session = new ClientLifecycleSession(transport);

		await session.replaceDrive({
			gait: "run",
			longitudinal: "forward",
			turning: null,
		});
		expect(transport.calls).toEqual(["invoke:replace_client_drive"]);
		await expect(
			session.replaceDrive({
				gait: "sprint",
				longitudinal: null,
				turning: null,
			} as never),
		).rejects.toThrow();
		expect(transport.calls).toHaveLength(1);
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
		localPlayerGuid: playerGuid,
		serverTime: 10,
		worldGeneration: 2,
		worldName: "Leafcull",
		playerName: "Drudge",
		vitals: [],
		dynamic: {
			hostTime: { seconds: 10 },
			entities: [view(playerGuid)],
		},
	};
}

function view(guid: number): DynamicEntityView {
	return {
		generation: 1,
		identity: { guid, wcid: 42, name: "Drudge" },
		presentation: {
			category: "other",
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
			radar: { blipColor: "Default", behavior: null, obviousRange: null },
		},
		physics: {
			semanticMask: 0,
			participation: "pose-only",
			noDraw: false,
			hidden: false,
			cloaked: false,
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
		playingClip: null,
	};
}
