import { describe, expect, it, vi } from "vitest";
import {
	ClientWindowClose,
	CLIENT_CLOSE_PREPARATION_TIMEOUT_MS,
} from "../../electron/client-window-close";
import { ClientSettingsPersistence } from "./client-settings-persistence";
import { ClientAppLifecycle } from "./client-app-lifecycle";

function deferred() {
	let resolve: () => void = () => {
		throw new Error("Deferred not initialized.");
	};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
function setup() {
	const dependencies = {
		prepareRenderer: vi.fn(),
		shutdownNative: vi.fn(async () => {}),
		reportFailure: vi.fn(),
		exit: vi.fn(),
		deadlineMs: CLIENT_CLOSE_PREPARATION_TIMEOUT_MS,
	};
	return { ...dependencies, owner: new ClientWindowClose(dependencies) };
}

describe("client renderer/native close composition", () => {
	it("waits for the latest renderer-buffered patch behind an in-flight save before native flush/exit", async () => {
		const app = setup();
		const saveA = deferred();
		const saveB = deferred();
		const sent: string[] = [];
		const persistence = new ClientSettingsPersistence<string>({
			delayMs: 60_000,
			report: vi.fn(),
			save: async (patch) => {
				sent.push(patch);
				await (patch === "A" ? saveA.promise : saveB.promise);
			},
		});
		persistence.publish("A");
		const firstSave = persistence.flush();
		persistence.publish("B");
		const lifecycle = new ClientAppLifecycle({
			session: () => null,
			stopInput: async () => {},
			retireGameplay: async () => {},
			warn: vi.fn(),
			onChange: vi.fn(),
		});
		app.prepareRenderer.mockImplementation(() => {
			void lifecycle
				.prepareClose(() => persistence.flush())
				.then(
					() => app.owner.acceptPreparation({ kind: "prepared" }),
					(error) =>
						app.owner.acceptPreparation({
							kind: "failed",
							diagnostic: String(error),
						}),
				);
		});
		const closing = app.owner.request();
		await vi.waitFor(() => expect(app.prepareRenderer).toHaveBeenCalledOnce());
		expect(sent).toEqual(["A"]);
		expect(app.shutdownNative).not.toHaveBeenCalled();
		saveA.resolve();
		await vi.waitFor(() => expect(sent).toEqual(["A", "B"]));
		expect(app.shutdownNative).not.toHaveBeenCalled();
		expect(app.exit).not.toHaveBeenCalled();
		saveB.resolve();
		await Promise.all([closing, firstSave]);
		expect(app.shutdownNative).toHaveBeenCalledOnce();
		expect(app.exit).toHaveBeenCalledOnce();
		expect(app.reportFailure).not.toHaveBeenCalled();
	});
});
