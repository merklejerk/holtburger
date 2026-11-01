import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientCombatMode } from "./client-host-contract";
import type { ClientLifecycleSessionEvent } from "./client-lifecycle-session";
import { ClientChatComposer } from "./client-chat-composer.svelte";
import { ClientEmoteController } from "./client-emote-controller";
import { soulEmoteFixture } from "./client-soul-emotes.test-support";
import { emotePlaybackFixture } from "../harness/browser/client-emote-fixture";
import {
	DynamicEntityMirror,
	type DynamicEntityMotion,
} from "../lib/game/runtime/dynamic-entity-feed";
import { CLIENT_TUNING } from "./client-tuning";

const wave = { kind: "soul-emote", token: "wave" } as const;
const bow = { kind: "soul-emote", token: "bow" } as const;

function fixture(mode: ClientCombatMode) {
	type Session = ConstructorParameters<typeof ClientEmoteController>[0];
	let state: ReturnType<Session["state"]> = {
		lifecycle: { kind: "in-world" },
		playerGuid: 1,
		worldGeneration: 1,
		combatMode: mode,
	};
	const listeners = new Set<(event: ClientLifecycleSessionEvent) => void>();
	const mirror = new DynamicEntityMirror(() => 0);
	mirror.apply({
		kind: "snapshot",
		snapshot: { hostTime: { seconds: 0 }, entities: [] },
	});
	const sendChat = vi.fn<Session["sendChat"]>().mockResolvedValue(undefined);
	const setCombatMode = vi
		.fn<Session["setCombatMode"]>()
		.mockResolvedValue(undefined);
	const release = vi.fn();
	const escapes: (() => void)[] = [];
	const reportError = vi.fn();
	const composer = new ClientChatComposer({
		recentEmotes: [],
		onRecentEmotesChange: () => {},
	});
	composer.setEmotes(soulEmoteFixture());
	const controller = new ClientEmoteController(
		{
			mirror,
			state: () => state,
			subscribe: (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			sendChat,
			setCombatMode,
		},
		{
			bindEscapeContext: (cancel) => {
				escapes.push(cancel);
				return { release, promote: vi.fn() };
			},
		},
		reportError,
	);
	const emit = (event: ClientLifecycleSessionEvent) => {
		if (event.type === "dynamic" && !mirror.apply(event.event)) return;
		for (const listener of listeners) listener(event);
	};
	const confirm = (mode: ClientCombatMode) => {
		state = { ...state, combatMode: mode };
		emit({ type: "combat-mode", mode });
	};
	return {
		controller,
		send: (request: Parameters<Session["sendChat"]>[0]) =>
			controller.sendAll([request], composer),
		composer,
		reportError,
		playback: (activity: DynamicEntityMotion["activity"], guid: number) =>
			emit({
				type: "dynamic",
				event: {
					kind: "upserted",
					entity: emotePlaybackFixture(guid, activity),
				},
			}),
		sendChat,
		setCombatMode,
		confirm,
		release,
		escapes,
		listeners,
		emit,
		replace: (changes: Partial<typeof state>) => {
			state = { ...state, ...changes };
			emit({ type: "entities" });
		},
	};
}

afterEach(() => vi.useRealTimers());

describe("emote peace policy", () => {
	it("sends peace emotes and ordinary chat directly", async () => {
		const f = fixture("peace");
		await f.send(wave);
		await f.send({ kind: "speech", message: "Hello" });
		expect(f.setCombatMode).not.toHaveBeenCalled();
		expect(f.sendChat.mock.calls).toEqual([
			[wave],
			[{ kind: "speech", message: "Hello" }],
		]);
		f.controller.destroy();
	});

	it.each(["melee", "missile", "magic"] as const)(
		"waits for confirmed peace in %s and shares the request across emotes",
		async (mode) => {
			const f = fixture(mode);
			const requests = Promise.all([f.send(wave), f.send(bow)]);
			await Promise.resolve();
			expect(f.setCombatMode).toHaveBeenCalledTimes(1);
			expect(f.sendChat).not.toHaveBeenCalled();
			f.confirm(mode);
			expect(f.sendChat).not.toHaveBeenCalled();
			f.confirm("peace");
			await requests;
			expect(f.sendChat.mock.calls).toEqual([[wave], [bow]]);
			expect(f.release).not.toHaveBeenCalled();
			f.controller.destroy();
		},
	);

	it("requires command admission even when peace confirmation arrives first", async () => {
		const f = fixture("magic");
		const receipts: (() => void)[] = [];
		f.setCombatMode.mockImplementation(
			() => new Promise<void>((resolve) => receipts.push(resolve)),
		);
		const sent = f.send(wave);
		f.confirm("peace");
		await Promise.resolve();
		expect(f.sendChat).not.toHaveBeenCalled();
		receipts[0]();
		await sent;
		expect(f.sendChat).toHaveBeenCalledExactlyOnceWith(wave);
		f.controller.destroy();
	});

	it("rejects all waiting emotes when the peace request fails", async () => {
		const f = fixture("melee");
		f.setCombatMode.mockRejectedValue(new Error("Request failed"));
		await expect(Promise.all([f.send(wave), f.send(bow)])).rejects.toThrow(
			"Request failed",
		);
		f.confirm("peace");
		expect(f.sendChat).not.toHaveBeenCalled();
		expect(f.release).toHaveBeenCalledTimes(1);
		f.controller.destroy();
	});

	it.each([
		"intent",
		"escape",
		"character",
		"world",
		"lifecycle",
		"exit",
		"recovery",
		"destroy",
	] as const)(
		"cancels on %s and cannot replay after a later peace event",
		async (reason) => {
			const f = fixture("melee");
			const cancelled = expect(f.send(wave)).rejects.toThrow("cancelled");
			switch (reason) {
				case "intent":
					f.controller.cancel();
					break;
				case "escape":
					f.escapes[0]();
					break;
				case "character":
					f.replace({ playerGuid: 2 });
					break;
				case "world":
					f.replace({ worldGeneration: 2 });
					break;
				case "lifecycle":
					f.replace({ lifecycle: { kind: "logging-out" } });
					break;
				case "exit":
					f.emit({
						type: "exit-requested",
						exit: { cause: "explicit-disconnect", diagnostic: "Disconnected" },
					});
					break;
				case "recovery":
					f.emit({ type: "resyncing" });
					break;
				case "destroy":
					f.controller.destroy();
					break;
			}
			await cancelled;
			f.confirm("peace");
			await Promise.resolve();
			expect(f.sendChat).not.toHaveBeenCalled();
			expect(f.release).toHaveBeenCalledTimes(1);
			f.controller.destroy();
		},
	);

	it("cancels callers already released by confirmation when combat input supersedes them", async () => {
		const f = fixture("melee");
		const cancelled = expect(f.send(wave)).rejects.toThrow("cancelled");
		await Promise.resolve();
		f.confirm("peace");
		f.controller.cancel();
		await cancelled;
		expect(f.sendChat).not.toHaveBeenCalled();
		f.controller.destroy();
	});

	it("times out and releases input ownership without replaying", async () => {
		vi.useFakeTimers();
		const f = fixture("magic");
		const timedOut = expect(f.send(wave)).rejects.toThrow("Timed out");
		await vi.advanceTimersByTimeAsync(
			CLIENT_TUNING.emotes.acknowledgementTimeoutMs,
		);
		await timedOut;
		f.confirm("peace");
		expect(f.sendChat).not.toHaveBeenCalled();
		expect(f.release).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
		f.controller.destroy();
	});

	it("does not let an old command failure reject a replacement emote", async () => {
		const f = fixture("magic");
		const reject: ((error: Error) => void)[] = [];
		f.setCombatMode.mockImplementationOnce(
			() => new Promise<void>((_, fail) => reject.push(fail)),
		);
		const cancelled = expect(f.send(wave)).rejects.toThrow("cancelled");
		f.controller.cancel();
		await cancelled;
		const replacement = f.send(bow);
		reject[0](new Error("Old request failed"));
		await Promise.resolve();
		f.confirm("peace");
		await replacement;
		expect(f.sendChat).toHaveBeenCalledExactlyOnceWith(bow);
		f.controller.destroy();
	});

	it("keeps mixed speech ordered and records Recent only after actual emote submission", async () => {
		const f = fixture("magic");
		const composer = f.composer;
		const speech = { kind: "speech", message: "Hello" } as const;
		const submitted = f.controller.sendAll([wave, speech], composer);
		await Promise.resolve();
		expect(composer.recentEmotes).toEqual([]);
		expect(f.sendChat).not.toHaveBeenCalled();
		f.confirm("peace");
		await submitted;
		expect(f.sendChat.mock.calls).toEqual([[wave], [speech]]);
		expect(composer.recentEmotes).toEqual(["wave"]);
		f.controller.destroy();
	});

	it("rejects unavailable character or stance facts instead of requesting a toggle", async () => {
		const f = fixture("unknown");
		await expect(f.send(wave)).rejects.toThrow("Wait for your combat stance");
		f.replace({ playerGuid: null });
		await expect(f.send(wave)).rejects.toThrow("Enter the world");
		expect(f.setCombatMode).not.toHaveBeenCalled();
		f.controller.destroy();
		await expect(f.send(wave)).rejects.toThrow("stopped");
		expect(f.listeners.size).toBe(0);
	});
});

describe("combat restoration", () => {
	it.each(["melee", "missile", "magic"] as const)(
		"restores the saved %s family only after host-owned emote playback ends",
		async (mode) => {
			const f = fixture(mode);
			const submitted = f.send(wave);
			f.confirm("peace");
			await submitted;
			f.playback("explicit", 1);
			f.playback("locomotion", 1);
			expect(f.setCombatMode.mock.calls).toEqual([["peace"]]);
			f.playback("emote", 1);
			f.playback("locomotion", 2);
			f.playback("explicit", 1);
			expect(f.setCombatMode.mock.calls).toEqual([["peace"]]);
			f.playback("locomotion", 1);
			f.playback("locomotion", 1);
			expect(f.setCombatMode.mock.calls).toEqual([["peace"], [mode]]);
			expect(f.release).toHaveBeenCalledTimes(1);
			f.controller.destroy();
		},
	);

	it("leaves a held pose alone until it is exited, with no guessed duration", async () => {
		vi.useFakeTimers();
		const f = fixture("magic");
		const submitted = f.send(bow);
		f.confirm("peace");
		await submitted;
		f.playback("emote", 1);
		await vi.advanceTimersByTimeAsync(
			CLIENT_TUNING.emotes.acknowledgementTimeoutMs * 2,
		);
		expect(f.reportError).not.toHaveBeenCalled();
		expect(f.setCombatMode.mock.calls).toEqual([["peace"]]);
		f.playback("explicit", 1);
		expect(f.setCombatMode.mock.calls).toEqual([["peace"]]);
		f.playback("locomotion", 1);
		expect(f.setCombatMode.mock.calls).toEqual([["peace"], ["magic"]]);
		f.controller.destroy();
	});

	it.each(["peace", "melee", "missile", "magic"] as const)(
		"manual %s intent invalidates the queued return even when the server stance does not change",
		async (manualMode) => {
			const f = fixture("magic");
			const submitted = f.send(wave);
			f.confirm("peace");
			await submitted;
			f.playback("emote", 1);
			f.controller.cancel();
			f.confirm(manualMode);
			f.confirm("peace");
			f.playback("locomotion", 1);
			expect(f.setCombatMode.mock.calls).toEqual([["peace"]]);
			expect(f.release).toHaveBeenCalledTimes(1);
			f.controller.destroy();
		},
	);

	it("preserves the original mode across further emotes submitted during the temporary peace stance", async () => {
		const f = fixture("missile");
		const first = f.send(wave);
		f.confirm("peace");
		await first;
		f.playback("emote", 1);
		await f.send(bow);
		f.playback("emote", 1);
		f.playback("locomotion", 1);
		expect(f.setCombatMode.mock.calls).toEqual([["peace"], ["missile"]]);
		f.controller.destroy();
	});

	it("waits for the composed submission to finish enqueueing even if playback updates arrive before its receipt", async () => {
		const f = fixture("melee");
		const receipts: (() => void)[] = [];
		f.sendChat.mockImplementationOnce(
			() => new Promise<void>((resolve) => receipts.push(resolve)),
		);
		const submitted = f.controller.sendAll(
			[wave, { kind: "speech", message: "Hello" }],
			f.composer,
		);
		f.confirm("peace");
		await vi.waitFor(() => expect(receipts).toHaveLength(1));
		f.playback("emote", 1);
		f.playback("locomotion", 1);
		expect(f.setCombatMode.mock.calls).toEqual([["peace"]]);
		receipts[0]();
		await submitted;
		expect(f.sendChat.mock.calls).toEqual([
			[wave],
			[{ kind: "speech", message: "Hello" }],
		]);
		expect(f.setCombatMode.mock.calls).toEqual([["peace"], ["melee"]]);
		f.controller.destroy();
	});

	it("reports a failed restoration without replaying it on later ticks", async () => {
		const f = fixture("magic");
		const submitted = f.send(wave);
		f.confirm("peace");
		await submitted;
		f.setCombatMode.mockRejectedValueOnce(new Error("Return failed"));
		f.playback("emote", 1);
		f.playback("locomotion", 1);
		await Promise.resolve();
		expect(f.reportError).toHaveBeenCalledWith(
			expect.objectContaining({ message: "Return failed" }),
		);
		f.playback("locomotion", 1);
		expect(f.setCombatMode).toHaveBeenCalledTimes(2);
		f.controller.destroy();
	});

	it("cancels a return when playback never starts, instead of assuming the emote has finished", async () => {
		vi.useFakeTimers();
		const f = fixture("magic");
		const submitted = f.send(wave);
		f.confirm("peace");
		await submitted;
		await vi.advanceTimersByTimeAsync(
			CLIENT_TUNING.emotes.acknowledgementTimeoutMs,
		);
		expect(f.reportError).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining("Timed out"),
			}),
		);
		f.playback("emote", 1);
		f.playback("locomotion", 1);
		expect(f.setCombatMode.mock.calls).toEqual([["peace"]]);
		f.controller.destroy();
	});

	it("keeps emotes requested from peace in peace", async () => {
		const f = fixture("peace");
		await f.send(wave);
		f.playback("emote", 1);
		f.playback("locomotion", 1);
		expect(f.setCombatMode).not.toHaveBeenCalled();
		f.controller.destroy();
	});
});

describe("accepted playback observations", () => {
	it("uses replacement snapshots and tick updates while ignoring stale player records in otherwise accepted batches", async () => {
		const f = fixture("magic");
		const submitted = f.send(wave);
		f.confirm("peace");
		await submitted;
		const player = { ...emotePlaybackFixture(1, "emote"), generation: 2 };
		const other = emotePlaybackFixture(2, "locomotion");
		f.emit({
			type: "dynamic",
			event: {
				kind: "snapshot",
				snapshot: { hostTime: { seconds: 1 }, entities: [player, other] },
			},
		});
		f.emit({
			type: "dynamic",
			event: {
				kind: "ticked",
				batch: {
					hostTime: { seconds: 2 },
					durationMs: 1,
					advances: [],
					updates: [emotePlaybackFixture(1, "locomotion"), other],
				},
			},
		});
		expect(f.setCombatMode.mock.calls).toEqual([["peace"]]);
		f.emit({
			type: "dynamic",
			event: {
				kind: "ticked",
				batch: {
					hostTime: { seconds: 3 },
					durationMs: 1,
					advances: [],
					updates: [
						{ ...emotePlaybackFixture(1, "locomotion"), generation: 2 },
					],
				},
			},
		});
		expect(f.setCombatMode.mock.calls).toEqual([["peace"], ["magic"]]);
		f.controller.destroy();
	});

	it.each(["removed", "world", "character", "escape"] as const)(
		"invalidates an active held-pose return on %s",
		async (reason) => {
			const f = fixture("missile");
			const submitted = f.send(bow);
			f.confirm("peace");
			await submitted;
			f.playback("emote", 1);
			switch (reason) {
				case "removed":
					f.emit({
						type: "dynamic",
						event: { kind: "removed", guid: 1, generation: 1 },
					});
					break;
				case "world":
					f.replace({ worldGeneration: 2 });
					break;
				case "character":
					f.replace({ playerGuid: 2 });
					break;
				case "escape":
					f.escapes[0]();
					break;
			}
			f.playback("locomotion", 1);
			expect(f.setCombatMode.mock.calls).toEqual([["peace"]]);
			expect(f.release).toHaveBeenCalledTimes(1);
			f.controller.destroy();
		},
	);
});

describe("submission intent ownership", () => {
	it("does not let cancellation cleanup from an older submission cancel a replacement", async () => {
		const f = fixture("magic");
		const old = expect(f.send(wave)).rejects.toThrow("cancelled");
		f.controller.cancel();
		const replacement = f.send(bow).then(
			() => null,
			(error: unknown) => error,
		);
		await old;
		f.confirm("peace");
		expect(await replacement).toBeNull();
		expect(f.sendChat).toHaveBeenCalledExactlyOnceWith(bow);
		f.controller.destroy();
	});

	it("retires old in-flight submissions from return admission without waiting for their receipts", async () => {
		const f = fixture("magic");
		const receipts: (() => void)[] = [];
		f.sendChat.mockImplementationOnce(
			() => new Promise<void>((resolve) => receipts.push(resolve)),
		);
		const old = f.send(wave);
		f.confirm("peace");
		await vi.waitFor(() => expect(receipts).toHaveLength(1));
		f.controller.cancel();
		f.confirm("missile");
		const replacement = f.send(bow);
		f.confirm("peace");
		await replacement;
		f.playback("emote", 1);
		f.playback("locomotion", 1);
		const requestedModes = f.setCombatMode.mock.calls.map((args) => [...args]);
		receipts[0]();
		await old;
		expect(requestedModes).toEqual([["peace"], ["peace"], ["missile"]]);
		f.controller.destroy();
	});

	it("stops the unsent remainder of a mixed submission after newer stance intent", async () => {
		const f = fixture("magic");
		const receipts: (() => void)[] = [];
		f.sendChat.mockImplementationOnce(
			() => new Promise<void>((resolve) => receipts.push(resolve)),
		);
		const cancelled = expect(
			f.controller.sendAll([wave, bow], f.composer),
		).rejects.toThrow("Queued 1 of 2 actions");
		f.confirm("peace");
		await vi.waitFor(() => expect(receipts).toHaveLength(1));
		f.controller.cancel();
		f.confirm("magic");
		receipts[0]();
		f.confirm("peace");
		await cancelled;
		expect(f.sendChat).toHaveBeenCalledExactlyOnceWith(wave);
		expect(f.composer.recentEmotes).toEqual(["wave"]);
		expect(f.setCombatMode.mock.calls).toEqual([["peace"]]);
		f.controller.destroy();
	});

	it("does not let unrelated chat failure cancel a social excursion", async () => {
		const f = fixture("magic");
		const failures: ((error: Error) => void)[] = [];
		f.sendChat.mockImplementationOnce(
			() => new Promise<void>((_, reject) => failures.push(reject)),
		);
		const failedSpeech = expect(
			f.send({ kind: "speech", message: "Hello" }),
		).rejects.toThrow("Speech failed");
		const emote = f.send(wave).then(
			() => null,
			(error: unknown) => error,
		);
		failures[0](new Error("Speech failed"));
		await failedSpeech;
		f.confirm("peace");
		expect(await emote).toBeNull();
		expect(f.sendChat.mock.calls.at(-1)).toEqual([wave]);
		f.controller.destroy();
	});
});
