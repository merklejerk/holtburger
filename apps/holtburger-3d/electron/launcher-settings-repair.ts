import { z } from "zod";
import {
	launcherSettingsSchema,
	launcherServerSchema,
	launcherSelectionSchema,
	type LauncherSettings,
} from "../src/launcher/launcher-contract.js";
import type { ClientWindowSettings } from "../src/app/window-settings-contract.js";
import { repairSettingsValue } from "./settings-value-repair.js";

// Catalog containers and the format version must be recognizable before salvage.
// Known historical formats share catalog identities. Future formats need review.
const catalogSchema = z
	.object({
		version: z
			.number()
			.int()
			.min(1)
			.max(launcherSettingsSchema.shape.version.value),
		servers: z.array(z.unknown()),
		profiles: z.array(z.unknown()),
	})
	.catchall(z.unknown());
const serverIdentitySchema = launcherServerSchema
	.pick({ id: true, name: true, endpoint: true })
	.extend({ endpoint: launcherServerSchema.shape.endpoint.strip() })
	.strip();
const profileSchema = launcherSettingsSchema.shape.profiles.element;
const profileIdentitySchema = profileSchema
	.pick({ id: true, name: true, serverId: true })
	.strip();
/** Version five placed the optional content override on each profile. */
const legacyProfileContentSchema = profileIdentitySchema.extend({
	contentPath: launcherServerSchema.shape.contentPath.default(null),
});
const identitySchema = z.object({ id: z.string().uuid() });
const recordSchema = z.record(z.string(), z.unknown());

/** Expected data failures may reset the catalog; programming failures must preserve the source. */
export class UnrepairableLauncherSettingsError extends Error {}

/** Repair preferences only after establishing catalog identities and ownership. */
export function repairLauncherSettings(
	raw: unknown,
	window: ClientWindowSettings,
): { document: LauncherSettings; notices: readonly string[] } {
	const parsed = catalogSchema.safeParse(raw);
	if (!parsed.success)
		throw new UnrepairableLauncherSettingsError(
			"Unsupported launcher catalog format",
			{ cause: parsed.error },
		);
	const catalog = parsed.data;
	const notices: string[] = [];
	let servers = repairCatalog(
		catalog.servers,
		serverIdentitySchema,
		launcherServerSchema,
		(identity) => ({ ...identity, contentPath: null }),
		"servers",
		notices,
	);
	const serverIds = new Set(servers.map(({ id }) => id));
	const profileInputs = catalog.profiles.map((rawProfile) => {
		if (catalog.version > 5) return rawProfile;
		const record = recordSchema.safeParse(rawProfile);
		if (!record.success) return rawProfile;
		const fields = { ...record.data };
		delete fields.contentPath;
		return fields;
	});
	const profiles = repairCatalog(
		profileInputs,
		profileIdentitySchema,
		profileSchema,
		(identity) => ({ ...identity, credentials: null }),
		"profiles",
		notices,
	).filter((profile) => {
		if (serverIds.has(profile.serverId)) return true;
		notices.push(`profiles.${profile.id}: removed profile for unknown server`);
		return false;
	});
	const profileOwners = new Map(
		profiles.map(({ id, serverId }) => [id, serverId]),
	);
	if (catalog.version < launcherSettingsSchema.shape.version.value) {
		notices.push(`Upgraded launcher settings from version ${catalog.version}`);
	}
	if (catalog.version === 5) {
		servers = reconcileProfileContent(
			servers,
			profiles,
			catalog.profiles,
			notices,
		);
	}
	const ownsProfile = (serverId: string, profileId: string | null) =>
		serverIds.has(serverId) &&
		(profileId === null || profileOwners.get(profileId) === serverId);
	// Version one retained a profile ID; version two introduced server selection.
	const legacySelection = profiles.find(
		(profile) => profile.id === catalog.lastProfileId,
	);
	if (
		catalog.version === 1 &&
		catalog.lastProfileId != null &&
		legacySelection === undefined
	)
		notices.push("lastProfileId: cleared invalid selection");
	const selectionInput =
		catalog.version === 1
			? legacySelection === undefined
				? null
				: { serverId: legacySelection.serverId, profileId: legacySelection.id }
			: catalog.lastSelection;
	const selection = launcherSelectionSchema.safeParse(selectionInput);
	const lastSelection =
		selection.success &&
		ownsProfile(selection.data.serverId, selection.data.profileId)
			? selection.data
			: null;
	if (selectionInput != null && lastSelection === null)
		notices.push("lastSelection: cleared invalid selection");
	const lastProfileByServer = repairMap(
		catalog.version <= 2 && lastSelection !== null
			? { [lastSelection.serverId]: lastSelection.profileId }
			: catalog.lastProfileByServer,
		"lastProfileByServer",
		z.string().uuid().nullable(),
		ownsProfile,
		notices,
	);
	const serverCredentials = repairMap(
		catalog.serverCredentials,
		"serverCredentials",
		launcherSettingsSchema.shape.serverCredentials.valueType,
		(serverId) => serverIds.has(serverId),
		notices,
	);
	const defaults: LauncherSettings = {
		version: launcherSettingsSchema.shape.version.value,
		servers,
		profiles,
		window,
		lastSelection: null,
		lastProfileByServer: {},
		serverCredentials: {},
	};
	const normalizedSource = { ...catalog };
	if (catalog.version === 1) delete normalizedSource.lastProfileId;
	// Catalog arrays have already been isolated entry by entry. Their references
	// are coherent before the shared repair routine handles remaining preferences.
	const repaired = repairSettingsValue(
		{
			...normalizedSource,
			version: launcherSettingsSchema.shape.version.value,
			servers,
			profiles,
			lastSelection,
			lastProfileByServer,
			serverCredentials,
		},
		launcherSettingsSchema,
		defaults,
		"launcher",
	);
	return {
		document: repaired.value,
		notices: [...notices, ...repaired.notices],
	};
}

/** Move profile overrides to servers only when retained profiles agree on the repaired choice. */
function reconcileProfileContent(
	servers: LauncherSettings["servers"],
	profiles: LauncherSettings["profiles"],
	rawProfiles: readonly unknown[],
	notices: string[],
): LauncherSettings["servers"] {
	const retained = new Set(profiles.map(({ id }) => id));
	const pathsByProfile = new Map<string, string | null>();
	for (const rawProfile of rawProfiles) {
		const identity = profileIdentitySchema.safeParse(rawProfile);
		if (!identity.success || !retained.has(identity.data.id)) continue;
		const repaired = repairSettingsValue(
			rawProfile,
			legacyProfileContentSchema,
			{ ...identity.data, contentPath: null },
			`profiles.${identity.data.id}`,
		);
		pathsByProfile.set(identity.data.id, repaired.value.contentPath);
		notices.push(...repaired.notices);
	}
	return servers.map((server) => {
		const paths = new Set(
			profiles
				.filter((profile) => profile.serverId === server.id)
				.map((profile) => pathsByProfile.get(profile.id))
				.filter((path) => path !== undefined),
		);
		if (paths.size > 1)
			notices.push(
				`servers.${server.id}.contentPath: conflicting profile overrides reset to application default`,
			);
		const [path] = paths;
		return {
			...server,
			contentPath: paths.size === 1 && path !== undefined ? path : null,
		};
	});
}

/** Never choose a winner for duplicate identities or invent missing identity fields. */
function repairCatalog<I extends { id: string }, T>(
	entries: readonly unknown[],
	identity: z.ZodType<I>,
	schema: z.ZodType<T>,
	defaults: (identity: I) => T,
	label: string,
	notices: string[],
): T[] {
	const identities = new Set<string>();
	return entries.flatMap((raw, index) => {
		const key = identitySchema.safeParse(raw);
		if (key.success) {
			if (identities.has(key.data.id))
				throw new UnrepairableLauncherSettingsError(
					`Duplicate ${label} identity; automatic repair is ambiguous`,
				);
			identities.add(key.data.id);
		}
		const parsed = identity.safeParse(raw);
		if (!parsed.success) {
			notices.push(`${label}[${index}]: removed malformed catalog entry`);
			return [];
		}
		const repaired = repairSettingsValue(
			raw,
			schema,
			defaults(parsed.data),
			`${label}.${parsed.data.id}`,
		);
		notices.push(...repaired.notices);
		return [repaired.value];
	});
}

/** History and credentials are independent per server; invalid owners never get reassigned. */
function repairMap<T>(
	raw: unknown,
	label: string,
	schema: z.ZodType<T>,
	accept: (serverId: string, value: T) => boolean,
	notices: string[],
): Record<string, T> {
	if (raw === undefined) return {};
	const map = recordSchema.safeParse(raw);
	if (!map.success) {
		notices.push(`${label}: reset malformed map`);
		return {};
	}
	return Object.fromEntries(
		Object.entries(map.data).flatMap(([key, value]) => {
			const parsed = schema.safeParse(value);
			if (parsed.success && accept(key, parsed.data))
				return [[key, parsed.data]];
			notices.push(`${label}.${key}: removed invalid entry`);
			return [];
		}),
	);
}
