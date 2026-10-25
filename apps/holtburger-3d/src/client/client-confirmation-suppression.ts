import type { ClientLifecycleSessionEvent } from "./client-lifecycle-session";

/** A checked, accepted confirmation grants one hour for that feature in the character session. */
export const LOCAL_CONFIRMATION_SUPPRESSION_MS = 60 * 60 * 1_000;

/** Each feature owns an independent deadline; ordinary actions never extend it. */
export class ClientConfirmationSuppression {
	#until = 0;

	get active(): boolean {
		return Date.now() < this.#until;
	}

	suppressForHour(): void {
		this.#until = Date.now() + LOCAL_CONFIRMATION_SUPPRESSION_MS;
	}

	/** Portal travel and snapshot recovery stay within the same character session. */
	receive(event: ClientLifecycleSessionEvent): void {
		const lifecycle =
			event.type === "current-state"
				? event.state.lifecycle
				: event.type === "lifecycle"
					? event.lifecycle
					: null;
		if (
			lifecycle !== null &&
			lifecycle.kind !== "in-world" &&
			lifecycle.kind !== "portal-space"
		)
			this.#until = 0;
	}
}
