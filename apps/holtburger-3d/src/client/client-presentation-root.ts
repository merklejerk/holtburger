import type { ClientPregameLocation } from "./client-pregame-tuning";
import { ClientPregameCharacterService } from "./client-pregame-character";
import {
	abortError,
	isAbortError,
	awaitWithAbort,
} from "../lib/async-lifetime";
import type { GamePresentationRuntime } from "../lib/game/runtime/game-presentation-runtime";
import {
	ClientPregameScene,
	type ClientPregameSceneResources,
	type ClientPregameSceneStatus,
} from "./client-pregame-scene";
import type {
	ClientGameplayPresentation,
	ClientGameplayPresentationFrame,
} from "./client-gameplay-presentation";
import type { FrameSettings } from "../lib/game/renderer/renderer";
import type { ClientAudioSettings } from "./client-settings-contract";

/** Browser resources owned by the root and borrowed by exactly one world driver at a time. */
export type ClientPresentationRootOwner = ClientPregameSceneResources & {
	/** Shared settings remain applicable before a gameplay adapter is attached. */
	readonly runtime: Pick<
		GamePresentationRuntime,
		"setFrameSettings" | "setAudioSettings"
	>;
	setOutputVolume(volume: number): void;
	/** Release renderer, workers and audio after both kinds of borrower have retired. */
	destroy(): Promise<void>;
};

/** Foreground policy selects world inputs; it never owns world resource lifetime. */
export type ClientPresentationMode = "pregame" | "gameplay" | "idle";

type GameplayDriver = Pick<
	ClientGameplayPresentation,
	"start" | "frame" | "destroy"
>;

type ActiveDriver = (
	| { readonly kind: "pregame"; readonly driver: ClientPregameScene }
	| { readonly kind: "gameplay"; readonly driver: GameplayDriver }
) & {
	/** Cancels the local startup wait before driver retirement joins it. */ readonly lifetime: AbortController;
};

/** Frame result is pulled imperatively; only changed status is published to cold UI. */
export type ClientPresentationRootFrame =
	| { readonly kind: "loading" }
	| {
			readonly kind: "failed";
			readonly message: string;
			readonly canRetry: boolean;
	  }
	| {
			readonly kind: "pregame";
			readonly status: ClientPregameSceneStatus;
			readonly rendered: boolean;
	  }
	| {
			readonly kind: "gameplay";
			readonly frame: ClientGameplayPresentationFrame;
	  };

interface Dependencies<TOwner extends ClientPresentationRootOwner> {
	/** Shell owns the DOM node; it stays mounted across mode changes. */
	readonly canvas: HTMLCanvasElement;
	/** Launch-selected scene retained across retries and pregame/gameplay handoffs. */
	readonly pregameLocation: ClientPregameLocation;
	readonly build: (signal: AbortSignal) => Promise<TOwner>;
	readonly createGameplay: (resources: TOwner) => GameplayDriver;
	/** Clears app references to the retired adapter before another one is created. */
	readonly onGameplayRetired: () => void;
	readonly onReady: (owner: TOwner) => void;
	readonly onError: (error: unknown) => void;
}

/** One world-resource lifetime with serialized, latest-requested scene ownership. */
export class ClientPresentationRoot<
	TOwner extends ClientPresentationRootOwner,
> {
	readonly #dependencies: Dependencies<TOwner>;
	/** Current pregame page survives world construction/retry without owning the renderer. */
	readonly pregameCharacters = new ClientPregameCharacterService();
	readonly #abort = new AbortController();
	readonly #ownerCompletion: Promise<TOwner>;
	#owner: TOwner | null = null;
	#active: ActiveDriver | null = null;
	#requested: ClientPresentationMode | null = null;
	#revision = 0;
	#transition: Promise<void> = Promise.resolve();
	/** Mode selection may stop waiting for shared construction without aborting that construction. */
	#modeWait = new AbortController();
	/** Retained after active is cleared, including a failed retirement. */
	#driverRetirement: Promise<void> = Promise.resolve();
	/** Gameplay retirement never waits for unrelated pregame content work. */
	#gameplayRetirement: Promise<void> = Promise.resolve();
	#switching = false;
	#closed = false;
	#failure: { readonly message: string; readonly canRetry: boolean } | null =
		null;
	#retirement: Promise<void> | null = null;

	constructor(dependencies: Dependencies<TOwner>) {
		this.#dependencies = dependencies;
		this.#ownerCompletion = dependencies
			.build(this.#abort.signal)
			.then((owner) => {
				this.#owner = owner;
				if (!this.#closed) dependencies.onReady(owner);
				return owner;
			});
		// Construction can reject before a mode request awaits it; retain the original rejection.
		void this.#ownerCompletion.catch(() => undefined);
	}

	/** Same-mode requests retain existing installation; explicit retry is separate. */
	setMode(mode: ClientPresentationMode): Promise<void> {
		if (this.#closed || this.#failure?.canRetry === false)
			return Promise.resolve();
		if (this.#requested === mode) return this.#transition;
		this.#requested = mode;
		return this.#switch(mode);
	}

	/** Failed static demand needs fresh dispatches, not another identical activation receipt. */
	retry(): Promise<void> {
		if (
			this.#closed ||
			this.#failure?.canRetry === false ||
			this.#requested === null
		)
			return Promise.resolve();
		return this.#switch(this.#requested);
	}

	#switch(mode: ClientPresentationMode): Promise<void> {
		this.#modeWait.abort(abortError("Presentation mode superseded."));
		this.#modeWait = new AbortController();
		const modeSignal = this.#modeWait.signal;
		this.#active?.lifetime.abort(abortError("Presentation driver superseded."));
		const revision = ++this.#revision;
		this.#switching = true;
		this.#failure = null;
		this.#transition = this.#transition
			.then(async () => {
				if (
					this.#closed ||
					revision !== this.#revision ||
					this.#failure?.canRetry === false
				)
					return;
				await this.#retireDriver();
				if (this.#closed || revision !== this.#revision) return;
				if (mode === "idle") {
					this.#switching = false;
					return;
				}
				let owner: TOwner;
				try {
					owner = await awaitWithAbort(this.#ownerCompletion, modeSignal);
				} catch (error) {
					if (
						!this.#closed &&
						revision === this.#revision &&
						!isAbortError(error)
					)
						this.#report(error, false);
					return;
				}
				if (this.#closed || revision !== this.#revision) return;
				const active: ActiveDriver =
					mode === "pregame"
						? {
								kind: "pregame",
								driver: new ClientPregameScene(
									owner,
									this.pregameCharacters,
									this.#dependencies.pregameLocation,
									() =>
										window.matchMedia("(prefers-reduced-motion: reduce)")
											.matches,
								),
								lifetime: new AbortController(),
							}
						: {
								kind: "gameplay",
								lifetime: new AbortController(),
								driver: this.#dependencies.createGameplay(owner),
							};
				// Retain the driver while startup runs so shutdown/failure can still retire it.
				this.#active = active;
				await awaitWithAbort(active.driver.start(), active.lifetime.signal);
				if (this.#closed || revision !== this.#revision) return;
				this.#switching = false;
			})
			.catch((error: unknown) => {
				if (
					!isAbortError(error) &&
					!this.#closed &&
					revision === this.#revision &&
					this.#failure?.canRetry !== false
				)
					this.#report(error, true);
			});
		return this.#transition;
	}

	setFrameSettings(settings: FrameSettings): void {
		this.#owner?.runtime.setFrameSettings(settings);
	}

	setAudioSettings(settings: ClientAudioSettings): void {
		this.#owner?.setOutputVolume(settings.muted ? 0 : settings.masterVolume);
		this.#owner?.runtime.setAudioSettings({
			effectVolume: settings.effectVolume,
			ambientVolume: settings.ambientVolume,
		});
	}

	/** The caller schedules one world loop. Each driver retains its own proven tick/render order. */
	frame(timeMs: number): ClientPresentationRootFrame {
		if (this.#failure !== null) return { kind: "failed", ...this.#failure };
		if (this.#closed) return { kind: "loading" };
		try {
			if (this.#switching || this.#active === null) {
				this.#owner?.runtime.pollPortalTransitionLoading();
				return { kind: "loading" };
			}
			if (this.#active.kind === "gameplay")
				return { kind: "gameplay", frame: this.#active.driver.frame(timeMs) };
			const rendered = this.#active.driver.frame(
				timeMs,
				this.#dependencies.canvas.clientWidth,
				this.#dependencies.canvas.clientHeight,
			);
			return {
				kind: "pregame",
				status: this.#active.driver.status(),
				rendered,
			};
		} catch (error) {
			return {
				kind: "failed",
				message: this.#report(error, true),
				canRetry: true,
			};
		}
	}

	#report(error: unknown, canRetry: boolean): string {
		const message = error instanceof Error ? error.message : String(error);
		this.#failure = { message, canRetry };
		this.#dependencies.onError(error);
		return message;
	}

	/** Cancel and join actual gameplay borrowers, irrespective of requested mode or static loading. */
	retireGameplay(): Promise<void> {
		void this.setMode("idle");
		if (this.#active?.kind === "gameplay") return this.#retireDriver();
		return this.#gameplayRetirement;
	}

	#retireDriver(): Promise<void> {
		const active = this.#active;
		if (active === null) return this.#driverRetirement;
		this.#active = null;
		active.lifetime.abort(abortError("Presentation driver retired."));
		const retirement = (async () => {
			try {
				await active.driver.destroy();
			} catch (error) {
				this.#report(error, false);
				throw error;
			} finally {
				if (active.kind === "gameplay") this.#dependencies.onGameplayRetired();
			}
		})();
		this.#driverRetirement = retirement;
		if (active.kind === "gameplay") this.#gameplayRetirement = retirement;
		// Status consumers and explicit barrier consumers share the original failure, without an unobserved rejection.
		void retirement.catch(() => undefined);
		return retirement;
	}

	destroy(): Promise<void> {
		if (this.#retirement !== null) return this.#retirement;
		this.#closed = true;
		this.#revision++;
		this.#modeWait.abort(abortError("Presentation root retired."));
		this.#abort.abort();
		return (this.#retirement = this.#destroy());
	}

	async #destroy(): Promise<void> {
		const failures: unknown[] = [];
		// Surface withdrawal can report a release failure; still join the driver and renderer.
		try {
			this.pregameCharacters.destroy();
		} catch (error) {
			failures.push(error);
		}
		// Stop the current borrower immediately, including startup, before awaiting the handoff lane.
		const results = await Promise.allSettled([
			this.#transition,
			this.#retireDriver(),
		]);
		failures.push(
			...results.flatMap((result) =>
				result.status === "rejected" ? [result.reason] : [],
			),
		);
		try {
			await this.#ownerCompletion;
		} catch (error) {
			if (!(error instanceof DOMException && error.name === "AbortError"))
				failures.push(error);
		}
		try {
			await this.#owner?.destroy();
		} catch (error) {
			failures.push(error);
		}
		if (failures.length > 0)
			throw new AggregateError(failures, "Presentation retirement failed.");
	}
}
