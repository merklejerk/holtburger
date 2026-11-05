import { z } from "zod";
import { clientWindowSettingsSchema } from "../app/window-settings-contract.js";

/** Server identity belongs to the launcher; game caches still use the selected endpoint. */
export const launcherServerSchema = z
	.object({
		id: z.string().uuid(),
		name: z.string().trim().min(1),
		/** Null inherits the application default for every account on this server. */
		contentPath: z.string().min(1).nullable(),
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
/** A saved credential preset refers to one server; null credentials represent incomplete presets. */
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
/** Version six keeps server content and credential presets in one validated launcher catalog. */
export const launcherSettingsSchema = z
	.object({
		version: z.literal(6),
		servers: z.array(launcherServerSchema),
		profiles: z.array(launcherProfileSchema),
		window: clientWindowSettingsSchema,
		lastSelection: launcherSelectionSchema.nullable(),
		/** Null remembers a profile-free launch; missing means this server has no history. */
		lastProfileByServer: z.record(
			z.string().uuid(),
			z.string().uuid().nullable(),
		),
		/** Profile-free credentials never overwrite named presets. */
		serverCredentials: z.record(z.string().uuid(), encryptedCredentialsSchema),
	})
	.strict()
	.superRefine((value, context) => {
		const servers = new Set(value.servers.map((server) => server.id));
		const profiles = new Set(value.profiles.map((profile) => profile.id));
		if (servers.size !== value.servers.length)
			context.addIssue({
				code: "custom",
				message: "Duplicate server identity",
			});
		if (profiles.size !== value.profiles.length)
			context.addIssue({
				code: "custom",
				message: "Duplicate profile identity",
			});
		if (value.profiles.some((profile) => !servers.has(profile.serverId)))
			context.addIssue({
				code: "custom",
				message: "Profile references an unknown server",
			});
		const selection = value.lastSelection;
		if (selection !== null) {
			if (!servers.has(selection.serverId))
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
					message:
						"Last selection references an unknown profile for this server",
				});
		}
		for (const [serverId, profileId] of Object.entries(
			value.lastProfileByServer,
		)) {
			if (!servers.has(serverId))
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
		if (Object.keys(value.serverCredentials).some((id) => !servers.has(id)))
			context.addIssue({
				code: "custom",
				message: "Saved credentials reference an unknown server",
			});
	});

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
