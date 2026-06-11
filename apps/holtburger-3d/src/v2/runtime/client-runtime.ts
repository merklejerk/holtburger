import { HostBackedAssetService } from "../assets/asset-service";
import type { AssetService, AssetServiceSnapshot } from "../assets/contracts";
import type { RuntimeHost, RuntimeHostSnapshot } from "../host/contracts";
import type {
	Renderer,
	RendererSnapshot,
	StaticResidencyDelta,
	TexturePlacementUpdate,
} from "../renderer/types";
import type { FrameState } from "../renderer/types";
import {
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
	getOutdoorLandblockCoords,
	normalizeOutdoorLandblockId,
} from "../../lib/landblocks";
import { TextureManager } from "../textures/texture-manager";
import type { TexturePacker } from "../textures/packing/packer";
import {
	ImmediateStaticBakerClient,
	ImmediateStaticResolverClient,
} from "../static/fake-workers";
import { StaticCoordinator } from "../static/coordinator/static-coordinator";
import type {
	StaticCoordinatorSnapshot,
	StaticCoordinatorCommitDelta,
	StaticDemand,
	StaticDrawUnit,
	StaticLodRadii,
} from "../static/contracts";

export type ManualStaticDomain =
	| "terrain"
	| "buildings"
	| "detail"
	| "topology";

export interface StaticWorkCommand {
	readonly landblockId: string;
	readonly domains: readonly ManualStaticDomain[];
	readonly lod?: Partial<StaticLodRadii>;
	readonly locationKind?: "outdoor-landblock" | "interior-cell";
	readonly envCellId?: string;
}

export interface RuntimeSnapshot {
	readonly status: "idle" | "static-active" | "disposed";
	readonly lastStaticRequest: StaticWorkCommand | null;
	readonly assets: AssetServiceSnapshot;
	readonly host: RuntimeHostSnapshot;
	readonly renderer: RendererSnapshot;
	readonly static: StaticCoordinatorSnapshot;
	readonly staticMaterialization: StaticMaterializationSnapshot;
}

export type RuntimeSnapshotListener = (snapshot: RuntimeSnapshot) => void;

interface StaticMaterializationSnapshot {
	readonly pendingRevisions: readonly number[];
	readonly committedRevisions: readonly number[];
	readonly failed: readonly StaticMaterializationFailureSnapshot[];
}

interface StaticMaterializationFailureSnapshot {
	readonly revision: number;
	readonly message: string;
}

export interface ClientRuntime {
	requestStaticWork(command: StaticWorkCommand): void;
	evictStaticWork(): void;
	updateFrameState(state: FrameState): void;
	subscribe(listener: RuntimeSnapshotListener): () => void;
	dispose(): void;
}

export interface ClientRuntimeOptions {
	readonly renderer: Renderer;
	readonly host: RuntimeHost;
	readonly assetService?: AssetService;
	readonly staticCoordinator?: StaticCoordinator;
	readonly texturePacker?: TexturePacker;
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
		options.texturePacker,
	);
}

class ClientRuntimeImpl implements ClientRuntime {
	readonly #renderer: Renderer;
	readonly #host: RuntimeHost;
	readonly #assetService: AssetService;
	readonly #textureManager: TextureManager;
	readonly #staticCoordinator: StaticCoordinator;
	readonly #listeners = new Set<RuntimeSnapshotListener>();
	readonly #unsubscribeRenderer: () => void;
	readonly #unsubscribeStaticCoordinator: () => void;
	readonly #unsubscribeStaticCommits: () => void;
	#lastRendererSnapshot: RendererSnapshot;
	#lastStaticSnapshot: StaticCoordinatorSnapshot;
	#lastStaticRequest: StaticWorkCommand | null = null;
	#renderAnchorLandblockId: number | null = null;
	#staticMaterializationQueue: Promise<void> = Promise.resolve();
	#pendingStaticMaterializations = new Set<number>();
	#committedStaticMaterializations: number[] = [];
	#failedStaticMaterializations: StaticMaterializationFailureSnapshot[] = [];
	#disposed = false;

	constructor(
		renderer: Renderer,
		host: RuntimeHost,
		assetService: AssetService,
		staticCoordinator: StaticCoordinator,
		texturePacker: TexturePacker | undefined,
	) {
		this.#renderer = renderer;
		this.#host = host;
		this.#assetService = assetService;
		this.#textureManager = new TextureManager({ assetService, texturePacker });
		this.#staticCoordinator = staticCoordinator;
		this.#staticCoordinator.setAtlasSnapshotProvider((payload) =>
			this.#textureManager.createDomainAtlasSnapshot(payload),
		);
		this.#lastRendererSnapshot = {
			backend: "webgl2",
			canvasWidth: 0,
			canvasHeight: 0,
			error: null,
			frameCount: 0,
			isRunning: true,
			renderedTriangles: 0,
			staticDrawUnits: 0,
			terrainDrawUnits: 0,
		};
		this.#lastStaticSnapshot = staticCoordinator.createSnapshot();
		this.#unsubscribeRenderer = renderer.subscribe((snapshot) => {
			this.#lastRendererSnapshot = snapshot;
			this.#emit();
		});
		this.#unsubscribeStaticCoordinator = staticCoordinator.subscribe(
			(snapshot) => {
				this.#lastStaticSnapshot = snapshot;
				this.#emit();
			},
		);
		this.#unsubscribeStaticCommits = staticCoordinator.subscribeCommits(
			(delta) => {
				this.#enqueueStaticMaterialization(delta);
			},
		);
	}

	requestStaticWork(command: StaticWorkCommand): void {
		this.#assertActive();
		this.#lastStaticRequest = normalizeStaticWorkCommand(command);
		this.#renderAnchorLandblockId =
			this.#lastStaticRequest.locationKind === "outdoor-landblock"
				? normalizeOutdoorLandblockId(
						parseLandblockInput(this.#lastStaticRequest.landblockId),
					)
				: null;
		this.#staticCoordinator.requestStaticDemand(
			createManualStaticDemand(this.#lastStaticRequest),
		);
		this.#emit();
	}

	evictStaticWork(): void {
		this.#assertActive();
		this.#lastStaticRequest = null;
		this.#renderAnchorLandblockId = null;
		this.#staticCoordinator.requestStaticDemand({
			location: null,
			lod: {
				buildings: -1,
				detail: -1,
				terrain: -1,
				topology: -1,
			},
		});
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
		this.#unsubscribeStaticCommits();
		this.#staticCoordinator.dispose();
		this.#textureManager.dispose();
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
			staticMaterialization: {
				committedRevisions: this.#committedStaticMaterializations,
				failed: this.#failedStaticMaterializations,
				pendingRevisions: Array.from(this.#pendingStaticMaterializations).sort(
					(a, b) => a - b,
				),
			},
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

	#enqueueStaticMaterialization(delta: StaticCoordinatorCommitDelta): void {
		this.#pendingStaticMaterializations.add(delta.revision);
		this.#emit();
		this.#staticMaterializationQueue = this.#staticMaterializationQueue
			.then(() => this.#materializeStaticCommit(delta))
			.catch((error: unknown) => {
				this.#recordStaticMaterializationFailure(delta.revision, error);
			});
	}

	async #materializeStaticCommit(
		delta: StaticCoordinatorCommitDelta,
	): Promise<void> {
		const textureUpdate =
			await this.#textureManager.applyStaticCommitDelta(delta);
		if (this.#disposed) {
			return;
		}

		const staticDelta = createStaticResidencyDelta(
			delta,
			this.#renderAnchorLandblockId,
		);
		applyMaterializedStaticCommit(this.#renderer, textureUpdate, staticDelta);
		this.#pendingStaticMaterializations.delete(delta.revision);
		this.#committedStaticMaterializations = appendBoundedRevision(
			this.#committedStaticMaterializations,
			delta.revision,
		);
		this.#emit();
	}

	#recordStaticMaterializationFailure(revision: number, error: unknown): void {
		this.#pendingStaticMaterializations.delete(revision);
		const message = error instanceof Error ? error.message : String(error);
		this.#failedStaticMaterializations = appendBoundedFailure(
			this.#failedStaticMaterializations,
			{ message, revision },
		);
		this.#emit();
	}
}

function applyMaterializedStaticCommit(
	renderer: Renderer,
	textureUpdate: TexturePlacementUpdate | null,
	staticDelta: StaticResidencyDelta,
): void {
	if (textureUpdate) {
		renderer.applyTexturePlacementUpdate(textureUpdate);
	}
	renderer.applyStaticDelta(staticDelta);
}

function createStaticResidencyDelta(
	delta: StaticCoordinatorCommitDelta,
	renderAnchorLandblockId: number | null,
): StaticResidencyDelta {
	return {
		addedDrawUnitPlacements: delta.addedDrawUnits.map((drawUnit) => ({
			drawUnit,
			translation: createStaticDrawUnitTranslation(
				drawUnit,
				renderAnchorLandblockId,
			),
		})),
		removedDrawUnitIds: delta.removedDrawUnitIds,
		revision: delta.revision,
	};
}

function appendBoundedRevision(
	revisions: readonly number[],
	revision: number,
): number[] {
	return [...revisions, revision].slice(-8);
}

function appendBoundedFailure(
	failures: readonly StaticMaterializationFailureSnapshot[],
	failure: StaticMaterializationFailureSnapshot,
): StaticMaterializationFailureSnapshot[] {
	return [...failures, failure].slice(-8);
}

function normalizeStaticWorkCommand(
	command: StaticWorkCommand,
): StaticWorkCommand {
	const domains = Array.from(new Set(command.domains)).sort();

	return {
		domains,
		envCellId: command.envCellId?.trim(),
		landblockId: command.landblockId.trim(),
		...(command.lod ? { lod: command.lod } : {}),
		locationKind: command.locationKind,
	};
}

function createManualStaticDemand(command: StaticWorkCommand): StaticDemand {
	const lod: StaticLodRadii = {
		buildings: command.domains.includes("buildings")
			? (command.lod?.buildings ?? 0)
			: -1,
		detail: command.domains.includes("detail")
			? (command.lod?.detail ?? 0)
			: -1,
		terrain: command.domains.includes("terrain")
			? (command.lod?.terrain ?? 0)
			: -1,
		topology: command.domains.includes("topology")
			? (command.lod?.topology ?? 0)
			: -1,
	};

	if (command.locationKind === "interior-cell") {
		return {
			location: {
				envCellId: parseLandblockInput(
					command.envCellId ?? command.landblockId,
				),
				kind: "interior-cell",
				landblockId: parseLandblockInput(command.landblockId),
			},
			lod,
		};
	}

	return {
		location: {
			kind: "outdoor-landblock",
			landblockId: parseLandblockInput(command.landblockId),
		},
		lod,
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

function createStaticDrawUnitTranslation(
	drawUnit: StaticDrawUnit,
	focusLandblockId: number | null,
): readonly [number, number, number] {
	if (drawUnit.kind !== "terrain-geometry" || focusLandblockId === null) {
		return [0, 0, 0];
	}

	const drawUnitCoords = getOutdoorLandblockCoords(drawUnit.landblockId);
	const focusCoords = getOutdoorLandblockCoords(focusLandblockId);

	return [
		normalizeZero(
			(drawUnitCoords.x - focusCoords.x) * OUTDOOR_LANDBLOCK_WORLD_SIZE,
		),
		0,
		normalizeZero(
			-(drawUnitCoords.y - focusCoords.y) * OUTDOOR_LANDBLOCK_WORLD_SIZE,
		),
	];
}

function normalizeZero(value: number): number {
	return Object.is(value, -0) ? 0 : value;
}
