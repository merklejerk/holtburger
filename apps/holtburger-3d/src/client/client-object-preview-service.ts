import type { StartPresentationFrameLoop } from "../lib/game/presentation-frame-loop";
import type { ObjectPreviewSource } from "../lib/game/runtime/object-preview-source";
import {
	ObjectPreviewController,
	type ObjectPreviewHandle,
	type ObjectPreviewResources,
} from "../lib/game/preview/object-preview-controller";

export interface ClientObjectPreviewOpenRequest {
	readonly canvas: HTMLCanvasElement;
	readonly source: ObjectPreviewSource | null;
}

/** Single-active-preview policy for isolated inspection surfaces. */
export interface ClientObjectPreviewService {
	open(request: ClientObjectPreviewOpenRequest): ObjectPreviewHandle;
}

interface ServiceDependencies {
	/** Shared frontend scheduling policy for every mounted preview. */
	readonly startFrameLoop: StartPresentationFrameLoop;
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
		this.#retirement = Promise.allSettled([this.#retirement, retirement]).then(
			(results) => {
				const failures = results.flatMap((result) =>
					result.status === "rejected" ? [result.reason] : [],
				);
				if (failures.length === 1) throw failures[0];
				if (failures.length > 0)
					throw new AggregateError(
						failures,
						"Object preview retirement failed.",
					);
			},
		);
		// Preserve failure for activation/shutdown while observing it immediately.
		void this.#retirement.catch((error: unknown) =>
			this.#dependencies.onError?.(error),
		);
	}
}
