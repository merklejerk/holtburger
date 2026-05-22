type ProfileDetail = Record<string, unknown>;

type ProfileSample = {
	name: string;
	spanKind: "async" | "sync";
	durationMs: number;
	detail: ProfileDetail;
};

type TimedProfileSample = ProfileSample & {
	startedAtMs: number;
	endedAtMs: number;
};

type TimedProfileEvent = {
	name: string;
	atMs: number;
	detail: ProfileDetail;
};

type ProfileEventCount = {
	name: string;
	count: number;
	detail: ProfileDetail;
};

type ProfileSpanStats = {
	name: string;
	spanKind: "async" | "sync";
	count: number;
	totalMs: number;
	maxMs: number;
	avgMs: number;
};

type LongFrameSample = {
	frameMs: number;
	atMs: number;
};

type LongFrameContext = LongFrameSample & {
	windowStartMs: number;
	windowEndMs: number;
	topSpans: ProfileSample[];
	eventCounts: ProfileEventCount[];
};

type FrontendProfileSummary = {
	label: string;
	startedAt: string;
	stoppedAt: string;
	durationMs: number;
	longFrames: {
		count: number;
		maxFrameMs: number;
		samples: LongFrameSample[];
	};
	longFrameContexts: LongFrameContext[];
	topSyncSpans: ProfileSample[];
	topAsyncSpans: ProfileSample[];
	spanStats: ProfileSpanStats[];
	eventCounts: ProfileEventCount[];
};

const FRONTEND_PROFILE_ENV_KEY = "VITE_HOLTBURGER_FRONTEND_PROFILE";
const DEFAULT_LONG_FRAME_MS = 50;
const MAX_RECENT_SAMPLES = 20;
const MAX_EVENT_COUNTS = 20;
const MAX_SPAN_STATS = 50;
const MAX_LONG_FRAME_SAMPLES = 200;
const MAX_TIMELINE_SAMPLES = 5000;
const MAX_LONG_FRAME_CONTEXTS = 30;
const MAX_LONG_FRAME_CONTEXT_SPANS = 8;
const MAX_LONG_FRAME_CONTEXT_EVENTS = 8;

export interface FrontendProfiler {
	readonly enabled: boolean;
	recordEvent(name: string, detail?: ProfileDetail): void;
	recordFrameWork(name: string, detail?: ProfileDetail): void;
	recordDuration(name: string, durationMs: number, detail?: ProfileDetail): void;
	measureSync<T>(name: string, detail: ProfileDetail, work: () => T): T;
	measureAsync<T>(
		name: string,
		detail: ProfileDetail,
		work: () => Promise<T>,
	): Promise<T>;
	startCapture(): void;
	createSummary(): FrontendProfileSummary;
	dispose(): void;
}

class DisabledFrontendProfiler implements FrontendProfiler {
	readonly enabled = false;

	recordEvent(): void {
		// Profiling is intentionally inert when disabled.
	}

	recordFrameWork(): void {
		// Profiling is intentionally inert when disabled.
	}

	recordDuration(): void {
		// Profiling is intentionally inert when disabled.
	}

	measureSync<T>(_name: string, _detail: ProfileDetail, work: () => T): T {
		return work();
	}

	measureAsync<T>(
		_name: string,
		_detail: ProfileDetail,
		work: () => Promise<T>,
	): Promise<T> {
		return work();
	}

	startCapture(): void {
		// Nothing to reset.
	}

	createSummary(): FrontendProfileSummary {
		return createEmptySummary();
	}

	dispose(): void {
		// Nothing to release.
	}
}

class RecordingFrontendProfiler implements FrontendProfiler {
	readonly enabled = true;

	private readonly recentSyncSamples: ProfileSample[] = [];
	private readonly recentAsyncSamples: ProfileSample[] = [];
	private readonly timedSpans: TimedProfileSample[] = [];
	private readonly timedEvents: TimedProfileEvent[] = [];
	private readonly frameWork = new Map<string, ProfileEventCount>();
	private readonly spanStats = new Map<string, ProfileSpanStats>();
	private readonly eventCounts = new Map<string, ProfileEventCount>();
	private readonly observers: PerformanceObserver[] = [];
	private readonly longFrameMs: number;
	private readonly longFrameSamples: LongFrameSample[] = [];
	private readonly longFrameContexts: LongFrameContext[] = [];
	private longFrameCount = 0;
	private captureActive = false;
	private captureLabel = "profile-run";
	private captureStartedAtMs = window.performance.now();
	private captureStartedAtIso = new Date().toISOString();
	private frameId: number | null = null;
	private lastFrameAt: number | null = null;

	constructor({
		longFrameMs = DEFAULT_LONG_FRAME_MS,
	}: {
		longFrameMs?: number;
	} = {}) {
		this.longFrameMs = longFrameMs;
		this.installLongTaskObserver();
		this.startFrameMonitor();
	}

	recordEvent(name: string, detail: ProfileDetail = {}): void {
		const summarizedDetail = summarizeEventDetail(detail);
		this.recordTimedEvent(name, summarizedDetail);
		const key = createFrameWorkKey(name, summarizedDetail);
		const existing = this.eventCounts.get(key);
		if (existing) {
			existing.count += 1;
			return;
		}

		this.eventCounts.set(key, {
			name,
			count: 1,
			detail: summarizedDetail,
		});
	}

	recordFrameWork(name: string, detail: ProfileDetail = {}): void {
		const summarizedDetail = summarizeEventDetail(detail);
		this.recordTimedEvent(`frame-work.${name}`, summarizedDetail);
		const key = createEventKey(name, summarizedDetail);
		const existing = this.frameWork.get(key);
		if (existing) {
			existing.count += 1;
			existing.detail = mergeFrameWorkDetail(existing.detail, summarizedDetail);
			return;
		}

		this.frameWork.set(key, {
			name,
			count: 1,
			detail: summarizedDetail,
		});
	}

	recordDuration(
		name: string,
		durationMs: number,
		detail: ProfileDetail = {},
	): void {
		this.recordSpan("sync", name, durationMs, detail);
	}

	measureSync<T>(name: string, detail: ProfileDetail, work: () => T): T {
		const startedAt = window.performance.now();
		try {
			return work();
		} finally {
			const endedAt = window.performance.now();
			this.recordSpan(
				"sync",
				name,
				endedAt - startedAt,
				detail,
				startedAt,
				endedAt,
			);
		}
	}

	async measureAsync<T>(
		name: string,
		detail: ProfileDetail,
		work: () => Promise<T>,
	): Promise<T> {
		const startedAt = window.performance.now();
		try {
			return await work();
		} finally {
			const endedAt = window.performance.now();
			this.recordSpan(
				"async",
				name,
				endedAt - startedAt,
				detail,
				startedAt,
				endedAt,
			);
		}
	}

	startCapture(): void {
		this.captureActive = true;
		this.captureStartedAtMs = window.performance.now();
		this.captureStartedAtIso = new Date().toISOString();
		this.recentSyncSamples.length = 0;
		this.recentAsyncSamples.length = 0;
		this.spanStats.clear();
		this.eventCounts.clear();
		this.longFrameSamples.length = 0;
		this.longFrameContexts.length = 0;
		this.timedSpans.length = 0;
		this.timedEvents.length = 0;
		this.frameWork.clear();
		this.longFrameCount = 0;
		this.recordEvent("frontend-profile-capture-started");
	}

	createSummary(): FrontendProfileSummary {
		const stoppedAtMs = window.performance.now();
		const longFrames = [...this.longFrameSamples].sort(
			(left, right) => right.frameMs - left.frameMs,
		);
		return {
			label: this.captureLabel,
			startedAt: this.captureStartedAtIso,
			stoppedAt: new Date().toISOString(),
			durationMs: roundMs(stoppedAtMs - this.captureStartedAtMs),
			longFrames: {
				count: this.longFrameCount,
				maxFrameMs: roundMs(longFrames[0]?.frameMs ?? 0),
				samples: longFrames.slice(0, MAX_LONG_FRAME_SAMPLES).map((sample) => ({
					frameMs: roundMs(sample.frameMs),
					atMs: roundMs(sample.atMs - this.captureStartedAtMs),
				})),
			},
			longFrameContexts: this.sortedLongFrameContexts(),
			topSyncSpans: this.samplesByKind("sync"),
			topAsyncSpans: this.samplesByKind("async"),
			spanStats: this.sortedSpanStats(),
			eventCounts: this.sortedEventCounts(),
		};
	}

	dispose(): void {
		if (this.frameId !== null) {
			window.cancelAnimationFrame(this.frameId);
			this.frameId = null;
		}
		for (const observer of this.observers) {
			observer.disconnect();
		}
		this.observers.length = 0;
	}

	private recordSpan(
		spanKind: ProfileSample["spanKind"],
		name: string,
		durationMs: number,
		detail: ProfileDetail,
		startedAtMs = window.performance.now() - durationMs,
		endedAtMs = window.performance.now(),
	): void {
		const sample = { name, spanKind, durationMs, detail };
		const samples =
			spanKind === "sync" ? this.recentSyncSamples : this.recentAsyncSamples;
		samples.push(sample);
		samples.sort((left, right) => right.durationMs - left.durationMs);
		samples.length = Math.min(samples.length, MAX_RECENT_SAMPLES);
		this.recordTimedSpan({
			...sample,
			startedAtMs,
			endedAtMs,
		});
		this.recordSpanStats(spanKind, name, durationMs);
	}

	private recordSpanStats(
		spanKind: ProfileSample["spanKind"],
		name: string,
		durationMs: number,
	): void {
		const key = createSpanStatsKey(spanKind, name);
		const existing = this.spanStats.get(key);
		if (existing) {
			existing.count += 1;
			existing.totalMs += durationMs;
			existing.maxMs = Math.max(existing.maxMs, durationMs);
			existing.avgMs = existing.totalMs / existing.count;
			return;
		}

		this.spanStats.set(key, {
			name,
			spanKind,
			count: 1,
			totalMs: durationMs,
			maxMs: durationMs,
			avgMs: durationMs,
		});
	}

	private installLongTaskObserver(): void {
		if (!("PerformanceObserver" in window)) {
			return;
		}

		try {
			const observer = new PerformanceObserver((list) => {
				if (this.captureActive) {
					for (const entry of list.getEntries()) {
						this.recordDuration("browser.long-task", entry.duration, {});
					}
				}
			});
			observer.observe({ entryTypes: ["longtask"] });
			this.observers.push(observer);
		} catch {
			this.recordEvent("long-task-observer-unavailable");
		}
	}

	private startFrameMonitor(): void {
		const monitorFrame = (frameAt: number): void => {
			if (this.lastFrameAt !== null) {
				const frameMs = frameAt - this.lastFrameAt;
				if (this.captureActive) {
					this.recordFramePressure(frameMs);
				}
				if (frameMs >= this.longFrameMs) {
					if (this.captureActive) {
						this.recordLongFrame(frameMs, frameAt);
					}
				}
			}
			this.lastFrameAt = frameAt;
			this.frameId = window.requestAnimationFrame(monitorFrame);
		};
		this.frameId = window.requestAnimationFrame(monitorFrame);
	}

	private recordFramePressure(frameMs: number): void {
		if (this.frameWork.size === 0) {
			return;
		}

		const topWork = [...this.frameWork.values()]
			.sort((left, right) => right.count - left.count)
			.slice(0, MAX_LONG_FRAME_CONTEXT_EVENTS)
			.map((entry) => ({
				name: entry.name,
				count: entry.count,
				detail: entry.detail,
			}));
		this.recordTimedEvent("frame.pressure", {
			frameMs: roundMs(frameMs),
			work: topWork,
		});
		this.frameWork.clear();
	}

	private recordLongFrame(frameMs: number, atMs: number): void {
		this.longFrameCount += 1;
		this.longFrameSamples.push({ frameMs, atMs });
		this.longFrameSamples.sort((left, right) => right.frameMs - left.frameMs);
		this.longFrameSamples.length = Math.min(
			this.longFrameSamples.length,
			MAX_LONG_FRAME_SAMPLES,
		);
		this.longFrameContexts.push(this.createLongFrameContext(frameMs, atMs));
		this.longFrameContexts.sort((left, right) => right.frameMs - left.frameMs);
		this.longFrameContexts.length = Math.min(
			this.longFrameContexts.length,
			MAX_LONG_FRAME_CONTEXTS,
		);
	}

	private recordTimedSpan(sample: TimedProfileSample): void {
		this.timedSpans.push(sample);
		if (this.timedSpans.length > MAX_TIMELINE_SAMPLES) {
			this.timedSpans.splice(0, this.timedSpans.length - MAX_TIMELINE_SAMPLES);
		}
	}

	private recordTimedEvent(name: string, detail: ProfileDetail): void {
		this.timedEvents.push({
			name,
			atMs: window.performance.now(),
			detail,
		});
		if (this.timedEvents.length > MAX_TIMELINE_SAMPLES) {
			this.timedEvents.splice(0, this.timedEvents.length - MAX_TIMELINE_SAMPLES);
		}
	}

	private createLongFrameContext(
		frameMs: number,
		atMs: number,
	): LongFrameContext {
		const windowStartMs = atMs - frameMs;
		const windowEndMs = atMs;
		const spans = this.timedSpans
			.filter(
				(span) =>
					span.endedAtMs >= windowStartMs && span.startedAtMs <= windowEndMs,
			)
			.sort((left, right) => right.durationMs - left.durationMs)
			.slice(0, MAX_LONG_FRAME_CONTEXT_SPANS)
			.map((span) => ({
				name: span.name,
				spanKind: span.spanKind,
				durationMs: roundMs(span.durationMs),
				detail: summarizeEventDetail(span.detail),
			}));

		return {
			frameMs,
			atMs,
			windowStartMs,
			windowEndMs,
			topSpans: spans,
			eventCounts: this.countTimedEvents(windowStartMs, windowEndMs),
		};
	}

	private countTimedEvents(
		windowStartMs: number,
		windowEndMs: number,
	): ProfileEventCount[] {
		const counts = new Map<string, ProfileEventCount>();
		for (const event of this.timedEvents) {
			if (event.atMs < windowStartMs || event.atMs > windowEndMs) {
				continue;
			}

			const key = createEventKey(event.name, event.detail);
			const existing = counts.get(key);
			if (existing) {
				existing.count += 1;
				continue;
			}

			counts.set(key, {
				name: event.name,
				count: 1,
				detail: event.detail,
			});
		}
		return [...counts.values()]
			.sort((left, right) => right.count - left.count)
			.slice(0, MAX_LONG_FRAME_CONTEXT_EVENTS);
	}

	private samplesByKind(spanKind: ProfileSample["spanKind"]): ProfileSample[] {
		const samples =
			spanKind === "sync" ? this.recentSyncSamples : this.recentAsyncSamples;
		return samples.map((sample) => ({
			...sample,
			durationMs: roundMs(sample.durationMs),
		}));
	}

	private sortedEventCounts(): ProfileEventCount[] {
		return [...this.eventCounts.values()]
			.sort((left, right) => right.count - left.count)
			.slice(0, MAX_EVENT_COUNTS)
			.map((event) => ({
				name: event.name,
				count: event.count,
				detail: { ...event.detail },
			}));
	}

	private sortedLongFrameContexts(): LongFrameContext[] {
		return this.longFrameContexts.map((context) => ({
			frameMs: roundMs(context.frameMs),
			atMs: roundMs(context.atMs - this.captureStartedAtMs),
			windowStartMs: roundMs(context.windowStartMs - this.captureStartedAtMs),
			windowEndMs: roundMs(context.windowEndMs - this.captureStartedAtMs),
			topSpans: context.topSpans,
			eventCounts: context.eventCounts.map((event) => ({
				name: event.name,
				count: event.count,
				detail: { ...event.detail },
			})),
		}));
	}

	private sortedSpanStats(): ProfileSpanStats[] {
		return [...this.spanStats.values()]
			.sort((left, right) => right.totalMs - left.totalMs)
			.slice(0, MAX_SPAN_STATS)
			.map((stats) => ({
				name: stats.name,
				spanKind: stats.spanKind,
				count: stats.count,
				totalMs: roundMs(stats.totalMs),
				maxMs: roundMs(stats.maxMs),
				avgMs: roundMs(stats.avgMs),
			}));
	}
}

let activeFrontendProfiler: FrontendProfiler | null = null;

export function createFrontendProfiler(): FrontendProfiler {
	activeFrontendProfiler = isFrontendProfilingEnabled()
		? new RecordingFrontendProfiler()
		: new DisabledFrontendProfiler();

	return activeFrontendProfiler;
}

export function getActiveFrontendProfiler(): FrontendProfiler | null {
	return activeFrontendProfiler;
}

function isFrontendProfilingEnabled(): boolean {
	return (
		import.meta.env[FRONTEND_PROFILE_ENV_KEY] === "1" ||
		import.meta.env[FRONTEND_PROFILE_ENV_KEY] === "true"
	);
}

function roundMs(value: number): number {
	return Math.round(value * 100) / 100;
}

function summarizeEventDetail(detail: ProfileDetail): ProfileDetail {
	const summarized: ProfileDetail = {};
	for (const key of [
		"priority",
		"hydrationKind",
		"requestRevision",
		"requestCount",
		"assetKind",
		"geometryBytesBucket",
		"transferableBytesBucket",
		"payloadTransportKind",
		"byteLengthBucket",
		"preparedCount",
		"resultCount",
		"errorCount",
		"pendingCount",
		"activeCount",
		"queueLength",
		"byteLength",
		"geometryBytes",
		"transferableBytes",
		"frameMs",
		"work",
	]) {
		const value = detail[key];
		if (value !== undefined) {
			summarized[key] = value;
		}
	}
	return summarized;
}

function mergeFrameWorkDetail(
	left: ProfileDetail,
	right: ProfileDetail,
): ProfileDetail {
	const merged = { ...left };
	for (const [key, value] of Object.entries(right)) {
		if (typeof value === "number" && typeof merged[key] === "number") {
			merged[key] = merged[key] + value;
			continue;
		}
		merged[key] = value;
	}
	return merged;
}

function createEventKey(name: string, detail: ProfileDetail): string {
	return JSON.stringify([name, detail]);
}

function createFrameWorkKey(name: string, detail: ProfileDetail): string {
	return JSON.stringify([
		name,
		detail["priority"],
		detail["assetKind"],
		detail["byteLengthBucket"],
		detail["geometryBytesBucket"],
		detail["transferableBytesBucket"],
	]);
}

function createSpanStatsKey(
	spanKind: ProfileSample["spanKind"],
	name: string,
): string {
	return `${spanKind}:${name}`;
}

function createEmptySummary(): FrontendProfileSummary {
	const now = new Date().toISOString();
	return {
		label: "disabled",
		startedAt: now,
		stoppedAt: now,
		durationMs: 0,
		longFrames: {
			count: 0,
			maxFrameMs: 0,
			samples: [],
		},
		longFrameContexts: [],
		topSyncSpans: [],
		topAsyncSpans: [],
		spanStats: [],
		eventCounts: [],
	};
}
