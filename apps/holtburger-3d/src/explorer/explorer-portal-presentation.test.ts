import { describe, expect, it, vi } from "vitest";
import type { PortalTransitionPresentationPlan } from "../lib/client/portal-transition-presentation";
import {
	presentExplorerPortalFrame,
	type ExplorerPortalPresentationRuntime,
	type ExplorerPortalTransitionCoordinator,
} from "./explorer-portal-presentation";

const EXTENT = { height: 720, width: 1_280 } as const;

describe("presentExplorerPortalFrame", () => {
	it("delivers one controller plan to the portal-only schedule and acknowledges its receipt", () => {
		const plan = { generation: 3, kind: "tunnel-only" } as const;
		const receipt = { generation: 3, kind: "tunnel-only" } as const;
		const { coordinator, runtime } = fixture(plan, receipt);

		expect(
			presentExplorerPortalFrame({
				activationReady: false,
				coordinator,
				extent: EXTENT,
				nowMs: 2_000,
				runtime,
				worldRenderable: false,
			}),
		).toBeNull();
		expect(coordinator.advancePortalTransition).toHaveBeenCalledOnce();
		expect(runtime.setPortalTransition).toHaveBeenCalledWith(plan);
		expect(runtime.renderPortalTransition).toHaveBeenCalledWith(2, EXTENT);
		expect(runtime.render).not.toHaveBeenCalled();
		expect(coordinator.acknowledgePortalPresentation).toHaveBeenCalledWith(
			receipt,
		);
		expect(coordinator.markRenderedFrame).not.toHaveBeenCalled();
	});

	it.each([
		{
			generation: 3,
			kind: "tunnel-to-destination",
			progress: 0.5,
		},
		{ generation: 3, kind: "destination-only-awaiting-handoff" },
	] satisfies readonly PortalTransitionPresentationPlan[])(
		"delivers $kind unchanged to one world render before acknowledgement",
		(plan) => {
			const receipt = {
				generation: 3,
				kind: "destination-only-awaiting-handoff",
			} as const;
			const { coordinator, runtime } = fixture(plan, receipt);
			vi.mocked(coordinator.acknowledgePortalPresentation).mockReturnValue({
				generation: 3,
			});

			expect(
				presentExplorerPortalFrame({
					activationReady: true,
					coordinator,
					extent: EXTENT,
					nowMs: 2_000,
					runtime,
					worldRenderable: true,
				}),
			).toEqual({ generation: 3 });
			expect(coordinator.advancePortalTransition).toHaveBeenCalledOnce();
			expect(runtime.setPortalTransition).toHaveBeenCalledWith(plan);
			expect(runtime.render).toHaveBeenCalledWith(2);
			expect(runtime.renderPortalTransition).not.toHaveBeenCalled();
			expect(coordinator.markRenderedFrame).toHaveBeenCalledOnce();
			expect(coordinator.acknowledgePortalPresentation).toHaveBeenCalledWith(
				receipt,
			);
		},
	);

	it("publishes the inactive plan without rendering an unavailable world", () => {
		const { coordinator, runtime } = fixture(undefined, null);
		presentExplorerPortalFrame({
			activationReady: false,
			coordinator,
			extent: EXTENT,
			nowMs: 2_000,
			runtime,
			worldRenderable: false,
		});
		expect(runtime.setPortalTransition).toHaveBeenCalledWith(undefined);
		expect(runtime.render).not.toHaveBeenCalled();
		expect(runtime.renderPortalTransition).not.toHaveBeenCalled();
		expect(coordinator.acknowledgePortalPresentation).not.toHaveBeenCalled();
	});

	it("does not make an unrenderable destination ready for exit", () => {
		const plan = { generation: 3, kind: "tunnel-only" } as const;
		const { coordinator, runtime } = fixture(plan, null);

		presentExplorerPortalFrame({
			activationReady: true,
			coordinator,
			extent: EXTENT,
			nowMs: 2_000,
			runtime,
			worldRenderable: false,
		});

		expect(coordinator.advancePortalTransition).toHaveBeenCalledWith(
			2_000,
			false,
		);
		expect(runtime.renderPortalTransition).toHaveBeenCalledOnce();
		expect(runtime.render).not.toHaveBeenCalled();
	});
});

function fixture(
	plan: PortalTransitionPresentationPlan | undefined,
	receipt: ReturnType<ExplorerPortalPresentationRuntime["render"]>,
): {
	readonly coordinator: ExplorerPortalTransitionCoordinator;
	readonly runtime: ExplorerPortalPresentationRuntime;
} {
	return {
		coordinator: {
			acknowledgePortalPresentation: vi.fn(() => null),
			advancePortalTransition: vi.fn(() => plan),
			markRenderedFrame: vi.fn(),
		},
		runtime: {
			render: vi.fn(() => receipt),
			renderPortalTransition: vi.fn(() => receipt),
			setPortalTransition: vi.fn(),
		},
	};
}
