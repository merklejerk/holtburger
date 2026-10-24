import type { LandblockProfileSource } from "../lib/assets/landblock-profile-source";
import type { GamePresentationOwner } from "../lib/game/runtime/game-presentation-owner";
import type { SceneActivationReceipt } from "../lib/game/runtime/scene-availability";
import { resolveSceneInterestRequest } from "../lib/game/runtime/scene-target";
import { sceneVec3, sceneVector3 } from "../lib/assets/ac-frame";
import { Quat, Vec3 } from "../lib/game/math/types";
import type { Camera, SceneInterestRadii } from "../lib/game/runtime/types";
import { resolveSceneEnvironment } from "../lib/game/environment/scene-environment";
import { CLIENT_ENVIRONMENT_INTERVAL_MS } from "./client-environment";
import { CLIENT_TUNING } from "./client-tuning";
import { CLIENT_GRAPHICS_DEFAULTS } from "./client-settings-policy";

/** Fixed first candidate; all coordinates are the user's canonical scene-frame camera report. */
export const CLIENT_PREGAME_BACKDROP_TUNING = {
	landblockId: "0x0138ffff",
	envCellId: "0x01380180",
	position: { x: 232, y: -3.751, z: -10467.59 },
	rotation: { w: 0.995, x: -0.0998, y: 0, z: 0 },
	/** Bounded coverage also works if this candidate is classified as outdoor content. */
	radii: {
		terrainRadius: 1,
		buildingRadius: 1,
		explicitObjectRadius: 1,
		generatedObjectRadius: 1,
		envCellRadius: 0,
	} satisfies SceneInterestRadii,
	/** Local calendar starts at noon; gameplay replaces it with its server-owned clock. */
	dayIndex: 0,
	timeOfDay: 0.5,
} as const;

/** This controller borrows world presentation; it never owns browser resources or live entities. */
export type ClientPregameBackdropResources = Pick<
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
		| "frame"
		| "clearSceneInterest"
	>;
};

/** Cold reveal/error state; preview readiness and authority lifecycle remain separate. */
export type ClientPregameBackdropStatus =
	| { readonly kind: "loading" }
	| { readonly kind: "ready" }
	| { readonly kind: "failed"; readonly message: string }
	| { readonly kind: "stopped" };

/** Fixed world backdrop, independent of foreground character-preview and gameplay inputs. */
export class ClientPregameBackdrop {
	readonly #resources: ClientPregameBackdropResources;
	readonly #camera: Camera;
	#status: ClientPregameBackdropStatus = { kind: "loading" };
	#receipt: SceneActivationReceipt | null = null;
	#completion: Promise<void> | null = null;
	#closed = false;
	#visible = true;
	#resumeWithoutSound = false;
	#previousTimeMs: number | null = null;
	#elapsedSeconds = 0;
	#lastEnvironmentSeconds = Number.NEGATIVE_INFINITY;
	#retirement: Promise<void> | null = null;

	constructor(resources: ClientPregameBackdropResources) {
		this.#resources = resources;
		const tuning = CLIENT_PREGAME_BACKDROP_TUNING;
		const { w, x, y, z } = tuning.rotation;
		const length = Math.hypot(w, x, y, z);
		this.#camera = {
			fov: CLIENT_GRAPHICS_DEFAULTS.verticalFovDegrees,
			near: CLIENT_TUNING.camera.near,
			far: CLIENT_TUNING.camera.far,
			placement: {
				landblockId: tuning.landblockId,
				envCellId: tuning.envCellId,
				position: sceneVec3(
					new Vec3(tuning.position.x, tuning.position.y, tuning.position.z),
				),
				rotation: new Quat(w / length, x / length, y / length, z / length),
			},
		};
	}

	status(): ClientPregameBackdropStatus {
		return this.#status;
	}

	/** One installation receipt per controller, including when start is called repeatedly. */
	start(): Promise<void> {
		if (this.#closed)
			throw new Error("Cannot start a retired pre-game backdrop.");
		return (this.#completion ??= this.#install());
	}

	async #install(): Promise<void> {
		try {
			const tuning = CLIENT_PREGAME_BACKDROP_TUNING;
			const target = await resolveSceneInterestRequest(
				{
					kind: "env-cell",
					landblockId: tuning.landblockId,
					envCellId: tuning.envCellId,
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

	/** Keep the installed backdrop while the opaque creator owns foreground presentation. */
	setVisible(visible: boolean): void {
		if (this.#closed || this.#visible === visible) return;
		this.#visible = visible;
		this.#resumeWithoutSound = visible;
		this.#previousTimeMs = null;
		if (!visible) this.#resources.runtime.setAudioListener(null);
	}

	/** Drain static work even while reveal is gated; return whether a background frame was drawn. */
	frame(timeMs: number, width: number, height: number): boolean {
		if (this.#closed || this.#status.kind === "failed") return false;
		const { runtime, activeRegion } = this.#resources;
		runtime.pollPortalTransitionLoading();
		if (this.#receipt === null) return false;
		const status = runtime.sceneActivationStatus(this.#receipt);
		if (status.kind === "failed") {
			this.#status = { kind: "failed", message: status.diagnostic };
			return false;
		}
		if (status.kind !== "ready") return false;
		if (this.#status.kind !== "ready") this.#status = { kind: "ready" };
		if (!this.#visible || width <= 0 || height <= 0) return false;
		if (this.#previousTimeMs !== null)
			this.#elapsedSeconds += Math.max(0, timeMs - this.#previousTimeMs) / 1000;
		this.#previousTimeMs = timeMs;
		if (
			(this.#elapsedSeconds - this.#lastEnvironmentSeconds) * 1000 >=
			CLIENT_ENVIRONMENT_INTERVAL_MS
		) {
			const tuning = CLIENT_PREGAME_BACKDROP_TUNING;
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
			extent: runtime.resolveViewportExtent(width, height),
		});
		const { position, rotation, envCellId } = this.#camera.placement;
		const listener = {
			position: sceneVector3([position.x, position.y, position.z]),
			rotation,
			envCellId,
		};
		// Existing script clocks perform bounded catch-up after a hidden interval. Suppress its
		// historical sound hooks on that first frame; later authored events use normal audio policy.
		runtime.setAudioListener(this.#resumeWithoutSound ? null : listener);
		runtime.frame(timeMs / 1000);
		if (this.#resumeWithoutSound) runtime.setAudioListener(listener);
		this.#resumeWithoutSound = false;
		return true;
	}

	/** Retire only borrowed scene demand; the root must await this before installing another driver. */
	destroy(): Promise<void> {
		return (this.#retirement ??= this.#destroy());
	}

	async #destroy(): Promise<void> {
		this.#closed = true;
		this.#status = { kind: "stopped" };
		// Startup reports its own failure; retirement still drains it and withdraws scene demand.
		if (this.#completion !== null) await Promise.allSettled([this.#completion]);
		this.#resources.runtime.setAudioListener(null);
		this.#resources.runtime.clearSceneInterest();
	}
}
