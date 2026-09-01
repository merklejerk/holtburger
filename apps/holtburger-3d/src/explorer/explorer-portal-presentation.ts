import type {
	PortalRevealReceipt,
	PortalTransitionPresentationPlan,
	PortalTransitionPresentationReceipt,
} from "../lib/client/portal-transition-presentation";
import type { RenderExtent } from "../lib/game/renderer/render-extent";

/** Transition operations owned by the Explorer camera coordinator. */
export interface ExplorerPortalTransitionCoordinator {
	advancePortalTransition(
		nowMs: number,
		destinationReady: boolean,
	): PortalTransitionPresentationPlan | undefined;
	acknowledgePortalPresentation(
		receipt: PortalTransitionPresentationReceipt | null,
	): PortalRevealReceipt | null;
	markRenderedFrame(): void;
}

/** Narrow runtime surface needed to present exactly one Explorer transition frame. */
export interface ExplorerPortalPresentationRuntime {
	render(timeSeconds: number): PortalTransitionPresentationReceipt | null;
	renderPortalTransition(
		timeSeconds: number,
		extent: RenderExtent,
	): PortalTransitionPresentationReceipt | null;
	setPortalTransition(plan: PortalTransitionPresentationPlan | undefined): void;
}

/** Advance once, render the selected schedule once, then acknowledge only its visible receipt. */
export function presentExplorerPortalFrame(input: {
	readonly activationReady: boolean;
	readonly coordinator: ExplorerPortalTransitionCoordinator;
	readonly extent: RenderExtent;
	readonly nowMs: number;
	readonly runtime: ExplorerPortalPresentationRuntime;
	readonly worldRenderable: boolean;
}): PortalRevealReceipt | null {
	const plan = input.coordinator.advancePortalTransition(
		input.nowMs,
		input.activationReady && input.worldRenderable,
	);
	input.runtime.setPortalTransition(plan);
	const timeSeconds = input.nowMs / 1_000;
	if (plan?.kind === "origin-to-tunnel" || plan?.kind === "tunnel-only") {
		return input.coordinator.acknowledgePortalPresentation(
			input.runtime.renderPortalTransition(timeSeconds, input.extent),
		);
	}
	if (!input.worldRenderable) return null;
	const receipt = input.runtime.render(timeSeconds);
	input.coordinator.markRenderedFrame();
	return input.coordinator.acknowledgePortalPresentation(receipt);
}
