import inspectionWire from "../../client/fixtures/object-inspection-wire.json";
import { decodeObjectInspectionResult } from "../../client/client-object-inspection-contract";
import { entityFacts } from "../../client/client-entity-mirror.test-support";
import type { ClientEntityFacts } from "../../client/client-entity-mirror";
import {
	salvagePreviewRequestSchema,
	salvageSubmitRequestSchema,
	type SalvageEvaluation,
} from "../../client/client-salvage-contract";

/** Synthetic authority replies through production session decoding; no UI-side yield algorithm. */
export function createSalvageFixture(options: {
	readonly emit: (event: string, payload: unknown) => void;
	readonly baseline: () => void;
	/** Full session snapshot proves listener registration has finished. */
	readonly ready: () => boolean;
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
	const readySources = new Map<number, ClientEntityFacts>();
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
	function preview() {
		const args = options.commands.findLast(
			(entry) => entry.command === "preview_client_salvage",
		)?.args;
		if (args === undefined) throw new Error("No salvage preview request.");
		return salvagePreviewRequestSchema.parse(args.request);
	}
	function submitted() {
		const args = options.commands.findLast(
			(entry) => entry.command === "submit_client_salvage",
		)?.args;
		if (args === undefined) throw new Error("No salvage submit request.");
		return salvageSubmitRequestSchema.parse(args.request);
	}
	function update(records: readonly ClientEntityFacts[]) {
		options.emit("client-entity-facts-changed", {
			projectileSupply: null,
			worldContainer: null,
			salvage: context,
			upserts: records,
			removed: [],
		});
	}
	return {
		ready: options.ready,
		tool,
		begin() {
			options.baseline();
			sources.clear();
			readySources.clear();
			const ust = item(tool, "Ust", "Steel");
			if (ust.description.kind !== "known")
				throw new Error("Expected Ust description.");
			const toolFacts: ClientEntityFacts = {
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
			};
			sources.set(tool, toolFacts);
			sources.set(9201, item(9201, "Steel sword", "Steel"));
			sources.set(9202, item(9202, "Steel armor", "Steel"));
			sources.set(9203, item(9203, "Oak bow", "Oak"));
			for (const [guid, source] of sources) readySources.set(guid, source);
			update([...sources.values()]);
			options.showInventory();
			options.select(9201);
		},
		preview,
		submitted,
		select: options.select,
		activateBound: () => options.activateBound(tool),
		reply(evaluation?: SalvageEvaluation) {
			const request = preview();
			const result: SalvageEvaluation = evaluation ?? {
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
				evaluation: result,
			});
		},
		appraise(guid: number, kind: "ready" | "rejected") {
			if (kind === "rejected") {
				options.emit("client-object-inspection-result", {
					guid,
					outcome: { kind },
				});
				return;
			}
			const facts = readySources.get(guid);
			if (facts?.description.kind !== "known")
				throw new Error("Unknown appraisal fixture item.");
			const base = decodeObjectInspectionResult(inspectionWire.item);
			if (base.outcome.kind !== "ready")
				throw new Error("Expected successful appraisal fixture.");
			// Exercise response-before-delta ordering: a successful appraisal must still cause
			// an authoritative preview after the source facts have reached the frontend.
			options.emit("client-object-inspection-result", {
				guid,
				outcome: {
					kind,
					inspection: {
						...base.outcome.inspection,
						guid,
						name: facts.description.name,
					},
				},
			});
			sources.set(guid, facts);
			update([facts]);
		},
		pending(item: number) {
			const facts = sources.get(item);
			if (facts === undefined) throw new Error("Unknown fixture item.");
			const changed: ClientEntityFacts = {
				...facts,
				salvage: { kind: "pending-details", material: "Steel" },
			};
			sources.set(item, changed);
			update([changed]);
		},
		finish(kind: "dispatched" | "rejected") {
			options.emit("client-salvage-result", {
				sequence: submitted().sequence,
				outcome:
					kind === "dispatched"
						? { kind }
						: { kind, reason: "Your character is busy." },
			});
		},
	};
}
