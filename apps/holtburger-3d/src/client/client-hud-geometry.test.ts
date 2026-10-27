import { expect, it } from "vitest";
import { HudGeometryRegistry } from "./client-hud-geometry";

const bounds = { left: 10, top: 20, width: 100, height: 40 };

it("pulls current bounds, excludes self and hidden surfaces, and cleans up", () => {
	const registry = new HudGeometryRegistry();
	let visible = true;
	let current = bounds;
	registry.register({ id: "moving", readBounds: () => bounds });
	const unregister = registry.register({
		id: "peer",
		readBounds: () => (visible ? current : null),
	});
	expect(registry.readPeers("moving")).toEqual([bounds]);
	current = { ...bounds, left: 50 };
	expect(registry.readBounds("peer")).toEqual(current);
	expect(registry.readPeers("moving")).toEqual([current]);
	visible = false;
	expect(registry.readBounds("peer")).toBeNull();
	expect(registry.readPeers("moving")).toEqual([]);
	unregister();
	expect(() => registry.readBounds("peer")).toThrow(
		"Missing HUD surface: peer",
	);
});

it("rejects duplicate identities and permits reuse after cleanup", () => {
	const registry = new HudGeometryRegistry();
	let current = bounds;
	const surface = { id: "bar", readBounds: () => current };
	const original = registry.register(surface);
	expect(() =>
		registry.register({ id: "bar", readBounds: () => bounds }),
	).toThrow("Duplicate HUD surface: bar");
	original();
	current = { ...bounds, left: 80 };
	registry.register(surface);
	original();
	expect(registry.readBounds("bar")).toEqual(current);
});
