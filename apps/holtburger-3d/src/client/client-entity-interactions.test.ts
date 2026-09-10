import { describe, expect, it, vi } from "vitest";
import { ClientEntityInteractions } from "./client-entity-interactions";
import { ClientEntitySelection } from "./client-entity-selection";
import { ClientLifecycleSession } from "./client-lifecycle-session";

/** Exercise real selection and lifecycle owners across an injected host transport. */
async function fixture() {
	const handlers = new Map<string, (payload: unknown) => void>();
	const invoke = vi
		.fn<(command: string, args?: Record<string, unknown>) => Promise<void>>()
		.mockResolvedValue(undefined);
	const lifecycle = new ClientLifecycleSession({
		invoke,
		listen: async (name, handler) => {
			handlers.set(name, handler);
			return () => {
				handlers.delete(name);
			};
		},
	});
	const selection = new ClientEntitySelection({
		lifecycle,
		presentation: () => null,
	});
	const onFailure = vi.fn();
	const interactions = new ClientEntityInteractions({
		lifecycle,
		selection,
		onFailure,
	});
	await lifecycle.start();
	function emit(name: string, payload: unknown): void {
		const handler = handlers.get(name);
		if (handler === undefined) throw new Error(`Missing listener: ${name}`);
		handler(payload);
	}
	emit("client-lifecycle-changed", { kind: "in-world" });
	invoke.mockClear();
	return {
		invoke,
		emit,
		selection,
		interactions,
		onFailure,
		destroy: () => {
			interactions.destroy();
			selection.destroy();
			lifecycle.stop();
		},
	};
}

describe("ClientEntityInteractions", () => {
	it("replaces subscriptions, filters health by GUID, and distinguishes unknown from zero", async () => {
		const f = await fixture();
		f.selection.select(7);
		f.selection.select(7);
		expect(f.invoke.mock.calls).toEqual([
			["query_client_entity_health", { guid: 7 }],
		]);
		expect(f.interactions.healthFraction()).toBeNull();
		f.emit("client-entity-health-updated", { guid: 7, healthFraction: 0.4 });
		expect(f.interactions.healthFraction()).toBe(0.4);
		f.selection.select(null);
		f.selection.select(7);
		expect(f.interactions.healthFraction()).toBeNull();
		expect(f.invoke).toHaveBeenLastCalledWith("query_client_entity_health", {
			guid: 7,
		});
		f.emit("client-entity-health-updated", { guid: 7, healthFraction: 0.4 });
		expect(f.interactions.healthFraction()).toBe(0.4);
		f.selection.select(8);
		f.emit("client-entity-health-updated", { guid: 7, healthFraction: 0.2 });
		expect(f.interactions.healthFraction()).toBeNull();
		f.emit("client-entity-health-updated", { guid: 8, healthFraction: 0 });
		expect(f.interactions.healthFraction()).toBe(0);
		f.selection.select(null);
		expect(f.invoke).toHaveBeenLastCalledWith("query_client_entity_health", {
			guid: 0,
		});
		expect(f.interactions.healthFraction()).toBeNull();
		f.destroy();
	});

	it("uses the target at the button edge and reports command failures", async () => {
		const f = await fixture();
		f.interactions.interact(false);
		expect(f.invoke).not.toHaveBeenCalled();
		f.selection.select(7);
		f.interactions.interact(false);
		expect(f.invoke).toHaveBeenLastCalledWith("use_client_entity", {
			guid: 7,
			unrestricted: false,
		});
		const failure = new Error("transport closed");
		f.invoke.mockRejectedValueOnce(failure);
		f.selection.select(8);
		await vi.waitFor(() => expect(f.onFailure).toHaveBeenCalledWith(failure));
		f.invoke.mockRejectedValueOnce(failure);
		f.interactions.interact(false);
		await vi.waitFor(() => expect(f.onFailure).toHaveBeenCalledTimes(2));
		f.destroy();
	});

	it("captures the explicit unrestricted policy independently for each use", async () => {
		const f = await fixture();
		f.selection.select(7);
		f.interactions.interact(true);
		expect(f.invoke).toHaveBeenLastCalledWith("use_client_entity", {
			guid: 7,
			unrestricted: true,
		});
		f.interactions.interact(false);
		expect(f.invoke).toHaveBeenLastCalledWith("use_client_entity", {
			guid: 7,
			unrestricted: false,
		});
		f.destroy();
	});

	it("cancels on portal entry and does not restore a target on world reentry", async () => {
		const f = await fixture();
		f.selection.select(7);
		f.emit("client-lifecycle-changed", {
			kind: "portal-space",
			worldGeneration: 2,
			cause: "teleport",
		});
		expect(f.selection.selectedGuid()).toBeNull();
		expect(f.invoke).toHaveBeenLastCalledWith("query_client_entity_health", {
			guid: 0,
		});
		f.invoke.mockClear();
		f.emit("client-lifecycle-changed", { kind: "in-world" });
		f.interactions.interact(false);
		expect(f.invoke).not.toHaveBeenCalled();
		f.destroy();
	});

	it("clears on disconnect without sending commands to a dead session", async () => {
		const f = await fixture();
		f.selection.select(7);
		f.invoke.mockClear();
		f.emit("client-lifecycle-changed", {
			kind: "exiting",
			cause: "server-disconnect",
		});
		expect(f.selection.selectedGuid()).toBeNull();
		f.interactions.interact(false);
		f.destroy();
		expect(f.invoke).not.toHaveBeenCalled();
	});

	it("cancels once on destruction and detaches selection and health listeners", async () => {
		const f = await fixture();
		f.selection.select(7);
		f.invoke.mockClear();
		f.interactions.destroy();
		f.interactions.destroy();
		f.selection.select(8);
		f.emit("client-entity-health-updated", { guid: 8, healthFraction: 0.9 });
		f.interactions.interact(false);
		expect(f.interactions.healthFraction()).toBeNull();
		expect(f.invoke.mock.calls).toEqual([
			["query_client_entity_health", { guid: 0 }],
		]);
		f.destroy();
	});
});
