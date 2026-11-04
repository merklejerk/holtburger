import { describe, expect, it, vi } from "vitest";
import {
	ClientAppLifecycle,
	clientAppPage,
	initialClientAppLifecycleState,
} from "./client-app-lifecycle";

const roster = {
	kind: "character-selection" as const,
	rejection: null,
	maxSlots: 11,
	characters: [
		{ guid: 7, name: "Mira", slot: 0, deleteTime: 0 },
		{ guid: 8, name: "Nox", slot: 1, deleteTime: 0 },
	],
};
const context = { worldName: "Test server", playerName: "Mira" };

function setup() {
	let state = initialClientAppLifecycleState();
	const session = {
		cancelStartup: vi.fn(),
		prepareAuthorityShutdown: vi.fn(),
		stop: vi.fn(),
		enterWorld: vi
			.fn<(guid: number) => Promise<void>>()
			.mockResolvedValue(undefined),
		logout: vi.fn(async () => {}),
		disconnect: vi.fn(async () => {}),
	};
	const stopInput = vi.fn(async () => {});
	const retireGameplay = vi.fn(async () => {});
	const warn = vi.fn();
	const changed = vi.fn();
	const retry = vi.fn();
	const owner = new ClientAppLifecycle({
		session: () => session,
		stopInput,
		retireGameplay,
		warn,
		onChange: (next) => {
			state = next;
			changed(next);
		},
	});
	return {
		owner,
		session,
		stopInput,
		retireGameplay,
		warn,
		changed,
		retry,
		state: () => state,
		page: () => clientAppPage(state, context, retry),
	};
}
function deferred() {
	let release: () => void = () => {
		throw new Error("Deferred promise not initialized");
	};
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release: () => release() };
}

describe("app lifecycle coordination", () => {
	it("admits the roster and its canvas together only after scene readiness", () => {
		const app = setup();
		app.owner.acceptAuthority(roster);
		expect(app.page().kind).toBe("loading");
		expect(app.state().admission.canvasVisible).toBe(false);
		app.owner.acceptScene({ kind: "ready" }, true);
		expect(app.page().kind).toBe("selection");
		expect(app.state().admission).toMatchObject({
			mode: "pregame",
			canvasVisible: true,
			gameplayInput: false,
			entryGuid: 7,
		});
	});
	it("preserves a valid selection on roster refresh and replaces a removed selection", () => {
		const app = setup();
		app.owner.acceptAuthority(roster);
		app.owner.acceptScene({ kind: "ready" }, true);
		app.owner.select(8);
		app.owner.acceptAuthority(roster);
		expect(app.state().phase).toMatchObject({ selectedGuid: 8 });
		app.owner.acceptAuthority({
			...roster,
			characters: [roster.characters[0]],
		});
		expect(app.state().phase).toMatchObject({ selectedGuid: 7 });
	});
	it("serializes repeated entry and keeps selection stable while entry is pending", async () => {
		const app = setup();
		const entry = deferred();
		app.session.enterWorld.mockReturnValue(entry.promise);
		app.owner.acceptAuthority(roster);
		app.owner.acceptScene({ kind: "ready" }, true);
		const first = app.owner.enter();
		app.owner.select(8);
		await app.owner.enter();
		expect(app.session.enterWorld).toHaveBeenCalledExactlyOnceWith(7);
		expect(app.state().phase).toMatchObject({ selectedGuid: 7 });
		entry.release();
		await first;
	});
	it("keeps gameplay presentation through portal staging but enables input only in world", () => {
		const app = setup();
		app.owner.acceptAuthority({ kind: "entering-world", characterGuid: 7 });
		expect(app.page().kind).toBe("gameplay");
		expect(app.state().admission).toMatchObject({
			mode: "gameplay",
			gameplayInput: false,
		});
		app.owner.acceptAuthority({
			kind: "portal-space",
			worldGeneration: 4,
			cause: "initial-entry",
		});
		expect(app.state().admission.mode).toBe("gameplay");
		expect(app.state().admission.gameplayInput).toBe(false);
		app.owner.acceptAuthority({ kind: "in-world" });
		expect(app.state().admission.gameplayInput).toBe(true);
	});
	it("retains return progress through roster arrival until the replacement scene is ready", async () => {
		const app = setup();
		app.owner.acceptAuthority({ kind: "in-world" });
		app.owner.acceptScene({ kind: "ready" }, true);
		app.session.logout.mockImplementation(async () => {
			app.owner.acceptAuthority({ kind: "logging-out" });
		});
		await app.owner.returnToSelection();
		expect(app.stopInput).toHaveBeenCalledOnce();
		expect(app.page()).toMatchObject({
			kind: "loading",
			content: { activity: "return" },
		});
		expect(app.state().admission).toMatchObject({
			mode: "pregame",
			canvasVisible: false,
			gameplayInput: false,
		});
		app.owner.acceptAuthority(roster);
		expect(app.page()).toMatchObject({
			kind: "loading",
			content: { activity: "return" },
		});
		app.owner.acceptScene({ kind: "ready" }, true);
		expect(app.page().kind).toBe("selection");
	});
	it("blocks input before flushing motion and sending logout, and restores it on rejection", async () => {
		const app = setup();
		const flush = deferred();
		app.stopInput.mockReturnValue(flush.promise);
		app.session.logout.mockRejectedValue(new Error("Logout refused"));
		app.owner.acceptAuthority({ kind: "in-world" });
		const returning = app.owner.returnToSelection();
		expect(app.state().admission.gameplayInput).toBe(false);
		expect(app.session.logout).not.toHaveBeenCalled();
		await app.owner.returnToSelection();
		flush.release();
		await returning;
		expect(app.session.logout).toHaveBeenCalledOnce();
		expect(app.warn).toHaveBeenCalledWith("Logout refused");
		expect(app.state().admission.gameplayInput).toBe(true);
	});
	it("drains gameplay retirement before host disconnect and keeps the camera driver withdrawn", async () => {
		const app = setup();
		const retirement = deferred();
		app.retireGameplay.mockReturnValue(retirement.promise);
		app.owner.acceptAuthority({ kind: "in-world" });
		const closing = app.owner.disconnect();
		await vi.waitFor(() => expect(app.retireGameplay).toHaveBeenCalledOnce());
		expect(app.state().admission).toMatchObject({
			mode: "idle",
			gameplayInput: false,
			canvasVisible: false,
		});
		expect(app.page()).toMatchObject({ content: { activity: "disconnect" } });
		expect(app.session.disconnect).not.toHaveBeenCalled();
		await app.owner.disconnect();
		retirement.release();
		await closing;
		expect(app.session.disconnect).toHaveBeenCalledOnce();
		expect(app.state().phase.kind).toBe("closed");
	});
	it("disconnects during pregame loading without waiting for scene readiness", async () => {
		const app = setup();
		await app.owner.disconnect();
		expect(app.retireGameplay).toHaveBeenCalledOnce();
		expect(app.session.disconnect).toHaveBeenCalledOnce();
	});

	it("does not let interrupted entry completion release a disconnect guard", async () => {
		const app = setup();
		const entry = deferred();
		const shutdown = deferred();
		app.session.enterWorld.mockReturnValue(entry.promise);
		app.session.disconnect.mockReturnValue(shutdown.promise);
		app.owner.acceptAuthority(roster);
		app.owner.acceptScene({ kind: "ready" }, true);
		const entering = app.owner.enter();
		const disconnecting = app.owner.disconnect();
		entry.release();
		await entering;
		expect(app.state().operation).toBe("disconnect");
		await app.owner.disconnect();
		expect(app.session.disconnect).toHaveBeenCalledOnce();
		shutdown.release();
		await disconnecting;
		expect(app.page()).toMatchObject({
			content: { kind: "ended", failed: false, details: null },
		});
	});
	it("distinguishes shutdown in progress from completed exit even with an empty diagnostic", async () => {
		const app = setup();
		app.owner.acceptAuthority({ kind: "in-world" });
		app.owner.acceptAuthority({
			kind: "exiting",
			cause: "server-disconnect",
		});
		expect(app.state().phase.kind).toBe("closing");
		expect(app.page()).toMatchObject({
			content: { kind: "pending", activity: "disconnect" },
		});
		app.owner.acceptExit({ cause: "server-disconnect", diagnostic: "" });
		await vi.waitFor(() => expect(app.state().phase.kind).toBe("closed"));
		expect(app.page()).toMatchObject({
			content: {
				kind: "ended",
				title: "Connection lost",
				message: "The connection to the server was lost.",
			},
		});
		app.owner.acceptAuthority(roster);
		expect(app.state().phase.kind).toBe("closed");
		expect(app.state().admission).toMatchObject({
			mode: "idle",
			canvasVisible: false,
			gameplayInput: false,
			canDisconnect: false,
		});
	});
	it("keeps meaningful server reasons and technical context in the completed failure", async () => {
		const app = setup();
		app.owner.acceptAuthority({ kind: "in-world" });
		app.owner.acceptExit({
			cause: "server-disconnect",
			diagnostic: "Server maintenance",
		});
		await vi.waitFor(() => expect(app.state().phase.kind).toBe("closed"));
		expect(app.page()).toMatchObject({
			content: {
				message: "Server maintenance",
				details: expect.stringContaining("Last session phase: in world"),
			},
		});
	});
	it("withdraws gameplay UI, canvas, and input together on app failure", () => {
		const app = setup();
		app.owner.acceptAuthority({ kind: "in-world" });
		app.owner.acceptScene({ kind: "ready" }, true);
		app.owner.fail("command", "Broken command");
		expect(app.page()).toMatchObject({
			content: { kind: "failed", details: "Broken command" },
		});
		expect(app.state().admission).toMatchObject({
			canvasVisible: false,
			gameplayInput: false,
		});
	});
	it("offers retry only when presentation owns a recoverable failure", () => {
		const app = setup();
		app.owner.acceptScene(
			{ kind: "failed", message: "Scene failed", canRetry: true },
			false,
		);
		expect(app.page()).toMatchObject({
			content: { kind: "failed", retry: app.retry },
		});
		app.owner.acceptScene(
			{ kind: "failed", message: "Scene failed", canRetry: false },
			false,
		);
		expect(app.page()).toMatchObject({ content: { retry: null } });
	});
	it("publishes readiness changes without scheduling reactive work every frame", () => {
		const app = setup();
		app.owner.acceptScene({ kind: "ready" }, true);
		app.owner.acceptScene({ kind: "ready" }, true);
		expect(app.changed).toHaveBeenCalledOnce();
	});
	it("keeps failed Disconnect withdrawn rather than restarting gameplay", async () => {
		const app = setup();
		app.owner.acceptAuthority({ kind: "in-world" });
		app.session.disconnect.mockRejectedValue(new Error("Host unavailable"));
		await app.owner.disconnect();
		expect(app.state().admission).toMatchObject({
			mode: "idle",
			gameplayInput: false,
			canvasVisible: false,
		});
		expect(app.page()).toMatchObject({
			content: { kind: "failed", details: "Host unavailable" },
		});
	});
	it("attempts host Disconnect despite failed local cleanup and preserves the diagnostic", async () => {
		const app = setup();
		app.owner.acceptAuthority({ kind: "in-world" });
		app.retireGameplay.mockRejectedValue(new Error("Camera cleanup failed"));
		await app.owner.disconnect();
		expect(app.session.disconnect).toHaveBeenCalledOnce();
		expect(app.page()).toMatchObject({
			content: {
				kind: "ended",
				failed: true,
				details: expect.stringContaining("Camera cleanup failed"),
			},
		});
	});
	it("enriches local stop completion with a late authoritative reason without reopening admission", async () => {
		const app = setup();
		await app.owner.disconnect();
		expect(app.state().phase).toEqual({ kind: "closed", exit: null });
		app.owner.acceptExit({
			cause: "server-disconnect",
			diagnostic: "Server maintenance",
		});
		expect(app.page()).toMatchObject({
			content: { message: "Server maintenance" },
		});
		expect(app.state().admission.mode).toBe("idle");
	});
	it("does not publish completed connection loss until local retirement settles", async () => {
		const app = setup();
		const retirement = deferred();
		app.retireGameplay.mockReturnValue(retirement.promise);
		app.owner.acceptAuthority({ kind: "in-world" });
		app.owner.acceptExit({
			cause: "server-disconnect",
			diagnostic: "Server maintenance",
		});
		expect(app.state().phase.kind).toBe("closing");
		await vi.waitFor(() => expect(app.retireGameplay).toHaveBeenCalledOnce());
		retirement.release();
		await vi.waitFor(() => expect(app.state().phase.kind).toBe("closed"));
		expect(app.session.disconnect).not.toHaveBeenCalled();
	});
	it("lets Disconnect supersede a held Enter acknowledgement", async () => {
		const app = setup();
		const entry = deferred();
		app.session.enterWorld.mockReturnValue(entry.promise);
		app.owner.acceptAuthority(roster);
		app.owner.acceptScene({ kind: "ready" }, true);
		const entering = app.owner.enter();
		await vi.waitFor(() =>
			expect(app.session.enterWorld).toHaveBeenCalledOnce(),
		);
		await app.owner.disconnect();
		await entering;
		expect(app.state().phase.kind).toBe("closed");
		entry.release();
		expect(app.session.disconnect).toHaveBeenCalledOnce();
	});
	it("lets Disconnect supersede a held Return acknowledgement", async () => {
		const app = setup();
		const logout = deferred();
		app.session.logout.mockReturnValue(logout.promise);
		app.owner.acceptAuthority({ kind: "in-world" });
		const returning = app.owner.returnToSelection();
		await vi.waitFor(() => expect(app.session.logout).toHaveBeenCalledOnce());
		await app.owner.disconnect();
		await returning;
		logout.release();
		expect(app.state().phase.kind).toBe("closed");
		expect(app.state().admission.mode).toBe("idle");
	});
	it.each(["enter", "return"] as const)(
		"lets Quit supersede a held %s acknowledgement",
		async (intent) => {
			const app = setup();
			const command = deferred();
			let pending: Promise<void>;
			if (intent === "enter") {
				app.owner.acceptAuthority(roster);
				app.owner.acceptScene({ kind: "ready" }, true);
				app.session.enterWorld.mockReturnValue(command.promise);
				pending = app.owner.enter();
				await vi.waitFor(() =>
					expect(app.session.enterWorld).toHaveBeenCalledOnce(),
				);
			} else {
				app.owner.acceptAuthority({ kind: "in-world" });
				app.session.logout.mockReturnValue(command.promise);
				pending = app.owner.returnToSelection();
				await vi.waitFor(() =>
					expect(app.session.logout).toHaveBeenCalledOnce(),
				);
			}
			const prepare = vi.fn(async () => {});
			await app.owner.prepareClose(prepare);
			await pending;
			expect(prepare).toHaveBeenCalledOnce();
			expect(app.session.stop).toHaveBeenCalledOnce();
			command.release();
			await Promise.resolve();
			expect(app.state().operation).toBe("quit");
			expect(app.state().admission.mode).toBe("idle");
		},
	);

	it("joins an already issued native Disconnect before acknowledging Quit", async () => {
		const app = setup();
		const command = deferred();
		app.owner.acceptAuthority({ kind: "in-world" });
		app.session.disconnect.mockReturnValue(command.promise);
		const disconnecting = app.owner.disconnect();
		await vi.waitFor(() =>
			expect(app.session.disconnect).toHaveBeenCalledOnce(),
		);
		const prepare = vi.fn(async () => {});
		const closing = app.owner.prepareClose(prepare);
		await vi.waitFor(() => expect(app.session.stop).toHaveBeenCalledOnce());
		expect(prepare).not.toHaveBeenCalled();
		command.release();
		await Promise.all([closing, disconnecting]);
		expect(prepare).toHaveBeenCalledOnce();
		expect(app.state().operation).toBe("quit");
	});

	it("keeps Quit withdrawn through retirement, settings flush, and a concurrent failure", async () => {
		const app = setup();
		const retirement = deferred();
		const saving = deferred();
		app.retireGameplay.mockReturnValue(retirement.promise);
		const flush = vi.fn(() => saving.promise);
		let prepared = false;
		const preparation = app.owner.prepareClose(flush);
		const closing = preparation.then(() => {
			prepared = true;
		});
		expect(app.owner.prepareClose(flush)).toBe(preparation);
		await vi.waitFor(() => expect(app.retireGameplay).toHaveBeenCalledOnce());
		app.owner.fail("command", "An earlier command failed");
		expect(prepared).toBe(false);
		retirement.release();
		await vi.waitFor(() => expect(flush).toHaveBeenCalledOnce());
		expect(app.session.prepareAuthorityShutdown).toHaveBeenCalledOnce();
		expect(app.session.stop).toHaveBeenCalledOnce();
		expect(prepared).toBe(false);
		saving.release();
		await closing;
		expect(app.state().operation).toBe("quit");
		expect(app.state().admission).toMatchObject({
			mode: "idle",
			canDisconnect: false,
			gameplayInput: false,
		});
	});
	it("attempts settings flush when close retirement fails and reports failure to Electron", async () => {
		const app = setup();
		app.retireGameplay.mockRejectedValue(new Error("Camera cleanup failed"));
		const flush = vi.fn(async () => {});
		await expect(app.owner.prepareClose(flush)).rejects.toThrow(
			"Client close preparation failed",
		);
		expect(flush).toHaveBeenCalledOnce();
		expect(app.session.prepareAuthorityShutdown).toHaveBeenCalledOnce();
	});
});

it("shows a login failure using the retained phase and shared diagnostic", async () => {
	const app = setup();
	app.owner.acceptAuthority({ kind: "authenticating" });
	app.owner.acceptExit({
		cause: "server-disconnect",
		diagnostic: "Login failed: The account does not exist on this server.",
	});
	await vi.waitFor(() => expect(app.state().phase.kind).toBe("closed"));
	expect(app.page()).toMatchObject({
		content: {
			kind: "ended",
			title: "Login failed",
			message: "Login failed: The account does not exist on this server.",
		},
	});
});

it("restores selection with the retained rejection and allows another explicit entry", async () => {
	const app = setup();
	app.owner.acceptAuthority(roster);
	app.owner.acceptScene({ kind: "ready" }, true);
	await app.owner.enter();
	app.owner.acceptAuthority({
		kind: "portal-space",
		worldGeneration: 2,
		cause: "initial-entry",
	});
	app.owner.acceptAuthority({
		...roster,
		rejection: "World entry failed: This character is still in the world.",
	});
	app.owner.acceptScene({ kind: "ready" }, true);
	expect(app.page()).toMatchObject({
		kind: "selection",
		selection: {
			rejection: "World entry failed: This character is still in the world.",
		},
	});
	await app.owner.enter();
	expect(app.session.enterWorld).toHaveBeenCalledTimes(2);
});
