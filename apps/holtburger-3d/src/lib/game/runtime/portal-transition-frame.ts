import type { PortalTransitionPresentationPlan } from "../../client/portal-transition-presentation";
import type {
	PortalTransitionFrame,
	PortalTunnelVisualSample,
} from "../renderer/renderer";

/** Attach runtime-owned authored clocks only to plans that actually render the tunnel. */
export function enrichPortalTransitionFrame(
	plan: PortalTransitionPresentationPlan,
	tunnel: PortalTunnelVisualSample | null,
): PortalTransitionFrame {
	if (plan.kind === "destination-only-awaiting-handoff") return plan;
	if (tunnel === null) {
		throw new Error(`${plan.kind} requires an authored tunnel visual sample.`);
	}
	return { ...plan, tunnel };
}
