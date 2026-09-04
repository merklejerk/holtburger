import { describe, expect, it } from "vitest";

import { Mat4 } from "../math/types";
import type { SceneNodeId } from "../scene";
import { WebGL2EntitySelectionPass } from "./webgl2-entity-selection-pass";

const NODE_ID = "scene-node:selection-test" as SceneNodeId;

describe("WebGL2EntitySelectionPass", () => {
	it("does not allocate GPU state for a hidden selected entity", () => {
		const pass = new WebGL2EntitySelectionPass({} as WebGL2RenderingContext, {
			getGeometry: () => {
				throw new Error("Hidden selection must not resolve geometry.");
			},
		});

		expect(
			pass.render({
				anchorCoordinates: { x: 0, y: 0 },
				clipFromAnchor: Mat4.identity(),
				contributions: { depth: [], kind: "hidden", material: [] },
				height: 720,
				nodeId: NODE_ID,
				shape: { kind: "rigid" },
				showRetailHiddenGeometry: false,
				width: 1280,
			}),
		).toBeNull();
		expect(pass.getDiagnostics()).toEqual({
			activeMaskBytes: 0,
			allocatedTargetGenerationCount: 0,
			disposedTargetGenerationCount: 0,
		});
		pass.destroy();
	});
});
