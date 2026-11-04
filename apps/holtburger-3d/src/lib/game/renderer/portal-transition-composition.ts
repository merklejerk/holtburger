import type { PortalTransitionFrame } from "./renderer";

/** Exact flat-scene composition selected before any WebGL state is touched. */
export type PortalTransitionComposition<Texture> =
	| { readonly kind: "scene-only" }
	| { readonly kind: "tunnel-only"; readonly tunnel: Texture }
	| {
			readonly kind: "origin-to-tunnel";
			readonly origin: Texture;
			readonly tunnel: Texture;
			readonly progress: number;
	  }
	| {
			readonly kind: "tunnel-to-destination";
			readonly tunnel: Texture;
			readonly progress: number;
	  };

/** Renderer-owned resources available while resolving one complete presentation instruction. */
export interface PortalTransitionCompositionResources<Texture> {
	readonly origin: Texture | null;
	readonly tunnel: Texture | null;
}

/** Resolve one plan exhaustively; missing required resources are invariant failures, never modes. */
export function resolvePortalTransitionComposition<Texture>(
	frame: PortalTransitionFrame | undefined,
	resources: PortalTransitionCompositionResources<Texture>,
): PortalTransitionComposition<Texture> {
	if (
		frame === undefined ||
		frame.kind === "destination-only-awaiting-handoff"
	) {
		return { kind: "scene-only" };
	}
	const tunnel = resources.tunnel;
	if (tunnel === null) {
		throw new Error(`${frame.kind} requires the authored tunnel target.`);
	}
	if (frame.kind === "tunnel-only") return { kind: "tunnel-only", tunnel };
	if (frame.kind === "tunnel-to-destination") {
		return {
			kind: frame.kind,
			progress: frame.progress,
			tunnel,
		};
	}
	const origin = resources.origin;
	if (origin === null) {
		throw new Error("origin-to-tunnel requires a captured origin target.");
	}
	return {
		kind: frame.kind,
		origin,
		progress: frame.progress,
		tunnel,
	};
}
