import { readFile, copyFile } from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { clientServerScope } from "./client-profile-key.js";
import { replaceLocalFile } from "./replace-local-file.js";
import {
	decryptCredentials,
	encryptCredentials,
} from "./launcher-credentials.js";
import { clientFailureDiagnostic } from "../src/client/client-close-contract.js";
import {
	launcherSettingsSchema,
	decodeLauncherSettings,
	launcherServerSchema,
	profileSaveSchema,
	launcherPlaySchema,
	launcherSelectionSchema,
	type LauncherSettings,
	type LauncherSnapshot,
	type LauncherCredentials,
	type LauncherServer,
} from "../src/launcher/launcher-contract.js";
import type { ClientWindowSettings } from "../src/app/window-settings-contract.js";
import type { ClientLaunchConfiguration } from "./client-launch.js";

/** Catalog order is launch recency; servers without history retain their existing order. */
function mostRecentServerFirst(
	servers: readonly LauncherServer[],
	id: string,
): LauncherServer[] {
	return servers.toSorted(
		(left, right) => Number(right.id === id) - Number(left.id === id),
	);
}

/** Application-lived launcher persistence; successful mutations acknowledge durable replacement. */
export class LauncherStore {
	readonly #path: string;
	readonly #initialWindow: ClientWindowSettings;
	#document: LauncherSettings;
	#failure: string | null = null;
	#recoveryRequired = false;
	#tail: Promise<void> = Promise.resolve();

	constructor(path: string, initialWindow: ClientWindowSettings) {
		this.#path = path;
		this.#initialWindow = initialWindow;
		this.#document = this.#empty();
	}
	#empty(): LauncherSettings {
		return {
			version: 4,
			serverCredentials: {},
			servers: [],
			profiles: [],
			lastSelection: null,
			lastProfileByServer: {},
			window: this.#initialWindow,
		};
	}
	async load(): Promise<void> {
		try {
			this.#document = decodeLauncherSettings(
				JSON.parse(await readFile(this.#path, "utf8")),
			);
			// Older catalogs only recorded the last selection, so recover that known ordering.
			if (this.#document.lastSelection !== null)
				this.#document.servers = mostRecentServerFirst(
					this.#document.servers,
					this.#document.lastSelection.serverId,
				);
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT")
				return;
			this.#failure = `Launcher settings could not be loaded: ${clientFailureDiagnostic(error)}`;
			this.#recoveryRequired = true;
		}
	}
	get window(): ClientWindowSettings {
		return this.#document.window;
	}
	snapshot(failure: string | null, canPlay: boolean): LauncherSnapshot {
		return {
			servers: this.#document.servers,
			profiles: this.#document.profiles.map((profile) => {
				let credentialStatus: "absent" | "saved" | "unavailable" = "absent";
				if (profile.credentials !== null) {
					try {
						decryptCredentials(profile.id, profile.credentials);
						credentialStatus = "saved";
					} catch {
						credentialStatus = "unavailable";
					}
				}
				return {
					id: profile.id,
					name: profile.name,
					serverId: profile.serverId,
					credentialStatus,
				};
			}),
			lastSelection: this.#document.lastSelection,
			lastProfileByServer: this.#document.lastProfileByServer,
			failure: this.#failure ?? failure,
			recoveryRequired: this.#recoveryRequired,
			canPlay: canPlay && !this.#recoveryRequired,
		};
	}
	#write(update: (value: LauncherSettings) => LauncherSettings): Promise<void> {
		const operation = this.#tail.then(async () => {
			if (this.#recoveryRequired)
				throw new Error("Recover launcher settings before saving changes");
			const next = launcherSettingsSchema.parse(update(this.#document));
			try {
				await replaceLocalFile(
					this.#path,
					JSON.stringify(next, null, 2) + "\n",
				);
			} catch (error) {
				this.#failure = `Launcher settings could not be saved: ${clientFailureDiagnostic(error)}`;
				throw error;
			}
			this.#document = next;
			this.#failure = null;
		});
		// The caller observes operation failures; the settled tail only sequences subsequent work.
		// Validation rejects do not poison flush. Actual replacement failures remain in #failure.
		this.#tail = operation.catch(() => undefined);
		return operation;
	}
	/** Explicit recovery keeps the unreadable original as a sibling before creating defaults. */
	recover(): Promise<void> {
		const operation = this.#tail.then(async () => {
			if (!this.#recoveryRequired)
				throw new Error("Launcher settings do not require recovery");
			await copyFile(
				this.#path,
				`${this.#path}.invalid-${randomUUID()}`,
				constants.COPYFILE_EXCL,
			);
			const next = this.#empty();
			await replaceLocalFile(this.#path, JSON.stringify(next, null, 2) + "\n");
			this.#document = next;
			this.#failure = null;
			this.#recoveryRequired = false;
		});
		this.#tail = operation.catch((error: unknown) => {
			this.#failure = `Launcher settings recovery failed: ${clientFailureDiagnostic(error)}`;
		});
		return operation;
	}
	saveServer(input: unknown): Promise<void> {
		const server = launcherServerSchema.parse(input);
		return this.#write((value) => {
			const endpoint = clientServerScope(server.endpoint);
			const duplicate = value.servers.find(
				(item) =>
					item.id !== server.id &&
					clientServerScope(item.endpoint) === endpoint,
			);
			if (duplicate !== undefined)
				throw new Error(
					`A server for ${endpoint} already exists (${duplicate.name}).`,
				);
			return {
				...value,
				servers: value.servers.some((item) => item.id === server.id)
					? value.servers.map((item) => (item.id === server.id ? server : item))
					: [...value.servers, server],
			};
		});
	}
	/** Add one directory server durably; matching endpoints preserve existing identities and credentials. */
	async importServer(input: unknown): Promise<string | null> {
		const candidate = launcherServerSchema.omit({ id: true }).parse(input);
		let added: string | null = null;
		await this.#write((value) => {
			const key = clientServerScope(candidate.endpoint);
			if (
				value.servers.some(
					(server) => clientServerScope(server.endpoint) === key,
				)
			)
				return value;
			added = randomUUID();
			return {
				...value,
				servers: [...value.servers, { ...candidate, id: added }],
			};
		});
		return added;
	}
	deleteServer(id: string): Promise<void> {
		return this.#write((value) => {
			if (!value.servers.some((item) => item.id === id))
				throw new Error("Server does not exist");
			const profiles = value.profiles.filter(
				(profile) => profile.serverId !== id,
			);
			return {
				...value,
				servers: value.servers.filter((item) => item.id !== id),
				serverCredentials: Object.fromEntries(
					Object.entries(value.serverCredentials).filter(
						([serverId]) => serverId !== id,
					),
				),
				lastProfileByServer: Object.fromEntries(
					Object.entries(value.lastProfileByServer).filter(
						([serverId]) => serverId !== id,
					),
				),
				profiles,
				lastSelection:
					value.lastSelection?.serverId === id ? null : value.lastSelection,
			};
		});
	}
	saveProfile(input: unknown): Promise<void> {
		const edit = profileSaveSchema.parse(input);
		return this.#write((value) => {
			if (!value.servers.some((server) => server.id === edit.serverId))
				throw new Error("Profile server does not exist");

			return {
				...value,
				profiles: [
					...value.profiles.filter((profile) => profile.id !== edit.id),
					{
						id: edit.id,
						name: edit.name,
						serverId: edit.serverId,
						credentials: encryptCredentials(edit.id, edit.credentials),
					},
				],
			};
		});
	}
	deleteProfile(id: string): Promise<void> {
		return this.#write((value) => {
			if (!value.profiles.some((profile) => profile.id === id))
				throw new Error("Profile does not exist");
			return {
				...value,
				profiles: value.profiles.filter((profile) => profile.id !== id),
				lastProfileByServer: Object.fromEntries(
					Object.entries(value.lastProfileByServer).map(
						([serverId, profileId]) => [
							serverId,
							profileId === id ? null : profileId,
						],
					),
				),
				lastSelection:
					value.lastSelection?.profileId === id
						? { serverId: value.lastSelection.serverId, profileId: null }
						: value.lastSelection,
			};
		});
	}
	/** Only the admitted picker can load credentials into its editable masked-password form. */
	credentials(input: unknown): LauncherCredentials | null {
		const { serverId, profileId } = launcherSelectionSchema.parse(input);
		if (!this.#document.servers.some((server) => server.id === serverId))
			throw new Error("Server does not exist");
		if (profileId === null) {
			const envelope = this.#document.serverCredentials[serverId];
			return envelope === undefined
				? null
				: decryptCredentials(`server:${serverId}`, envelope);
		}
		const profile = this.#document.profiles.find(
			(profile) => profile.id === profileId,
		);
		if (profile === undefined) throw new Error("Profile does not exist");
		if (profile.serverId !== serverId)
			throw new Error("Profile belongs to a different server");
		return profile.credentials === null
			? null
			: decryptCredentials(profile.id, profile.credentials);
	}
	async select(input: unknown): Promise<ClientLaunchConfiguration> {
		const selection = launcherPlaySchema.parse(input);
		await this.#tail;
		const server = this.#document.servers.find(
			(server) => server.id === selection.serverId,
		);
		if (server === undefined) throw new Error("Server does not exist");
		if (selection.profileId !== null) {
			const profile = this.#document.profiles.find(
				(profile) => profile.id === selection.profileId,
			);
			if (profile === undefined) throw new Error("Profile does not exist");
			if (profile.serverId !== server.id)
				throw new Error("Profile belongs to a different server");
		}
		await this.#write((value) => ({
			...value,
			servers: mostRecentServerFirst(value.servers, server.id),
			serverCredentials:
				selection.profileId === null
					? {
							...value.serverCredentials,
							[server.id]: encryptCredentials(
								`server:${server.id}`,
								selection.credentials,
							),
						}
					: value.serverCredentials,
			lastSelection: { serverId: server.id, profileId: selection.profileId },
			lastProfileByServer: {
				...value.lastProfileByServer,
				[server.id]: selection.profileId,
			},
		}));
		return { ...server.endpoint, ...selection.credentials };
	}
	updateWindow(window: ClientWindowSettings): Promise<void> {
		if (this.#recoveryRequired) return Promise.resolve();
		return this.#write((value) => ({ ...value, window }));
	}
	async flush(): Promise<void> {
		await this.#tail;
		if (this.#failure !== null && !this.#recoveryRequired)
			throw new Error(this.#failure);
	}
}
