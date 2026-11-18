import { entityFacts } from "../../client/client-entity-mirror.test-support";
import type { ClientEntityFacts } from "../../client/client-entity-mirror";
import {
	salvagePreviewRequestSchema,
	type SalvageEvaluation,
} from "../../client/client-salvage-contract";

/** Synthetic salvage evaluation replies for the interactive UI showcase. */
export function createSalvageFixture(options: {
	readonly emit: (event: string, payload: unknown) => void;
	readonly baseline: () => void;
	readonly showInventory: () => void;
	readonly select: (guid: number) => void;
	readonly activateBound: (guid: number) => void;
	readonly commands: readonly {
		readonly command: string;
		readonly args: Record<string, unknown> | undefined;
	}[];
}) {
	const tool = 9200;
	const context = {
		skills: {
			salvagingSkill: 300,
			tinkeringSkill: 200,
			augmentationBonusSalvage: 0,
		},
	};
	const sources = new Map<number, ClientEntityFacts>();
	function item(
		guid: number,
		name: string,
		material: string,
	): ClientEntityFacts {
		const facts = entityFacts(guid, {
			ownedByPlayer: true,
			location: {
				kind: "contained",
				parentGuid: 1,
				slot: { kind: "item", index: guid - tool },
			},
			salvage: {
				kind: "ready",
				source: {
					guid,
					instance: 1,
					input: {
						itemType: 1,
						materialType: material,
						stackSize: 2,
						structure: 0,
						itemWorkmanship: 7,
						numItemsInMaterial: 1,
					},
				},
			},
		});
		if (facts.description.kind !== "known")
			throw new Error("Expected known fixture description.");
		return {
			...facts,
			description: { ...facts.description, name, stackCount: 2 },
		};
	}
	return {
		begin() {
			options.baseline();
			sources.clear();
			const ust = item(tool, "Ust", "Steel");
			if (ust.description.kind !== "known")
				throw new Error("Expected Ust description.");
			sources.set(tool, {
				...ust,
				salvage: {
					kind: "ineligible",
					reason: "The Ust has no salvageable material.",
				},
				description: {
					...ust.description,
					wcid: 20646,
					itemType: 0x20000000,
					useCapability: "salvage-tool",
					stackCount: null,
				},
			});
			sources.set(9201, item(9201, "Steel sword", "Steel"));
			sources.set(9202, item(9202, "Steel armor", "Steel"));
			sources.set(9203, item(9203, "Oak bow", "Oak"));
			options.emit("client-entity-facts-changed", {
				projectileSupply: null,
				worldContainer: null,
				salvage: context,
				upserts: [...sources.values()],
				removed: [],
			});
			options.showInventory();
			options.select(9201);
		},
		activateBound: () => options.activateBound(tool),
		reply() {
			const args = options.commands.findLast(
				(entry) => entry.command === "preview_client_salvage",
			)?.args;
			if (args === undefined) throw new Error("No salvage preview request.");
			const request = salvagePreviewRequestSchema.parse(args.request);
			const evaluation: SalvageEvaluation = {
				kind: "ready",
				review: {
					player: 1,
					tool: { guid: tool, instance: 1 },
					skills: context.skills,
					sources: request.items.map((guid) => {
						const candidate = sources.get(guid)?.salvage;
						if (candidate?.kind !== "ready")
							throw new Error("Expected ready source.");
						return candidate.source;
					}),
				},
				bags: [
					...new Set(
						request.items.map((guid) => {
							const candidate = sources.get(guid)?.salvage;
							if (candidate?.kind !== "ready")
								throw new Error("Expected ready source.");
							return candidate.source.input.materialType;
						}),
					),
				].map((materialType) => ({ materialType, units: 42, workmanship: 7 })),
			};
			options.emit("client-salvage-preview", {
				sequence: request.sequence,
				evaluation,
			});
		},
	};
}
