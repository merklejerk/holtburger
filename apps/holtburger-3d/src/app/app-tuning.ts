/**
 * App-shell policy shared by native owners without renderer dependencies.
 * Keep compatibility constants and wire-format limits beside their implementations.
 * Changing a tuning value must not require changing test expectations.
 */
/** App-shell update policy, consumed by Electron without renderer dependencies. */
export const APP_UPDATE_TUNING = {
	/** Channel JSON documents live beneath this URL; omit the trailing slash. */
	feedRootUrl: "https://merklejerk.github.io/holtburger/updates",
	/** Confirmed release tags append to this URL; omit the trailing slash. */
	downloadsRootUrl: "https://github.com/merklejerk/holtburger/releases/tag",
	/** Minimum time between attempts while the launcher or pregame is visible. */
	checkIntervalMs: 60 * 60 * 1000,
	/** Deadline covers both requesting the feed and reading its body. */
	requestTimeoutMs: 5 * 1000,
} as const;

/** Native window defaults; saved geometry takes precedence over initial sizes. */
export const APP_WINDOW_TUNING = {
	/** Native background shown before renderer content paints. */
	backgroundColor: "#0b0a08",
	/** Launcher geometry is independent of the game viewport and its saved bounds. */
	launcher: {
		/** Initial launcher content dimensions in CSS pixels. */
		initialContentSize: Object.freeze({ width: 900, height: 650 }),
		/** Minimum launcher window dimensions in CSS pixels. */
		minimumSize: Object.freeze({ width: 680, height: 520 }),
	},
	/** Game and Explorer windows share these viewport defaults. */
	game: {
		/** Initial viewport dimensions in CSS pixels. */
		initialContentSize: Object.freeze({ width: 1440, height: 900 }),
		/** Minimum game window dimensions in CSS pixels. */
		minimumSize: Object.freeze({ width: 1100, height: 700 }),
	},
} as const;

/** Background persistence cadence; final retirement still flushes pending writes. */
export const APP_PERSISTENCE_TUNING = {
	/** Debounce native resize/maximize events before saving window geometry. */
	windowGeometryWriteDelayMs: 250,
	/** Debounce captured player-visual cache writes. */
	visualCacheWriteDelayMs: 500,
} as const;

/** Native lifecycle deadlines, independent of negotiated protocol identity and limits. */
export const APP_LIFECYCLE_TUNING = {
	/** Bounds renderer close preparation only; native disk flush is separate. */
	rendererClosePreparationTimeoutMs: 5_000,
	/** Startup bound for a spawned sidecar that never produces a handshake. */
	sidecarHandshakeTimeoutMs: 15_000,
	/** Grace before terminating a sidecar that ignored shutdown. */
	sidecarShutdownGraceMs: 2_000,
} as const;

/** Public server-browser service policy; renderer callers cannot supply fetch URLs. */
export const APP_SERVER_DIRECTORY_TUNING = {
	/** TreeStats server directory consumed by the native catalog. */
	url: "https://treestats.net/servers.json",
	/** Deadline for the directory request. */
	requestTimeoutMs: 10_000,
} as const;
