import { getContext, setContext } from "svelte";
import { HudGeometryRegistry } from "./hud-geometry";

const HUD_GEOMETRY = Symbol("hud-geometry");

/** Scope mounted geometry readers to one HUD lifetime. */
export function provideHudGeometry(): void {
	setContext(HUD_GEOMETRY, new HudGeometryRegistry());
}

/** Read the geometry owner provided by the containing HUD. */
export function useHudGeometry(): HudGeometryRegistry {
	const registry = getContext<HudGeometryRegistry | undefined>(HUD_GEOMETRY);
	if (registry === undefined) throw new Error("HUD geometry was not provided.");
	return registry;
}
