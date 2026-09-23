import { CLIENT_TUNING } from "../../client/client-tuning";
import type { ClientEntityFacts } from "../../client/client-entity-mirror";
import { entityFacts } from "../../client/client-entity-mirror.test-support";
import {
	vendorPreviewSchema,
	vendorRequestSchema,
	vendorResultSchema,
	type VendorQuote,
	type VendorSnapshot,
} from "../../client/client-vendor-contract";

/** Controlled authority replies exercise production session decoding and HUD gestures. */
export function createVendorFixture(options: {
	readonly emit: (event: string, payload: unknown) => void;
	readonly baseline: () => void;
	readonly commands: readonly {
		readonly command: string;
		readonly args: Record<string, unknown> | undefined;
	}[];
}) {
	const { emit, baseline, commands } = options;
	const vendor = 5000;
	const offer = (
		guid: number,
		name: string,
		item_type: number,
		stack_count: number,
	) => ({
		guid,
		wcid: guid,
		name,
		item_type,
		stack_count,
		stackable: stack_count > 1,
		supply: null,
		icon: {
			base: 0x06001000 + guid,
			overlay: null,
			underlay: null,
			uiEffects: 0,
		},
		price: {
			kind: "quoted" as const,
			amount: 10 * stack_count,
			quantity: stack_count,
		},
	});
	const snapshot: VendorSnapshot = {
		vendor,
		currency: { wcid: 38234, name: "Trade Tokens" },
		offers: [
			offer(7001, "Lead Scarabs", 0x1000, 10),
			offer(7002, "Steel Sword", 1, 1),
			{
				...offer(7003, "Garnet of Excess", 0x800, 1),
				price: { kind: "quoted", amount: 600, quantity: 1 },
			},
			...Array.from({ length: 36 }, (_, i) =>
				offer(7100 + i, `Garnet ${i + 1}`, 0x800, 1),
			),
		],
	};
	function named(
		guid: number,
		name: string,
		overrides: Partial<ClientEntityFacts>,
	): ClientEntityFacts {
		const facts = entityFacts(guid, overrides);
		if (facts.description.kind !== "known")
			throw new Error("Expected known fixture description");
		return {
			...facts,
			description: {
				...facts.description,
				name,
				itemType: 0x1000,
				stackCount: 80,
				icon: { ...facts.description.icon, base: 0x06001000 + guid },
			},
		};
	}
	const sources = [6001, 6002, 6003].map((guid, index) =>
		named(guid, index === 2 ? "Retained Scarabs" : "Lead Scarabs", {
			ownedByPlayer: true,
			location: {
				kind: "contained",
				parentGuid: 1,
				slot: { kind: "item", index },
			},
		}),
	);
	const request = (command: string) => {
		const args = commands.findLast((entry) => entry.command === command)?.args;
		if (args === undefined)
			throw new Error(`Vendor fixture has no ${command} request`);
		return vendorRequestSchema.parse(args.request);
	};
	const currencies: VendorQuote["currencies"] = [
		{ wcid: 38234, name: "Trade Tokens", current: 500, projected: 400 },
		{ wcid: 273, name: "Pyreals", current: 3000, projected: 10000 },
	];
	return {
		gestureCooldownMs: CLIENT_TUNING.inventory.doubleClickSuppressionMs,
		settle: () =>
			new Promise<void>((resolve) =>
				window.setTimeout(
					resolve,
					CLIENT_TUNING.inventory.displayIntervalMs * 2,
				),
			),
		begin() {
			baseline();
			emit("client-entity-facts-changed", {
				projectileSupply: null,
				worldContainer: null,
				upserts: [named(vendor, "Festival Merchant", {}), ...sources],
				removed: [],
			});
			emit("client-vendor-snapshot", snapshot);
		},
		refresh() {
			emit("client-vendor-snapshot", snapshot);
		},
		reply(quote: VendorQuote) {
			const pending = request("preview_client_vendor");
			emit(
				"client-vendor-preview",
				vendorPreviewSchema.parse({
					sequence: pending.sequence,
					vendor,
					outcome: { kind: "ready", quote },
				}),
			);
		},
		reject(reason: string) {
			const pending = request("preview_client_vendor");
			emit(
				"client-vendor-preview",
				vendorPreviewSchema.parse({
					sequence: pending.sequence,
					vendor,
					outcome: { kind: "rejected", reason },
				}),
			);
		},
		finishBuyFailure() {
			const submitted = request("submit_client_vendor");
			emit("client-vendor-phase", "buying");
			emit(
				"client-vendor-result",
				vendorResultSchema.parse({
					sequence: submitted.sequence,
					vendor,
					sold: submitted.draft.sells,
					sale_issue: null,
					outcome: {
						kind: "failed",
						phase: "buying",
						message: "Fixture purchase refused",
					},
				}),
			);
		},
		pending: () => request("preview_client_vendor"),
		submitted: () => request("submit_client_vendor"),
		currencies,
		close() {
			emit("client-vendor-snapshot", null);
		},
	};
}
