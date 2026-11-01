import type { KeyboardInputPolicy } from "../lib/input/keyboard-input-policy";
import type {
	DynamicEntityEvent,
	DynamicEntityMirror,
	DynamicEntityView,
} from "../lib/game/runtime/dynamic-entity-feed";
import type {
	ClientChatRequest,
	ClientCombatMode,
} from "./client-host-contract";
import type { ClientChatComposer } from "./client-chat-composer.svelte";
import type {
	ClientLifecycleSession,
	ClientLifecycleSessionState,
} from "./client-lifecycle-session";
import { CLIENT_TUNING } from "./client-tuning";

/** Commands and authoritative facts required by this app-owned automation. */
type EmoteSession = Pick<
	ClientLifecycleSession,
	"subscribe" | "setCombatMode" | "sendChat"
> & {
	/** Batched feeds can contain ignored stale generations alongside accepted updates. */
	readonly mirror: Pick<DynamicEntityMirror, "entity">;
	/** Character and world changes invalidate the whole emote excursion. */
	readonly state: () => Pick<
		ClientLifecycleSessionState,
		"lifecycle" | "playerGuid" | "worldGeneration" | "combatMode"
	>;
};

/** Waiters retain each composer's ordering while sharing one peace request. */
interface PeaceWaiter {
	/** Resume this submission after enqueue and server confirmation. */
	readonly resolve: () => void;
	/** Reject this submission when intent changes or peace cannot be established. */
	readonly reject: (error: Error) => void;
}

/** One temporary excursion from combat, retained through held poses and their exit playback. */
interface EmoteRun {
	/** Character whose original stance may be restored. */
	readonly character: number;
	/** World placement epoch captured at the original user action. */
	readonly worldGeneration: number;
	/** Exact combat family to restore; no equipment-derived toggle. */
	readonly returnMode: Exclude<ClientCombatMode, "peace" | "unknown">;
	/** Peace admission and authoritative playback observation have different completion rules. */
	phase:
		| { kind: "peace"; enqueued: boolean; waiters: PeaceWaiter[] }
		| { kind: "playback"; status: "awaiting-start" | "active" | "idle" };
	/** Restart the bounded acknowledgement/start wait, never a duration for an active pose. */
	readonly restartTimeout: () => void;
	/** Active host-owned playback has no guessed end deadline. */
	readonly stopTimeout: () => void;
	/** Timeout and contextual Escape live as long as the queued return. */
	readonly retire: () => void;
}

/** One user-intent lifetime; cancelled asynchronous work retains only this retired scope. */
interface EmoteIntent {
	/** Saved stance and playback observation owned by this intent. */
	run: EmoteRun | null;
	/** Composed emote submissions that must enqueue before this intent can return to combat. */
	submissions: number;
}

/** Read only this player's update; absence from a delta is not a playback completion. */
function playerUpdate(
	event: DynamicEntityEvent,
	guid: number,
): DynamicEntityView | "removed" | null {
	switch (event.kind) {
		case "snapshot":
			return (
				event.snapshot.entities.find(
					(entity) => entity.identity.guid === guid,
				) ?? "removed"
			);
		case "upserted":
			return event.entity.identity.guid === guid ? event.entity : null;
		case "removed":
			return event.guid === guid ? "removed" : null;
		case "ticked":
			return (
				event.batch.updates.find((entity) => entity.identity.guid === guid) ??
				event.batch.advances.find(
					(advance) => advance.entity.identity.guid === guid,
				)?.entity ??
				null
			);
	}
}

/**
 * RETAIL DIVERGENCE: retail refuses combat emotes and reports the refusal. h3d issues ordinary
 * peace, emote, and stance requests a player can issue manually. Content still observes
 * permitted playback. Restoring retail policy removes this convenience. The mapped-command
 * census found all 74 soul emotes restricted.
 */
export class ClientEmoteController {
	readonly #session: EmoteSession;
	readonly #keyboard: Pick<KeyboardInputPolicy, "bindEscapeContext">;
	readonly #reportError: (error: unknown) => void;
	readonly #unsubscribe: () => void;
	/** Replacement retires submission admission and the queued return together. */
	#intent: EmoteIntent = { run: null, submissions: 0 };
	#destroyed = false;

	constructor(
		session: EmoteSession,
		keyboard: Pick<KeyboardInputPolicy, "bindEscapeContext">,
		reportError: (error: unknown) => void,
	) {
		this.#session = session;
		this.#keyboard = keyboard;
		this.#reportError = reportError;
		this.#unsubscribe = session.subscribe((event) => {
			if (event.type === "exit-requested" || event.type === "resyncing")
				this.cancel();
			else {
				this.#observe();
				if (event.type === "dynamic") this.#observePlayback(event.event);
			}
		});
	}

	/** Composer retains validation/history; this owner brackets the whole ordered submission. */
	async sendAll(
		requests: readonly [ClientChatRequest, ...ClientChatRequest[]],
		composer: Pick<ClientChatComposer, "sendAll">,
	): Promise<void> {
		if (this.#destroyed) throw new Error("Emote controller has stopped.");
		// Ordinary chat has no stake in the stance excursion or its cancellation lifetime.
		if (!requests.some((request) => request.kind === "soul-emote")) {
			await composer.sendAll(requests, (request) =>
				this.#session.sendChat(request),
			);
			return;
		}
		const intent = this.#intent;
		intent.submissions++;
		try {
			await composer.sendAll(requests, (request) => {
				if (intent !== this.#intent)
					throw new Error("Emote submission cancelled by newer intent.");
				return this.#send(request);
			});
		} catch (error) {
			if (intent === this.#intent) this.cancel();
			throw error;
		} finally {
			// Invalidated host requests may still settle, but no longer own current admission.
			intent.submissions--;
			if (intent === this.#intent) this.#restore();
		}
	}

	async #send(request: ClientChatRequest): Promise<void> {
		if (request.kind !== "soul-emote") {
			await this.#session.sendChat(request);
			return;
		}
		const state = this.#session.state();
		if (state.lifecycle?.kind !== "in-world" || state.playerGuid === null)
			throw new Error("Enter the world before emoting.");
		if (state.combatMode === "unknown")
			throw new Error("Wait for your combat stance before emoting.");
		const intent = this.#intent;
		if (this.#intent.run === null && state.combatMode !== "peace")
			this.#begin(state.playerGuid, state.worldGeneration, state.combatMode);
		const run = this.#intent.run;
		const phase = run?.phase;
		if (phase?.kind === "peace")
			await new Promise<void>((resolve, reject) => {
				phase.waiters.push({ resolve, reject });
			});
		const current = this.#session.state();
		if (
			this.#destroyed ||
			intent !== this.#intent ||
			current.playerGuid !== state.playerGuid ||
			current.worldGeneration !== state.worldGeneration ||
			current.lifecycle?.kind !== "in-world" ||
			current.combatMode !== "peace"
		)
			throw new Error("Emote cancelled before submission.");
		if (run?.phase.kind === "playback" && run.phase.status === "idle") {
			run.phase.status = "awaiting-start";
			run.restartTimeout();
		}
		await this.#session.sendChat(request);
	}

	#begin(
		character: number,
		worldGeneration: number,
		returnMode: EmoteRun["returnMode"],
	): void {
		const escape = this.#keyboard.bindEscapeContext(() => this.cancel());
		let timeout: ReturnType<typeof globalThis.setTimeout> | null = null;
		const stopTimeout = () => {
			if (timeout !== null) globalThis.clearTimeout(timeout);
			timeout = null;
		};
		const run: EmoteRun = {
			character,
			worldGeneration,
			returnMode,
			phase: { kind: "peace", enqueued: false, waiters: [] },
			stopTimeout,
			restartTimeout: () => {
				stopTimeout();
				timeout = globalThis.setTimeout(
					() =>
						this.#fail(
							run,
							new Error(
								"Timed out waiting for emote acknowledgement. Combat return cancelled.",
							),
						),
					CLIENT_TUNING.emotes.acknowledgementTimeoutMs,
				);
			},
			retire: () => {
				stopTimeout();
				escape.release();
			},
		};
		this.#intent.run = run;
		run.restartTimeout();
		void this.#session.setCombatMode("peace").then(
			() => {
				if (this.#intent.run !== run || run.phase.kind !== "peace") return;
				run.phase.enqueued = true;
				this.#observe();
			},
			(error: unknown) =>
				this.#fail(
					run,
					error instanceof Error ? error : new Error(String(error)),
				),
		);
	}

	#observe(): void {
		const run = this.#intent.run;
		if (run === null) return;
		const state = this.#session.state();
		if (
			state.lifecycle?.kind !== "in-world" ||
			state.playerGuid !== run.character ||
			state.worldGeneration !== run.worldGeneration
		) {
			this.cancel();
			return;
		}
		if (
			run.phase.kind === "peace" &&
			run.phase.enqueued &&
			state.combatMode === "peace"
		) {
			const waiters = run.phase.waiters;
			run.phase = { kind: "playback", status: "awaiting-start" };
			run.restartTimeout();
			for (const waiter of waiters) waiter.resolve();
		} else if (run.phase.kind === "playback" && state.combatMode !== "peace")
			this.cancel();
	}

	#observePlayback(event: DynamicEntityEvent): void {
		const run = this.#intent.run;
		if (run === null || run.phase.kind !== "playback") return;
		const entity = playerUpdate(event, run.character);
		if (entity === "removed") {
			this.cancel();
			return;
		}
		if (
			entity !== null &&
			this.#session.mirror.entity(run.character, entity.generation) !== entity
		)
			return;
		if (entity?.motion?.activity === "emote") {
			run.phase.status = "active";
			run.stopTimeout();
		} else if (
			entity?.motion?.activity === "locomotion" &&
			run.phase.status === "active"
		) {
			run.phase.status = "idle";
			this.#restore();
		}
	}

	#restore(): void {
		const run = this.#intent.run;
		if (
			run === null ||
			run.phase.kind !== "playback" ||
			run.phase.status !== "idle" ||
			this.#intent.submissions !== 0
		)
			return;
		this.#intent.run = null;
		run.retire();
		void this.#session.setCombatMode(run.returnMode).catch(this.#reportError);
	}

	#fail(run: EmoteRun, error: Error): void {
		// A late receipt from an invalidated run cannot cancel its replacement.
		if (this.#intent.run !== run) return;
		const phase = run.phase;
		this.#invalidate(error);
		if (phase.kind === "playback") this.#reportError(error);
	}

	/** Every explicit stance action invalidates the queued return, including repeated peace requests. */
	cancel(): void {
		this.#invalidate(new Error("Pending emote cancelled."));
	}

	/** Retirement invalidates both the queued return and any unsent submission remainder. */
	#invalidate(error: Error): void {
		const run = this.#intent.run;
		this.#intent = { run: null, submissions: 0 };
		if (run === null) return;
		run.retire();
		if (run.phase.kind === "peace")
			for (const waiter of run.phase.waiters) waiter.reject(error);
	}

	destroy(): void {
		this.#destroyed = true;
		this.cancel();
		this.#unsubscribe();
	}
}
