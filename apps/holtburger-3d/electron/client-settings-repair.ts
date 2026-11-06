import { z } from "zod";
import { repairSettingsValue } from "./settings-value-repair.js";
import {
	clientUserSectionSchemas,
	clientHudPlacementSchemas,
	clientCharacterSectionSchemas,
	type ClientSettingsCollection,
} from "../src/client/client-settings-sections.js";

/** A supported section normalized for disk, with notices only for discarded choices. */
export interface RepairedSettingsEntry {
	/** Canonical supported entry, or undefined when the section is absent. */
	readonly entry: unknown;
	/** Discarded preferences to report after the replacement succeeds. */
	readonly notices: readonly string[];
}

const envelopeSchema = z.object({
	version: z.number().int().positive(),
	value: z.unknown(),
});

const supportedEnvelopeSchema = envelopeSchema.extend({
	version: z.literal(1),
});

/** Repair supported persisted input after structural pruning. Save requests still use strict parsing. */
export function repairSettingsEntry(
	raw: unknown,
	schema: z.ZodType,
	defaults: unknown,
	label: string,
): RepairedSettingsEntry {
	if (raw === undefined) return { entry: raw, notices: [] };
	const envelope = supportedEnvelopeSchema.safeParse(raw);
	if (!envelope.success)
		return {
			entry: { version: 1, value: schema.parse(defaults) },
			notices: [`${label}: reset malformed entry`],
		};
	const notices = new Set<string>();
	if (isRecord(raw)) {
		for (const key of Object.keys(raw)) {
			if (key !== "version" && key !== "value")
				notices.add(`${label}.${key}: removed unknown entry field`);
		}
	}
	const repaired = repairSettingsValue(
		envelope.data.value,
		schema,
		defaults,
		label,
	);
	return {
		entry: { version: 1, value: repaired.value },
		notices: [...notices, ...repaired.notices],
	};
}

/** Prune section identities and versions without requiring viewport- or character-specific defaults. */
export function pruneUnsupportedSettings(document: ClientSettingsCollection): {
	document: ClientSettingsCollection;
	notices: readonly string[];
} {
	const notices: string[] = [];
	const prune = (
		raw: Readonly<Record<string, unknown>>,
		supported: ReadonlySet<string>,
		label: string,
	) => {
		const entries: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(raw)) {
			const path = `${label}.${key}`;
			if (!supported.has(key)) {
				notices.push(`${path}: removed unknown section`);
				continue;
			}
			const envelope = envelopeSchema.safeParse(value);
			if (envelope.success && envelope.data.version !== 1) {
				notices.push(
					`${path}: removed unsupported version ${envelope.data.version}`,
				);
				continue;
			}
			entries[key] = value;
		}
		return entries;
	};
	// hudPlacements is a section map, not a versioned entry. Exclude it from envelope parsing.
	const { hudPlacements, ...userEntries } = document.user;
	const user = prune(
		userEntries,
		new Set([...Object.keys(clientUserSectionSchemas), "window"]),
		"user",
	);
	if (hudPlacements !== undefined) {
		if (isRecord(hudPlacements))
			user.hudPlacements = prune(
				hudPlacements,
				new Set(Object.keys(clientHudPlacementSchemas)),
				"user.hudPlacements",
			);
		else {
			user.hudPlacements = {};
			notices.push("user.hudPlacements: reset invalid map");
		}
	}
	const supportedCharacterSections = new Set(
		Object.keys(clientCharacterSectionSchemas),
	);
	const characters = Object.fromEntries(
		Object.entries(document.characters).map(([profile, entries]) => [
			profile,
			prune(entries, supportedCharacterSections, `characters.${profile}`),
		]),
	);
	return { document: { ...document, user, characters }, notices };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
