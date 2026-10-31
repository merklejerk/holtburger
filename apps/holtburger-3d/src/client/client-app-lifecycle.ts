import type { ClientLoadingPageState } from "./client-loading-page";
import { clientFailureDiagnostic as errorMessage } from "./client-close-contract";
import {
	abortError,
	isAbortError,
	awaitWithAbort,
} from "../lib/async-lifetime";
import type { ClientPresentationRootFrame } from "./client-presentation-root";
import type { ClientLifecycleSession } from "./client-lifecycle-session";
import type {
	ClientExitRequested,
	ClientLifecycle,
} from "./client-host-contract";

/** Session recovery carries an admitted retry action in addition to display-only page content. */
type ClientSessionLoadingPageState =
	| Exclude<ClientLoadingPageState, { kind: "failed" }>
	| (Extract<ClientLoadingPageState, { kind: "failed" }> & {
			/** Only the session/scene owner can admit a retry. */
			readonly retry: (() => void) | null;
	  });

/** Authority phases plus app-owned roster selection and explicit shutdown completion. */
export type ClientAppPhase =
	| Exclude<
			ClientLifecycle,
			{ readonly kind: "character-selection" | "exiting" }
	  >
	| (Extract<ClientLifecycle, { readonly kind: "character-selection" }> & {
			readonly selectedGuid: number | null;
	  })
	| {
			readonly kind: "closing" | "closed";
			readonly exit: ClientExitRequested | null;
	  };

/** Visible app surface, with a roster present only when its scene is admitted. */
type ClientAppSurface =
	| { readonly kind: "gameplay" }
	| {
			readonly kind: "selection";
			readonly selection: Extract<
				ClientAppPhase,
				{ readonly kind: "character-selection" }
			>;
	  }
	| { readonly kind: "loading" };

type ClientAppPhaseAction =
	| { readonly type: "authority"; readonly lifecycle: ClientLifecycle }
	| { readonly type: "select"; readonly guid: number };

/** Initial launch state before the host's atomic current-state response arrives. */
function initialClientAppPhase(): ClientAppPhase {
	return { kind: "connecting" };
}

/** Whether this authority phase uses the gameplay driver and HUD; world resources also exist pre-game. */
function clientLifecycleUsesGameplayPresentation(
	state: ClientAppPhase,
): boolean {
	return (
		state.kind === "entering-world" ||
		state.kind === "portal-space" ||
		state.kind === "in-world"
	);
}

/** Whether the frontend owns live character input for this authority phase. */
function clientLifecycleEnablesGameplayInput(state: ClientAppPhase): boolean {
	return state.kind === "in-world";
}

/**
 * Applies one authority or local-selection edge without introducing retry or credential state.
 * Terminal exit is absorbing: a late lifecycle packet cannot resurrect a closed client shell.
 */
function reduceClientAppPhase(
	state: ClientAppPhase,
	action: ClientAppPhaseAction,
): ClientAppPhase {
	if (state.kind === "closing" || state.kind === "closed") return state;

	switch (action.type) {
		case "authority":
			return fromAuthorityLifecycle(state, action.lifecycle);
		case "select":
			if (state.kind !== "character-selection") return state;
			if (
				!state.characters.some((character) => character.guid === action.guid)
			) {
				return state;
			}
			return { ...state, selectedGuid: action.guid };
	}
}

function fromAuthorityLifecycle(
	previous: ClientAppPhase,
	lifecycle: ClientLifecycle,
): ClientAppPhase {
	if (lifecycle.kind !== "character-selection") {
		return lifecycle.kind === "exiting"
			? { kind: "closing", exit: null }
			: lifecycle;
	}

	// Preserve a valid choice on refresh; otherwise select the first available character.
	const firstCharacter = lifecycle.characters[0];
	const selectedGuid =
		previous.kind === "character-selection" &&
		previous.selectedGuid !== null &&
		lifecycle.characters.some(
			(character) => character.guid === previous.selectedGuid,
		)
			? previous.selectedGuid
			: firstCharacter === undefined
				? null
				: firstCharacter.guid;
	return { ...lifecycle, selectedGuid };
}

/** Cold renderer readiness; frame poses and renderer resources stay outside app state. */
export type ClientAppScene =
	| { readonly kind: "loading" | "ready" | "stopped" }
	| {
			readonly kind: "failed";
			readonly message: string;
			readonly canRetry: boolean;
	  };

const LOADING_SCENE: ClientAppScene = { kind: "loading" };

/** App intents are distinct from the server's authoritative phase. */
type ClientAppOperation = "idle" | "enter" | "return" | "disconnect" | "quit";

/** One coherent admission decision, recomputed only when app inputs change. */
interface ClientAppAdmission {
	/** Requested driver; resource switching remains presentation-owned. */
	readonly mode: "idle" | "pregame" | "gameplay";
	/** Enables character control only while the world is interactive and no session action is pending. */
	readonly gameplayInput: boolean;
	/** Admitted surface, including the exact roster it may display. */
	readonly page: ClientAppSurface;
	/** A rendered frame may be revealed only alongside its admitted surface. */
	readonly canvasVisible: boolean;
	/** Exact selected character admitted for entry; null rejects the intent. */
	readonly entryGuid: number | null;
	/** Return is a character logout on the existing connection. */
	readonly canReturn: boolean;
	/** Disconnect can interrupt entry but cannot duplicate another exit action. */
	readonly canDisconnect: boolean;
}

/** Immutable cold app snapshot shared by page, input, and presentation consumers. */
export interface ClientAppLifecycleState {
	/** Current authority projection, enriched only with frontend selection and terminal completion. */
	readonly phase: ClientAppPhase;
	/** Latest cold readiness or failure from the presentation owner. */
	readonly scene: ClientAppScene;
	/** Whether the latest presentation frame contains a drawable scene. */
	readonly rendered: boolean;
	/** Pending command admission, independent of server acknowledgement. */
	readonly operation: ClientAppOperation;
	/** App-level failures stop interaction while preserving their original diagnostic. */
	readonly failure: {
		readonly kind: "startup" | "command";
		readonly message: string;
	} | null;
	/** Last nonterminal phase retained for expanded failure details. */
	readonly lastSessionPhase: ClientLifecycle["kind"];
	/** Return context survives roster arrival until its replacement backdrop is ready. */
	readonly returning: boolean;
	/** One owner-produced decision consumed by the UI, input, and renderer adapter. */
	readonly admission: ClientAppAdmission;
}

/** Shell effects remain injected; this owner decides when those effects are admitted. */
interface ClientAppLifecycleDependencies {
	/** The app-owned session, absent before mounting or after teardown. */
	readonly session: () => Pick<
		ClientLifecycleSession,
		| "enterWorld"
		| "logout"
		| "disconnect"
		| "cancelStartup"
		| "prepareAuthorityShutdown"
		| "stop"
	> | null;
	/** Cancel local controls and drain already-queued motion before a session command. */
	readonly stopInput: () => Promise<void>;
	/** Drain gameplay camera work before the host stops accepting session commands. */
	readonly retireGameplay: () => Promise<void>;
	/** A refused logout remains a recoverable gameplay notice. */
	readonly warn: (message: string) => void;
	/** Publish only changed cold snapshots to the shell. */
	readonly onChange: (state: ClientAppLifecycleState) => void;
}

/** App-local coordination of authority, scene readiness, and user session intents. */
/** One winning intent owns its cancellation; late completions cannot clear its replacement. */
interface AppOperation {
	readonly kind: Exclude<ClientAppOperation, "idle">;
	readonly lifetime: AbortController;
	readonly completion: Promise<void>;
}

export class ClientAppLifecycle {
	#state = initialClientAppLifecycleState();
	#operation: AppOperation | null = null;
	#withdrawal: Promise<void> | null = null;
	#disconnecting: Promise<void> | null = null;
	#localStopped = false;
	#closing: Promise<void> | null = null;
	readonly #dependencies: ClientAppLifecycleDependencies;
	constructor(dependencies: ClientAppLifecycleDependencies) {
		this.#dependencies = dependencies;
	}

	acceptAuthority(next: ClientLifecycle): void {
		const previous = this.#state;
		const phase = reduceClientAppPhase(previous.phase, {
			type: "authority",
			lifecycle: next,
		});
		if (phase === previous.phase) return;
		const modeChanged =
			clientLifecycleUsesGameplayPresentation(previous.phase) !==
			clientLifecycleUsesGameplayPresentation(phase);
		this.#update({
			...previous,
			phase,
			scene: modeChanged ? { kind: "loading" } : previous.scene,
			rendered: modeChanged ? false : previous.rendered,
			returning:
				phase.kind === "character-selection"
					? previous.returning
					: phase.kind === "logging-out",
			lastSessionPhase:
				phase.kind === "closing" || phase.kind === "closed"
					? previous.lastSessionPhase
					: phase.kind,
		});
		if (phase.kind === "closing") {
			if (this.#operation?.kind !== "quit")
				this.#operation?.lifetime.abort(abortError("Authority is ending."));
			this.#observeWithdrawal();
		}
	}
	acceptExit(exit: ClientExitRequested): void {
		const phase = this.#state.phase;
		if (
			(phase.kind === "closing" || phase.kind === "closed") &&
			phase.exit !== null
		)
			return;
		this.#update({
			...this.#state,
			phase: { kind: phase.kind === "closed" ? "closed" : "closing", exit },
		});
		if (this.#operation?.kind !== "quit")
			this.#operation?.lifetime.abort(abortError("Authority ended."));
		this.#observeWithdrawal();
	}

	select(guid: number): void {
		if (
			this.#state.admission.page.kind !== "selection" ||
			this.#state.operation !== "idle"
		)
			return;
		this.#update({
			...this.#state,
			phase: reduceClientAppPhase(this.#state.phase, { type: "select", guid }),
		});
	}
	/** Reduce the driver's frame to readiness only; never retain its poses or render data. */
	acceptPresentation(frame: ClientPresentationRootFrame): void {
		const scene =
			frame.kind === "failed"
				? frame
				: frame.kind === "pregame"
					? frame.status.kind === "failed"
						? { ...frame.status, canRetry: true }
						: frame.status
					: LOADING_SCENE;
		const rendered =
			frame.kind === "gameplay"
				? frame.frame.rendered
				: frame.kind === "pregame" && frame.rendered;
		this.acceptScene(scene, rendered);
	}

	/** Publish only cold changes, even though the presentation driver is sampled every frame. */
	acceptScene(scene: ClientAppScene, rendered: boolean): void {
		const previous = this.#state.scene;
		if (
			rendered === this.#state.rendered &&
			previous.kind === scene.kind &&
			(previous.kind !== "failed" ||
				(scene.kind === "failed" &&
					previous.message === scene.message &&
					previous.canRetry === scene.canRetry))
		)
			return;
		this.#update({ ...this.#state, scene, rendered });
	}
	fail(kind: "startup" | "command", message: string): void {
		this.#recordFailure(kind, message);
		if (this.#operation?.kind !== "quit")
			this.#operation?.lifetime.abort(abortError("App stopped after failure."));
		this.#observeWithdrawal();
	}
	#recordFailure(kind: "startup" | "command", message: string): void {
		const previous = this.#state.failure;
		if (previous?.message === message) return;
		this.#update({
			...this.#state,
			failure:
				previous === null
					? { kind, message }
					: { kind: previous.kind, message: `${previous.message}\n${message}` },
		});
	}
	/** Startup cancellation is an expected withdrawal, not a second client failure. */
	async start(request: () => Promise<void>): Promise<void> {
		try {
			await request();
		} catch (error) {
			if (!isAbortError(error)) this.fail("startup", errorMessage(error));
		}
	}
	async enter(): Promise<void> {
		const session = this.#dependencies.session();
		const guid = this.#state.admission.entryGuid;
		if (session === null || guid === null) return;
		await this.#operate("enter", async (signal) => {
			signal.throwIfAborted();
			await session.enterWorld(guid);
		});
	}
	async returnToSelection(): Promise<void> {
		const session = this.#dependencies.session();
		if (session === null || !this.#state.admission.canReturn) return;
		await this.#operate("return", async (signal) => {
			await awaitWithAbort(this.#dependencies.stopInput(), signal);
			signal.throwIfAborted();
			await session.logout();
		});
	}
	async disconnect(): Promise<void> {
		const session = this.#dependencies.session();
		if (session === null || !this.#state.admission.canDisconnect) return;
		await this.#operate("disconnect", async (signal) => {
			// Cleanup failure is retained, but cannot prevent the attempt from reaching host Disconnect.
			try {
				await awaitWithAbort(this.#withdraw(), signal);
			} catch (error) {
				if (isAbortError(error)) throw error;
			}
			signal.throwIfAborted();
			this.#disconnecting = session.disconnect().then(() => {
				this.#localStopped = true;
				this.#completeStop();
			});
			await this.#disconnecting;
		});
	}
	/** Renderer preparation stays withdrawn until this document retires; every independent flush still runs. */
	prepareClose(prepareResources: () => Promise<void>): Promise<void> {
		if (this.#closing !== null) return this.#closing;
		this.#closing = this.#operate("quit", async () => {
			const errors: unknown[] = [];
			const attempt = async (work: () => void | Promise<void>) => {
				try {
					await work();
				} catch (error) {
					errors.push(error);
				}
			};
			await attempt(() => this.#withdraw());
			const session = this.#dependencies.session();
			session?.prepareAuthorityShutdown();
			session?.stop();
			const disconnecting = this.#disconnecting;
			if (disconnecting !== null) await attempt(() => disconnecting);
			await attempt(prepareResources);
			if (errors.length)
				throw new AggregateError(errors, "Client close preparation failed.");
		});
		return this.#closing;
	}
	#withdraw(): Promise<void> {
		if (this.#withdrawal !== null) return this.#withdrawal;
		this.#dependencies.session()?.cancelStartup();
		this.#withdrawal = (async () => {
			const errors: unknown[] = [];
			try {
				await this.#dependencies.stopInput();
			} catch (error) {
				errors.push(error);
			}
			try {
				await this.#dependencies.retireGameplay();
			} catch (error) {
				errors.push(error);
			}
			if (errors.length)
				throw new AggregateError(errors, "Client retirement failed.");
		})();
		void this.#withdrawal.catch((error) =>
			this.#recordFailure("command", errorMessage(error)),
		);
		return this.#withdrawal;
	}
	#observeWithdrawal(): void {
		void this.#withdraw().then(
			() => this.#completeStop(),
			() => this.#completeStop(),
		);
	}
	#completeStop(): void {
		const phase = this.#state.phase;
		if (phase.kind === "closed") return;
		if (
			this.#localStopped ||
			(phase.kind === "closing" && phase.exit !== null)
		) {
			this.#update({
				...this.#state,
				phase: {
					kind: "closed",
					exit: phase.kind === "closing" ? phase.exit : null,
				},
			});
		}
	}
	#operate(
		kind: AppOperation["kind"],
		request: (signal: AbortSignal) => Promise<void>,
	): Promise<void> {
		this.#operation?.lifetime.abort(abortError("Session intent superseded."));
		const operation: AppOperation = {
			kind,
			lifetime: new AbortController(),
			completion: Promise.resolve().then(async () => {
				try {
					operation.lifetime.signal.throwIfAborted();
					await awaitWithAbort(
						request(operation.lifetime.signal),
						operation.lifetime.signal,
					);
				} catch (error) {
					if (isAbortError(error)) return;
					if (kind === "quit") {
						this.#recordFailure("command", errorMessage(error));
						throw error;
					}
					if (this.#operation !== operation) return;
					if (kind === "return") this.#dependencies.warn(errorMessage(error));
					else this.fail("command", errorMessage(error));
				} finally {
					if (this.#operation === operation && kind !== "quit") {
						this.#operation = null;
						this.#update({ ...this.#state, operation: "idle" });
					}
				}
			}),
		};
		this.#operation = operation;
		this.#update({ ...this.#state, operation: kind });
		return operation.completion;
	}

	#update(state: Omit<ClientAppLifecycleState, "admission">): void {
		this.#state = { ...state, admission: admitClientApp(state) };
		this.#dependencies.onChange(this.#state);
	}
}

/** Initial launch before listeners receive the host's atomic current-state response. */
export function initialClientAppLifecycleState(): ClientAppLifecycleState {
	const state = {
		phase: initialClientAppPhase(),
		scene: { kind: "loading" } as const,
		rendered: false,
		operation: "idle" as const,
		failure: null,
		lastSessionPhase: "connecting" as const,
		returning: false,
	};
	return { ...state, admission: admitClientApp(state) };
}

function admitClientApp(
	state: Omit<ClientAppLifecycleState, "admission">,
): ClientAppAdmission {
	const terminal =
		state.phase.kind === "closing" || state.phase.kind === "closed";
	const healthy =
		state.failure === null &&
		state.scene.kind !== "failed" &&
		!terminal &&
		state.operation !== "disconnect" &&
		state.operation !== "quit";
	const mode =
		terminal ||
		state.failure !== null ||
		state.operation === "disconnect" ||
		state.operation === "quit"
			? "idle"
			: clientLifecycleUsesGameplayPresentation(state.phase)
				? "gameplay"
				: "pregame";
	const gameplayPage = healthy && mode === "gameplay";
	const selectionPage =
		healthy &&
		state.phase.kind === "character-selection" &&
		state.scene.kind === "ready";
	const idle = state.operation === "idle";
	return {
		mode,
		page: gameplayPage
			? { kind: "gameplay" }
			: selectionPage && state.phase.kind === "character-selection"
				? { kind: "selection", selection: state.phase }
				: { kind: "loading" },
		gameplayInput:
			gameplayPage && idle && clientLifecycleEnablesGameplayInput(state.phase),
		canvasVisible: state.rendered && (gameplayPage || selectionPage),
		entryGuid:
			selectionPage && idle && state.phase.kind === "character-selection"
				? state.phase.selectedGuid
				: null,
		canReturn: gameplayPage && idle && state.phase.kind === "in-world",
		canDisconnect:
			!terminal &&
			state.operation !== "quit" &&
			state.operation !== "disconnect",
	};
}

/** Page projection consumes the same admission decision as input and renderer control. */
export function clientAppPage(
	state: ClientAppLifecycleState,
	context: {
		readonly worldName: string | null;
		readonly playerName: string | null;
	},
	retry: () => void,
):
	| { readonly kind: "gameplay" }
	| {
			readonly kind: "selection";
			readonly selection: Extract<
				ClientAppPhase,
				{ kind: "character-selection" }
			>;
	  }
	| {
			readonly kind: "loading";
			readonly content: ClientSessionLoadingPageState;
	  } {
	if (state.admission.page.kind !== "loading") return state.admission.page;
	return { kind: "loading", content: loadingPage(state, context, retry) };
}

function loadingPage(
	state: ClientAppLifecycleState,
	context: {
		readonly worldName: string | null;
		readonly playerName: string | null;
	},
	retry: () => void,
): ClientSessionLoadingPageState {
	const lifecycle = state.phase;
	if (state.operation === "quit")
		return {
			kind: "pending",
			activity: "disconnect",
			title: "Quitting",
			message: "Closing the application…",
		};
	if (
		lifecycle.kind === "closing" ||
		(lifecycle.kind !== "closed" && state.operation === "disconnect")
	)
		return {
			kind: "pending",
			activity: "disconnect",
			title: "Disconnecting",
			message: "Closing the game session…",
		};
	if (lifecycle.kind === "closed") {
		const exit = lifecycle.exit;
		const disconnected = {
			failed: false,
			title: "Disconnected",
			message: "You are no longer connected to the server.",
		};
		const outcome =
			exit === null
				? disconnected
				: {
						"explicit-disconnect": disconnected,
						"host-shutdown": disconnected,
						"server-disconnect": {
							failed: true,
							title:
								state.lastSessionPhase === "connecting" ||
								state.lastSessionPhase === "authenticating"
									? "Login failed"
									: "Connection lost",
							message:
								exit.diagnostic.trim().length > 0
									? exit.diagnostic
									: "The connection to the server was lost.",
						},
						"startup-failure": {
							failed: true,
							title: "Unable to connect",
							message: "The client could not connect to the server.",
						},
						"runtime-failure": {
							failed: true,
							title:
								state.lastSessionPhase === "connecting" ||
								state.lastSessionPhase === "authenticating"
									? "Login failed"
									: "Session ended",
							message: exit.diagnostic,
						},
					}[exit.cause];
		return {
			kind: "ended",
			...outcome,
			failed: outcome.failed || state.failure !== null,
			title:
				!outcome.failed && state.failure !== null
					? "Session ended with errors"
					: outcome.title,
			details:
				outcome.failed || state.failure !== null
					? [
							context.worldName === null
								? null
								: `Server: ${context.worldName}`,
							context.playerName === null
								? null
								: `Character: ${context.playerName}`,
							`Last session phase: ${state.lastSessionPhase.replaceAll("-", " ")}`,
							exit === null ? null : `Diagnostic: ${exit.diagnostic}`,
							state.failure === null
								? null
								: `Local failure: ${state.failure.message}`,
						]
							.filter((part) => part !== null)
							.join("\n")
					: null,
		};
	}

	if (state.failure?.kind === "startup")
		return {
			kind: "failed",
			title: "Client unavailable",
			message:
				"The client could not start. Restart the application to try again.",
			details: state.failure.message,
			retry: null,
		};
	if (state.failure?.kind === "command")
		return {
			kind: "failed",
			title: "Client stopped",
			message:
				"The client could not continue. Restart the application to try again.",
			details: state.failure.message,
			retry: null,
		};
	if (state.scene.kind === "failed")
		return {
			kind: "failed",
			title: "Unable to load the world",
			message: state.scene.canRetry
				? "The game world could not be loaded. Try again."
				: "The game world could not be loaded. Restart the application to try again.",
			details: state.scene.message,
			retry: state.scene.canRetry ? retry : null,
		};
	if (state.returning || state.operation === "return")
		return {
			kind: "pending",
			activity: "return",
			title: "Returning to character selection",
			message: "Returning to character selection…",
		};
	if (lifecycle.kind === "connecting")
		return {
			kind: "pending",
			activity: "connection",
			title: "Connecting",
			message: "Connecting to the server…",
		};
	if (lifecycle.kind === "authenticating")
		return {
			kind: "pending",
			activity: "connection",
			title: "Signing in",
			message: "Signing in to the server…",
		};
	return {
		kind: "pending",
		activity: "scene",
		title: "Loading",
		message: "Loading the world…",
	};
}
