import type { ParticleMeshSource } from "../../assets/particle-mesh-source";
import type { ObjectPreviewSource } from "../runtime/object-preview-source";
import type { PresentationAssetService } from "../runtime/presentation-asset-service";
import type { RenderExtent } from "../renderer/render-extent";
import {
	WebGL2PreviewRenderer,
	type ObjectPreviewRenderViewport,
	type ObjectPreviewRendererDiagnostics,
} from "../renderer/webgl2-preview-renderer";
import {
	acquireObjectPreviewAssets,
	type ObjectPreviewAssetLease,
} from "./object-preview-assets";
import { ObjectPreviewPresentation } from "./object-preview-presentation";

/** Latest UI-owned viewport policy. Null suspends both scheduling and active preview time. */
export interface ObjectPreviewViewport {
	readonly extent: RenderExtent;
	readonly minimumFrameIntervalSeconds: number;
	readonly yawRadians: number;
}

export interface ObjectPreviewMountRequest {
	readonly canvas: HTMLCanvasElement;
	readonly source: ObjectPreviewSource;
	/** Prior device retirement; context-B activation may not overtake it. */
	readonly activationBarrier: Promise<void>;
}

export interface ObjectPreviewHandle {
	/** Resolves after the first complete direct-canvas draw. */
	readonly ready: Promise<void>;
	diagnostics(): ObjectPreviewRendererDiagnostics | null;
	setViewport(viewport: ObjectPreviewViewport | null): void;
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

/** One mount generation joining preparation, local simulation, cadence and context-B lifetime. */
export class ObjectPreviewController implements ObjectPreviewHandle {
	readonly ready: Promise<void>;
	readonly #resolveReady: () => void;
	readonly #rejectReady: (cause: unknown) => void;
	readonly #request: ObjectPreviewMountRequest;
	readonly #dependencies: ControllerDependencies;
	readonly #setupCompletion: Promise<void>;
	#lease: ObjectPreviewAssetLease | null = null;
	#presentation: ObjectPreviewPresentation | null = null;
	#renderer: WebGL2PreviewRenderer | null = null;
	#viewport: ObjectPreviewViewport | null = null;
	#animationFrame: number | null = null;
	#lastDrawTimestampMs: number | null = null;
	#activeClockSeconds = 0;
	#readySettled = false;
	#disposed = false;
	#releaseCompletion: Promise<void> | null = null;
	#disposalCompletion: Promise<void> | null = null;

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
		this.#setupCompletion = this.#initialize();
	}

	setViewport(viewport: ObjectPreviewViewport | null): void {
		if (this.#disposed) return;
		if (viewport !== null) validateViewport(viewport);
		this.#viewport = viewport;
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
		if (this.#disposalCompletion) return this.#disposalCompletion;
		this.#disposed = true;
		this.#viewport = null;
		this.#cancelFrame();
		this.#rejectReadyOnce(abortError("Object preview mount was disposed."));
		return (this.#disposalCompletion = this.#setupCompletion.then(() =>
			this.#release(),
		));
	}

	async #initialize(): Promise<void> {
		try {
			const resources = await this.#dependencies.resolveResources();
			this.#throwIfDisposed();
			const lease = await acquireObjectPreviewAssets(
				resources.assets,
				this.#request.source,
			);
			this.#lease = lease;
			this.#throwIfDisposed();
			await this.#request.activationBarrier;
			this.#throwIfDisposed();
			const renderer = await WebGL2PreviewRenderer.build(
				this.#request.canvas,
				lease.assets,
				{
					particleMeshSource: resources.particleMeshSource(),
					preserveDrawingBuffer: resources.preserveDrawingBuffer,
					texturePreparer: resources.assets.texturePreparer,
				},
			);
			this.#renderer = renderer;
			this.#throwIfDisposed();
			this.#presentation = new ObjectPreviewPresentation(lease.assets);
			this.#scheduleFrame();
		} catch (cause) {
			let failure = cause;
			try {
				await this.#release();
			} catch (releaseCause) {
				failure = new AggregateError(
					[cause, releaseCause],
					"Object preview setup and rollback both failed.",
				);
			}
			this.#rejectReadyOnce(failure);
			if (!this.#disposed) this.#dependencies.onError?.(failure);
		}
	}

	#scheduleFrame(): void {
		if (
			this.#disposed ||
			this.#viewport === null ||
			this.#presentation === null ||
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
		const presentation = this.#presentation;
		const renderer = this.#renderer;
		if (this.#disposed || viewport === null || !presentation || !renderer)
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
			const frame = presentation.advance(this.#activeClockSeconds);
			const renderViewport: ObjectPreviewRenderViewport = {
				extent: viewport.extent,
				yawRadians: viewport.yawRadians,
			};
			renderer.draw(frame, renderViewport);
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

	#release(): Promise<void> {
		return (this.#releaseCompletion ??= this.#releaseOwned());
	}

	async #releaseOwned(): Promise<void> {
		const failures: unknown[] = [];
		try {
			this.#presentation?.dispose();
		} catch (cause) {
			failures.push(cause);
		}
		this.#presentation = null;
		const renderer = this.#renderer;
		this.#renderer = null;
		if (renderer)
			try {
				await renderer.destroy();
			} catch (cause) {
				failures.push(cause);
			}
		const lease = this.#lease;
		this.#lease = null;
		if (lease)
			try {
				lease.release();
			} catch (cause) {
				failures.push(cause);
			}
		if (failures.length > 0)
			throw new AggregateError(failures, "Object preview teardown failed.");
	}

	#throwIfDisposed(): void {
		if (this.#disposed) throw abortError("Object preview mount was disposed.");
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

function validateViewport(viewport: ObjectPreviewViewport): void {
	if (
		!Number.isFinite(viewport.minimumFrameIntervalSeconds) ||
		viewport.minimumFrameIntervalSeconds <= 0 ||
		!Number.isFinite(viewport.yawRadians)
	)
		throw new Error(
			"Object preview viewport requires a positive frame interval and finite yaw.",
		);
}

function abortError(message: string): Error {
	const error = new Error(message);
	error.name = "AbortError";
	return error;
}
