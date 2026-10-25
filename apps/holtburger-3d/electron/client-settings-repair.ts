import { z } from "zod";

/** A supported section normalized for disk, with notices only for discarded choices. */
export interface RepairedSettingsEntry {
	/** Canonical supported entry, or an untouched future-version entry. */
	readonly entry: unknown;
	/** Discarded preferences to report after the replacement succeeds. */
	readonly notices: readonly string[];
}

const envelopeSchema = z.object({
	version: z.number().int().positive(),
	value: z.unknown(),
});

/** Repair persisted input only. Runtime values and save requests still use strict parsing. */
export function repairSettingsEntry(
	raw: unknown,
	schema: z.ZodType,
	defaults: unknown,
	label: string,
): RepairedSettingsEntry {
	if (raw === undefined) return { entry: raw, notices: [] };
	const envelope = envelopeSchema.safeParse(raw);
	// A newer build owns this value; its contract cannot be inferred from ours.
	if (envelope.success && envelope.data.version > 1)
		return { entry: raw, notices: [] };
	const fallback = schema.parse(defaults);
	if (!envelope.success)
		return {
			entry: { version: 1, value: fallback },
			notices: [`${label}: reset malformed entry`],
		};
	let value: unknown = structuredClone(envelope.data.value);
	const notices = new Set<string>();
	if (isRecord(raw)) {
		for (const key of Object.keys(raw)) {
			if (key !== "version" && key !== "value")
				notices.add(`${label}.${key}: removed unknown entry field`);
		}
	}
	for (;;) {
		const parsed = schema.safeParse(value);
		if (parsed.success)
			return {
				entry: { version: 1, value: parsed.data },
				notices: [...notices],
			};
		const before = JSON.stringify(value);
		for (const issue of parsed.error.issues) {
			if (issue.code === "unrecognized_keys") {
				const target = atPath(value, issue.path);
				if (isRecord(target)) {
					for (const key of issue.keys) {
						delete target[key];
						notices.add(
							`${formatPath(label, [...issue.path, key])}: removed unknown field`,
						);
					}
					continue;
				}
			}
			// Collections are atomic: deleting or merging cells could remap bindings.
			const collectionIndex = issue.path.findIndex(
				(part) => typeof part === "number",
			);
			const path =
				collectionIndex < 0
					? [...issue.path]
					: issue.path.slice(0, collectionIndex);
			// Union branches can contain fields absent from the default branch. Reset
			// their nearest default-bearing group rather than inventing a mixed variant.
			while (path.length > 0 && atPath(fallback, path) === undefined)
				path.pop();
			const previous = atPath(value, path);
			const replacement = structuredClone(atPath(fallback, path));
			value = replacePath(value, path, replacement);
			if (previous !== undefined)
				notices.add(`${formatPath(label, path)}: reset invalid value`);
		}
		if (JSON.stringify(value) === before)
			throw new Error(`Settings repair made no progress for ${label}`, {
				cause: parsed.error,
			});
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function atPath(value: unknown, path: readonly PropertyKey[]): unknown {
	for (const key of path) {
		if (!isRecord(value) || typeof key !== "string") return undefined;
		value = value[key];
	}
	return value;
}

function replacePath(
	value: unknown,
	path: readonly PropertyKey[],
	replacement: unknown,
): unknown {
	if (path.length === 0) return replacement;
	const parent = atPath(value, path.slice(0, -1));
	const key = path.at(-1);
	if (!isRecord(parent) || typeof key !== "string")
		throw new Error("Settings repair path has no object parent");
	parent[key] = replacement;
	return value;
}

function formatPath(label: string, path: readonly PropertyKey[]): string {
	return [label, ...path.map(String)].join(".");
}
