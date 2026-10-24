import type { ParticleMeshSource } from "../../assets/particle-mesh-source";
import type { ObjectPreviewSource } from "../runtime/object-preview-source";
import type { PresentationAssetService } from "../runtime/presentation-asset-service";
import {
	WebGL2PreviewRenderer,
	type ObjectPreviewRendererDiagnostics,
} from "../renderer/webgl2-preview-renderer";
import {
	acquireObjectPreviewAssets,
	type ObjectPreviewAssetLease,
} from "./object-preview-composition";
import { ObjectPreviewPresentation } from "./object-preview-presentation";

import {
	resolveObjectPreviewViewport,
	type ObjectPreviewViewport,
	type ResolvedObjectPreviewViewport,
} from "./object-preview-viewport";
export type { ObjectPreviewViewport } from "./object-preview-viewport";

export interface ObjectPreviewMountRequest {
	readonly canvas: HTMLCanvasElement;
	/** An empty mounted surface admits a source later without creating a device prematurely. */
	readonly source: ObjectPreviewSource | null;
	/** Prior device retirement; context-B activation may not overtake it. */
	readonly activationBarrier: Promise<void>;
}

export interface ObjectPreviewHandle {
	/** Resolves after the first complete direct-canvas draw. */
	readonly ready: Promise<void>;
	diagnostics(): ObjectPreviewRendererDiagnostics | null;
	setViewport(viewport: ObjectPreviewViewport | null): void;
	/** Replace the source in the mounted device, coalescing pending work to the latest request. */
	replaceSource(
		source: ObjectPreviewSource,
	): Promise<ObjectPreviewReplacementResult>;
	/** Clear a previous subject immediately while preserving device lifetime. */
	withdrawSource(): Promise<void>;
	dispose(): Promise<void>;
}

/** Composition-owned preparation capabilities borrowed by a mounted preview. */
export interface ObjectPreviewResources {
	readonly assets: PresentationAssetService;
	readonly particleMeshSource: () => ParticleMeshSource;
	/** Harness-only readback policy; ordinary mounted previews keep this absent. */
	readonly preserveDrawingBuffer?: boolean;
}

interface ControllerDependencies {
	readonly resolveResources: () => Promise<ObjectPreviewResources>;
	readonly onError?: (error: unknown) => void;
}

/** Outcome belongs to one requested source; superseded work cannot publish success or failure. */
export type ObjectPreviewReplacementResult = {
	readonly kind: "installed" | "superseded";
};

/** One cold source request; revisions are local currentness, never world/server identity. */
interface SourceRequest {
	/** Monotonic revision admitted by this mounted owner. */
	readonly revision: number;
	/** Immutable visual facts to prepare. */
	readonly source: ObjectPreviewSource;
	/** Complete installation or supersession for this caller only. */
	readonly resolve: (result: ObjectPreviewReplacementResult) => void;
	/** Report a current request's preparation failure. */
	readonly reject: (cause: unknown) => void;
}

/** CPU leases and their presentation runtime move together at a visual installation boundary. */
interface InstalledVisual {
	/** CPU/content acquisitions retained until the corresponding GPU bundle retires. */
	readonly lease: ObjectPreviewAssetLease;
	/** Animation/effects runtime belonging to that same installed visual. */
	readonly presentation: ObjectPreviewPresentation;
}

/** One mounted device with one preparation in flight and one latest pending source request. */
export class ObjectPreviewController implements ObjectPreviewHandle {
	readonly ready: Promise<void>;
	readonly #resolveReady: () => void;
	readonly #rejectReady: (cause: unknown) => void;
	readonly #request: ObjectPreviewMountRequest;
	readonly #dependencies: ControllerDependencies;
	#active: InstalledVisual | null = null;
	#renderer: WebGL2PreviewRenderer | null = null;
	#pending: SourceRequest | null = null;
	#work: Promise<void> | null = null;
	#revision = 0;
	#viewport: ResolvedObjectPreviewViewport | null = null;
	#animationFrame: number | null = null;
	#lastDrawTimestampMs: number | null = null;
	#activeClockSeconds = 0;
	#readySettled = false;
	#disposed = false;
	#disposalCompletion: Promise<void> | null = null;
	readonly #retirements = new Set<Promise<void>>();
	#retirementFailure: unknown = null;

	constructor(
		request: ObjectPreviewMountRequest,
		dependencies: ControllerDependencies,
	) {
		this.#request = request;
		this.#dependencies = dependencies;
		let resolveReady: () => void = () => {};
		let rejectReady: (cause: unknown) => void = () => {};
		this.ready = new Promise<void>((resolve, reject) => {
			resolveReady = resolve;
			rejectReady = reject;
		});
		this.#resolveReady = resolveReady;
		this.#rejectReady = rejectReady;
		if (request.source !== null)
			void this.replaceSource(request.source).catch((cause: unknown) =>
				this.#rejectReadyOnce(cause),
			);
	}

	/** Replace appearance without changing device lifetime; only the latest request may install. */
	replaceSource(
		source: ObjectPreviewSource,
	): Promise<ObjectPreviewReplacementResult> {
		if (this.#disposed)
			return Promise.reject(abortError("Object preview mount was disposed."));
		this.#revision++;
		this.#pending?.resolve({ kind: "superseded" });
		const completion = new Promise<ObjectPreviewReplacementResult>(
			(resolve, reject) => {
				this.#pending = { revision: this.#revision, source, resolve, reject };
			},
		);
		this.#startWork();
		return completion;
	}

	/** Hide the previous subject now; source preparation may continue solely for cleanup. */
	withdrawSource(): Promise<void> {
		if (this.#disposed)
			return Promise.reject(abortError("Object preview mount was disposed."));
		this.#revision++;
		this.#pending?.resolve({ kind: "superseded" });
		this.#pending = null;
		this.#cancelFrame();
		const previous = this.#active;
		this.#active = null;
		let gpu: Promise<void>;
		try {
			gpu = this.#renderer?.clear() ?? Promise.resolve();
		} catch (cause) {
			gpu = Promise.reject(cause);
		}
		return this.#retire(previous, gpu);
	}

	setViewport(viewport: ObjectPreviewViewport | null): void {
		if (this.#disposed) return;
		this.#viewport =
			viewport === null ? null : resolveObjectPreviewViewport(viewport);
		if (viewport === null) {
			this.#cancelFrame();
			this.#lastDrawTimestampMs = null;
			return;
		}
		this.#scheduleFrame();
	}

	diagnostics(): ObjectPreviewRendererDiagnostics | null {
		return this.#renderer?.getDiagnostics() ?? null;
	}

	dispose(): Promise<void> {
		if (this.#disposalCompletion !== null) return this.#disposalCompletion;
		this.#disposed = true;
		this.#revision++;
		this.#pending?.resolve({ kind: "superseded" });
		this.#pending = null;
		this.#viewport = null;
		this.#cancelFrame();
		this.#rejectReadyOnce(abortError("Object preview mount was disposed."));
		return (this.#disposalCompletion = this.#release());
	}

	#startWork(): void {
		if (this.#work !== null || this.#disposed) return;
		this.#work = this.#run().finally(() => {
			this.#work = null;
			if (this.#pending !== null && !this.#disposed) this.#startWork();
		});
	}

	async #run(): Promise<void> {
		while (this.#pending !== null && !this.#disposed) {
			const request = this.#pending;
			this.#pending = null;
			try {
				const installed = await this.#prepare(request);
				request.resolve({
					kind:
						installed && this.#isCurrent(request) ? "installed" : "superseded",
				});
			} catch (cause) {
				if (this.#isCurrent(request)) {
					request.reject(cause);
					this.#rejectReadyOnce(cause);
				} else request.resolve({ kind: "superseded" });
			}
		}
	}

	async #prepare(request: SourceRequest): Promise<boolean> {
		const resources = await this.#dependencies.resolveResources();
		if (!this.#isCurrent(request)) return false;
		const lease = await acquireObjectPreviewAssets(
			resources.assets,
			request.source,
		);
		// Installation transfers this lease permanently, even if withdrawal or another request
		// retires it while #install is awaiting the previous GPU bundle's completion.
		let releaseLease: (() => void) | null = () => lease.release();
		// Retain the preparation outcome until cleanup finishes so cleanup failure cannot
		// overwrite the original content or upload failure in a finally clause.
		let outcome:
			| { kind: "complete"; installed: boolean }
			| { kind: "failed"; cause: unknown };
		try {
			let installed = false;
			if (this.#isCurrent(request)) {
				await this.#request.activationBarrier;
				if (this.#isCurrent(request))
					installed = await this.#install(request, lease, resources, () => {
						releaseLease = null;
					});
			}
			outcome = { kind: "complete", installed };
		} catch (cause) {
			outcome = { kind: "failed", cause };
		}
		try {
			releaseLease?.();
		} catch (cause) {
			// Obsolete content errors need not reach UI, but broken ownership cleanup must
			// remain observable even after its request has been superseded.
			this.#retirementFailure ??= cause;
			this.#dependencies.onError?.(cause);
			if (outcome.kind === "failed")
				throw new AggregateError(
					[outcome.cause, cause],
					"Preview preparation and lease cleanup failed.",
					{ cause },
				);
			throw cause;
		}
		if (outcome.kind === "failed") throw outcome.cause;
		return outcome.installed;
	}

	async #install(
		request: SourceRequest,
		lease: ObjectPreviewAssetLease,
		resources: ObjectPreviewResources,
		transferLease: () => void,
	): Promise<boolean> {
		const initial = this.#renderer === null;
		const renderer =
			this.#renderer ??
			(await WebGL2PreviewRenderer.build(this.#request.canvas, lease.assets, {
				particleMeshSource: resources.particleMeshSource,
				preserveDrawingBuffer: resources.preserveDrawingBuffer,
				texturePreparer: resources.assets.texturePreparer,
			}));
		this.#renderer = renderer;
		const staged = initial
			? null
			: await renderer.prepareReplacement(lease.assets);
		try {
			if (!this.#isCurrent(request)) return false;
			const presentation = new ObjectPreviewPresentation(
				lease.assets,
				this.#active?.presentation ?? null,
			);
			const previous = this.#active;
			// Both pointer changes occur synchronously. A draw cannot pair old pose data with
			// the new GPU bundle while previous-resource retirement is awaiting completion.
			let retirement: Promise<void>;
			try {
				retirement = staged?.commit() ?? Promise.resolve();
			} catch (cause) {
				presentation.dispose();
				throw cause;
			}
			this.#active = { lease, presentation };
			transferLease();
			this.#activeClockSeconds = 0;
			this.#lastDrawTimestampMs = null;
			this.#scheduleFrame();
			await this.#retire(previous, retirement);
			return true;
		} finally {
			if (staged !== null) await staged.dispose();
			else if (this.#active?.lease !== lease) await renderer.clear();
		}
	}

	#isCurrent(request: SourceRequest): boolean {
		return !this.#disposed && request.revision === this.#revision;
	}

	#retire(previous: InstalledVisual | null, gpu: Promise<void>): Promise<void> {
		const completion = this.#retireVisual(previous, gpu);
		this.#retirements.add(completion);
		void completion.then(
			() => this.#retirements.delete(completion),
			(cause: unknown) => {
				this.#retirements.delete(completion);
				this.#retirementFailure ??= cause;
				this.#dependencies.onError?.(cause);
			},
		);
		return completion;
	}

	async #retireVisual(
		previous: InstalledVisual | null,
		gpu: Promise<void>,
	): Promise<void> {
		const failures: unknown[] = [];
		try {
			previous?.presentation.dispose();
		} catch (cause) {
			failures.push(cause);
		}
		try {
			await gpu;
		} catch (cause) {
			failures.push(cause);
		}
		try {
			previous?.lease.release();
		} catch (cause) {
			failures.push(cause);
		}
		if (failures.length > 0)
			throw new AggregateError(
				failures,
				"Object preview visual retirement failed.",
			);
	}

	#scheduleFrame(): void {
		if (
			this.#disposed ||
			this.#viewport === null ||
			this.#active === null ||
			this.#renderer === null ||
			this.#animationFrame !== null
		)
			return;
		this.#animationFrame = requestAnimationFrame((timestampMs) =>
			this.#drawFrame(timestampMs),
		);
	}

	#drawFrame(timestampMs: number): void {
		this.#animationFrame = null;
		const viewport = this.#viewport;
		const active = this.#active;
		const renderer = this.#renderer;
		if (
			this.#disposed ||
			viewport === null ||
			active === null ||
			renderer === null
		)
			return;
		const minimumMs = viewport.minimumFrameIntervalSeconds * 1_000;
		if (
			this.#lastDrawTimestampMs !== null &&
			timestampMs - this.#lastDrawTimestampMs < minimumMs
		) {
			this.#scheduleFrame();
			return;
		}
		if (this.#lastDrawTimestampMs !== null)
			this.#activeClockSeconds +=
				Math.max(0, timestampMs - this.#lastDrawTimestampMs) / 1_000;
		this.#lastDrawTimestampMs = timestampMs;
		try {
			renderer.draw(
				active.presentation.advance(
					this.#activeClockSeconds,
					viewport.subjectTransform,
				),
				{
					extent: viewport.extent,
					cameraYawRadians: viewport.cameraYawRadians,
					subjectTransform: viewport.subjectTransform,
					framing: viewport.framing,
				},
			);
			this.#resolveReadyOnce();
			this.#scheduleFrame();
		} catch (cause) {
			this.#rejectReadyOnce(cause);
			this.#dependencies.onError?.(cause);
			void this.dispose().catch((releaseCause: unknown) =>
				this.#dependencies.onError?.(releaseCause),
			);
		}
	}

	#cancelFrame(): void {
		if (this.#animationFrame === null) return;
		cancelAnimationFrame(this.#animationFrame);
		this.#animationFrame = null;
	}

	async #release(): Promise<void> {
		const results = await Promise.allSettled([
			this.#work,
			...this.#retirements,
		]);
		const failures = results.flatMap((result) =>
			result.status === "rejected" ? [result.reason] : [],
		);
		if (this.#retirementFailure !== null)
			failures.push(this.#retirementFailure);
		const active = this.#active;
		this.#active = null;
		const renderer = this.#renderer;
		this.#renderer = null;
		try {
			await this.#retireVisual(
				active,
				renderer?.destroy() ?? Promise.resolve(),
			);
		} catch (cause) {
			failures.push(cause);
		}
		if (failures.length > 0)
			throw new AggregateError(failures, "Object preview teardown failed.");
	}

	#resolveReadyOnce(): void {
		if (this.#readySettled) return;
		this.#readySettled = true;
		this.#resolveReady();
	}

	#rejectReadyOnce(cause: unknown): void {
		if (this.#readySettled) return;
		this.#readySettled = true;
		this.#rejectReady(cause);
	}
}

function abortError(message: string): Error {
	const error = new Error(message);
	error.name = "AbortError";
	return error;
}
