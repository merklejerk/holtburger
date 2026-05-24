import type { BrowserLocationSelection } from "../../app/browser-mode";
import type { RenderLandblockAnchor } from "./render-chunks";

type WorldRenderSceneContextKind = "outdoor" | "dungeon";

export interface WorldRenderSceneContext {
	kind: WorldRenderSceneContextKind;
	anchorLandblockId: number | null;
}

export function deriveWorldRenderSceneContext(options: {
	activeRenderAnchor: RenderLandblockAnchor | null;
	browserDestination: BrowserLocationSelection | null;
}): WorldRenderSceneContext {
	return {
		kind:
			options.browserDestination?.kind === "interior-cell"
				? "dungeon"
				: "outdoor",
		anchorLandblockId: options.activeRenderAnchor?.landblockId ?? null,
	};
}
