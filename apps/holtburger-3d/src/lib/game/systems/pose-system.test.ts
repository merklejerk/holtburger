import { describe, expect, it } from "vitest";
import { Mat4 } from "../math/types";
import { PoseSystem, type DynamicPosePublisher } from "./pose-system";

describe("PoseSystem", () => {
	it("publishes visual-root state before final rigid-part pose", () => {
		const calls: string[] = [];
		const publisher: DynamicPosePublisher = {
			setPose: () => calls.push("pose"),
			setVisualRootTransform: () => calls.push("visual-root"),
		};
		new PoseSystem(publisher).publish([
			{
				nodeId: "scene-node:1",
				pose: { partToObjectTransforms: [Mat4.identity()] },
				visualRootTransform: Mat4.identity(),
			},
		]);

		expect(calls).toEqual(["visual-root", "pose"]);
	});
});
