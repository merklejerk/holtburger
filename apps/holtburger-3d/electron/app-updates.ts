import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { gt } from "semver";
import {
	appBuildSchema,
	type AppBuild,
} from "../src/app/app-build-contract.js";
import {
	updateFeedSchema,
	type UpdateFeed,
	type PregameRegistrationStatus,
	type UpdateSnapshot,
} from "../src/app/app-update-contract.js";
import { formatError } from "../src/lib/format-error.js";

export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
export const UPDATE_CHECK_TIMEOUT_MS = 5 * 1000;
const UPDATE_FEED_ROOT = "https://merklejerk.github.io/holtburger/updates";
const DOWNLOADS_ROOT = "https://github.com/merklejerk/holtburger/releases/tag/";

/** Optional update metadata failures must never prevent the installed app from starting. */
export function loadUpdateBuild(
	path: string,
	report: (message: string) => void,
): AppBuild | null {
	try {
		const build = appBuildSchema.parse(JSON.parse(readFileSync(path, "utf8")));
		return build.development || build.modified ? null : build;
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
): Promise<UpdateFeed> {
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
				headers: { Accept: "application/json" },
				credentials: "omit",
			});
			if (!response.ok)
				throw new Error(`Update feed returned HTTP ${response.status}`);
			return updateFeedSchema.parse(await response.json());
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
		diagnostic: null,
	};
	#request: UpdateRequest | null = null;
	#timer: ReturnType<typeof setTimeout> | null = null;
	#lastAttempt: number | null = null;
	#windowVisible = false;
	#started = false;
	#stopped = false;

	constructor(build: AppBuild | null, dependencies: UpdateDependencies) {
		this.#build = build;
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
		const availability = this.#snapshot.availability;
		if (availability.kind !== "available")
			throw new Error("No confirmed update downloads are available");
		await this.#dependencies.openExternal(
			`${DOWNLOADS_ROOT}${availability.tag}`,
		);
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
						UPDATE_CHECK_INTERVAL_MS -
							Math.max(0, this.#dependencies.now() - this.#lastAttempt),
					);
		if (remaining === 0) this.#check();
		else this.#timer = setTimeout(() => this.#schedule(), remaining);
	}

	#check(): void {
		const build = this.#build;
		if (build === null || this.#stopped || this.#request !== null) return;
		this.#lastAttempt = this.#dependencies.now();
		const cancellation = new AbortController();
		const deadline = setTimeout(
			() => cancellation.abort(new Error("Update check timed out")),
			UPDATE_CHECK_TIMEOUT_MS,
		);
		// Defer work until the request resource is installed, including synchronous fetch failures.
		void Promise.resolve().then(async () => {
			try {
				const feed = await readUpdateFeed(
					this.#dependencies.request,
					`${UPDATE_FEED_ROOT}/${build.channel}.json`,
					cancellation.signal,
				);
				if (!this.#stopped)
					this.#publish({
						revision: this.#snapshot.revision + 1,
						availability: gt(feed.version, build.version)
							? { kind: "available", version: feed.version, tag: feed.tag }
							: { kind: "current" },
						diagnostic: null,
					});
			} catch (error) {
				if (!this.#stopped) {
					const diagnostic = `Update check failed: ${formatError(error)}`;
					this.#dependencies.report(diagnostic);
					this.#publish({
						...this.#snapshot,
						revision: this.#snapshot.revision + 1,
						diagnostic,
					});
				}
			} finally {
				clearTimeout(deadline);
				this.#request = null;
				this.#schedule();
			}
		});
		this.#request = { cancellation, deadline };
	}

	#publish(snapshot: UpdateSnapshot): void {
		this.#snapshot = snapshot;
		this.#dependencies.publish(snapshot);
	}
}
