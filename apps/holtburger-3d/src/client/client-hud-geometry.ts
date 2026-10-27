import type { ResolvedClientHudPlacement } from "./client-hud-layout";

/** Stable identity within one mounted client HUD, independent of display order. */
export type HudSurfaceId = string;

/** Mounted snap participant; hidden surfaces expose no rectangle. */
interface HudSurface {
	/** Stable key for exclusion and mount-lifetime cleanup. */
	readonly id: HudSurfaceId;
	/** Pull resolved CSS-pixel geometry; null explicitly marks a hidden surface. */
	readonly readBounds: () => ResolvedClientHudPlacement | null;
}

/** Imperative geometry readers owned by one client HUD, not a reactive position cache. */
export class HudGeometryRegistry {
	private readonly surfaces = new Map<HudSurfaceId, HudSurface>();

	register(surface: HudSurface): () => void {
		if (this.surfaces.has(surface.id))
			throw new Error(`Duplicate HUD surface: ${surface.id}`);
		this.surfaces.set(surface.id, surface);
		let registered = true;
		return () => {
			// Cleanup remains safe if called again after the identity has been reused.
			if (!registered) return;
			registered = false;
			this.surfaces.delete(surface.id);
		};
	}

	/** Read a required participant; hidden geometry is explicitly unavailable. */
	readBounds(id: HudSurfaceId): ResolvedClientHudPlacement | null {
		const surface = this.surfaces.get(id);
		if (surface === undefined) throw new Error(`Missing HUD surface: ${id}`);
		return surface.readBounds();
	}

	/** Pull current visible peers, excluding the surface being moved. */
	readPeers(moving: HudSurfaceId): readonly ResolvedClientHudPlacement[] {
		const rectangles: ResolvedClientHudPlacement[] = [];
		for (const surface of this.surfaces.values()) {
			if (surface.id === moving) continue;
			const bounds = surface.readBounds();
			if (bounds !== null) rectangles.push(bounds);
		}
		return rectangles;
	}
}
