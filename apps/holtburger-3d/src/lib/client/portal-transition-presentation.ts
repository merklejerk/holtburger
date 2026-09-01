/** Complete visual instruction produced once for one portal-transition frame. */
export type PortalTransitionPresentationPlan =
	| {
			readonly kind: "origin-to-tunnel";
			readonly generation: number;
			readonly progress: number;
	  }
	| {
			readonly kind: "tunnel-only";
			readonly generation: number;
	  }
	| {
			readonly kind: "tunnel-to-destination";
			readonly generation: number;
			readonly progress: number;
	  }
	| {
			readonly kind: "destination-only-awaiting-handoff";
			readonly generation: number;
	  };

/** Renderer proof that one generation-specific transition barrier reached the visible surface. */
export type PortalTransitionPresentationReceipt =
	| { readonly kind: "tunnel-only"; readonly generation: number }
	| {
			readonly kind: "destination-only-awaiting-handoff";
			readonly generation: number;
	  };

/** One-shot authority-facing fact emitted after a neutral destination frame is presented. */
export interface PortalRevealReceipt {
	readonly generation: number;
}

/** Validate a complete controller-produced plan at an external presentation boundary. */
export function validatePortalTransitionPresentationPlan(
	plan: PortalTransitionPresentationPlan,
): void {
	if (!Number.isSafeInteger(plan.generation) || plan.generation < 0) {
		throw new Error(
			"Portal transition generation must be a non-negative safe integer.",
		);
	}
	if (
		plan.kind !== "origin-to-tunnel" &&
		plan.kind !== "tunnel-to-destination"
	) {
		return;
	}
	if (!Number.isFinite(plan.progress)) {
		throw new Error("Portal transition progress must be finite.");
	}
	if (plan.progress < 0 || plan.progress > 1) {
		throw new Error("Portal transition progress must be within [0, 1].");
	}
}
