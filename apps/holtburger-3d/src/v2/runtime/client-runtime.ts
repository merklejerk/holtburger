import type { FrameState, Renderer, RendererSnapshot } from "../renderer/types";

export type StaticDomain = "terrain" | "buildings" | "detail" | "envCells";

export interface StaticWorkCommand {
	readonly landblockId: string;
	readonly domains: readonly StaticDomain[];
}

export interface RuntimeSnapshot {
	readonly status: "idle" | "static-requested" | "disposed";
	readonly lastStaticRequest: StaticWorkCommand | null;
	readonly renderer: RendererSnapshot;
}

export type RuntimeSnapshotListener = (snapshot: RuntimeSnapshot) => void;

export interface ClientRuntime {
	requestStaticWork(command: StaticWorkCommand): void;
	updateFrameState(state: FrameState): void;
	subscribe(listener: RuntimeSnapshotListener): () => void;
	dispose(): void;
}

export interface ClientRuntimeOptions {
	readonly renderer: Renderer;
}

export function createClientRuntime(
	options: ClientRuntimeOptions,
): ClientRuntime {
	return new ClientRuntimeImpl(options.renderer);
}

class ClientRuntimeImpl implements ClientRuntime {
	readonly #renderer: Renderer;
	readonly #listeners = new Set<RuntimeSnapshotListener>();
	readonly #unsubscribeRenderer: () => void;
	#lastRendererSnapshot: RendererSnapshot;
	#lastStaticRequest: StaticWorkCommand | null = null;
	#disposed = false;

	constructor(renderer: Renderer) {
		this.#renderer = renderer;
		this.#lastRendererSnapshot = {
			backend: "webgl2",
			canvasWidth: 0,
			canvasHeight: 0,
			error: null,
			frameCount: 0,
			isRunning: true,
		};
		this.#unsubscribeRenderer = renderer.subscribe((snapshot) => {
			this.#lastRendererSnapshot = snapshot;
			this.#emit();
		});
	}

	requestStaticWork(command: StaticWorkCommand): void {
		this.#assertActive();
		this.#lastStaticRequest = normalizeStaticWorkCommand(command);
		this.#emit();
	}

	updateFrameState(state: FrameState): void {
		this.#assertActive();
		this.#renderer.updateFrameState(state);
	}

	subscribe(listener: RuntimeSnapshotListener): () => void {
		this.#listeners.add(listener);
		listener(this.#createSnapshot());

		return () => {
			this.#listeners.delete(listener);
		};
	}

	dispose(): void {
		if (this.#disposed) {
			return;
		}

		this.#disposed = true;
		this.#unsubscribeRenderer();
		this.#renderer.dispose();
		this.#emit();
		this.#listeners.clear();
	}

	#assertActive(): void {
		if (this.#disposed) {
			throw new Error("ClientRuntime has been disposed.");
		}
	}

	#createSnapshot(): RuntimeSnapshot {
		return {
			lastStaticRequest: this.#lastStaticRequest,
			renderer: this.#lastRendererSnapshot,
			status: this.#disposed
				? "disposed"
				: this.#lastStaticRequest
					? "static-requested"
					: "idle",
		};
	}

	#emit(): void {
		const snapshot = this.#createSnapshot();

		for (const listener of this.#listeners) {
			listener(snapshot);
		}
	}
}

function normalizeStaticWorkCommand(command: StaticWorkCommand): StaticWorkCommand {
	const domains = Array.from(new Set(command.domains)).sort();

	return {
		domains,
		landblockId: command.landblockId.trim(),
	};
}
