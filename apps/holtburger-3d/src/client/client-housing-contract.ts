import { z } from "zod";

const uint = z.number().int().min(0).max(0xffff_ffff);
const timestamp = z.number().int().nonnegative().safe();
const vector = z
	.object({
		x: z.number().finite(),
		y: z.number().finite(),
		z: z.number().finite(),
	})
	.strict();

/** Server-owned requirement progress; consumers never recalculate remaining amounts. */
const requirement = z
	.object({
		wcid: uint,
		name: z.string(),
		pluralName: z.string(),
		required: uint,
		paid: uint,
		remaining: uint,
	})
	.strict();

/** Known period timing is computed by world; free maintenance has no next due date. */
const period = z
	.object({ start: uint, end: timestamp, nextDue: timestamp.nullable() })
	.strict();

const home = z
	.object({
		houseType: uint,
		boughtAt: uint.nullable(),
		maintenanceFree: z.boolean(),
		buy: z.array(requirement),
		rent: z.array(requirement),
		maintenancePaid: z.boolean(),
		position: z
			.object({
				landblockId: uint,
				coords: vector,
				rotation: z
					.object({
						w: z.number().finite(),
						x: z.number().finite(),
						y: z.number().finite(),
						z: z.number().finite(),
					})
					.strict(),
			})
			.strict(),
		period: period.nullable(),
	})
	.strict();

/** Effective home can be unknown, absent, or loaded independently of refresh activity. */
const knowledge = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("unqueried") }).strict(),
	z.object({ kind: z.literal("none") }).strict(),
	z.object({ kind: z.literal("owned"), home }).strict(),
]);

/** Account relationship is core-produced and never implies management eligibility. */
export const housingCrystalSchema = z
	.object({
		ownership: z.enum(["available", "character", "account", "other"]),
		crystal: z
			.object({
				crystal: uint,
				dwellingId: uint,
				owner: uint,
				ownerName: z.string(),
				flags: uint,
				active: z.boolean(),
				requiresMonarch: z.boolean(),
				houseType: uint,
				maintenanceFree: z.boolean(),
				maintenancePaid: z.boolean(),
				minLevel: z.number().int(),
				maxLevel: z.number().int(),
				minAllegianceRank: z.number().int(),
				maxAllegianceRank: z.number().int(),
				buy: z.array(requirement),
				rent: z.array(requirement),
			})
			.strict(),
	})
	.strict();

/** Named access disclosures remain unknown when an older HAR version omits them. */
const accessRecords = z
	.object({
		publicEntry: z.boolean(),
		guests: z.array(
			z
				.object({
					character: uint,
					name: z.string(),
					storageAllowed: z.boolean(),
				})
				.strict(),
		),
		allegiance: z
			.object({
				flags: uint,
				monarch: uint,
				entryAllowed: z.boolean(),
				storageAllowed: z.boolean(),
			})
			.strict()
			.nullable(),
		roommates: z.array(uint).nullable(),
	})
	.strict();

/** Search areas are location cells, distinct from the total number of available houses. */
const searchResults = z
	.object({ houseType: uint, areas: z.array(uint), totalAvailable: uint })
	.strict();

/** Only established search types can be requested; raw result types stay lossless. */
export const housingSearchRequestSchema = z
	.object({ houseType: z.number().int().min(1).max(4) })
	.strict();

/** Administrative intents are explicit; unknown hook visibility never becomes a guessed toggle. */
const managementAction = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("addGuest"), name: z.string() }).strict(),
	z.object({ kind: z.literal("removeGuest"), name: z.string() }).strict(),
	z.object({ kind: z.literal("bootGuest"), name: z.string() }).strict(),
	z
		.object({
			kind: z.literal("storage"),
			name: z.string(),
			allowed: z.boolean(),
		})
		.strict(),
	z.object({ kind: z.literal("publicEntry"), enabled: z.boolean() }).strict(),
	z
		.object({ kind: z.literal("allegianceEntry"), enabled: z.boolean() })
		.strict(),
	z
		.object({ kind: z.literal("allegianceStorage"), enabled: z.boolean() })
		.strict(),
	z.object({ kind: z.literal("hooks"), enabled: z.boolean() }).strict(),
	z.object({ kind: z.literal("removeAllGuests") }).strict(),
	z.object({ kind: z.literal("addAllStorage") }).strict(),
	z.object({ kind: z.literal("removeAllStorage") }).strict(),
	z.object({ kind: z.literal("bootEveryone") }).strict(),
	z.object({ kind: z.literal("abandon") }).strict(),
]);

/** Character/epoch guard rejects a reviewed request after effective-home replacement. */
export const housingManagementRequestSchema = z
	.object({
		sequence: uint,
		player: uint,
		generation: timestamp,
		action: managementAction,
	})
	.strict();
/** Core owns rejection toasts; this event carries correlation and evidence only. */
export const housingManagementResultSchema = z
	.object({
		sequence: uint,
		generation: timestamp,
		outcome: z.discriminatedUnion("kind", [
			z.object({ kind: z.literal("confirmed") }).strict(),
			z.object({ kind: z.literal("requested") }).strict(),
			z.object({ kind: z.literal("rejected"), reason: z.string() }).strict(),
			z.object({ kind: z.literal("unresolved"), reason: z.string() }).strict(),
		]),
	})
	.strict();
export type HousingManagementRequest = z.infer<
	typeof housingManagementRequestSchema
>;
export type HousingManagementResult = z.infer<
	typeof housingManagementResultSchema
>;

/** Replacement state does not replay crystal-opening intent. */
export const housingSnapshotSchema = z
	.object({
		home: knowledge,
		pendingManagement: z
			.object({
				sequence: uint,
				generation: timestamp,
				action: managementAction,
			})
			.strict()
			.nullable(),
		access: z
			.object({
				generation: timestamp,
				records: accessRecords.nullable(),
				refreshing: z.boolean(),
			})
			.strict(),
		search: z
			.object({
				results: searchResults.nullable(),
				pendingType: uint.nullable(),
			})
			.strict(),
		refreshing: z.boolean(),
		crystal: housingCrystalSchema.nullable(),
		pendingPayment: z
			.object({
				sequence: uint,
				crystal: uint,
				purpose: z.enum(["purchase", "maintenance"]),
			})
			.strict()
			.nullable(),
	})
	.strict();

export type HousingSnapshot = z.infer<typeof housingSnapshotSchema>;
export type HousingCrystal = z.infer<typeof housingCrystalSchema>;

/** Candidate selection contains object IDs; quantities and values come from core. */
export const housingPreviewRequestSchema = z
	.object({
		sequence: uint,
		draft: z
			.object({
				crystal: uint,
				purpose: z.enum(["purchase", "maintenance"]),
				items: z.array(uint),
			})
			.strict(),
		operation: z.discriminatedUnion("kind", [
			z.object({ kind: z.literal("quote") }).strict(),
			z.object({ kind: z.literal("add"), wcid: uint, item: uint }).strict(),
			z.object({ kind: z.literal("fill"), wcid: uint }).strict(),
		]),
	})
	.strict();

/** Single quote contract shared by preview and validated submission. */
const housingPaymentQuoteSchema = z
	.object({
		lines: z.array(
			z
				.object({
					wcid: uint,
					// Draft membership includes selected stacks with zero expected consumption.
					sources: z.array(uint),
					consumption: z.array(
						z
							.object({
								item: uint,
								quantity: uint,
								value: timestamp,
							})
							.strict(),
					),
					credited: uint,
					effectivePaid: timestamp,
					shortfall: uint,
					excess: timestamp,
				})
				.strict(),
		),
		complete: z.boolean(),
		contributes: z.boolean(),
	})
	.strict();

/** All draft displays read this shared quote rather than recalculate accounting. */
export const housingPreviewResultSchema = z
	.object({
		sequence: uint,
		crystal: uint,
		outcome: z.discriminatedUnion("kind", [
			z
				.object({
					kind: z.literal("ready"),
					items: z.array(uint),
					quote: housingPaymentQuoteSchema,
					unavailable: z.array(z.string()),
				})
				.strict(),
			z.object({ kind: z.literal("rejected"), reason: z.string() }).strict(),
		]),
	})
	.strict();

export type HousingPreviewRequest = z.infer<typeof housingPreviewRequestSchema>;
export type HousingPreviewResult = z.infer<typeof housingPreviewResultSchema>;

/** Initial session state before the first complete authority snapshot. */
export function emptyHousing(): HousingSnapshot {
	return {
		home: { kind: "unqueried" },
		access: { generation: 0, records: null, refreshing: false },
		search: { results: null, pendingType: null },
		refreshing: false,
		crystal: null,
		pendingPayment: null,
		pendingManagement: null,
	};
}

/** Dispatch binds the current profile and quote to the originating character. */
export const housingPaymentRequestSchema = z
	.object({
		sequence: uint,
		player: uint,
		draft: housingPreviewRequestSchema.shape.draft,
		profile: housingCrystalSchema.shape.crystal,
		quote: housingPaymentQuoteSchema,
	})
	.strict();

/** Terminal feedback owns at most one existing rejection toast. */
export const housingPaymentResultSchema = z
	.object({
		sequence: uint,
		crystal: uint,
		outcome: z.discriminatedUnion("kind", [
			z.object({ kind: z.literal("completed") }).strict(),
			z.object({ kind: z.literal("partial"), reason: z.string() }).strict(),
			z.object({ kind: z.literal("rejected"), reason: z.string() }).strict(),
			z.object({ kind: z.literal("unresolved"), reason: z.string() }).strict(),
		]),
		notify: z.boolean(),
	})
	.strict();

export type HousingPaymentRequest = z.infer<typeof housingPaymentRequestSchema>;
export type HousingPaymentResult = z.infer<typeof housingPaymentResultSchema>;
