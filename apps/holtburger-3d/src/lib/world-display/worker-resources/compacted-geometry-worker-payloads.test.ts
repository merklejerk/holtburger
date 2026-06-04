import { describe, expect, it } from "vitest";

import type {
	CompactedGeometryBuildDrawUnit,
	CompactedGeometryPlan,
} from "../compaction/compacted-geometry";
import type { RenderMat4 } from "../render-math";
import {
	buildCompactedGeometryWorkerResult,
	collectBuildCompactedGeometryInputTransferables,
	collectBuildCompactedGeometryResultTransferables,
	type BuildCompactedGeometryWorkerInput,
} from "./compacted-geometry-worker-payloads";
import { runRenderResourceWorkerJob } from "../../../workers/render-resource-worker";

describe("compacted geometry worker payloads", () => {
	it("builds compacted geometry through the worker job contract", () => {
		const input = createWorkerInput();
		const result = runRenderResourceWorkerJob({
			type: "build-compacted-geometry",
			key: input.key,
			input,
		});

		expect(result.type).toBe("build-compacted-geometry");
		if (result.type !== "build-compacted-geometry") {
			throw new Error("expected compacted geometry result");
		}
		expect(result.geometry?.positions).toEqual(
			Float32Array.from([10, 0, 0, 11, 0, 0, 10, 1, 0]),
		);
		expect(result.geometry?.materialSlotIndices).toEqual(
			Float32Array.from([0, 0, 0]),
		);
		expect(result.geometry?.indices).toEqual(Uint16Array.from([0, 1, 2]));
	});

	it("collects input and result transferables from worker-owned buffers", () => {
		const input = createWorkerInput();
		const inputTransferables =
			collectBuildCompactedGeometryInputTransferables(input);
		const result = buildCompactedGeometryWorkerResult(input);
		const resultTransferables =
			collectBuildCompactedGeometryResultTransferables(result);

		expect(inputTransferables).toHaveLength(4);
		expect(resultTransferables).toHaveLength(5);
		expect(new Set(resultTransferables).size).toBe(resultTransferables.length);
	});
});

function createWorkerInput(): BuildCompactedGeometryWorkerInput {
	return {
		key: "compacted-job/a",
		plan: createPlan(),
		drawUnits: [createDrawUnit()],
		batchOrigin: { x: 0, y: 0, z: 0 },
	};
}

function createPlan(): CompactedGeometryPlan {
	return {
		key: "plan-a",
		compactableDrawUnitIds: ["draw-a"],
		materialSlots: [{ key: "material-slot-a", index: 0 }],
		drawUnitMaterialSlots: [
			{ drawUnitId: "draw-a", materialSlotKey: "material-slot-a" },
		],
		drawSlices: [
			{
				key: "slice-a",
				renderStateKey: "opaque",
				materialSlotKeys: ["material-slot-a"],
				drawUnitIds: ["draw-a"],
			},
		],
		triangleCount: 1,
	};
}

function createDrawUnit(): CompactedGeometryBuildDrawUnit {
	return {
		id: "draw-a",
		kind: "static",
		geometry: {
			signature: "geometry-a",
			positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
			uvs: Float32Array.from([0, 0, 1, 0, 0, 1]),
			indices: Uint16Array.from([0, 1, 2]),
			vertexCount: 3,
			triangleCount: 1,
		},
		modelMatrix: new Float32Array([
			1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1,
		]) as RenderMat4,
		material: { kind: "direct-texture" },
	};
}
