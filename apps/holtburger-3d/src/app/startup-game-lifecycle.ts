import type { ClientClosePreparation } from "../client/client-close-contract";

/** Game construction and close delegation span the interval before ClientApp registers cleanup. */
export class StartupGameLifecycle {
	readonly #mode: "client" | "explorer";
	readonly #registrationWaiters = new Set<{
		resolve: () => void;
		reject: (error: Error) => void;
	}>();
	#mountFailure: Error | null = null;
	#cleanup: (() => Promise<ClientClosePreparation>) | null = null;
	#closing = false;
	#mount: Promise<void> | null = null;
	#close: Promise<ClientClosePreparation> | null = null;

	constructor(mode: "client" | "explorer") {
		this.#mode = mode;
	}

	/** Starts at most once; a close arriving before admission prevents construction entirely. */
	start(mount: (isClosing: () => boolean) => Promise<boolean>): Promise<void> {
		if (this.#mount !== null) return this.#mount;
		if (this.#closing) return Promise.resolve();
		this.#mount = Promise.resolve().then(async () => {
			if (this.#closing) return;
			const mounted = await mount(() => this.#closing);
			if (this.#mountFailure !== null) throw this.#mountFailure;
			if (mounted && this.#mode === "client" && this.#cleanup === null)
				await new Promise<void>((resolve, reject) => {
					this.#registrationWaiters.add({ resolve, reject });
				});
		});
		return this.#mount;
	}

	/** Client cleanup is installed synchronously during its initial mount effects. */
	registerCleanup(handler: () => Promise<ClientClosePreparation>): () => void {
		if (this.#cleanup !== null)
			throw new Error("Game cleanup is already registered");
		this.#cleanup = handler;
		for (const { resolve } of this.#registrationWaiters) resolve();
		this.#registrationWaiters.clear();
		return () => {
			if (this.#cleanup === handler) this.#cleanup = null;
		};
	}

	/** A failed mount effect cannot leave close waiting forever for cleanup registration. */
	failMount(error: Error): void {
		this.#mountFailure = error;
		for (const { reject } of this.#registrationWaiters) reject(error);
		this.#registrationWaiters.clear();
	}

	/** Joins in-flight settings/mount work before invoking the game delegate exactly once. */
	prepareClose(): Promise<ClientClosePreparation> {
		this.#closing = true;
		return (this.#close ??= this.#prepare());
	}

	async #prepare(): Promise<ClientClosePreparation> {
		const failures: string[] = [];
		try {
			await this.#mount;
		} catch (error) {
			failures.push(error instanceof Error ? error.message : String(error));
		}
		try {
			const prepared =
				this.#cleanup === null
					? { kind: "prepared" as const }
					: await this.#cleanup();
			if (prepared.kind === "failed") failures.push(prepared.diagnostic);
		} catch (error) {
			failures.push(error instanceof Error ? error.message : String(error));
		}
		return failures.length === 0
			? { kind: "prepared" }
			: { kind: "failed", diagnostic: failures.join("; ") };
	}
}
