import {
	CLIENT_PREGAME_SCENE_TUNING,
	type ClientPregameLocation,
} from "../../client/client-pregame-tuning";
import { startPresentationFrameLoop } from "../../app/presentation-frame-loop";
import { ClientPresentationRoot } from "../../client/client-presentation-root";
import { EXPLORER_TUNING } from "../../explorer/explorer-tuning";
import { GamePresentationOwner } from "../../lib/game/runtime/game-presentation-owner";
import type { HostPresentationResources } from "../../lib/game/runtime/host-presentation-assets";
import type { HostTransport } from "../../lib/host/host-transport";

/** Deterministic location selection for diagnostics and standalone scene review. */
export function pregameHarnessLocation(): ClientPregameLocation {
	const index = Number(
		new URLSearchParams(location.search).get("pregame-location"),
	);
	const entry = CLIENT_PREGAME_SCENE_TUNING.locations[index];
	if (!Number.isInteger(index) || entry === undefined)
		throw new Error("pregame-location must index a configured pregame scene.");
	return entry;
}

/** Real persistent world for standalone pregame UI review, without a game-server session. */
export function mountPregameWorldHarness(
	canvas: HTMLCanvasElement,
	transport: HostTransport,
	resources: HostPresentationResources,
	onError: (cause: unknown) => void,
) {
	const root = new ClientPresentationRoot({
		canvas,
		pregameLocation: pregameHarnessLocation(),
		build: (signal) =>
			GamePresentationOwner.build({
				canvas,
				hostTransport: transport,
				presentationResources: resources,
				signal,
				frameSettings: EXPLORER_TUNING.frameSettings,
				portalWarpDriveTuning: EXPLORER_TUNING.portalTransition.visual,
				audioTuning: EXPLORER_TUNING.audio,
			}),
		createGameplay: () => {
			throw new Error("Pregame review has no gameplay authority.");
		},
		onGameplayRetired: () => {},
		onReady: () => {},
		onError,
	});
	const stop = startPresentationFrameLoop(
		(time) => {
			root.frame(time);
		},
		() => 0,
	);
	void root.setMode("pregame");
	return {
		scene: { canvas, characters: root.pregameCharacters },
		destroy: () => {
			stop();
			return root.destroy();
		},
	};
}
