/** Appraisal cooldown, single-slot timeout, refresh cadence, and health recency tuning. */
export interface ClientAppraisalTuningConfig {
	/** Server per-player cooldown between outgoing IdentifyObject requests, in milliseconds. */
	readonly assessmentRetryIntervalMs: number;
	/** Maximum wait before expiring an unanswered single-slot appraisal, in milliseconds. */
	readonly responseTimeoutMs: number;
	/** Periodic refresh cadence for active inspectors and interested nameplates, in milliseconds. */
	readonly refreshIntervalMs: number;
	/** Host-time window during which a mob health update stays visible on nameplates, in milliseconds. */
	readonly recentWindowMs: number;
}

/** Narrow single-slot pacing bounds validated by the native host at client startup. */
export type ClientHostAppraisalTuningConfig = Pick<
	ClientAppraisalTuningConfig,
	"assessmentRetryIntervalMs" | "responseTimeoutMs"
>;

/**
 * Single source of truth for appraisal pacing and recency bounds shared by Electron main
 * (validated by the native host at client startup) and browser client owners.
 */
export const CLIENT_APPRAISAL_TUNING = {
	assessmentRetryIntervalMs: 550,
	responseTimeoutMs: 3_000,
	refreshIntervalMs: 1_000,
	recentWindowMs: 5_000,
} as const satisfies ClientAppraisalTuningConfig;
