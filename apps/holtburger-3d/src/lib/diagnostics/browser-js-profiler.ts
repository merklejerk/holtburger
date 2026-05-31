interface BrowserJsProfilerSample {
	count: number;
	totalMs: number;
	maxMs: number;
	lastMs: number;
}

interface BrowserJsProfilerActiveScope {
	id: number;
	label: string;
	startedAt: number;
}

export interface BrowserJsProfilerControl {
	enable(): void;
	disable(): void;
	reset(): void;
	flush(): void;
	isEnabled(): boolean;
}

declare global {
	interface Window {
		holtburgerJsProfiler?: BrowserJsProfilerControl;
	}
}

const PROFILE_QUERY_PARAMS = ["holtburgerProfile", "holtburgerJsProfile"];

const samplesByLabel = new Map<string, BrowserJsProfilerSample>();
const activeScopes = new Map<number, BrowserJsProfilerActiveScope>();
let enabled = readInitialEnabledState();
let lastReportAt = nowMs();
let nextActiveScopeId = 1;

export const browserJsProfiler: BrowserJsProfilerControl = {
	enable() {
		enabled = true;
		console.info("[holtburger-3d][js-profile] enabled");
	},
	disable() {
		flushBrowserJsProfile();
		enabled = false;
		console.info("[holtburger-3d][js-profile] disabled");
	},
	reset() {
		samplesByLabel.clear();
		activeScopes.clear();
		lastReportAt = nowMs();
		console.info("[holtburger-3d][js-profile] reset");
	},
	flush() {
		flushBrowserJsProfile();
	},
	isEnabled() {
		return enabled;
	},
};

installBrowserJsProfilerControl();

export function profileBrowserJsScope<T>(label: string, action: () => T): T {
	if (!enabled) {
		return action();
	}
	const startedAt = nowMs();
	try {
		return action();
	} finally {
		recordBrowserJsProfileSample(label, nowMs() - startedAt);
	}
}

export async function profileBrowserJsScopeAsync<T>(
	label: string,
	action: () => Promise<T>,
): Promise<T> {
	if (!enabled) {
		return action();
	}
	const startedAt = nowMs();
	const activeScopeId = startActiveScope(label, startedAt);
	try {
		return await action();
	} finally {
		activeScopes.delete(activeScopeId);
		recordBrowserJsProfileSample(label, nowMs() - startedAt);
	}
}

export function recordBrowserJsProfileSample(
	label: string,
	durationMs: number,
): void {
	if (!enabled) {
		return;
	}
	const sample = samplesByLabel.get(label) ?? {
		count: 0,
		totalMs: 0,
		maxMs: 0,
		lastMs: 0,
	};
	sample.count += 1;
	sample.totalMs += durationMs;
	sample.maxMs = Math.max(sample.maxMs, durationMs);
	sample.lastMs = durationMs;
	samplesByLabel.set(label, sample);
}

function flushBrowserJsProfile(): void {
	if (samplesByLabel.size === 0 && activeScopes.size === 0) {
		lastReportAt = nowMs();
		return;
	}

	const activeSummaries = summarizeActiveScopes(nowMs());
	const rows = [
		...new Set([...samplesByLabel.keys(), ...activeSummaries.keys()]),
	]
		.map((label) => {
			const sample = samplesByLabel.get(label);
			const active = activeSummaries.get(label);
			return {
				label,
				count: sample?.count ?? 0,
				active: active?.count ?? 0,
				activeMaxMs: roundMs(active?.maxMs ?? 0),
				totalMs: roundMs(sample?.totalMs ?? 0),
				avgMs: sample ? roundMs(sample.totalMs / sample.count) : 0,
				maxMs: roundMs(sample?.maxMs ?? 0),
				lastMs: roundMs(sample?.lastMs ?? 0),
			};
		})
		.sort(
			(left, right) =>
				right.activeMaxMs - left.activeMaxMs || right.totalMs - left.totalMs,
		);
	console.groupCollapsed(
		`[holtburger-3d][js-profile] ${rows.length} scopes over ${roundMs(
			nowMs() - lastReportAt,
		)} ms`,
	);
	console.table(rows);
	console.groupEnd();
	samplesByLabel.clear();
	lastReportAt = nowMs();
}

function startActiveScope(label: string, startedAt: number): number {
	const id = nextActiveScopeId;
	nextActiveScopeId += 1;
	activeScopes.set(id, { id, label, startedAt });
	return id;
}

function summarizeActiveScopes(
	currentTimeMs: number,
): Map<string, { count: number; maxMs: number }> {
	const summaries = new Map<string, { count: number; maxMs: number }>();
	for (const scope of activeScopes.values()) {
		const elapsedMs = currentTimeMs - scope.startedAt;
		const summary = summaries.get(scope.label) ?? { count: 0, maxMs: 0 };
		summary.count += 1;
		summary.maxMs = Math.max(summary.maxMs, elapsedMs);
		summaries.set(scope.label, summary);
	}
	return summaries;
}

function installBrowserJsProfilerControl(): void {
	if (typeof window === "undefined") {
		return;
	}
	window.holtburgerJsProfiler = browserJsProfiler;
	if (enabled) {
		console.info(
			"[holtburger-3d][js-profile] enabled; use window.holtburgerJsProfiler.flush() to print the current sample.",
		);
	}
}

function readInitialEnabledState(): boolean {
	if (typeof window === "undefined") {
		return false;
	}
	const params = new URLSearchParams(window.location.search);
	for (const param of PROFILE_QUERY_PARAMS) {
		const value = params.get(param);
		if (value === "1" || value === "true") {
			return true;
		}
		if (value === "0" || value === "false") {
			return false;
		}
	}
	return false;
}

function nowMs(): number {
	return globalThis.performance?.now() ?? Date.now();
}

function roundMs(value: number): number {
	return Math.round(value * 100) / 100;
}
