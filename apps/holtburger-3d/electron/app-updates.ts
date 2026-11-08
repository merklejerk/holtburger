import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { gt } from "semver";
import { APP_UPDATE_TUNING } from "../src/app/app-tuning.js";
import {
	appBuildSchema,
	type AppBuild,
} from "../src/app/app-build-contract.js";
import {
	type PregameRegistrationStatus,
	type UpdateSnapshot,
} from "../src/app/app-update-contract.js";
import {
	releaseHistoryFeedSchema,
	type ReleaseHistoryFeed,
} from "../src/app/release-history-contract.js";
import { formatError } from "../src/lib/format-error.js";

/** One native admission policy covers metadata loading and direct owner construction. */
function checkingBuild(build: AppBuild | null): AppBuild | null {
	return build === null ||
		build.development ||
		build.modified ||
		build.kind === "nightly"
		? null
		: build;
}

/** Optional update metadata failures must never prevent the installed app from starting. */
export function loadUpdateBuild(
	path: string,
	report: (message: string) => void,
): AppBuild | null {
	try {
		const build = appBuildSchema.parse(JSON.parse(readFileSync(path, "utf8")));
		return checkingBuild(build);
	} catch (error) {
		report(
			`Update checking disabled: invalid packaged build identity: ${formatError(error)}`,
		);
		return null;
	}
}

/** Process capabilities are injected so checks and browser opening can be exercised without GitHub. */
interface UpdateDependencies {
	/** Fixed-feed network access, owned by native code. */
	readonly request: typeof fetch;
	/** Elapsed scheduling clock; wall time in production includes machine suspend. */
	readonly now: () => number;
	/** Publish only cold update state to the current document. */
	readonly publish: (snapshot: UpdateSnapshot) => void;
	/** Native diagnostics remain observable even when the footer is absent. */
	readonly report: (message: string) => void;
	/** Main supplies Electron's system-browser opener. */
	readonly openExternal: (url: string) => Promise<void>;
}

/** One bounded request owns its cancellation, deadline and completion together. */
interface UpdateRequest {
	/** Clicks join an active refresh and observe its success or failure. */
	readonly completion: Promise<void>;
	/** Aborts both native fetch and the bounded read when optional work is retired. */
	readonly cancellation: AbortController;
	/** Native shutdown clears this timer synchronously. */
	readonly deadline: ReturnType<typeof setTimeout>;
}

/** Abort bounds body decoding as well as acquisition, even for a stalled response reader. */
function readUpdateFeed(
	request: typeof fetch,
	url: string,
	signal: AbortSignal,
): Promise<ReleaseHistoryFeed> {
	return new Promise((resolve, reject) => {
		const onAbort = () => reject(signal.reason);
		if (signal.aborted) {
			onAbort();
			return;
		}
		signal.addEventListener("abort", onAbort, { once: true });
		void (async () => {
			const response = await request(url, {
				signal,
				cache: "no-store",
				headers: { Accept: "application/json" },
				credentials: "omit",
			});
			if (!response.ok)
				throw new Error(`Update feed returned HTTP ${response.status}`);
			return releaseHistoryFeedSchema.parse(await response.json());
		})()
			.then(resolve, reject)
			.finally(() => signal.removeEventListener("abort", onAbort));
	});
}

/** Application-lived result and scheduling; document-scoped registrations describe pregame visibility. */
export class AppUpdates {
	readonly #build: AppBuild | null;
	readonly #dependencies: UpdateDependencies;
	readonly #pregame = new Map<string, boolean>();
	#snapshot: UpdateSnapshot = {
		revision: 0,
		availability: { kind: "unknown" },
		check: { kind: "idle" },
	};
	#request: UpdateRequest | null = null;
	#timer: ReturnType<typeof setTimeout> | null = null;
	#lastAttempt: number | null = null;
	#windowVisible = false;
	#started = false;
	#stopped = false;

	constructor(build: AppBuild | null, dependencies: UpdateDependencies) {
		this.#build = checkingBuild(build);
		if (this.#build === null) this.#snapshot.check = { kind: "disabled" };
		this.#dependencies = dependencies;
	}

	get snapshot(): UpdateSnapshot {
		return this.#snapshot;
	}

	/** Startup checks once regardless of which client screen will appear first. */
	start(): void {
		if (this.#started || this.#stopped) return;
		this.#started = true;
		this.#check();
	}

	registerPregame(visible: boolean): string {
		const token = randomUUID();
		this.#pregame.set(token, visible);
		this.#schedule();
		return token;
	}

	setPregameVisible(
		token: string,
		visible: boolean,
	): PregameRegistrationStatus {
		if (!this.#pregame.has(token)) return "retired";
		this.#pregame.set(token, visible);
		this.#schedule();
		return "active";
	}

	releasePregame(token: string): PregameRegistrationStatus {
		if (this.#pregame.delete(token)) this.#schedule();
		return "retired";
	}

	/** Native navigation/retirement clears every registration before another document is admitted. */
	clearPregame(): void {
		this.#pregame.clear();
		this.#schedule();
	}

	/** Also reevaluated on focus and system resume, even if visibility itself did not change. */
	setWindowVisible(visible: boolean): void {
		this.#windowVisible = visible;
		this.#schedule();
	}

	async openDownloads(): Promise<void> {
		if (this.#stopped || this.#snapshot.availability.kind === "unknown")
			throw new Error("No confirmed release downloads are available");
		await this.refresh();
		const availability = this.snapshot.availability;
		if (this.#stopped || availability.kind === "unknown")
			throw new Error("No confirmed release downloads are available");
		await this.#dependencies.openExternal(
			`${APP_UPDATE_TUNING.downloadsRootUrl}/${availability.releases[0].tag}`,
		);
	}

	/** History navigation is fixed to this repository, including when notes are incomplete. */
	openHistory(): Promise<void> {
		if (this.#stopped) throw new Error("Update checking has stopped");
		return this.#dependencies.openExternal(APP_UPDATE_TUNING.historyUrl);
	}

	/** Optional network work never joins native settings/host shutdown. */
	stop(): void {
		this.#stopped = true;
		this.#pregame.clear();
		if (this.#timer !== null) clearTimeout(this.#timer);
		this.#timer = null;
		if (this.#request !== null) {
			clearTimeout(this.#request.deadline);
			this.#request.cancellation.abort(
				new Error("Update check stopped during application shutdown"),
			);
		}
	}

	#schedule(): void {
		if (this.#timer !== null) clearTimeout(this.#timer);
		this.#timer = null;
		if (
			this.#stopped ||
			!this.#started ||
			this.#build === null ||
			this.#request !== null ||
			!this.#windowVisible ||
			![...this.#pregame.values()].some(Boolean)
		)
			return;
		// A backward wall-clock correction postpones a check without overflowing native timers.
		const remaining =
			this.#lastAttempt === null
				? 0
				: Math.max(
						0,
						APP_UPDATE_TUNING.checkIntervalMs -
							Math.max(0, this.#dependencies.now() - this.#lastAttempt),
					);
		if (remaining === 0) this.#check();
		else this.#timer = setTimeout(() => this.#schedule(), remaining);
	}

	#check(): void {
		void this.refresh().catch((error: unknown) => {
			if (!this.#stopped)
				this.#dependencies.report(`Update check failed: ${formatError(error)}`);
		});
	}

	/** Modal retries and download actions bypass the hourly interval and share any active request. */
	refresh(): Promise<void> {
		if (this.#request !== null) return this.#request.completion;
		const build = this.#build;
		if (build === null || this.#stopped) return Promise.resolve();
		this.#lastAttempt = this.#dependencies.now();
		const cancellation = new AbortController();
		const deadline = setTimeout(
			() => cancellation.abort(new Error("Update check timed out")),
			APP_UPDATE_TUNING.requestTimeoutMs,
		);
		// Defer work until the request resource is installed, including synchronous fetch failures.
		const completion = Promise.resolve().then(async () => {
			try {
				const feed = await readUpdateFeed(
					this.#dependencies.request,
					`${APP_UPDATE_TUNING.feedRootUrl}/v2/${build.channel}.json`,
					cancellation.signal,
				);
				if (!this.#stopped) {
					const newer = feed.releases.filter((release) =>
						gt(release.version, build.version),
					);
					const [first, ...rest] = newer;
					this.#publish({
						revision: this.#snapshot.revision + 1,
						check: { kind: "ready" },
						availability:
							first === undefined
								? {
										kind: "current",
										releases: [feed.releases[0]],
									}
								: {
										kind: "available",
										releases: [first, ...rest],
										historyIncomplete:
											feed.omittedVersion !== null &&
											gt(feed.omittedVersion, build.version),
									},
					});
				}
			} catch (error) {
				if (!this.#stopped)
					this.#publish({
						...this.#snapshot,
						revision: this.#snapshot.revision + 1,
						check: { kind: "failed", message: formatError(error) },
					});
				throw error;
			} finally {
				clearTimeout(deadline);
				this.#request = null;
				this.#schedule();
			}
		});
		this.#request = { cancellation, deadline, completion };
		this.#publish({
			...this.#snapshot,
			revision: this.#snapshot.revision + 1,
			check: { kind: "loading" },
		});
		return completion;
	}

	#publish(snapshot: UpdateSnapshot): void {
		this.#snapshot = snapshot;
		this.#dependencies.publish(snapshot);
	}
}
