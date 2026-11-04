import { describe, expect, it } from "vitest";
import { Mat4, Vec3 } from "../math/types";
import type { SceneNodeId } from "../scene";
import { WebGL2EntitySelectionPass } from "./webgl2-entity-selection-pass";

describe("WebGL2EntitySelectionPass", () => {
	it("preserves a sphere proxy without rigid geometry and skips a hidden rigid root without GPU work", () => {
		const pass = new WebGL2EntitySelectionPass({} as WebGL2RenderingContext, {
			getGeometry: () => {
				throw new Error("Preparation must not resolve GPU geometry.");
			},
			getPose: () => {
				throw new Error("Preparation must not read a GPU pose address.");
			},
		});
		const nodeId = "scene-node:selection-test" as SceneNodeId;
		expect(pass.prepare({ nodeId, shape: { kind: "rigid" } }, null)).toBeNull();
		expect(
			pass.prepare(
				{
					nodeId,
					shape: {
						kind: "sphere-proxy",
						placement: {
							envCellId: null,
							landblockId: "0x0000ffff",
							localToLandblock: Mat4.identity(),
							scope: { kind: "outdoor" },
						},
						sphere: { center: Vec3.zero(), radius: 1 },
					},
				},
				null,
			)?.kind,
		).toBe("sphere-proxy");
		expect(pass.getDiagnostics()).toEqual({
			activeMaskBytes: 0,
			allocatedTargetGenerationCount: 0,
			disposedTargetGenerationCount: 0,
		});
		pass.destroy();
	});
});
