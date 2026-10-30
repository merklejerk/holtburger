import { z } from "zod";
import { clientWindowSettingsSchema } from "../app/window-settings-contract.js";

/** Server identity belongs to the launcher; game caches still use the selected endpoint. */
export const launcherServerSchema = z
	.object({
		id: z.string().uuid(),
		name: z.string().trim().min(1),
		endpoint: z
			.object({
				host: z.string().trim().min(1),
				port: z.number().int().min(1).max(65535),
			})
			.strict(),
	})
	.strict();
/** Saved secrets use authenticated encryption; the universal key is an obfuscation measure. */
const encryptedCredentialsSchema = z
	.object({
		version: z.number().int().positive(),
		nonce: z.string(),
		ciphertext: z.string(),
		authenticationTag: z.string(),
	})
	.strict();
/** A saved credential preset refers to one server; null credentials occur only in incomplete legacy profiles. */
const launcherProfileSchema = z
	.object({
		id: z.string().uuid(),
		name: z.string().trim().min(1),
		serverId: z.string().uuid(),
		credentials: encryptedCredentialsSchema.nullable(),
	})
	.strict();
/** Account names are encrypted together with passwords, including intentionally empty passwords. */
export const launcherCredentialsSchema = z
	.object({ account: z.string().min(1), password: z.string() })
	.strict();
/** Last-used server and optional preset are one validated selection. */
export const launcherSelectionSchema = z
	.object({
		/** Saved server used by the attempt, including launches without a preset. */
		serverId: z.string().uuid(),
		/** Optional saved preset selected for this server. */
		profileId: z.string().uuid().nullable(),
	})
	.strict();
const launcherCatalogSchema = z.object({
	servers: z.array(launcherServerSchema),
	profiles: z.array(launcherProfileSchema),
	window: clientWindowSettingsSchema,
});
/** Shared reference validation applies before upgrading an older on-disk document. */
function validateCatalog(
	value: z.infer<typeof launcherCatalogSchema>,
	context: z.RefinementCtx,
): void {
	const servers = new Set(value.servers.map((server) => server.id));
	const profiles = new Set(value.profiles.map((profile) => profile.id));
	if (servers.size !== value.servers.length)
		context.addIssue({ code: "custom", message: "Duplicate server identity" });
	if (profiles.size !== value.profiles.length)
		context.addIssue({ code: "custom", message: "Duplicate profile identity" });
	if (value.profiles.some((profile) => !servers.has(profile.serverId)))
		context.addIssue({
			code: "custom",
			message: "Profile references an unknown server",
		});
}
/** Independent launcher document; profile-free logins retain server selection without creating a named preset. */
const selectedLauncherCatalogSchema = launcherCatalogSchema
	.extend({
		lastSelection: launcherSelectionSchema.nullable(),
	})
	.strict()
	.superRefine((value, context) => {
		validateCatalog(value, context);
		const selection = value.lastSelection;
		if (selection === null) return;
		if (!value.servers.some((server) => server.id === selection.serverId))
			context.addIssue({
				code: "custom",
				message: "Last selection references an unknown server",
			});
		if (
			selection.profileId !== null &&
			!value.profiles.some(
				(profile) =>
					profile.id === selection.profileId &&
					profile.serverId === selection.serverId,
			)
		)
			context.addIssue({
				code: "custom",
				message: "Last selection references an unknown profile for this server",
			});
	});
/** Version two retained only one global launch selection. */
const previousLauncherSettingsSchema = selectedLauncherCatalogSchema.safeExtend(
	{
		version: z.literal(2),
	},
);
/** Per-server launch choices survive using another server; null remembers a profile-free launch. */
const profileMemoryCatalogSchema = selectedLauncherCatalogSchema
	.safeExtend({
		lastProfileByServer: z.record(
			z.string().uuid(),
			z.string().uuid().nullable(),
		),
	})
	.strict()
	.superRefine((value, context) => {
		for (const [serverId, profileId] of Object.entries(
			value.lastProfileByServer,
		)) {
			if (!value.servers.some((server) => server.id === serverId))
				context.addIssue({
					code: "custom",
					message: "Remembered profile references an unknown server",
				});
			if (
				profileId !== null &&
				!value.profiles.some(
					(profile) =>
						profile.id === profileId && profile.serverId === serverId,
				)
			)
				context.addIssue({
					code: "custom",
					message: "Remembered profile does not belong to its server",
				});
		}
	});
/** Version three stored credential envelopes only in named profiles. */
const profileMemorySettingsSchema = profileMemoryCatalogSchema.safeExtend({
	version: z.literal(3),
});
/** Profile-free credentials belong to their server and never overwrite a named preset. */
export const launcherSettingsSchema = profileMemoryCatalogSchema
	.safeExtend({
		version: z.literal(4),
		serverCredentials: z.record(z.string().uuid(), encryptedCredentialsSchema),
	})
	.superRefine((value, context) => {
		if (
			Object.keys(value.serverCredentials).some(
				(id) => !value.servers.some((server) => server.id === id),
			)
		)
			context.addIssue({
				code: "custom",
				message: "Saved credentials reference an unknown server",
			});
	});
/** Only the load boundary accepts older documents. */
const legacyLauncherSettingsSchema = launcherCatalogSchema
	.extend({
		version: z.literal(1),
		lastProfileId: z.string().uuid().nullable(),
	})
	.strict()
	.superRefine((value, context) => {
		validateCatalog(value, context);
		if (
			value.lastProfileId !== null &&
			!value.profiles.some((profile) => profile.id === value.lastProfileId)
		)
			context.addIssue({
				code: "custom",
				message: "Last selection references an unknown profile",
			});
	})
	.transform((value) => {
		const profile = value.profiles.find(
			(profile) => profile.id === value.lastProfileId,
		);
		return {
			version: 2 as const,
			servers: value.servers,
			profiles: value.profiles,
			window: value.window,
			lastSelection:
				profile === undefined
					? null
					: { serverId: profile.serverId, profileId: profile.id },
		};
	});
/** Upgrade selection metadata without changing server IDs, profiles, or encrypted credential envelopes. */
export function decodeLauncherSettings(input: unknown): LauncherSettings {
	const current = launcherSettingsSchema.safeParse(input);
	if (current.success) return current.data;
	const profileMemory = profileMemorySettingsSchema.safeParse(input);
	if (profileMemory.success)
		return launcherSettingsSchema.parse({
			...profileMemory.data,
			version: 4,
			serverCredentials: {},
		});
	const previous = z
		.union([previousLauncherSettingsSchema, legacyLauncherSettingsSchema])
		.parse(input);
	return launcherSettingsSchema.parse({
		...previous,
		version: 4,
		serverCredentials: {},
		lastProfileByServer:
			previous.lastSelection === null
				? {}
				: {
						[previous.lastSelection.serverId]: previous.lastSelection.profileId,
					},
	});
}
export type LauncherServer = z.infer<typeof launcherServerSchema>;
export type LauncherCredentials = z.infer<typeof launcherCredentialsSchema>;
export type EncryptedCredentials = z.infer<typeof encryptedCredentialsSchema>;
export type LauncherSettings = z.infer<typeof launcherSettingsSchema>;
/** Identifies either a named preset or a server's profile-free credentials. */
export type LauncherSelection = z.infer<typeof launcherSelectionSchema>;

/** Public profile projection never exposes the stored credential envelope or password. */
export interface LauncherProfileView {
	/** Stable profile identity; also authenticates its saved credential envelope. */
	readonly id: string;
	/** User-authored label, independent of the encrypted account name. */
	readonly name: string;
	/** Reference to one catalog server, never a game settings/cache key. */
	readonly serverId: string;
	/** Main-owned decryption result; consumers never infer readiness from ciphertext. */
	readonly credentialStatus: "absent" | "saved" | "unavailable";
}
/** Snapshot supports explicit recovery without silently replacing an unreadable file. */
export interface LauncherSnapshot {
	/** Most recently launched servers first; metadata edits preserve order and dependent profiles. */
	readonly servers: readonly LauncherServer[];
	/** Public profile projection excludes saved secrets and their envelopes. */
	readonly profiles: readonly LauncherProfileView[];
	/** Last admitted server and optional preset, or null on first run/server deletion. */
	readonly lastSelection: z.infer<typeof launcherSelectionSchema> | null;
	/** Last launched preset per server; absent/null means no preset. */
	readonly lastProfileByServer: Readonly<Record<string, string | null>>;
	/** Current persistence or session diagnostic suitable for the picker. */
	readonly failure: string | null;
	/** Prevents writes until the unreadable catalog is explicitly recovered. */
	readonly recoveryRequired: boolean;
	/** Combined application admission and catalog health, decided by native owners. */
	readonly canPlay: boolean;
}
/** Explicit preset saves always store both credentials in one encrypted payload. */
export const profileSaveSchema = z
	.object({
		id: z.string().uuid(),
		name: z.string().trim().min(1),
		serverId: z.string().uuid(),
		credentials: launcherCredentialsSchema,
	})
	.strict();
/** Play uses the current form values and never creates or overwrites a saved profile. */
export const launcherPlaySchema = launcherSelectionSchema
	.extend({
		credentials: launcherCredentialsSchema,
	})
	.strict();
export type ProfileSave = z.infer<typeof profileSaveSchema>;
export type LauncherPlay = z.infer<typeof launcherPlaySchema>;
