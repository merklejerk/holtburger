import {
	UI_THEME_LOAD_TIMEOUT_MS,
	type UiThemeTransport,
} from "./ui-theme-contract";

/** Previous choices remain usable when a catalog refresh fails. */
type ThemeCatalogState =
	| { readonly kind: "ready" | "loading"; readonly ids: readonly string[] }
	| {
			readonly kind: "failed";
			readonly ids: readonly string[];
			readonly message: string;
	  };

/** Active appearance can differ from the preferred ID during startup recovery. */
type ThemeSelectionState =
	| { readonly kind: "ready"; readonly activeId: string | null }
	| {
			readonly kind: "loading";
			readonly activeId: string | null;
			readonly requestedId: string | null;
	  }
	| {
			readonly kind: "failed";
			readonly activeId: string | null;
			readonly requestedId: string | null;
			readonly message: string;
	  };

/** Cold snapshots consumed only by theme controls. */
export interface UiThemeState {
	readonly catalog: ThemeCatalogState;
	readonly selection: ThemeSelectionState;
}

/** Stylesheet lifetime stays in the existing document-owned loader. */
interface ThemeLoader {
	replace(
		url: string | null,
		override: null,
		signal: AbortSignal,
	): Promise<void>;
}

/** A shared settings capability keeps pregame and gameplay controls on one owner. */
export interface UiThemeSettings {
	readonly owner: UiThemeSelection;
	readonly select: (id: string | null) => Promise<void>;
}

/** Bound IPC waits as well as stylesheet waits; late IPC responses cannot start a load. */
function abortable<Value>(
	work: Promise<Value>,
	signal: AbortSignal,
): Promise<Value> {
	return new Promise((resolve, reject) => {
		const abort = () => reject(signal.reason);
		signal.addEventListener("abort", abort, { once: true });
		work.then(
			(value) => {
				signal.removeEventListener("abort", abort);
				if (signal.aborted) reject(signal.reason);
				else resolve(value);
			},
			(error: unknown) => {
				signal.removeEventListener("abort", abort);
				reject(error);
			},
		);
		if (signal.aborted) abort();
	});
}

/** One serial owner spans bootstrap and settings; it never constructs presentation owners. */
export class UiThemeSelection {
	readonly #transport: UiThemeTransport;
	readonly #loader: ThemeLoader;
	readonly #lifetime: AbortSignal | undefined;
	readonly #abort = () => {
		void this.retire();
	};
	readonly #listeners = new Set<(state: UiThemeState) => void>();
	#state: UiThemeState;
	#queue = Promise.resolve();
	#retired = false;
	#operation: AbortController | null = null;

	constructor(
		transport: UiThemeTransport,
		loader: ThemeLoader,
		lifetime?: AbortSignal,
	) {
		this.#transport = transport;
		this.#state = {
			catalog: { kind: "ready", ids: transport.initialIds },
			selection: { kind: "ready", activeId: null },
		};
		this.#loader = loader;
		this.#lifetime = lifetime;
		lifetime?.addEventListener("abort", this.#abort, { once: true });
		if (lifetime?.aborted) void this.retire();
	}

	read(): UiThemeState {
		return this.#state;
	}
	subscribe(listener: (state: UiThemeState) => void): () => void {
		this.#listeners.add(listener);
		listener(this.#state);
		return () => {
			this.#listeners.delete(listener);
		};
	}
	#publish(state: UiThemeState): void {
		if (this.#retired) return;
		this.#state = state;
		for (const listener of this.#listeners) listener(state);
	}
	#enqueue(work: () => Promise<boolean>): Promise<boolean> {
		const result = this.#queue.then(() => (this.#retired ? false : work()));
		this.#queue = result.then(
			() => {},
			() => {},
		);
		return result;
	}
	async #run<Value>(
		work: (signal: AbortSignal) => Promise<Value>,
	): Promise<Value> {
		const controller = new AbortController();
		this.#operation = controller;
		const timer = setTimeout(
			() => controller.abort(new Error("Theme operation timed out")),
			UI_THEME_LOAD_TIMEOUT_MS,
		);
		try {
			return await abortable(work(controller.signal), controller.signal);
		} finally {
			clearTimeout(timer);
			this.#operation = null;
		}
	}

	/** Catalog refresh never changes the current or remembered theme. */
	refresh(): Promise<boolean> {
		return this.#enqueue(async () => {
			const ids = this.#state.catalog.ids;
			this.#publish({ ...this.#state, catalog: { kind: "loading", ids } });
			try {
				const next = await this.#run(() => this.#transport.list());
				this.#publish({
					...this.#state,
					catalog: { kind: "ready", ids: next },
				});
				return !this.#retired;
			} catch (error) {
				this.#publish({
					...this.#state,
					catalog: { kind: "failed", ids, message: String(error) },
				});
				return false;
			}
		});
	}

	/** True authorizes the caller to commit the ID into its latest settings snapshot. */
	select(id: string | null): Promise<boolean> {
		return this.#enqueue(async () => {
			const activeId = this.#state.selection.activeId;
			this.#publish({
				...this.#state,
				selection: { kind: "loading", activeId, requestedId: id },
			});
			try {
				await this.#run(async (signal) => {
					const url =
						id === null
							? null
							: await abortable(this.#transport.resolve(id), signal);
					signal.throwIfAborted();
					await this.#loader.replace(url, null, signal);
				});
				this.#publish({
					...this.#state,
					selection: { kind: "ready", activeId: id },
				});
				return !this.#retired;
			} catch (error) {
				this.#publish({
					...this.#state,
					selection: {
						kind: "failed",
						activeId,
						requestedId: id,
						message: String(error),
					},
				});
				return false;
			}
		});
	}

	/** Folder-opening errors belong to the initiating UI; no gameplay capability is involved. */
	openDirectory(): Promise<void> {
		return this.#transport.openDirectory();
	}

	/** Withdrawal is synchronous; close may join the drain alongside existing settings flushes. */
	retire(): Promise<void> {
		this.#retired = true;
		this.#lifetime?.removeEventListener("abort", this.#abort);
		this.#operation?.abort();
		this.#listeners.clear();
		return this.#queue;
	}
}
