import type { AppInput } from "../lib/input/app-input";
import type { KeyboardInputPolicy } from "../lib/input/keyboard-input-policy";
import type {
	DynamicEntityMirror,
	RestPosture,
} from "../lib/game/runtime/dynamic-entity-feed";
import type {
	ClientLifecycleSession,
	ClientLifecycleSessionState,
} from "./client-lifecycle-session";
import { playerMotionUpdate } from "./client-player-motion-update";
import { CLIENT_TUNING } from "./client-tuning";

/** Labels describe the selected target; server refusals still arrive as action feedback. */
export const REST_POSTURE_LABELS: Readonly<Record<RestPosture, string>> = {
	crouching: "Crouching",
	sitting: "Sitting",
	lying: "Lying down",
	standing: "Standing",
};

/** Gameplay routing after keyboard scope admission, shared with native-input regression tests. */
export function handleRestPostureKeydown(
	input: AppInput,
	event: KeyboardEvent,
	cycle: () => void,
): boolean {
	if (
		event.defaultPrevented ||
		event.isComposing ||
		!input.shortcut("cycleRestPosture", event)
	)
		return false;
	event.preventDefault();
	if (!event.repeat) cycle();
	return true;
}

/** The shared authority handles peace admission; this controller owns only cycle input. */
type PostureSession = Pick<
	ClientLifecycleSession,
	"subscribe" | "setRestPosture" | "cancelRestPosture"
> & {
	readonly mirror: Pick<
		DynamicEntityMirror,
		"currentEntities" | "entity" | "isAwaitingSnapshot"
	>;
	readonly state: () => Pick<
		ClientLifecycleSessionState,
		"lifecycle" | "playerGuid" | "worldGeneration"
	>;
};

/** One unconfirmed target; rapid presses advance this target rather than a stale observation. */
interface PendingCycle {
	/** Snapshots can acknowledge this target only after its command has been dispatched. */
	phase: "queued" | "submitted";
	/** Latest explicitly requested target. */
	readonly posture: RestPosture;
	/** Character whose request may still dispatch. */
	readonly character: number;
	/** Placement epoch captured at the key edge. */
	readonly generation: number;
	/** Release this target’s acknowledgement timer and Escape context. */
	readonly retire: () => void;
}

/** h3d-only ordering; the TUI requests individual postures instead. */
function nextRestPosture(posture: RestPosture | null): RestPosture {
	switch (posture) {
		case "crouching":
			return "sitting";
		case "sitting":
			return "lying";
		case "lying":
			return "standing";
		default:
			return "crouching";
	}
}

/** Cycles explicit gameplay postures without social aliases or combat restoration. */
export class ClientRestPostureController {
	readonly #session: PostureSession;
	readonly #keyboard: Pick<KeyboardInputPolicy, "bindEscapeContext">;
	/** Present each deliberate cycle target immediately, before authority confirmation. */
	readonly #onCycle: (posture: RestPosture) => void;
	readonly #reportError: (error: unknown) => void;
	readonly #unsubscribe: () => void;
	#pending: PendingCycle | null = null;
	#destroyed = false;

	constructor(
		session: PostureSession,
		keyboard: Pick<KeyboardInputPolicy, "bindEscapeContext">,
		reportError: (error: unknown) => void,
		onCycle: (posture: RestPosture) => void,
	) {
		this.#session = session;
		this.#keyboard = keyboard;
		this.#reportError = reportError;
		this.#onCycle = onCycle;
		this.#unsubscribe = session.subscribe((event) => {
			const pending = this.#pending;
			if (pending === null) return;
			const state = session.state();
			if (event.type === "resyncing") {
				this.cancel();
				return;
			}
			if (
				state.lifecycle?.kind !== "in-world" ||
				state.playerGuid !== pending.character ||
				state.worldGeneration !== pending.generation ||
				event.type === "exit-requested"
			) {
				this.forget();
				return;
			}
			if (event.type !== "dynamic") return;
			const entity = playerMotionUpdate(
				event.event,
				pending.character,
				session.mirror,
			);
			if (entity === "removed") {
				this.forget();
				return;
			}
			if (
				pending.phase === "submitted" &&
				entity !== null &&
				entity.motion?.restPosture === pending.posture
			)
				this.forget();
		});
	}

	async cycle(after: Promise<void>): Promise<void> {
		const state = this.#session.state();
		if (
			this.#destroyed ||
			state.lifecycle?.kind !== "in-world" ||
			state.playerGuid === null ||
			this.#session.mirror.isAwaitingSnapshot()
		)
			return;
		const player = Array.from(this.#session.mirror.currentEntities()).find(
			(entity) => entity.identity.guid === state.playerGuid,
		);
		const posture = nextRestPosture(
			this.#pending?.posture ?? player?.motion?.restPosture ?? null,
		);
		this.forget();
		const escape = this.#keyboard.bindEscapeContext(() => this.cancel());
		const timeout = globalThis.setTimeout(() => {
			if (this.#pending === pending) this.cancel();
		}, CLIENT_TUNING.resting.acknowledgementTimeoutMs);
		const pending: PendingCycle = {
			phase: "queued",
			posture,
			character: state.playerGuid,
			generation: state.worldGeneration,
			retire: () => {
				globalThis.clearTimeout(timeout);
				escape.release();
			},
		};
		this.#pending = pending;
		this.#onCycle(posture);
		try {
			// Claim intent at the key edge, then wait for preceding movement releases. Manual
			// combat input or Escape during that wait must prevent dispatch of this target.
			await after;
			if (this.#pending !== pending || this.#destroyed) return;
			pending.phase = "submitted";
			await this.#session.setRestPosture(posture);
		} catch (error) {
			// A stale enqueue failure cannot erase a newer deliberate press.
			if (this.#pending === pending) this.forget();
			throw error;
		}
	}

	/** A competing command already cancels core's prerequisite; drop just the local cursor. */
	forget(): void {
		this.#pending?.retire();
		this.#pending = null;
	}

	/** Escape cancels the unconfirmed request without requesting another posture. */
	cancel(): void {
		if (this.#pending === null) return;
		this.forget();
		void this.#session.cancelRestPosture().catch(this.#reportError);
	}

	destroy(): void {
		this.#destroyed = true;
		this.cancel();
		this.#unsubscribe();
	}
}
