import { describe, expect, it } from "vitest";
import { acVector3 } from "../../assets/ac-frame";
import type { DrawableParticleEmitter } from "../behavior/particle-emitter-repository";
import type { PreparedPhysicsScript } from "../behavior/physics-script-repository";
import type { DatAssetId } from "../game-types";
import type { ObjectVisualTemplate } from "../systems/object-visual-template-repository";
import { AABB3, Mat4, Vec3 } from "../math/types";
import { ObjectPreviewPresentation } from "./object-preview-presentation";

const SCRIPT_ID = "0x33000001" as DatAssetId;
const EMITTER_ID = "0x32000001" as DatAssetId;
const MESH_ID = "0x01000001" as DatAssetId;

describe("ObjectPreviewPresentation", () => {
	it("executes a setup script and publishes a part-attached particle", () => {
		const setupPart = Mat4.identity();
		setupPart.m41 = 3;
		const presentation = new ObjectPreviewPresentation(
			{
				clips: [],
				defaultScriptRoot: SCRIPT_ID,
				emitters: new Map([[EMITTER_ID, emitter()]]),
				firstCyclicClip: null,
				scale: new Vec3(1, 1, 1),
				scripts: new Map([[SCRIPT_ID, script()]]),
				setupPose: [setupPart],
				template: template(),
				translucency: 0.4,
			},
			() => 0.5,
		);

		const frame = presentation.advance(0);

		expect(frame.partToPreview[0]?.m41).toBe(3);
		expect(frame.partRenderStates[0]?.translucency).toBe(0.4);
		expect(frame.particleRanges).toEqual([
			expect.objectContaining({ count: 1, hwGfxObjId: MESH_ID }),
		]);
		// The particle record stores the part-frame origin used by the GPU particle pass.
		expect(frame.particleRecords.data[0]).toBe(3);
		expect(frame.particleRecords.dirtySlots).toEqual({ first: 0, last: 0 });

		presentation.dispose();
		expect(() => presentation.advance(1)).toThrow("disposed");
	});
});

function script(): PreparedPhysicsScript {
	return {
		dependencies: {
			emitterInfoIds: [EMITTER_ID],
			scriptIds: [],
			soundIds: [],
		},
		id: SCRIPT_ID,
		lengthSeconds: 0,
		records: [
			{
				authoredOrder: 0,
				emitterId: 0,
				emitterInfoId: EMITTER_ID,
				kind: "create-particle",
				offsetOrigin: acVector3([0, 0, 0]),
				partIndex: 0,
				startTime: 0,
			},
		],
	};
}

function emitter(): DrawableParticleEmitter {
	return {
		centerReach: 0,
		id: EMITTER_ID,
		info: {
			a: acVector3([0, 0, 0]),
			b: acVector3([0, 0, 0]),
			birthrate: 0,
			c: acVector3([0, 0, 0]),
			emitsPerMeter: false,
			emitsPerSecond: false,
			finalScale: 1,
			finalTrans: 0,
			followsParent: true,
			id: EMITTER_ID,
			initialParticles: 1,
			isPersistent: true,
			lifespan: 10,
			lifespanRand: 0,
			maxA: 1,
			maxB: 1,
			maxC: 1,
			maxOffset: 0,
			maxParticles: 1,
			minA: 1,
			minB: 1,
			minC: 1,
			minOffset: 0,
			motionType: 0,
			offsetDir: acVector3([0, 0, 1]),
			scaleRand: 0,
			startScale: 1,
			startTrans: 0,
			totalParticles: 1,
			totalSeconds: 0,
			transRand: 0,
		},
		kind: "drawable",
		maximumScale: 1,
		mesh: { id: MESH_ID, radius: 1 },
	};
}

function template(): Pick<ObjectVisualTemplate, "parts"> {
	return {
		parts: [
			{
				defaultScale: new Vec3(1, 1, 1),
				depthDrawUnits: [],
				drawUnits: [],
				geometry: "object-geometry:preview-test" as never,
				geometryData: {
					bakedLight: null,
					indices: new Uint32Array(),
					kind: "object",
					normals: new Float32Array(),
					positions: new Float32Array(),
					textureCoordinates: new Float32Array(),
				},
				key: "part-visual-template:preview-test" as never,
				localBounds: new AABB3(Vec3.zero(), Vec3.zero()),
				partIndex: 0,
			},
		],
	};
}
