import { z } from "zod";

/** Salvage independent preferences using schema paths and owner-provided defaults. */
export function repairSettingsValue<T>(
	raw: unknown,
	schema: z.ZodType<T>,
	defaults: T,
	label: string,
): { value: T; notices: readonly string[] } {
	const fallback = schema.parse(defaults);
	let value: unknown = structuredClone(raw);
	const notices = new Set<string>();
	for (;;) {
		const parsed = schema.safeParse(value);
		if (parsed.success)
			return {
				value: parsed.data,
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
