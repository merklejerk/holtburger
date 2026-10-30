import type { LauncherServer } from "./launcher-contract";

/** Validated directory metadata; importing copies only the name and endpoint. */
export interface DirectoryServer {
	/** Normalized endpoint identity, also used for selection and duplicate detection. */
	readonly key: string;
	/** Public directory label, copied when the user imports this server. */
	readonly name: string;
	/** Explicit validated connection destination; no default host or port is inferred. */
	readonly endpoint: LauncherServer["endpoint"];
	/** Directory-authored plain text shown in the searchable result list. */
	readonly description: string;
	/** Directory-authored play style and emulator labels do not establish client compatibility. */
	readonly kind: string;
	/** Emulator family as reported by the directory. */
	readonly software: string;
	/** A reported population observation, never a live availability check. */
	readonly players: {
		/** Number observed at the reported time, including zero. */
		readonly count: number;
		/** Original provider timestamp shown beside the count to expose stale observations. */
		readonly updatedAt: string;
	} | null;
}
/** Main computes saved-endpoint membership after fetching, using the current launcher catalog. */
interface DirectoryServerView extends DirectoryServer {
	/** Matching endpoint already exists locally and cannot be added again. */
	readonly alreadyAdded: boolean;
}
/** Invalid rows are excluded individually and counted explicitly for the browsing UI. */
export interface ServerDirectory {
	/** Validated, deduplicated, alphabetically sorted entries with current import status. */
	readonly servers: readonly DirectoryServerView[];
	/** Rejected rows are visible as a count rather than silently disappearing. */
	readonly unavailableEntries: number;
}
