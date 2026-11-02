import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	ClientCombatMode,
	ClientLocalMotionFeedback,
} from "./client-host-contract";
import type { ClientLifecycleSessionEvent } from "./client-lifecycle-session";
import { ClientChatComposer } from "./client-chat-composer.svelte";
import { ClientEmoteController } from "./client-emote-controller";
import { soulEmoteFixture } from "./client-soul-emotes.test-support";
import { CLIENT_TUNING } from "./client-tuning";

const wave = { kind: "soul-emote", token: "wave" } as const;
const bow = { kind: "soul-emote", token: "bow" } as const;

function fixture(mode: ClientCombatMode = "magic") {
	type Session = ConstructorParameters<typeof ClientEmoteController>[0];
	let state: ReturnType<Session["state"]> = {
		lifecycle: { kind: "in-world" },
		playerGuid: 1,
		worldGeneration: 1,
		combatMode: mode,
		socialMotionReady: mode === "peace",
	};
	const listeners = new Set<(event: ClientLifecycleSessionEvent) => void>();
	const emit = (event: ClientLifecycleSessionEvent) => {
		for (const listener of listeners) listener(event);
	};
	const sendChat = vi.fn<Session["sendChat"]>().mockResolvedValue(undefined);
	const setCombatMode = vi
		.fn<Session["setCombatMode"]>()
		.mockResolvedValue(undefined);
	const reportError = vi.fn();
	const release = vi.fn();
	let escape = () => {};
	const composer = new ClientChatComposer({
		recentEmotes: [],
		onRecentEmotesChange: () => {},
	});
	composer.setEmotes(soulEmoteFixture());
	const controller = new ClientEmoteController(
		{
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
				escape = cancel;
				return { release, promote: vi.fn() };
			},
		},
		reportError,
	);
	const confirm = (
		combatMode: ClientCombatMode,
		socialMotionReady = combatMode === "peace",
	) => {
		state = { ...state, combatMode, socialMotionReady };
		emit({ type: "combat-mode", mode: combatMode });
		emit({ type: "social-motion-ready", ready: socialMotionReady });
	};
	const feedback = (
		requestId: number,
		outcome: ClientLocalMotionFeedback["outcome"],
		worldGeneration = 1,
	) =>
		emit({
			type: "local-motion-feedback",
			feedback: { requestId, outcome, worldGeneration },
		});
	return {
		controller,
		composer,
		sendChat,
		setCombatMode,
		reportError,
		release,
		emit,
		confirm,
		feedback,
		escape: () => escape(),
		send: (request: Parameters<Session["sendChat"]>[0] = wave) =>
			controller.sendAll([request], composer),
		replace: (patch: Partial<typeof state>) => {
			state = { ...state, ...patch };
			emit({ type: "social-motion-ready", ready: state.socialMotionReady });
		},
	};
}

afterEach(() => vi.useRealTimers());

describe("emote stance excursion", () => {
	it("sends ordinary speech and peaceful emotes without a combat excursion", async () => {
		const f = fixture("peace");
		await f.send();
		await f.send({ kind: "speech", message: "hello" });
		expect(f.sendChat.mock.calls).toEqual([
			[wave],
			[{ kind: "speech", message: "hello" }],
		]);
		expect(f.setCombatMode).not.toHaveBeenCalled();
		f.controller.destroy();
	});

	it.each(["melee", "missile", "magic"] as const)(
		"restores the exact %s family after the request completes",
		async (mode) => {
			const f = fixture(mode);
			const sent = f.send();
			f.confirm("peace");
			await sent;
			expect(f.sendChat).toHaveBeenCalledWith({ ...wave, requestId: 1 });
			f.feedback(1, "accepted");
			expect(f.setCombatMode.mock.calls).toEqual([["peace"]]);
			f.feedback(1, "completed");
			expect(f.setCombatMode.mock.calls).toEqual([["peace"], [mode]]);
			f.controller.destroy();
		},
	);

	it("waits for motion readiness when the peace property arrives first", async () => {
		const f = fixture();
		const sent = f.send();
		f.confirm("peace", false);
		await Promise.resolve();
		expect(f.sendChat).not.toHaveBeenCalled();
		f.confirm("peace", true);
		await sent;
		expect(f.sendChat).toHaveBeenCalledOnce();
		f.controller.destroy();
	});

	it("waits for the peace property when motion readiness arrives first", async () => {
		const f = fixture();
		const sent = f.send();
		f.replace({ socialMotionReady: true });
		await Promise.resolve();
		expect(f.sendChat).not.toHaveBeenCalled();
		f.confirm("peace");
		await sent;
		f.controller.destroy();
	});

	it("observes admission and completion delivered before sendChat settles", async () => {
		const f = fixture();
		f.sendChat.mockImplementation(async (request) => {
			if (request.kind === "soul-emote" && request.requestId !== undefined) {
				f.feedback(request.requestId, "accepted");
				f.feedback(request.requestId, "completed");
			}
		});
		const sent = f.send();
		f.confirm("peace");
		await sent;
		expect(f.setCombatMode.mock.calls).toEqual([["peace"], ["magic"]]);
		f.controller.destroy();
	});

	it("waits for every queued emote and preserves the original stance", async () => {
		const f = fixture();
		const first = f.send();
		f.confirm("peace");
		await first;
		f.feedback(1, "accepted");
		await f.send(bow);
		f.feedback(2, "accepted");
		f.feedback(1, "completed");
		expect(f.setCombatMode.mock.calls).toEqual([["peace"]]);
		f.feedback(2, "completed");
		expect(f.setCombatMode.mock.calls).toEqual([["peace"], ["magic"]]);
		f.controller.destroy();
	});

	it("retains a held pose without a guessed duration", async () => {
		vi.useFakeTimers();
		const f = fixture();
		const sent = f.send(bow);
		f.confirm("peace");
		await sent;
		f.feedback(1, "accepted");
		await vi.advanceTimersByTimeAsync(
			CLIENT_TUNING.emotes.admissionTimeoutMs * 2,
		);
		expect(f.reportError).not.toHaveBeenCalled();
		expect(f.setCombatMode.mock.calls).toEqual([["peace"]]);
		f.feedback(1, "completed");
		expect(f.setCombatMode).toHaveBeenLastCalledWith("magic");
		f.controller.destroy();
	});

	it.each([bow, wave])(
		"restores combat after a new $token emote replaces a held pose",
		async (replacement) => {
			const f = fixture();
			const sent = f.send(bow);
			f.confirm("peace");
			await sent;
			f.feedback(1, "accepted");
			await f.send(replacement);
			f.feedback(1, "superseded");
			f.feedback(2, "accepted");
			f.feedback(2, "completed");
			expect(f.setCombatMode).toHaveBeenLastCalledWith("magic");
			f.controller.destroy();
		},
	);

	it("cancels restoration when a different caller replaces its held pose", async () => {
		const f = fixture();
		const sent = f.send(bow);
		f.confirm("peace");
		await sent;
		f.feedback(1, "accepted");
		f.feedback(1, "superseded");
		f.feedback(1, "completed");
		expect(f.setCombatMode.mock.calls).toEqual([["peace"]]);
		f.controller.destroy();
	});

	it("a takeover of any queued request cancels the entire excursion", async () => {
		const f = fixture();
		const sent = f.send();
		f.confirm("peace");
		await sent;
		f.feedback(1, "accepted");
		await f.send(bow);
		f.feedback(2, "cancelled");
		f.feedback(1, "completed");
		expect(f.setCombatMode.mock.calls).toEqual([["peace"]]);
		f.controller.destroy();
	});

	it.each(["unsupported", "refused", "cancelled"] as const)(
		"retires a %s request without restoring combat",
		async (outcome) => {
			const f = fixture();
			const sent = f.send();
			f.confirm("peace");
			await sent;
			f.feedback(1, outcome);
			f.feedback(1, "completed");
			expect(f.setCombatMode.mock.calls).toEqual([["peace"]]);
			expect(f.reportError).toHaveBeenCalledTimes(
				outcome === "unsupported" ? 1 : 0,
			);
			f.controller.destroy();
		},
	);

	it("bounds missing admission without letting late completion restore combat", async () => {
		vi.useFakeTimers();
		const f = fixture();
		const sent = f.send();
		f.confirm("peace");
		await sent;
		await vi.advanceTimersByTimeAsync(CLIENT_TUNING.emotes.admissionTimeoutMs);
		expect(f.reportError).toHaveBeenCalledOnce();
		f.feedback(1, "completed");
		expect(f.setCombatMode.mock.calls).toEqual([["peace"]]);
		f.controller.destroy();
	});

	it("rejects a missing peace confirmation without submitting the emote", async () => {
		vi.useFakeTimers();
		const f = fixture();
		const rejected = expect(f.send()).rejects.toThrow("peaceful motion stance");
		await vi.advanceTimersByTimeAsync(CLIENT_TUNING.emotes.admissionTimeoutMs);
		await rejected;
		expect(f.sendChat).not.toHaveBeenCalled();
		f.controller.destroy();
	});

	it("ignores another generation or request's completion", async () => {
		const f = fixture();
		const sent = f.send();
		f.confirm("peace");
		await sent;
		f.feedback(1, "completed", 2);
		f.feedback(9, "completed");
		expect(f.setCombatMode.mock.calls).toEqual([["peace"]]);
		f.controller.destroy();
	});

	it.each(["escape", "combat", "teleport", "logout", "resync"] as const)(
		"cancels the return on %s",
		async (reason) => {
			const f = fixture();
			const sent = f.send();
			f.confirm("peace");
			await sent;
			f.feedback(1, "accepted");
			if (reason === "escape") f.escape();
			else if (reason === "combat") {
				f.controller.cancel();
				f.confirm("missile");
			} else if (reason === "teleport") f.replace({ worldGeneration: 2 });
			else if (reason === "logout")
				f.replace({ lifecycle: { kind: "connecting" } });
			else f.emit({ type: "resyncing" });
			f.feedback(1, "completed");
			expect(f.setCombatMode.mock.calls).toEqual([["peace"]]);
			f.controller.destroy();
		},
	);

	it("ignores old request feedback after a replacement excursion", async () => {
		const f = fixture();
		let sent = f.send();
		f.confirm("peace");
		await sent;
		f.controller.cancel();
		f.confirm("missile");
		sent = f.send();
		f.confirm("peace");
		await sent;
		f.feedback(1, "unsupported");
		f.feedback(2, "accepted");
		f.feedback(2, "completed");
		expect(f.reportError).not.toHaveBeenCalled();
		expect(f.setCombatMode).toHaveBeenLastCalledWith("missile");
		f.controller.destroy();
	});

	it("stops the unsent mixed submission when a newer intent cancels its peace wait", async () => {
		const f = fixture();
		const sent = f.controller.sendAll(
			[wave, { kind: "speech", message: "later" }],
			f.composer,
		);
		const rejected = expect(sent).rejects.toThrow("cancelled");
		f.controller.cancel();
		await rejected;
		expect(f.sendChat).not.toHaveBeenCalled();
		f.controller.destroy();
	});
});
