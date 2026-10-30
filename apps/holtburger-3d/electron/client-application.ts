import type { ClientLaunchConfiguration } from "./client-launch.js";
import { clientFailureDiagnostic } from "../src/client/client-close-contract.js";

/** One attempt owns resources that cannot be reused after retirement. */
export interface ApplicationAttempt {
	readonly cancellation: AbortController;
}
/** App admission and attempt ownership are one fact; an admitted session always has its attempt. */
type ApplicationState<T> =
	| { readonly kind: "picker" }
	| {
			readonly kind: "starting" | "retiring" | "quitting";
			readonly attempt: T | null;
	  }
	| { readonly kind: "session"; readonly attempt: T };
interface Dependencies<T extends ApplicationAttempt> {
	/** Without the launcher, leaving an attempt is terminal for the application. */
	readonly launcherEnabled: boolean;
	readonly create: (configuration: ClientLaunchConfiguration) => T;
	readonly initialize: (attempt: T) => Promise<void>;
	readonly retire: (attempt: T) => Promise<void>;
	readonly showPicker: (diagnostic: string | null) => Promise<void>;
	readonly flushLauncher: () => Promise<void>;
	readonly exit: (failures: readonly string[]) => void;
	readonly report: (diagnostic: string) => void;
}

/** Serializes Play/return/Quit without resetting one-shot game owners or overlapping attempts. */
export class ClientApplication<T extends ApplicationAttempt> {
	readonly #dependencies: Dependencies<T>;
	#state: ApplicationState<T> = { kind: "picker" };
	#initialization: Promise<void> = Promise.resolve();
	#retirement: Promise<void> | null = null;
	#quit: Promise<void> | null = null;
	#launch: Promise<void> = Promise.resolve();
	/** Preserve the failure that caused a launcher-free session to exit. */
	#exitFailure: string | null = null;

	constructor(dependencies: Dependencies<T>) {
		this.#dependencies = dependencies;
	}
	get phase(): ApplicationState<T>["kind"] {
		return this.#state.kind;
	}
	get attempt(): T | null {
		return this.#state.kind === "picker" ? null : this.#state.attempt;
	}
	get canPlay(): boolean {
		return this.#state.kind === "picker";
	}

	/** Acknowledge admission separately from long-running initialization and document navigation. */
	play(resolve: () => Promise<ClientLaunchConfiguration>): Promise<void> {
		if (!this.canPlay)
			return Promise.reject(
				new Error("A game attempt is already active or retiring"),
			);
		this.#state = { kind: "starting", attempt: null };
		this.#retirement = null;
		const launching = Promise.resolve().then(async () => {
			const configuration = await resolve();
			if (this.#state.kind !== "starting") {
				configuration.password = "";
				return;
			}
			const attempt = this.#dependencies.create(configuration);
			this.#state = { kind: "starting", attempt };
			this.#initialization = Promise.resolve()
				.then(() => this.#dependencies.initialize(attempt))
				.then(() => {
					if (
						this.#state.kind === "starting" &&
						this.#state.attempt === attempt
					)
						this.#state = { kind: "session", attempt };
				})
				.catch((error: unknown) => {
					if (!attempt.cancellation.signal.aborted) {
						void this.back(clientFailureDiagnostic(error)).catch(() => {
							/* back has already reported the retirement failure. */
						});
					}
				});
		});
		this.#launch = launching.catch(() => {});
		return launching.catch((error: unknown) => {
			if (this.#state.kind === "starting") this.#state = { kind: "picker" };
			throw error;
		});
	}
	back(diagnostic: string | null): Promise<void> {
		if (this.#state.kind === "quitting") return this.#quit ?? Promise.resolve();
		if (!this.#dependencies.launcherEnabled) {
			this.#exitFailure = diagnostic;
			return this.quit();
		}
		if (this.#retirement !== null) return this.#retirement;
		this.#state = { kind: "retiring", attempt: this.attempt };
		this.#state.attempt?.cancellation.abort();
		const retirement = this.#retire()
			.then(async () => {
				if (this.#state.kind === "quitting") return;
				this.#state = { kind: "picker" };
				await this.#dependencies.showPicker(diagnostic);
			})
			.catch((error: unknown) => {
				this.#dependencies.report(clientFailureDiagnostic(error));
				if (this.#state.kind !== "quitting" && this.#retirement === retirement)
					this.#state = { kind: "retiring", attempt: this.attempt };
				throw error;
			});
		this.#retirement = retirement;
		return retirement;
	}
	async #retire(): Promise<void> {
		await this.#launch;
		const attempt = this.attempt;
		if (attempt !== null) {
			attempt.cancellation.abort();
			await this.#dependencies.retire(attempt);
			await this.#initialization;
			if (this.#state.kind === "quitting" || this.#state.kind === "retiring")
				this.#state = { kind: this.#state.kind, attempt: null };
		}
	}
	/** Quit is terminal and joins any return already in progress before flushing app persistence. */
	quit(): Promise<void> {
		if (this.#quit !== null) return this.#quit;
		this.#state = { kind: "quitting", attempt: this.attempt };
		this.#state.attempt?.cancellation.abort();
		this.#quit = Promise.resolve().then(async () => {
			const failures: string[] =
				this.#exitFailure === null ? [] : [this.#exitFailure];
			const results = await Promise.allSettled([
				this.#retirement ?? this.#retire(),
				this.#dependencies.flushLauncher(),
			]);
			for (const result of results)
				if (result.status === "rejected")
					failures.push(clientFailureDiagnostic(result.reason));
			this.#dependencies.exit(failures);
		});
		return this.#quit;
	}
}
