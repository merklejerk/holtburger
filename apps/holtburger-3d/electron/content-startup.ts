import { ContentStartupError } from "./host-protocol.js";
import type { SidecarHostClient } from "./host-protocol.js";
import { ContentPreferenceStore } from "./content-preference-store.js";
import type {
	ContentFailure,
	ContentStartupPhase,
	ContentStartupSnapshot,
} from "../src/app/content-startup-contract.js";

/** One process receives one explicit selection or a bounded discovery root. */
export type HostContentSelection =
	{ kind: "explicit"; path: string } | { kind: "automatic"; root: string };
/** Narrow host surface lets coordinator tests exercise actual lifecycle decisions. */
export type StartupHost = Pick<
	SidecarHostClient,
	| "connect"
	| "shutdown"
	| "completed"
	| "contentLocation"
	| "listenContentFailures"
>;

interface Dependencies<T extends StartupHost> {
	readonly store: ContentPreferenceStore;
	readonly overridePath: string | null;
	/** Launch-only restriction; saved and explicitly selected paths still work. */
	readonly noContentSearch: boolean;
	/** Explicitly forget the saved selection before applying ordinary launch precedence. */
	readonly clearContent: boolean;
	readonly portableRoot: string;
	readonly launch: (selection: HostContentSelection) => T;
	readonly admit: (host: T) => Promise<void>;
	readonly pickFolder: (previous: string | null) => Promise<string | null>;
}

/** Process ownership and diagnostic latch for exactly one startup attempt. */
interface Attempt<T extends StartupHost> {
	readonly host: T;
	/** A process may stop while event forwarding or preference writes are still pending. */
	termination: Awaited<StartupHost["completed"]> | null;
	failure: ContentFailure | null;
	admitted: boolean;
	detach: () => void;
}

function diagnostic(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Native startup policy; no renderer, archive parser, or game authority lives here. */
export class ContentStartup<T extends StartupHost> {
	readonly #dependencies: Dependencies<T>;
	readonly #listeners = new Set<(snapshot: ContentStartupSnapshot) => void>();
	#snapshot: ContentStartupSnapshot;
	#attempt: Attempt<T> | null = null;
	#operation: Promise<void> | null = null;
	#closing = false;
	#retryPersistence: (() => Promise<void>) | null = null;

	constructor(dependencies: Dependencies<T>) {
		this.#dependencies = dependencies;
		this.#snapshot = {
			revision: 0,
			temporary: dependencies.overridePath !== null,
			phase: {
				kind: "loading",
				location: dependencies.overridePath,
				message: "Locating client assets…",
			},
		};
	}

	get snapshot(): ContentStartupSnapshot {
		return this.#snapshot;
	}

	/** Only the admitted host accepts game IPC; setup never waits on a dangling ready promise. */
	get activeHost(): T | null {
		return this.#attempt?.admitted === true ? this.#attempt.host : null;
	}

	/** Subscribe synchronously; IPC snapshot reads use the same main-owned revision. */
	listen(listener: (snapshot: ContentStartupSnapshot) => void): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	/** Native setup failures use the same recoverable attempt surface as content failures. */
	fail(message: string): void {
		if (!this.#closing) this.#publish({ kind: "fatal", message });
	}

	start(): Promise<void> {
		return this.#run(async () => {
			if (this.#dependencies.clearContent) {
				await this.#persist(
					() => this.#dependencies.store.clear(),
					() => this.#startSelection(),
				);
				return;
			}
			await this.#startSelection();
		});
	}

	async #startSelection(): Promise<void> {
		if (this.#closing) return;
		if (this.#dependencies.overridePath !== null) {
			await this.#trySelection(
				{ kind: "explicit", path: this.#dependencies.overridePath },
				false,
			);
			return;
		}
		let saved;
		try {
			saved = await this.#dependencies.store.load();
		} catch (error) {
			this.#needsAssets({
				location: null,
				message: diagnostic(error),
			});
			return;
		}
		if (this.#closing) return;
		if (saved.kind === "selected") {
			if (saved.health.kind === "needs_attention") {
				this.#needsAssets({
					location: saved.location,
					message: saved.health.failure.message,
				});
				return;
			}
			await this.#trySelection(
				{ kind: "explicit", path: saved.location },
				true,
			);
		} else await this.#discover();
	}

	async #discover(): Promise<void> {
		if (this.#dependencies.noContentSearch) {
			this.#needsAssets({
				location: null,
				message: null,
			});
			return;
		}
		await this.#trySelection(
			{ kind: "automatic", root: this.#dependencies.portableRoot },
			false,
		);
	}

	retry(): Promise<void> {
		return this.#run(async () => {
			if (this.#retryPersistence !== null) {
				await this.#retryPersistence();
				return;
			}
			const phase = this.#snapshot.phase;
			if (phase.kind !== "needs_assets")
				throw new Error("Asset retry is unavailable");
			if (phase.location === null) await this.#discover();
			else
				await this.#trySelection(
					{ kind: "explicit", path: phase.location },
					false,
				);
		});
	}

	choose(): Promise<void> {
		return this.#run(async () => {
			const previous = this.#snapshot.phase;
			if (previous.kind !== "needs_assets")
				throw new Error("Asset selection is unavailable");
			this.#publish({ ...previous, choosing: true });
			const path = await this.#dependencies.pickFolder(previous.location);
			if (this.#closing) return;
			if (path === null) {
				this.#publish(previous);
				return;
			}
			await this.#trySelection({ kind: "explicit", path }, false);
		});
	}

	/** Closing cancels an in-flight handshake before joining the operation that waits for it. */
	async close(): Promise<void> {
		this.#closing = true;
		await this.#attempt?.host.shutdown();
		// A native folder picker can remain pending until app exit; its late result checks closing.
		await this.#dependencies.store.flush();
	}

	#run(operation: () => Promise<void>): Promise<void> {
		if (this.#closing)
			return Promise.reject(new Error("Application startup is closing"));
		if (this.#operation !== null)
			return Promise.reject(
				new Error("A startup operation is already running"),
			);
		const running = Promise.resolve()
			.then(() => (this.#closing ? undefined : operation()))
			.catch((error: unknown) => {
				if (!this.#closing)
					this.#publish({ kind: "fatal", message: diagnostic(error) });
			})
			.finally(() => {
				this.#operation = null;
			});
		this.#operation = running;
		return running;
	}

	async #retire(): Promise<void> {
		const attempt = this.#attempt;
		if (attempt === null) return;
		attempt.detach();
		await attempt.host.shutdown();
		if (this.#attempt === attempt) this.#attempt = null;
	}

	async #trySelection(
		selection: HostContentSelection,
		allowDiscovery: boolean,
	): Promise<void> {
		await this.#retire();
		if (this.#closing) return;
		this.#publish({
			kind: "loading",
			location: selection.kind === "explicit" ? selection.path : null,
			message: "Loading client assets…",
		});
		const host = this.#dependencies.launch(selection);
		const attempt: Attempt<T> = {
			host,
			termination: null,
			failure: null,
			admitted: false,
			detach: () => undefined,
		};
		this.#attempt = attempt;
		attempt.detach = host.listenContentFailures((failure) => {
			if (
				this.#attempt !== attempt ||
				attempt.failure !== null ||
				this.#closing
			)
				return;
			attempt.failure = failure;
			if (attempt.admitted) void this.#runtimeFailure(attempt, failure);
		});
		void host.completed.then(({ code, signal }) => {
			attempt.termination = { code, signal };
			if (this.#attempt === attempt && attempt.admitted && !this.#closing)
				this.#publish({
					kind: "fatal",
					message: `Host stopped unexpectedly (code=${code}, signal=${signal}).`,
				});
		});
		try {
			await host.connect();
		} catch (error) {
			if (this.#closing) return;
			await this.#retire();
			if (!(error instanceof ContentStartupError)) throw error;
			if (
				allowDiscovery &&
				!this.#dependencies.noContentSearch &&
				error.failure.kind === "selection" &&
				error.failure.reason === "absent"
			) {
				await this.#trySelection(
					{ kind: "automatic", root: this.#dependencies.portableRoot },
					false,
				);
				return;
			}
			const location = selection.kind === "explicit" ? selection.path : null;
			await this.#persist(
				async () => {
					if (!this.#snapshot.temporary && location !== null)
						await this.#dependencies.store.markFailure(location, error.failure);
				},
				() =>
					this.#needsAssets({
						location,
						message:
							selection.kind === "automatic" &&
							error.failure.kind === "selection" &&
							error.failure.reason === "absent"
								? null
								: error.failure.message,
					}),
			);
			return;
		}
		if (this.#closing) return;
		await this.#dependencies.admit(host);
		await this.#finishAdmission(attempt);
	}

	async #finishAdmission(attempt: Attempt<T>): Promise<void> {
		if (this.#closing) return;
		if (attempt.failure === null) this.#requireRunning(attempt);
		const location = attempt.host.contentLocation;
		await this.#persist(
			async () => {
				if (this.#snapshot.temporary) return;
				if (attempt.failure === null)
					await this.#dependencies.store.select(location);
				if (attempt.failure !== null)
					await this.#dependencies.store.markFailure(location, attempt.failure);
			},
			async () => {
				if (this.#closing || this.#attempt !== attempt) return;
				if (attempt.failure === null) this.#requireRunning(attempt);
				if (attempt.failure !== null) {
					await this.#retire();
					if (this.#closing) return;
					this.#needsAssets({
						location,
						message: attempt.failure.message,
					});
					return;
				}
				attempt.admitted = true;
				this.#publish({ kind: "ready", location });
			},
		);
	}

	#requireRunning(attempt: Attempt<T>): void {
		if (attempt.termination !== null) {
			const { code, signal } = attempt.termination;
			throw new Error(
				`Host stopped during startup (code=${code}, signal=${signal}).`,
			);
		}
	}

	async #runtimeFailure(
		attempt: Attempt<T>,
		failure: ContentFailure,
	): Promise<void> {
		const location = attempt.host.contentLocation;
		await this.#persist(
			async () => {
				if (!this.#snapshot.temporary)
					await this.#dependencies.store.markFailure(location, failure);
			},
			() => {
				if (!this.#closing && this.#attempt === attempt)
					this.#publish({
						kind: "restart_required",
						location,
						message: failure.message,
					});
			},
		);
	}

	async #persist(
		write: () => Promise<void>,
		complete: () => void | Promise<void>,
	): Promise<void> {
		const retry = async () => {
			try {
				await write();
			} catch (error) {
				if (!this.#closing)
					this.#publish({
						kind: "persistence_failed",
						message: `Could not save asset preferences: ${diagnostic(error)}`,
					});
				return;
			}
			this.#retryPersistence = null;
			await complete();
		};
		this.#retryPersistence = retry;
		await retry();
	}

	#needsAssets(phase: {
		location: string | null;
		message: string | null;
	}): void {
		this.#publish({
			kind: "needs_assets",
			choosing: false,
			...phase,
			canRetry: phase.location !== null || !this.#dependencies.noContentSearch,
		});
	}

	#publish(phase: ContentStartupPhase): void {
		this.#snapshot = {
			revision: this.#snapshot.revision + 1,
			temporary: this.#snapshot.temporary,
			phase,
		};
		for (const listener of this.#listeners) listener(this.#snapshot);
	}
}
