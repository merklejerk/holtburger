/** The two app surfaces that need server-pushed fellowship vitals. */
export type PartyUpdateConsumer = "management" | "hud";

/** Session-owned demand; serialized requests always sample the latest surface state. */
export class ClientPartyUpdates {
	readonly #send: (enabled: boolean) => Promise<void>;
	readonly #report: (error: unknown) => void;
	readonly #consumers = new Set<PartyUpdateConsumer>();
	#active = false;
	#epoch = 0;
	/** False is known before this owner has ever requested updates. */
	#applied: boolean | null = false;
	#tail: Promise<void> = Promise.resolve();

	constructor(
		send: (enabled: boolean) => Promise<void>,
		report: (error: unknown) => void,
	) {
		this.#send = send;
		this.#report = report;
	}

	setDemand(consumer: PartyUpdateConsumer, enabled: boolean): void {
		if (enabled) this.#consumers.add(consumer);
		else this.#consumers.delete(consumer);
		this.#reconcile();
	}

	/** Recovery and world re-entry refresh active demand with a new full server snapshot. */
	setActive(active: boolean, recover: boolean): void {
		if (active === this.#active && !recover) return;
		this.#active = active;
		this.#epoch++;
		if (
			recover ||
			this.#applied !== false ||
			(active && this.#consumers.size > 0)
		)
			this.#applied = null;
		this.#reconcile();
	}

	stop(): void {
		this.#active = false;
		this.#epoch++;
		this.#consumers.clear();
		// A restarted browser session may still attach to the same subscribed host.
		if (this.#applied !== false) this.#applied = null;
	}

	#reconcile(): void {
		this.#tail = this.#tail.then(async () => {
			if (!this.#active) return;
			const enabled = this.#consumers.size > 0;
			if (enabled === this.#applied) return;
			const epoch = this.#epoch;
			// An interrupted or failed dispatch leaves server state unknown.
			this.#applied = null;
			try {
				await this.#send(enabled);
				if (epoch === this.#epoch) this.#applied = enabled;
			} catch (error) {
				if (epoch === this.#epoch) this.#report(error);
			}
		});
	}
}
