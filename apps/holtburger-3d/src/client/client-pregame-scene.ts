import { rotateRenderVector } from "../lib/game/math/camera-orientation";
import { createRotationMat4 } from "../lib/game/math/matrices";
import { createLandblockWorldOrigin } from "../lib/game/landblocks";
import { scopeFor } from "../lib/game/scene/scope";
import type { SceneSpatialPlacement } from "../lib/game/scene";
import type { LocalSceneModelHandle } from "../lib/game/runtime/local-scene-model";
import { completePresentationOperations } from "../lib/game/runtime/presentation-teardown";
import { resolvePregameCamera } from "./client-pregame-camera";
import type {
	ClientPregameCharacterService,
	PregameCharacterSink,
	PregameCharacterSource,
	PregameCharacterView,
	PregameCharacterStatus,
} from "./client-pregame-character";
import type { LandblockProfileSource } from "../lib/assets/landblock-profile-source";
import type { GamePresentationOwner } from "../lib/game/runtime/game-presentation-owner";
import type { SceneActivationReceipt } from "../lib/game/runtime/scene-availability";
import { resolveSceneInterestRequest } from "../lib/game/runtime/scene-target";
import {
	renderVector,
	sceneVec3,
	type SceneVec3,
} from "../lib/assets/ac-frame";
import { Quat, Vec3 } from "../lib/game/math/types";
import type { Camera } from "../lib/game/runtime/types";
import { resolveSceneEnvironment } from "../lib/game/environment/scene-environment";
import { CLIENT_ENVIRONMENT_INTERVAL_MS } from "./client-environment";
import { CLIENT_TUNING } from "./client-tuning";

import {
	CLIENT_PREGAME_CAMERA_TUNING,
	CLIENT_PREGAME_SCENE_TUNING,
	type ClientPregameLocation,
} from "./client-pregame-tuning";
/** A visible surface still needs room for the configured framing margin. */
const FRAMING_LIMITATION_MESSAGE =
	"The character viewing area is too small. Enlarge the window or reduce the interface size.";

/** This controller borrows world presentation; it never owns browser resources or live entities. */
export type ClientPregameSceneResources = Pick<
	GamePresentationOwner,
	"activeRegion"
> & {
	readonly profileSource: LandblockProfileSource;
	readonly runtime: Pick<
		GamePresentationOwner["runtime"],
		| "activateScene"
		| "sceneActivationStatus"
		| "pollPortalTransitionLoading"
		| "setAudioListener"
		| "setSceneEnvironment"
		| "setPrimaryView"
		| "resolveViewportExtent"
		| "queryWorldPointResidencyCandidates"
		| "frame"
		| "clearSceneInterest"
		| "createLocalSceneModel"
		| "setPresentationLights"
	>;
};

/** Cold world reveal/error state; character preparation has its own status. */
export type ClientPregameSceneStatus =
	| { readonly kind: "loading" }
	| { readonly kind: "ready" }
	| { readonly kind: "failed"; readonly message: string }
	| { readonly kind: "stopped" };

/** Pregame world driver owns local character composition while borrowing the persistent renderer. */
export class ClientPregameScene {
	readonly #resources: ClientPregameSceneResources;
	readonly #location: ClientPregameLocation;
	/** Canonical standing position resolved once from the authored AC position. */
	readonly #stagePosition: SceneVec3;
	#camera: Camera;
	readonly #model: LocalSceneModelHandle;
	readonly #disconnectCharacter: () => void;
	readonly #unsubscribeModel: () => void;
	readonly #characterListeners = new Set<
		(status: PregameCharacterStatus) => void
	>();
	#characterStatus: PregameCharacterStatus = { kind: "empty" };
	#view: PregameCharacterView | null = null;
	#compositionDirty = true;
	#characterVisible = false;
	/** CSS size and actual drawing projection jointly invalidate character composition. */
	#viewport: {
		readonly width: number;
		readonly height: number;
		readonly aspectRatio: number | null;
	} = { width: 0, height: 0, aspectRatio: null };
	#status: ClientPregameSceneStatus = { kind: "loading" };
	#receipt: SceneActivationReceipt | null = null;
	#completion: Promise<void> | null = null;
	#closed = false;
	#previousTimeMs: number | null = null;
	#elapsedSeconds = 0;
	#lastEnvironmentSeconds = Number.NEGATIVE_INFINITY;
	#retirement: Promise<void> | null = null;

	constructor(
		resources: ClientPregameSceneResources,
		characters: ClientPregameCharacterService,
		location: ClientPregameLocation,
	) {
		this.#resources = resources;
		this.#location = location;
		// Pregame owns a silent world; gameplay installs its own listener on handoff.
		resources.runtime.setAudioListener(null);
		const { w, x, y, z } = location.camera.rotation;
		const length = Math.hypot(w, x, y, z);
		this.#camera = {
			fov: CLIENT_PREGAME_CAMERA_TUNING.fovDegrees,
			near: CLIENT_TUNING.camera.near,
			far: CLIENT_TUNING.camera.far,
			placement: {
				landblockId: location.landblockId,
				...location.camera,
				rotation: new Quat(w / length, x / length, y / length, z / length),
			},
		};
		const [standingX, standingY, standingZ] = location.character.position;
		const standing = renderVector(standingX, standingY, standingZ);
		const origin = createLandblockWorldOrigin(location.landblockId);
		this.#stagePosition = sceneVec3(
			new Vec3(origin.x + standing.x, standing.y, origin.z + standing.z),
		);
		this.#model = resources.runtime.createLocalSceneModel(
			this.#modelPlacement(0),
		);
		this.#model.setVisible(false);
		this.#unsubscribeModel = this.#model.subscribe((status) => {
			this.#compositionDirty = true;
			if (status.kind !== "ready") {
				this.#hideCharacter();
				this.#publishCharacter(
					status.kind === "failed"
						? { kind: "failed", message: status.message }
						: { kind: status.kind },
				);
			}
		});
		const sink: PregameCharacterSink = {
			setSource: (source) => this.#setCharacterSource(source),
			setView: (view) => {
				this.#view = view;
				this.#compositionDirty = true;
				if (view === null) {
					this.#hideCharacter();
					if (this.#model.status().kind === "ready")
						this.#publishCharacter({ kind: "suspended" });
				}
			},
			subscribe: (listener) => {
				this.#characterListeners.add(listener);
				listener(this.#characterStatus);
				return () => this.#characterListeners.delete(listener);
			},
		};
		this.#disconnectCharacter = characters.connect(sink);
	}

	#modelPlacement(heading: number): SceneSpatialPlacement {
		const location = this.#location;
		const localTransform = createRotationMat4(
			new Quat(Math.cos(heading / 2), 0, Math.sin(heading / 2), 0),
		);
		const origin = createLandblockWorldOrigin(location.landblockId);
		localTransform.m41 = this.#stagePosition.x - origin.x;
		localTransform.m42 = this.#stagePosition.y - origin.y;
		localTransform.m43 = this.#stagePosition.z - origin.z;
		return {
			landblockId: location.landblockId,
			envCellId: location.character.envCellId,
			localTransform,
			spatialMembership: {
				scopes: [scopeFor(location.landblockId, location.character.envCellId)],
			},
		};
	}

	#setCharacterSource(source: PregameCharacterSource | null): void {
		if (source === null) this.#model.withdraw();
		else void this.#model.replace(source.subjectId, source.visual);
	}

	#publishCharacter(status: PregameCharacterStatus): void {
		if (JSON.stringify(status) === JSON.stringify(this.#characterStatus))
			return;
		this.#characterStatus = status;
		for (const listener of this.#characterListeners) listener(status);
	}

	#hideCharacter(): void {
		if (this.#characterVisible) this.#model.setVisible(false);
		this.#characterVisible = false;
		this.#resources.runtime.setPresentationLights([]);
	}

	#composeCharacter(
		width: number,
		height: number,
		aspectRatio: number | null,
	): void {
		if (
			width !== this.#viewport.width ||
			height !== this.#viewport.height ||
			aspectRatio !== this.#viewport.aspectRatio
		)
			this.#compositionDirty = true;
		if (!this.#compositionDirty) return;
		this.#compositionDirty = false;
		this.#viewport = { width, height, aspectRatio };
		const model = this.#model.status();
		if (model.kind !== "ready") return;
		const view = this.#view;
		if (view === null || aspectRatio === null) {
			this.#hideCharacter();
			this.#publishCharacter({ kind: "suspended" });
			return;
		}
		const tuning = CLIENT_PREGAME_SCENE_TUNING;
		const rotation = this.#camera.placement.rotation;
		const outcome = resolvePregameCamera({
			fit: model.fit,
			framing: view.framing,
			offset: CLIENT_PREGAME_CAMERA_TUNING[view.framing.kind],
			subject: {
				position: this.#stagePosition,
				yawOffsetRadians: view.headingRadians,
			},
			rectangle: view.rectangle,
			canvas: { width, height },
			rotation,
			projection: {
				fovDegrees: this.#camera.fov,
				aspectRatio,
			},
			margin: tuning.margin,
		});
		if (outcome.kind !== "ready") {
			this.#hideCharacter();
			this.#publishCharacter(
				outcome.kind === "suspended"
					? outcome
					: {
							kind: "limited",
							message: FRAMING_LIMITATION_MESSAGE,
						},
			);
			return;
		}
		const heading = outcome.headingRadians;
		// Framing can cross a portal. Use a unique containing cell; ambiguous/missing
		// topology retains the author's explicit camera cell without constraining motion.
		const cells = this.#resources.runtime
			.queryWorldPointResidencyCandidates(outcome.position)
			?.envCells.filter(
				(cell) =>
					cell.containsPoint && cell.landblockId === this.#location.landblockId,
			);
		const cell = cells?.length === 1 ? cells.at(0) : undefined;
		this.#model.setPlacement(this.#modelPlacement(heading));
		this.#camera = {
			...this.#camera,
			placement: {
				...this.#camera.placement,
				envCellId:
					cell === undefined ? this.#location.camera.envCellId : cell.envCellId,
				position: outcome.position,
				rotation: outcome.rotation,
			},
		};
		if (!this.#characterVisible) this.#model.setVisible(true);
		this.#characterVisible = true;
		const right = rotateRenderVector(new Vec3(1, 0, 0), rotation);
		const back = rotateRenderVector(new Vec3(0, 0, 1), rotation);
		const light = tuning.fillLight;
		this.#resources.runtime.setPresentationLights([
			{
				position: sceneVec3(
					new Vec3(
						this.#stagePosition.x +
							Math.cos(heading) * model.fit.center.x +
							Math.sin(heading) * model.fit.center.z +
							right.x * light.offset.x +
							back.x * light.offset.z,
						this.#stagePosition.y + model.fit.center.y + light.offset.y,
						this.#stagePosition.z -
							Math.sin(heading) * model.fit.center.x +
							Math.cos(heading) * model.fit.center.z +
							right.z * light.offset.x +
							back.z * light.offset.z,
					),
				),
				color: light.color,
				intensity: light.intensity,
				range: light.range,
			},
		]);
		this.#publishCharacter({ kind: "ready", replacement: model.replacement });
	}

	status(): ClientPregameSceneStatus {
		return this.#status;
	}

	/** One installation receipt per controller, including when start is called repeatedly. */
	start(): Promise<void> {
		if (this.#closed) throw new Error("Cannot start a retired pregame scene.");
		return (this.#completion ??= this.#install());
	}

	async #install(): Promise<void> {
		try {
			const tuning = CLIENT_PREGAME_SCENE_TUNING;
			const target = await resolveSceneInterestRequest(
				{
					kind: "env-cell",
					landblockId: this.#location.landblockId,
					envCellId: this.#location.camera.envCellId,
				},
				tuning.radii,
				this.#resources.profileSource,
			);
			if (this.#closed) return;
			this.#receipt = await this.#resources.runtime.activateScene({
				generation: 0,
				target,
			});
		} catch (error) {
			if (!this.#closed)
				this.#status = {
					kind: "failed",
					message: error instanceof Error ? error.message : String(error),
				};
			throw error;
		}
	}

	/** Drain static work even while reveal is gated; return whether a world frame was drawn. */
	frame(timeMs: number, width: number, height: number): boolean {
		if (this.#closed || this.#status.kind === "failed") return false;
		try {
			const { runtime, activeRegion } = this.#resources;
			runtime.pollPortalTransitionLoading();
			if (this.#receipt === null) return false;
			const status = runtime.sceneActivationStatus(this.#receipt);
			if (status.kind === "failed") {
				this.#status = { kind: "failed", message: status.diagnostic };
				this.#hideCharacter();
				return false;
			}
			if (status.kind !== "ready") return false;
			if (this.#status.kind !== "ready") this.#status = { kind: "ready" };
			const extent =
				width > 0 && height > 0
					? runtime.resolveViewportExtent(width, height)
					: null;
			this.#composeCharacter(
				width,
				height,
				extent === null ? null : extent.width / extent.height,
			);
			if (extent === null) return false;
			if (this.#previousTimeMs !== null)
				this.#elapsedSeconds +=
					Math.max(0, timeMs - this.#previousTimeMs) / 1000;
			this.#previousTimeMs = timeMs;
			if (
				(this.#elapsedSeconds - this.#lastEnvironmentSeconds) * 1000 >=
				CLIENT_ENVIRONMENT_INTERVAL_MS
			) {
				const tuning = CLIENT_PREGAME_SCENE_TUNING;
				const day =
					tuning.timeOfDay +
					this.#elapsedSeconds / activeRegion.data.calendar.dayLength;
				runtime.setSceneEnvironment(
					resolveSceneEnvironment(activeRegion, {
						dayIndex: tuning.dayIndex + Math.floor(day),
						timeOfDay: day % 1,
						dayGroupOverride: null,
					}),
				);
				this.#lastEnvironmentSeconds = this.#elapsedSeconds;
			}
			runtime.setPrimaryView({
				camera: this.#camera,
				extent,
			});

			runtime.frame(timeMs / 1000);
			return true;
		} catch (cause) {
			completePresentationOperations([
				() => this.#hideCharacter(),
				() => {
					throw cause;
				},
			]);
			throw cause;
		}
	}

	/** Retire only borrowed scene demand; the root must await this before installing another driver. */
	destroy(): Promise<void> {
		return (this.#retirement ??= this.#destroy());
	}

	async #destroy(): Promise<void> {
		this.#closed = true;
		this.#status = { kind: "stopped" };
		this.#disconnectCharacter();
		this.#unsubscribeModel();
		this.#hideCharacter();
		this.#characterListeners.clear();
		const modelRetirement = this.#model.destroy();
		// Startup reports its own failure; retirement still drains it and withdraws scene demand.
		const [modelResult] = await Promise.allSettled([
			modelRetirement,
			this.#completion,
		] as const);
		completePresentationOperations([
			() => this.#resources.runtime.setAudioListener(null),
			() => {
				this.#resources.runtime.clearSceneInterest();
			},
			...(modelResult.status === "rejected"
				? [
						() => {
							throw modelResult.reason;
						},
					]
				: []),
		]);
	}
}
