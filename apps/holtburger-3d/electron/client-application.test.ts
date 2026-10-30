import { describe, expect, it, vi } from "vitest";
import { ClientApplication } from "./client-application";

function deferred<T>() {
	let resolve: (value: T) => void = () => {
		throw new Error("Deferred not initialized");
	};
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
const configuration = () => ({
	host: "localhost",
	port: 9000,
	account: "test",
	password: "secret",
});
function setup(launcherEnabled: boolean) {
	const dependencies = {
		launcherEnabled,
		create: vi.fn(() => ({ cancellation: new AbortController() })),
		initialize: vi.fn(async () => {}),
		retire: vi.fn(async () => {}),
		showPicker: vi
			.fn<(diagnostic: string | null) => Promise<void>>()
			.mockResolvedValue(undefined),
		flushLauncher: vi.fn(async () => {}),
		exit: vi.fn(),
		report: vi.fn(),
	};
	return { ...dependencies, owner: new ClientApplication(dependencies) };
}
describe("single-window application attempt lifetime", () => {
	it("exits launcher-free sessions only after retirement and persistence complete", async () => {
		const app = setup(false);
		const native = deferred<void>();
		app.retire.mockReturnValue(native.promise);
		await app.owner.play(async () => configuration());
		const attempt = app.owner.attempt;
		const leaving = app.owner.back(null);
		expect(app.owner.back(null)).toBe(leaving);
		expect(attempt?.cancellation.signal.aborted).toBe(true);
		expect(app.owner.phase).toBe("quitting");
		expect(app.exit).not.toHaveBeenCalled();
		native.resolve();
		await leaving;
		expect(app.retire).toHaveBeenCalledOnce();
		expect(app.flushLauncher).toHaveBeenCalledOnce();
		expect(app.exit).toHaveBeenCalledExactlyOnceWith([]);
		expect(app.showPicker).not.toHaveBeenCalled();
	});
	it("exits failed launcher-free initialization with its diagnostic", async () => {
		const app = setup(false);
		app.initialize.mockRejectedValue(new Error("Connection failed"));
		await app.owner.play(async () => configuration());
		await vi.waitFor(() =>
			expect(app.exit).toHaveBeenCalledExactlyOnceWith(["Connection failed"]),
		);
		expect(app.retire).toHaveBeenCalledOnce();
		expect(app.showPicker).not.toHaveBeenCalled();
	});
	it("acknowledges Play without waiting for game readiness and rejects overlapping attempts", async () => {
		const app = setup(true);
		const startup = deferred<void>();
		app.initialize.mockReturnValue(startup.promise);
		await app.owner.play(async () => configuration());
		expect(app.owner.phase).toBe("starting");
		await expect(app.owner.play(async () => configuration())).rejects.toThrow(
			"already active",
		);
		expect(app.create).toHaveBeenCalledOnce();
		startup.resolve();
		await vi.waitFor(() => expect(app.owner.phase).toBe("session"));
		await app.owner.back(null);
		expect(app.retire).toHaveBeenCalledOnce();
		expect(app.owner.canPlay).toBe(true);
		await app.owner.play(async () => configuration());
		expect(app.create).toHaveBeenCalledTimes(2);
	});
	it("cancels admission while profile persistence is pending without constructing authority", async () => {
		const app = setup(true);
		const selection = deferred<ReturnType<typeof configuration>>();
		const playing = app.owner.play(() => selection.promise);
		const back = app.owner.back(null);
		const value = configuration();
		selection.resolve(value);
		await playing;
		await back;
		expect(app.create).not.toHaveBeenCalled();
		expect(value.password).toBe("");
		expect(app.owner.canPlay).toBe(true);
	});
	it("joins cancellation and native retirement before allowing another endpoint", async () => {
		const app = setup(true);
		const native = deferred<void>();
		const startup = deferred<void>();
		app.initialize.mockReturnValue(startup.promise);
		app.retire.mockReturnValue(native.promise);
		await app.owner.play(async () => configuration());
		const attempt = app.owner.attempt;
		const back = app.owner.back("Disconnected");
		expect(app.owner.back(null)).toBe(back);
		expect(attempt?.cancellation.signal.aborted).toBe(true);
		await expect(app.owner.play(async () => configuration())).rejects.toThrow();
		native.resolve();
		startup.resolve();
		await back;
		expect(app.showPicker).toHaveBeenCalledExactlyOnceWith("Disconnected");
	});
	it("Quit supersedes return navigation and drains the launcher even after native failure", async () => {
		const app = setup(true);
		const native = deferred<void>();
		app.retire.mockReturnValue(native.promise);
		await app.owner.play(async () => configuration());
		const back = app.owner.back(null);
		const quit = app.owner.quit();
		expect(app.owner.quit()).toBe(quit);
		native.resolve();
		await back;
		await quit;
		expect(app.showPicker).not.toHaveBeenCalled();
		expect(app.retire).toHaveBeenCalledOnce();
		expect(app.flushLauncher).toHaveBeenCalledOnce();
		expect(app.exit).toHaveBeenCalledExactlyOnceWith([]);
		await expect(app.owner.play(async () => configuration())).rejects.toThrow();
	});
	it("returns failed initialization to a usable picker and reports unresolved retirement", async () => {
		const app = setup(true);
		app.initialize.mockRejectedValue(new Error("Invalid game settings"));
		await app.owner.play(async () => configuration());
		await vi.waitFor(() =>
			expect(app.showPicker).toHaveBeenCalledWith("Invalid game settings"),
		);
		expect(app.owner.canPlay).toBe(true);
		app.initialize.mockResolvedValue();
		app.retire.mockRejectedValue(new Error("Host still running"));
		await app.owner.play(async () => configuration());
		await expect(app.owner.back(null)).rejects.toThrow("Host still running");
		expect(app.owner.canPlay).toBe(false);
		await app.owner.quit();
		expect(app.exit).toHaveBeenCalledWith(["Host still running"]);
	});
});
