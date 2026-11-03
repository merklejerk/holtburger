/** Maximum renderer requests awaiting one sidecar response. */
export const MAX_PENDING_REQUESTS = 512;

/** Shared content budget; control requests retain headroom below the emergency ceiling. */
export const MAX_CONCURRENT_CONTENT_REQUESTS = 32;
