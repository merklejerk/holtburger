import { describe, expect, it, vi } from "vitest";
import type { DecodedStaticPresentation } from "../../assets/decode-static-source-record";
import { Mat4, Vec3 } from "../math/types";
import type { SceneNodeId, SceneSpatialPlacement } from "../scene";
import { datAssetId } from "./dynamic-entity-presentation";
import type { LocalSceneModelSource } from "./local-scene-model";
import {
	canReplaceLocalModelAppearance,
	type LocalModelPresentation,
	prepareLocalModelPresentation,
} from "./local-model-presentation";
import { localSceneModelOwnerId } from "./owner-ids";
import { SetupVisualAssetRepository } from "./presentation-asset-service";

const appearance = {
	paletteDid: null,
	subPalettes: [],
	textureChanges: [],
	partChanges: [],
};
const source: LocalSceneModelSource = {
	body: {
		setupDid: 0x02000001,
		appearance,
		scale: 0.8,
		translucency: 0.1,
		pose: { kind: "setup-pose" },
	},
	attachments: [
		{
			visual: {
				setupDid: 0x02000002,
				appearance,
				scale: 0.5,
				translucency: 0.2,
				pose: { kind: "setup-pose" },
			},
			parentLocation: "right-hand",
			placement: 1,
		},
	],
};
const placement: SceneSpatialPlacement = {
	landblockId: "0x0001ffff",
	envCellId: null,
	localTransform: Mat4.identity(),
	spatialMembership: { scopes: [{ kind: "outdoor" }] },
};
function decoded(id: number): DecodedStaticPresentation {
	return {
		setupId: datAssetId(id),
		localBounds: null,
		partParents: [],
		behavior: {
			kind: "none",
			animationId: null,
			physicsScriptId: null,
			motionTableId: null,
			physicsScriptTableId: null,
			soundTableId: null,
		},
		presentation: {
			id: `presentation:${id}`,
			sourceAssetId: datAssetId(id),
			appearanceKey: "base",
			parts: [],
			lights: [],
			holdingLocations: new Map([
				[
					"right-hand",
					{
						location: "right-hand",
						partIndex: 0,
						offsetTransform: Mat4.identity(),
					},
				],
			]),
			placementPoses: new Map(),
			selectionBounds: null,
			sortingBounds: null,
		},
	};
}

describe("local model presentation preparation", () => {
	it("retains real setup facts, independent scale/placement, and explicit playback without host metadata", async () => {
		const repository = new SetupVisualAssetRepository({
			load: async (id) => decoded(id),
		});
		const group = await prepareLocalModelPresentation(
			repository,
			localSceneModelOwnerId(1),
			source,
			placement,
		);
		expect(
			group.sources.map((item) => ({
				scale: item.source.scale,
				placement: item.source.placementFrame,
				playback: item.playback,
				noDraw: item.initialPresentationState.noDraw,
				hidden: item.initialPresentationState.hidden,
			})),
		).toEqual([
			{
				scale: new Vec3(0.8, 0.8, 0.8),
				placement: 0,
				playback: { kind: "resolved", pose: source.body.pose },
				noDraw: false,
				hidden: true,
			},
			{
				scale: new Vec3(0.5, 0.5, 0.5),
				placement: 1,
				playback: {
					kind: "resolved",
					pose: source.attachments[0]?.visual.pose,
				},
				noDraw: false,
				hidden: true,
			},
		]);
		const body: SceneNodeId = "scene-node:1";
		const child: SceneNodeId = "scene-node:2";
		expect(group.attachments([body, child])).toEqual([
			{ parentNodeId: body, childNodeId: child, location: "right-hand" },
		]);
		expect(repository.getDiagnostics().referenceCount).toBe(2);
		group.release();
		group.release();
		expect(repository.getDiagnostics().referenceCount).toBe(0);
	});
	it("releases every successful setup when another child fails", async () => {
		const repository = new SetupVisualAssetRepository({
			load: async (id) => {
				if (id === source.body.setupDid) return decoded(id);
				throw new Error("Missing equipment");
			},
		});
		await expect(
			prepareLocalModelPresentation(
				repository,
				localSceneModelOwnerId(1),
				source,
				placement,
			),
		).rejects.toThrow("setup preparation failed");
		expect(repository.getDiagnostics().referenceCount).toBe(0);
	});
	it("rejects mismatched setup identity without retaining a lease", async () => {
		const repository = new SetupVisualAssetRepository({
			load: async () => decoded(0x02000003),
		});
		await expect(
			prepareLocalModelPresentation(
				repository,
				localSceneModelOwnerId(1),
				source,
				placement,
			),
		).rejects.toThrow("expected");
		expect(repository.getDiagnostics().referenceCount).toBe(0);
	});
	it("preserves playback only for appearance edits with unchanged equipment and holding frames", async () => {
		const load = vi.fn(async (id: number) => decoded(id));
		const repository = new SetupVisualAssetRepository({ load });
		const current = await prepareLocalModelPresentation(
			repository,
			localSceneModelOwnerId(1),
			source,
			placement,
		);
		const edited = {
			...source,
			body: {
				...source.body,
				appearance: { ...appearance, paletteDid: 0x04000001 },
			},
		};
		const next = await prepareLocalModelPresentation(
			repository,
			localSceneModelOwnerId(1),
			edited,
			placement,
		);
		expect(canReplaceLocalModelAppearance(source, edited, current, next)).toBe(
			true,
		);
		for (const changed of [
			{ ...edited, attachments: [] },
			{ ...edited, body: { ...edited.body, scale: 1 } },
			{
				...edited,
				body: {
					...edited.body,
					pose: {
						kind: "default-idle" as const,
						firstCyclicClip: 0,
						clips: [],
					},
				},
			},
		])
			expect(
				canReplaceLocalModelAppearance(source, changed, current, next),
			).toBe(false);
		const body = next.sources[0];
		const changedHolding: LocalModelPresentation = {
			...next,
			sources: [
				{
					...body,
					source: {
						...body.source,
						presentation: {
							...body.source.presentation,
							holdingLocations: new Map([
								[
									"right-hand" as const,
									{
										location: "right-hand" as const,
										partIndex: 1,
										offsetTransform: Mat4.identity(),
									},
								],
							]),
						},
					},
				},
				...next.sources.slice(1),
			],
		};
		expect(
			canReplaceLocalModelAppearance(source, edited, current, changedHolding),
		).toBe(false);
		current.release();
		next.release();
		expect(repository.getDiagnostics().referenceCount).toBe(0);
	});
});
