import { describe, expect, it } from "vitest";
import type { DatAssetId } from "../game-types";
import type { SceneNodeId } from "../scene";
import {
	EXTERIOR_PARTICLE_RENDER_OWNER,
	SKY_PARTICLE_RENDER_OWNER,
	type ParticleSourceRange,
} from "../systems/particle-system";
import { ParticleRenderBatcher } from "./particle-render-routing";

const MESH = "0x01000001" as DatAssetId;
const FIRST_OWNER = "scene-node:first" as SceneNodeId;
const SECOND_OWNER = "scene-node:second" as SceneNodeId;
const RECORD_ORIGIN = { kind: "record" } as const;

describe("particle render routing", () => {
	it("erases owner boundaries after routing into one final domain", () => {
		const batcher = new ParticleRenderBatcher();

		const routed = batcher.route(
			1,
			[source(FIRST_OWNER, 0), source(SECOND_OWNER, 8)],
			() => "shared-domain",
		);

		// Both owners land in one domain, and ownership is gone from what comes out.
		expect(routed.get("shared-domain")).toEqual([
			{
				baseSlot: 0,
				count: 1,
				hwGfxObjId: MESH,
				motionType: 2,
				origin: RECORD_ORIGIN,
			},
			{
				baseSlot: 8,
				count: 1,
				hwGfxObjId: MESH,
				motionType: 2,
				origin: RECORD_ORIGIN,
			},
		]);
	});

	it("keeps independently masked domains separate and omits unavailable owners", () => {
		const batcher = new ParticleRenderBatcher();

		const routed = batcher.route(
			1,
			[source(FIRST_OWNER, 0), source(SECOND_OWNER, 8)],
			(owner) => (owner === FIRST_OWNER ? "first-domain" : null),
		);

		expect(routed.get("first-domain")).toHaveLength(1);
		expect([...routed.values()].flat()).toHaveLength(1);
	});

	it("routes exterior effects only when the view has an outdoor domain", () => {
		const batcher = new ParticleRenderBatcher();

		const routed = batcher.route(
			1,
			[source(EXTERIOR_PARTICLE_RENDER_OWNER, 0)],
			(owner) => (owner === EXTERIOR_PARTICLE_RENDER_OWNER ? "outdoor" : null),
		);

		expect(routed.get("outdoor")).toHaveLength(1);
	});

	it("routes sky effects to the sky domain", () => {
		const batcher = new ParticleRenderBatcher();

		const routed = batcher.route(
			1,
			[source(SKY_PARTICLE_RENDER_OWNER, 0)],
			(owner) => (owner === SKY_PARTICLE_RENDER_OWNER ? "sky" : null),
		);

		expect(routed.get("sky")).toHaveLength(1);
	});

	it("concatenates the ranges of nodes sharing one executor contribution", () => {
		const batcher = new ParticleRenderBatcher();

		const merged = batcher.mergeContribution([
			[
				{
					baseSlot: 0,
					count: 2,
					hwGfxObjId: MESH,
					motionType: 2,
					origin: RECORD_ORIGIN,
				},
			],
			[
				{
					baseSlot: 8,
					count: 3,
					hwGfxObjId: MESH,
					motionType: 2,
					origin: RECORD_ORIGIN,
				},
			],
		]);

		// Ranges never combine even when they would draw identically: each names its own slots.
		expect(merged).toHaveLength(2);
		expect(merged.map((range) => range.baseSlot)).toEqual([0, 8]);
	});

	it("releases domain scratch when topology ownership changes", () => {
		const batcher = new ParticleRenderBatcher();
		batcher.route(1, [source(FIRST_OWNER, 0)], () => "old-domain");

		const rerouted = batcher.route(
			2,
			[source(FIRST_OWNER, 8)],
			() => "new-domain",
		);

		expect(rerouted.has("old-domain")).toBe(false);
		expect(rerouted.get("new-domain")?.[0]?.baseSlot).toBe(8);
	});
});

function source(
	renderOwner: ParticleSourceRange["renderOwner"],
	baseSlot: number,
): ParticleSourceRange {
	return {
		baseSlot,
		count: 1,
		hwGfxObjId: MESH,
		motionType: 2,
		origin: RECORD_ORIGIN,
		renderOwner,
	};
}
