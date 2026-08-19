import { describe, expect, it } from "vitest";
import {
	acVector3,
	landblockVector3,
	sceneVector3,
} from "../../assets/ac-frame";
import type { DatAssetId } from "../game-types";
import type { SceneNodeId } from "../scene";
import {
	EXTERIOR_PARTICLE_RENDER_OWNER,
	SKY_PARTICLE_RENDER_OWNER,
	type ParticleSourceCohort,
} from "../systems/particle-system";
import type { ParticleInstanceRecord } from "./particle-instance-stream";
import { ParticleRenderBatcher } from "./particle-render-routing";

const MESH = "0x01000001" as DatAssetId;
const FIRST_OWNER = "scene-node:first" as SceneNodeId;
const SECOND_OWNER = "scene-node:second" as SceneNodeId;

describe("particle render routing", () => {
	it("erases owner boundaries after routing into one final domain", () => {
		const batcher = new ParticleRenderBatcher();
		const batches = batcher.route(
			1,
			[source(FIRST_OWNER, 1), source(SECOND_OWNER, 2)],
			() => "shared-domain",
		);

		expect(batches.get("shared-domain")).toEqual([
			expect.objectContaining({
				hwGfxObjId: MESH,
				motionType: 2,
				particles: [record(1), record(2)],
			}),
		]);
	});

	it("keeps independently masked domains separate and omits unavailable owners", () => {
		const batcher = new ParticleRenderBatcher();
		const batches = batcher.route(
			1,
			[source(FIRST_OWNER, 1), source(SECOND_OWNER, 2)],
			(owner) => (owner === FIRST_OWNER ? "first-domain" : null),
		);

		expect(batches.get("first-domain")?.[0]?.particles).toEqual([record(1)]);
		expect([...batches.values()].flat()).toHaveLength(1);
	});

	it("routes exterior effects only when the view has an outdoor domain", () => {
		const batcher = new ParticleRenderBatcher();
		const sources = [source(EXTERIOR_PARTICLE_RENDER_OWNER, 1)];

		expect(
			batcher
				.route(1, sources, (owner) =>
					owner === EXTERIOR_PARTICLE_RENDER_OWNER ? "outdoor" : null,
				)
				.get("outdoor"),
		).toHaveLength(1);
		expect(batcher.route(1, sources, () => null).get("outdoor")).toEqual([]);
	});

	it("routes sky effects to the sky domain", () => {
		const batcher = new ParticleRenderBatcher();
		const sources = [source(SKY_PARTICLE_RENDER_OWNER, 1)];

		expect(
			batcher
				.route(1, sources, (owner) =>
					owner === SKY_PARTICLE_RENDER_OWNER ? "sky" : null,
				)
				.get("sky"),
		).toHaveLength(1);
	});

	it("recoalesces compatible nodes sharing one executor contribution", () => {
		const batcher = new ParticleRenderBatcher();
		const routed = batcher.route(
			1,
			[source(FIRST_OWNER, 1), source(SECOND_OWNER, 2)],
			(owner) => (owner === FIRST_OWNER ? "first-domain" : "second-domain"),
		);

		const merged = batcher.mergeContribution([
			routed.get("first-domain") ?? [],
			routed.get("second-domain") ?? [],
		]);
		expect(merged).toHaveLength(1);
		expect(merged[0]?.particles).toEqual([record(1), record(2)]);
	});

	it("releases domain scratch when topology ownership changes", () => {
		const batcher = new ParticleRenderBatcher();
		batcher.route(1, [source(FIRST_OWNER, 1)], () => "old-domain");

		const rerouted = batcher.route(
			2,
			[source(FIRST_OWNER, 2)],
			() => "new-domain",
		);
		expect(rerouted.has("old-domain")).toBe(false);
		expect(rerouted.get("new-domain")?.[0]?.particles).toEqual([record(2)]);
	});
});

function source(
	renderOwner: ParticleSourceCohort["renderOwner"],
	birthTime: number,
): ParticleSourceCohort {
	return {
		hwGfxObjId: MESH,
		motionType: 2,
		particles: [record(birthTime)],
		renderOwner,
	};
}

function record(birthTime: number): ParticleInstanceRecord {
	return {
		a: acVector3([1, 0, 0]),
		b: acVector3([0, 0, 0]),
		birthTime,
		c: acVector3([0, 0, 0]),
		finalScale: 1,
		finalTranslucency: 1,
		lifespan: 4,
		offset: acVector3([0, 0, 0]),
		landblockOrigin: sceneVector3([0, 0, 0]),
		localOrigin: landblockVector3([0, 0, 0]),
		startScale: 1,
		startTranslucency: 0,
	};
}
