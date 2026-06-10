import { HostBackedAssetService } from "../assets/asset-service";
import type { AssetService, AssetServiceSnapshot } from "../assets/contracts";
import type { RuntimeHost, RuntimeHostSnapshot } from "../host/contracts";
import type { Renderer, RendererSnapshot } from "../renderer/types";
import type { FrameState } from "../renderer/types";
import {
	ImmediateStaticBakerClient,
	ImmediateStaticResolverClient,
} from "../static/fake-workers";
import { StaticCoordinator } from "../static/coordinator/static-coordinator";
import type {
	StaticCoordinatorSnapshot,
	StaticDemand,
	StaticDomain,
	StaticLodRadii,
} from "../static/contracts";

export interface StaticWorkCommand {
	readonly landblockId: string;
	readonly domains: readonly StaticDomain[];
}

export interface RuntimeSnapshot {
	readonly status: "idle" | "static-active" | "disposed";
	readonly lastStaticRequest: StaticWorkCommand | null;
	readonly assets: AssetServiceSnapshot;
	readonly host: RuntimeHostSnapshot;
	readonly renderer: RendererSnapshot;
	readonly static: StaticCoordinatorSnapshot;
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
	readonly host: RuntimeHost;
	readonly assetService?: AssetService;
	readonly staticCoordinator?: StaticCoordinator;
}

export function createClientRuntime(
	options: ClientRuntimeOptions,
): ClientRuntime {
	const staticCoordinator =
		options.staticCoordinator ??
		new StaticCoordinator({
			baker: new ImmediateStaticBakerClient(),
			resolver: new ImmediateStaticResolverClient(),
		});
	const assetService =
		options.assetService ?? new HostBackedAssetService({ host: options.host });

	return new ClientRuntimeImpl(
		options.renderer,
		options.host,
		assetService,
		staticCoordinator,
	);
}

class ClientRuntimeImpl implements ClientRuntime {
	readonly #renderer: Renderer;
	readonly #host: RuntimeHost;
	readonly #assetService: AssetService;
	readonly #staticCoordinator: StaticCoordinator;
	readonly #listeners = new Set<RuntimeSnapshotListener>();
	readonly #unsubscribeRenderer: () => void;
	readonly #unsubscribeStaticCoordinator: () => void;
	#lastRendererSnapshot: RendererSnapshot;
	#lastStaticSnapshot: StaticCoordinatorSnapshot;
	#lastStaticRequest: StaticWorkCommand | null = null;
	#disposed = false;

	constructor(
		renderer: Renderer,
		host: RuntimeHost,
		assetService: AssetService,
		staticCoordinator: StaticCoordinator,
	) {
		this.#renderer = renderer;
		this.#host = host;
		this.#assetService = assetService;
		this.#staticCoordinator = staticCoordinator;
		this.#lastRendererSnapshot = {
			backend: "webgl2",
			canvasWidth: 0,
			canvasHeight: 0,
			error: null,
			frameCount: 0,
			isRunning: true,
		};
		this.#lastStaticSnapshot = staticCoordinator.createSnapshot();
		this.#unsubscribeRenderer = renderer.subscribe((snapshot) => {
			this.#lastRendererSnapshot = snapshot;
			this.#emit();
		});
		this.#unsubscribeStaticCoordinator = staticCoordinator.subscribe((snapshot) => {
			this.#lastStaticSnapshot = snapshot;
			this.#emit();
		});
	}

	requestStaticWork(command: StaticWorkCommand): void {
		this.#assertActive();
		this.#lastStaticRequest = normalizeStaticWorkCommand(command);
		this.#staticCoordinator.requestStaticDemand(
			createManualStaticDemand(this.#lastStaticRequest),
		);
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
		this.#unsubscribeStaticCoordinator();
		this.#staticCoordinator.dispose();
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
			assets: this.#assetService.createSnapshot(),
			host: this.#host.createSnapshot(),
			lastStaticRequest: this.#lastStaticRequest,
			renderer: this.#lastRendererSnapshot,
			static: this.#lastStaticSnapshot,
			status: this.#disposed
				? "disposed"
				: this.#lastStaticSnapshot.requested > 0
					? "static-active"
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

function createManualStaticDemand(command: StaticWorkCommand): StaticDemand {
	const lod: StaticLodRadii = {
		buildings: command.domains.includes("buildings") ? 0 : -1,
		detail: command.domains.includes("detail") ? 0 : -1,
		envCells: command.domains.includes("envCells") ? 0 : -1,
		terrain: command.domains.includes("terrain") ? 0 : -1,
	};

	return {
		location: {
			kind: "outdoor-landblock",
			landblockId: parseLandblockInput(command.landblockId),
		},
		lod,
		policyRevision: 1,
	};
}

function parseLandblockInput(value: string): number {
	const trimmed = value.trim();
	const normalized = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
	const parsed = Number.parseInt(normalized, 16);

	if (!Number.isFinite(parsed)) {
		throw new Error(`Invalid landblock id: ${value}`);
	}

	return parsed >>> 0;
}
