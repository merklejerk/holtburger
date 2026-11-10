import { CLIENT_SUMMON_TUNING } from "../../client/client-tuning";
import { readSummonLeashColors } from "../../client/client-summon-leash-appearance";
import { probeSummonLeashAppearance } from "./summon-leash-appearance-probe";
import type { Renderer } from "../../lib/game/renderer/renderer";
import type { RenderWorld } from "../../lib/game/renderer/render-world";
import type { GamePresentationRuntime } from "../../lib/game/runtime/game-presentation-runtime";
import type { DynamicEntityView } from "../../lib/game/runtime/dynamic-entity-feed";

/** Synthetic evidence uses the real runtime, current poses and production render publication. */
export interface SummonRuntimeProof {
	readonly leashCount: number;
	readonly relationshipColor: boolean;
	readonly themeAppearance: boolean;
	readonly movingEndpoint: boolean;
	readonly flickerWithdrawsModel: boolean;
	readonly flickerWithdrawsLeash: boolean;
	readonly flickerRestoresBoth: boolean;
	readonly clearRestoresModel: boolean;
	readonly missingOwnerHidesLeash: boolean;
}

const settle = () =>
	new Promise<void>((resolve) =>
		requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
	);

/** Harness-only capture; no production diagnostics or inspection API is needed. */
export class SummonRuntimeProbe {
	#last = { leashCount: 0, endX: 0, modelVisible: false, color: "" };

	attach(renderer: Renderer, world: RenderWorld): void {
		const draw = renderer.drawFrame.bind(renderer);
		renderer.drawFrame = (input) => {
			const leashes = input.summonLeashes;
			this.#last = {
				leashCount: leashes?.length ?? 0,
				color: leashes?.[0]?.color.join(",") ?? "",
				endX: leashes?.[0]?.end.x ?? 0,
				modelVisible:
					input.selectionTarget !== null &&
					world.getVisibleDynamicPresentation(input.selectionTarget.nodeId) !==
						null,
			};
			return draw(input);
		};
	}

	async run(
		runtime: GamePresentationRuntime,
		summon: DynamicEntityView,
		owner: DynamicEntityView,
	): Promise<SummonRuntimeProof> {
		if (owner.placement.kind !== "world")
			throw new Error("Summon fixture owner requires world placement.");
		const colors = readSummonLeashColors(document.documentElement);
		const level = {
			guid: summon.identity.guid,
			generation: summon.generation,
			leash: { owner: owner.identity.guid, color: colors.own },
			expiresAtSeconds: null,
		};
		runtime.setSelectedEntityGuid(summon.identity.guid);
		runtime.setSummonVisuals([level], CLIENT_SUMMON_TUNING);
		runtime.setDynamicEntityNameplateDecoration(summon.identity.guid, {
			indicators: [],
			strikeThrough: false,
			nameColor: "player",
		});
		await settle();
		const before = this.#last;
		runtime.setSummonVisuals(
			[{ ...level, leash: { ...level.leash, color: colors.other } }],
			CLIENT_SUMMON_TUNING,
		);
		await settle();
		const relationshipColor = this.#last.color === colors.other.join(",");
		const moved: DynamicEntityView = {
			...owner,
			placement: {
				...owner.placement,
				pose: {
					...owner.placement.pose,
					coords: {
						...owner.placement.pose.coords,
						x: owner.placement.pose.coords.x + 2,
					},
				},
			},
		};
		await runtime.upsertDynamicEntity(moved);
		await settle();
		const movingEndpoint = Math.abs(this.#last.endX - before.endX - 2) < 0.001;
		// A slow, fixed test frequency leaves ample time to inspect a known faded phase.
		const flicker = {
			leadInSeconds: 10,
			initialHertz: 0.1,
			finalHertz: 0.1,
			dutyCycle: 0.5,
		};
		runtime.setSummonVisuals(
			[{ ...level, expiresAtSeconds: performance.now() / 1000 + 2.5 }],
			{ leash: CLIENT_SUMMON_TUNING.leash, flicker },
		);
		await settle();
		const flickerWithdrawsModel = !this.#last.modelVisible;
		const flickerWithdrawsLeash = this.#last.leashCount === 0;
		runtime.setSummonVisuals(
			[{ ...level, expiresAtSeconds: performance.now() / 1000 + 7.5 }],
			{ leash: CLIENT_SUMMON_TUNING.leash, flicker },
		);
		await settle();
		const flickerRestoresBoth =
			this.#last.modelVisible && this.#last.leashCount === 1;
		runtime.setSummonVisuals([], CLIENT_SUMMON_TUNING);
		await settle();
		const clearRestoresModel =
			this.#last.leashCount === 0 && this.#last.modelVisible;
		runtime.removeDynamicEntity(owner.identity.guid, owner.generation);
		runtime.setSummonVisuals([level], CLIENT_SUMMON_TUNING);
		await settle();
		const missingOwnerHidesLeash = this.#last.leashCount === 0;
		await runtime.upsertDynamicEntity(moved);
		const themeAppearance = await probeSummonLeashAppearance(
			(palette) =>
				runtime.setSummonVisuals(
					[{ ...level, leash: { ...level.leash, color: palette.own } }],
					CLIENT_SUMMON_TUNING,
				),
			() => this.#last.color,
		);
		runtime.setSummonVisuals([level], CLIENT_SUMMON_TUNING);
		await settle();
		return {
			leashCount: before.leashCount,
			relationshipColor,
			themeAppearance,
			movingEndpoint,
			flickerWithdrawsModel,
			flickerWithdrawsLeash,
			flickerRestoresBoth,
			clearRestoresModel,
			missingOwnerHidesLeash,
		};
	}
}
