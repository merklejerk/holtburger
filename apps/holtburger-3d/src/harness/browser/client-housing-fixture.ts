import { entityFacts } from "../../client/client-entity-mirror.test-support";
import { CLIENT_TUNING } from "../../client/client-tuning";
import {
	emptyHousing,
	housingCrystalSchema,
	housingPreviewRequestSchema,
	housingPreviewResultSchema,
	housingPaymentRequestSchema,
	housingPaymentResultSchema,
	type HousingCrystal,
} from "../../client/client-housing-contract";

/** Explicit synthetic authority replies exercise the production session and crystal HUD. */
export function createHousingFixture(options: {
	readonly emit: (event: string, payload: unknown) => void;
	readonly baseline: () => void;
	readonly commands: readonly {
		readonly command: string;
		readonly args: Record<string, unknown> | undefined;
	}[];
}) {
	const crystal = 5500;
	const coins = 6501;
	const note = 6502;
	const writSmall = 6503;
	const writLarge = 6504;
	const requirement = {
		wcid: 273,
		required: 13,
		paid: 0,
		remaining: 13,
		name: "Pyreal",
		pluralName: "Pyreals",
	};
	const available: HousingCrystal = {
		ownership: "available",
		crystal: {
			crystal,
			dwellingId: 10,
			owner: 0,
			ownerName: "",
			flags: 1,
			active: true,
			requiresMonarch: false,
			houseType: 1,
			maintenanceFree: false,
			maintenancePaid: false,
			minLevel: -1,
			maxLevel: -1,
			minAllegianceRank: -1,
			maxAllegianceRank: -1,
			buy: [requirement],
			rent: [requirement],
		},
	};
	let current = available;
	function pending() {
		const command = options.commands.findLast(
			(entry) => entry.command === "preview_client_housing_payment",
		);
		if (command === undefined) throw new Error("No housing preview request");
		return housingPreviewRequestSchema.parse(command.args?.request);
	}
	function reply() {
		const request = pending();
		const requirements =
			request.draft.purpose === "purchase"
				? current.crystal.buy
				: current.crystal.rent;
		const items = [...request.draft.items];
		if (request.operation.kind === "add") {
			const { wcid, item } = request.operation;
			const matches =
				wcid === 273
					? item === coins || item === note
					: wcid === 42 && (item === writSmall || item === writLarge);
			if (!matches) {
				options.emit(
					"client-housing-payment-preview",
					housingPreviewResultSchema.parse({
						sequence: request.sequence,
						crystal,
						outcome: {
							kind: "rejected",
							reason: "That item does not match this payment requirement",
						},
					}),
				);
				return;
			}
			if (!items.includes(item)) items.push(item);
		} else if (request.operation.kind === "fill") {
			for (const id of request.operation.wcid === 273
				? [coins, note]
				: [writLarge])
				if (!items.includes(id)) items.push(id);
		}
		if (items.some((id) => ![coins, note, writSmall, writLarge].includes(id)))
			throw new Error("Unknown housing fixture source");
		const lines = requirements.map((row) => {
			let remaining = row.remaining;
			const sources = items.filter((id) =>
				row.wcid === 273
					? id === coins || id === note
					: id === writSmall || id === writLarge,
			);
			const consumption: { item: number; quantity: number; value: number }[] =
				[];
			for (const id of row.wcid === 273
				? [coins, note]
				: [writSmall, writLarge]) {
				if (!sources.includes(id) || remaining === 0) continue;
				const quantity =
					id === note
						? Math.min(2, Math.ceil(remaining / 10))
						: Math.min(id === writSmall ? 2 : 3, remaining);
				const value = id === note ? quantity * 10 : quantity;
				consumption.push({ item: id, quantity, value });
				remaining = Math.max(0, remaining - value);
			}
			const spent = consumption.reduce(
				(total, source) => total + source.value,
				0,
			);
			return {
				wcid: row.wcid,
				sources,
				consumption,
				credited: Math.min(row.remaining, spent),
				effectivePaid: row.paid + Math.min(row.remaining, spent),
				shortfall: remaining,
				excess: Math.max(0, spent - row.remaining),
			};
		});
		options.emit(
			"client-housing-payment-preview",
			housingPreviewResultSchema.parse({
				sequence: request.sequence,
				crystal,
				outcome: {
					kind: "ready",
					items,
					quote: {
						lines,
						complete: lines.every((row) => row.shortfall === 0),
						contributes: lines.some((row) => row.credited > 0),
					},
					unavailable: [],
				},
			}),
		);
	}
	function submitted() {
		const command = options.commands.findLast(
			(entry) => entry.command === "submit_client_housing_payment",
		);
		if (command === undefined) throw new Error("No submitted housing payment");
		return housingPaymentRequestSchema.parse(command.args?.request);
	}
	return {
		crystal,
		coins,
		note,
		writSmall,
		writLarge,
		pending,
		reply,
		submitted,
		accept() {
			const request = submitted();
			options.emit("client-housing-updated", {
				...emptyHousing(),
				crystal: current,
				pendingPayment: {
					sequence: request.sequence,
					crystal,
					purpose: request.draft.purpose,
				},
			});
		},
		finish(kind: "unresolved" | "completed") {
			const request = submitted();
			options.emit(
				"client-housing-payment-finished",
				housingPaymentResultSchema.parse({
					sequence: request.sequence,
					crystal,
					outcome:
						kind === "completed"
							? { kind }
							: {
									kind,
									reason:
										"Housing payment could not be confirmed. Refresh before trying again.",
								},
					notify: kind !== "completed",
				}),
			);
			if (kind === "completed" && request.draft.purpose === "maintenance") {
				const rent = request.profile.rent.map((line) => {
					const quoted = request.quote.lines.find(
						(quote) => quote.wcid === line.wcid,
					);
					if (quoted === undefined)
						throw new Error("Missing reviewed maintenance line");
					return {
						...line,
						paid: line.paid + quoted.credited,
						remaining: line.remaining - quoted.credited,
					};
				});
				current = {
					...current,
					crystal: {
						...request.profile,
						rent,
						maintenancePaid: rent.every((line) => line.remaining === 0),
					},
				};
			}

			options.emit("client-housing-updated", {
				...emptyHousing(),
				crystal: current,
			});
		},
		settle: () =>
			new Promise<void>((resolve) =>
				window.setTimeout(
					resolve,
					CLIENT_TUNING.inventory.displayIntervalMs * 2,
				),
			),
		begin(mode: "single" | "multiple" | "empty") {
			const writ = {
				wcid: mode === "empty" ? 11710 : 42,
				name: "Writ",
				pluralName: "Writs",
				required: 4,
				paid: 1,
				remaining: 3,
			};
			current =
				mode === "single"
					? available
					: {
							...available,
							crystal: {
								...available.crystal,
								buy: [requirement, writ],
								rent: [requirement, writ],
							},
						};
			options.baseline();
			const sources = (
				mode === "empty"
					? []
					: mode === "single"
						? [coins, note]
						: [coins, note, writSmall, writLarge]
			).map((guid, index) => {
				const facts = entityFacts(guid, {
					ownedByPlayer: true,
					location: {
						kind: "contained",
						parentGuid: 1,
						slot: { kind: "item", index },
					},
				});
				if (facts.description.kind !== "known")
					throw new Error("Expected source description");
				return {
					...facts,
					description: {
						...facts.description,
						name:
							index === 0
								? "Pyreals"
								: index === 1
									? "Trade Note (10)"
									: "Writs",
						itemType: index === 0 ? 0x10 : index === 1 ? 0x40000 : 1,
						wcid: index === 0 ? 273 : index === 1 ? 999 : 42,
						stackCount: index === 0 || index === 3 ? 3 : 2,
						icon: { ...facts.description.icon, base: 0x06001000 + guid },
					},
				};
			});
			options.emit("client-entity-facts-changed", {
				projectileSupply: null,
				salvage: null,
				worldContainer: null,
				upserts: [entityFacts(crystal), ...sources],
				removed: [],
			});
			options.emit("client-housing-crystal-received", current);
		},
		profile(
			ownership: HousingCrystal["ownership"],
			free: boolean,
			paid: boolean,
			active: boolean,
		) {
			current = housingCrystalSchema.parse({
				...available,
				ownership,
				crystal: {
					...available.crystal,
					owner:
						ownership === "available" ? 0 : ownership === "character" ? 1 : 2,
					ownerName: ownership === "available" ? "" : "Fixture owner",
					maintenanceFree: free,
					maintenancePaid: paid,
					active,
				},
			});
			options.emit("client-housing-crystal-received", current);
		},
		retained() {
			options.emit("client-housing-updated", {
				...emptyHousing(),
				crystal: available,
			});
		},
		commands: () =>
			options.commands.filter(
				(entry) =>
					entry.command === "preview_client_housing_payment" ||
					entry.command === "submit_client_inventory" ||
					entry.command === "submit_client_housing_payment",
			),
	};
}
