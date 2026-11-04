import { describe, expect, it, vi } from "vitest";
import {
	ClientPregameCharacterService,
	type PregameCharacterSink,
	type PregameCharacterStatus,
} from "./client-pregame-character";
import {
	PREGAME_TEST_SOURCE,
	PREGAME_TEST_VIEW,
} from "./client-pregame-model.test-support";

function scene() {
	let listener: ((status: PregameCharacterStatus) => void) | null = null;
	const sink: PregameCharacterSink = {
		setSource: vi.fn(),
		setView: vi.fn(),
		subscribe: (next) => {
			listener = next;
			next({ kind: "empty" });
			return () => {
				listener = null;
			};
		},
	};
	return {
		sink,
		publish: (status: PregameCharacterStatus) => listener?.(status),
	};
}

describe("pregame surface ownership", () => {
	it("revokes the surface and clears its view even when model withdrawal fails", () => {
		const service = new ClientPregameCharacterService();
		const driver = scene();
		service.connect(driver.sink);
		const revoke = vi.fn();
		const surface = service.open(vi.fn(), revoke);
		surface.setSource(PREGAME_TEST_SOURCE);
		const failure = new Error("Model withdrawal failed");
		vi.mocked(driver.sink.setSource).mockImplementationOnce(() => {
			throw failure;
		});
		expect(() => service.destroy()).toThrow(failure);
		expect(driver.sink.setView).toHaveBeenLastCalledWith(null);
		expect(revoke).toHaveBeenCalledOnce();
		surface.setSource(PREGAME_TEST_SOURCE);
		expect(driver.sink.setSource).toHaveBeenLastCalledWith(null);
	});

	it("retains source/layout while the world starts and reapplies them to a retried scene", () => {
		const service = new ClientPregameCharacterService();
		const status = vi.fn();
		const surface = service.open(status, () => {});
		surface.setView(PREGAME_TEST_VIEW);
		surface.setSource(PREGAME_TEST_SOURCE);
		expect(status).toHaveBeenLastCalledWith({ kind: "loading" });
		const first = scene();
		const disconnect = service.connect(first.sink);
		expect(first.sink.setView).toHaveBeenLastCalledWith(PREGAME_TEST_VIEW);
		expect(first.sink.setSource).toHaveBeenLastCalledWith(PREGAME_TEST_SOURCE);
		first.publish({ kind: "ready", replacement: { kind: "settled" } });
		expect(status).toHaveBeenLastCalledWith({
			kind: "ready",
			replacement: { kind: "settled" },
		});
		disconnect();
		const retried = scene();
		service.connect(retried.sink);
		first.publish({ kind: "failed", message: "obsolete" });
		expect(retried.sink.setSource).toHaveBeenLastCalledWith(
			PREGAME_TEST_SOURCE,
		);
		expect(retried.sink.setView).toHaveBeenLastCalledWith(PREGAME_TEST_VIEW);
		expect(status).not.toHaveBeenLastCalledWith({
			kind: "failed",
			message: "obsolete",
		});
	});

	it("revokes the outgoing page before a new page publishes, including late source and cleanup callbacks", () => {
		const service = new ClientPregameCharacterService();
		const driver = scene();
		service.connect(driver.sink);
		const oldStatus = vi.fn();
		const revoked = vi.fn();
		const old = service.open(oldStatus, revoked);
		old.setSource(PREGAME_TEST_SOURCE);
		const current = service.open(vi.fn(), () => {});
		const next = { ...PREGAME_TEST_SOURCE, subjectId: "character-b" };
		current.setSource(next);
		current.setView(PREGAME_TEST_VIEW);
		expect(revoked).toHaveBeenCalledOnce();
		old.setSource(PREGAME_TEST_SOURCE);
		old.setView(null);
		old.destroy();
		expect(driver.sink.setSource).toHaveBeenLastCalledWith(next);
		expect(driver.sink.setView).toHaveBeenLastCalledWith(PREGAME_TEST_VIEW);
		current.destroy();
		expect(driver.sink.setSource).toHaveBeenLastCalledWith(null);
		expect(driver.sink.setView).toHaveBeenLastCalledWith(null);
	});

	it("rejects new surfaces after root retirement and ignores retained outgoing capabilities", () => {
		const service = new ClientPregameCharacterService();
		const driver = scene();
		const disconnect = service.connect(driver.sink);
		const surface = service.open(vi.fn(), () => {});
		service.destroy();
		disconnect();
		surface.setSource(PREGAME_TEST_SOURCE);
		expect(() => service.open(vi.fn(), () => {})).toThrow("retired");
		expect(() => service.connect(scene().sink)).toThrow("unavailable");
		expect(driver.sink.setSource).toHaveBeenLastCalledWith(null);
	});
});
