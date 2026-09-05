import { describe, expect, it } from "vitest";
import type { DatAssetId } from "../game-types";
import { AABB3, Vec3 } from "../math/types";
import type { SceneVisibilityIslandId } from "../scene";
import {
	EXTERIOR_PARTICLE_RENDER_OWNER,
	type ParticleSourceRange,
} from "../systems/particle-system";
import {
	createEntityGroundingSelection,
	createEntityGroundingSelectionScratch,
	selectIndoorGroundingCasters,
} from "./entity-grounding";
import { ViewSubmissionStoragePool } from "./view-submission-storage";

describe("view submission storage", () => {
	it("preserves receiver records and particle routes across deferred views, then reuses capacity", () => {
		const pool = new ViewSubmissionStoragePool();
		const first = pool.acquire();
		const second = pool.acquire();
		const island = "env-cell-island:test" as SceneVisibilityIslandId;
		const bounds = new AABB3(new Vec3(-5, -5, -5), new Vec3(5, 5, 5));
		const cell = { bounds, scopeKey: "receiver", visibilityIslandId: island };
		const scratch = createEntityGroundingSelectionScratch();
		const selection = (first.indoorSelections[0] =
			createEntityGroundingSelection());
		selectIndoorGroundingCasters(
			cell,
			[
				{
					identity: "actor",
					contactAnchor: new Vec3(1, 0, 1),
					height: 2,
					radius: 1,
					influenceBounds: bounds,
					visibilityIslandIds: [island],
				},
			],
			Vec3.zero(),
			Vec3.zero(),
			selection,
			scratch,
		);
		first.indoorByScopeKey.set(cell.scopeKey, selection);
		const saved = selection.records.slice();
		const other = (second.indoorSelections[0] =
			createEntityGroundingSelection());
		selectIndoorGroundingCasters(
			cell,
			[],
			Vec3.zero(),
			Vec3.zero(),
			other,
			scratch,
		);
		second.indoorByScopeKey.set(cell.scopeKey, other);
		expect(selection.count).toBe(1);
		expect(other.count).toBe(0);
		expect(selection.records).toEqual(saved);
		const source: ParticleSourceRange = {
			hwGfxObjId: "0x01000001" as DatAssetId,
			baseSlot: 3,
			count: 2,
			frame: { kind: "record" },
			motionType: 0,
			renderOwner: EXTERIOR_PARTICLE_RENDER_OWNER,
		};
		const firstRoutes = first.particles.route(1, [source], () => "outdoor");
		const firstRange = firstRoutes.get("outdoor")?.[0];
		if (firstRange === undefined)
			throw new Error("Fixture requires one particle range.");
		second.particles.route(1, [{ ...source, baseSlot: 20 }], () => "sky");
		expect(firstRange.baseSlot).toBe(3);
		expect(firstRoutes.get("outdoor")).toHaveLength(1);
		pool.beginFrame();
		expect(first.indoorByScopeKey.size).toBe(0);
		expect(firstRoutes.get("outdoor")).toHaveLength(0);
		expect(firstRange.frame).not.toBe(source.frame);
		const reused = pool.acquire();
		expect(reused).toBe(first);
		expect(reused.indoorSelections[0]).toBe(selection);
		const newRoutes = reused.particles.route(1, [source], () => "outdoor");
		expect(newRoutes.get("outdoor")?.[0]).toBe(firstRange);
		pool.clearParticles();
		expect(newRoutes.size).toBe(0);
	});
});
