import type { ObjectPreviewSource } from "../lib/game/runtime/object-preview-source";
import {
	ObjectPreviewController,
	type ObjectPreviewHandle,
	type ObjectPreviewResources,
} from "../lib/game/preview/object-preview-controller";

export interface ClientObjectPreviewOpenRequest {
	readonly canvas: HTMLCanvasElement;
	readonly source: ObjectPreviewSource;
}

/** Single-active-preview policy consumed by the inspector component. */
export interface ClientObjectPreviewService {
	open(request: ClientObjectPreviewOpenRequest): ObjectPreviewHandle;
}

interface ServiceDependencies {
	readonly resolveResources: () => Promise<ObjectPreviewResources>;
	readonly onError?: (error: unknown) => void;
}

/** Owns admission and replacement; the mount controller owns all pending and active work. */
export class StandardClientObjectPreviewService implements ClientObjectPreviewService {
	readonly #dependencies: ServiceDependencies;
	#current: ObjectPreviewHandle | null = null;
	#retirement: Promise<void> = Promise.resolve();
	#destroyed = false;

	constructor(dependencies: ServiceDependencies) {
		this.#dependencies = dependencies;
	}

	open(request: ClientObjectPreviewOpenRequest): ObjectPreviewHandle {
		if (this.#destroyed)
			throw new Error("Cannot open a preview on a destroyed preview service.");
		if (this.#current !== null) this.#appendRetirement(this.#current.dispose());
		const handle = new ObjectPreviewController(
			{ ...request, activationBarrier: this.#retirement },
			this.#dependencies,
		);
		this.#current = handle;
		return handle;
	}

	destroy(): Promise<void> {
		if (!this.#destroyed) {
			this.#destroyed = true;
			if (this.#current !== null)
				this.#appendRetirement(this.#current.dispose());
			this.#current = null;
		}
		return this.#retirement;
	}

	#appendRetirement(retirement: Promise<void>): void {
		this.#retirement = Promise.all([this.#retirement, retirement]).then(
			() => undefined,
		);
		// Preserve failure for activation/shutdown while observing it immediately.
		void this.#retirement.catch((error: unknown) =>
			this.#dependencies.onError?.(error),
		);
	}
}
