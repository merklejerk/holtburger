import { getContext, setContext } from "svelte";
import { HudGeometryRegistry } from "./client-hud-geometry";

const HUD_GEOMETRY = Symbol("client-hud-geometry");

/** Scope mounted geometry readers to one gameplay HUD lifetime. */
export function provideClientHudGeometry(): void {
	setContext(HUD_GEOMETRY, new HudGeometryRegistry());
}

/** Read the geometry owner provided by the containing gameplay HUD. */
export function useClientHudGeometry(): HudGeometryRegistry {
	const registry = getContext<HudGeometryRegistry | undefined>(HUD_GEOMETRY);
	if (registry === undefined)
		throw new Error("Client HUD geometry was not provided.");
	return registry;
}
