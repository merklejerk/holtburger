import { getContext, setContext } from "svelte";
import { SvelteMap } from "svelte/reactivity";

/** Independently disclosed item properties; missing duration still permits countdown text. */
export interface ItemCooldownDefinition {
	/** Player-owned timer membership, absent for duration-only appraisal. */
	readonly groupId: number | null;
	/** Configured on-use duration used to scale the icon fill. */
	readonly durationSeconds: number | null;
}

/** Server timer aged from the enclosing snapshot's receipt clock. */
interface GroupCooldown {
	/** Shared membership produced by the world layer. */
	readonly groupId: number;
	/** Seconds remaining when the snapshot was produced. */
	readonly remainingSeconds: number;
}

/** Immutable animation inputs; second-boundary text updates never change these. */
export interface ItemCooldownAnimation {
	/** Browser monotonic deadline shared by every item in the group. */
	readonly deadlineMs: number;
	/** Positive configured duration, used only for percentage fill. */
	readonly durationSeconds: number;
}

const ITEM_COOLDOWNS = Symbol("item-cooldowns");

/** Native tooltips need reading time; inspection can show a finer countdown. */
export const ITEM_COOLDOWN_CADENCE_SECONDS = {
	tooltip: 5,
	inspection: 1,
} as const;

/** A mounted countdown's independent cadence, always capped by its actual expiry. */
interface CountdownSubscription {
	/** Group deadline in the browser's monotonic clock. */
	readonly deadlineMs: number;
	/** Requested text refresh interval, independent of CSS animation. */
	readonly intervalMs: number;
	/** Next text publication, unaffected by other consumers mounting or unmounting. */
	nextSampleMs: number;
}

/** Derived deadlines and one shared text clock; icon artwork is never sampled here. */
export class ItemCooldowns {
	readonly #deadlines = new SvelteMap<number, number>();
	readonly #listeners = new Map<
		(seconds: number) => void,
		CountdownSubscription
	>();
	readonly #now: () => number;
	#timer: ReturnType<typeof setTimeout> | null = null;

	constructor(now: () => number) {
		this.#now = now;
	}

	/** Replace an atomic server view; no local item-use prediction starts timers. */
	replace(
		snapshot: {
			readonly cooldowns: readonly GroupCooldown[];
			readonly receivedAtMs: number;
		} | null,
	): void {
		const incoming = new Map(
			snapshot?.cooldowns.map((timer) => [
				timer.groupId,
				snapshot.receivedAtMs + timer.remainingSeconds * 1000,
			]) ?? [],
		);
		for (const group of this.#deadlines.keys())
			if (!incoming.has(group)) this.#deadlines.delete(group);
		for (const [group, deadline] of incoming)
			this.#deadlines.set(group, deadline);
	}

	/** Keyed reactive lookup: cells without membership never observe the group map. */
	deadline(group: number): number | undefined {
		return this.#deadlines.get(group);
	}

	/** Subscribe only mounted active countdowns; one timeout serves all consumers. */
	watch(
		deadline: number,
		intervalSeconds: number,
		publish: (seconds: number) => void,
	): () => void {
		this.#listeners.set(publish, {
			deadlineMs: deadline,
			intervalMs: intervalSeconds * 1000,
			nextSampleMs: this.#now(),
		});
		this.#sample();
		return () => {
			this.#listeners.delete(publish);
			this.#sample();
		};
	}

	#sample = (): void => {
		if (this.#timer !== null) clearTimeout(this.#timer);
		this.#timer = null;
		const now = this.#now();
		let next = Infinity;
		for (const [publish, subscription] of this.#listeners) {
			if (now >= subscription.nextSampleMs) {
				const remaining = Math.max(0, subscription.deadlineMs - now);
				publish(Math.ceil(remaining / 1000));
				if (remaining === 0) {
					this.#listeners.delete(publish);
					continue;
				}
				subscription.nextSampleMs = Math.min(
					subscription.deadlineMs,
					now + subscription.intervalMs,
				);
			}
			next = Math.min(next, subscription.nextSampleMs - now);
		}
		if (next !== Infinity)
			this.#timer = setTimeout(this.#sample, Math.max(1, next));
	};
}

/** Optional app capability: explorer/showcase cells have no player cooldown source. */
export function provideItemCooldowns(): ItemCooldowns {
	return setContext(ITEM_COOLDOWNS, new ItemCooldowns(() => performance.now()));
}

/** Observe a cell's group, subscribing to seconds only while its countdown is active. */
export function useItemCooldown(
	definition: () => ItemCooldownDefinition | null,
	cadence: keyof typeof ITEM_COOLDOWN_CADENCE_SECONDS,
) {
	const source = getContext<ItemCooldowns | undefined>(ITEM_COOLDOWNS);
	const deadline = $derived.by(() => {
		const group = definition()?.groupId;
		return group == null ? undefined : source?.deadline(group);
	});
	let seconds = $state(0);
	$effect(() => {
		seconds = 0;
		if (deadline === undefined || source === undefined) return;
		return source.watch(
			deadline,
			ITEM_COOLDOWN_CADENCE_SECONDS[cadence],
			(remaining) => {
				seconds = remaining;
			},
		);
	});
	// Text publication never restarts animation; only activation, correction, or expiry does.
	const active = $derived(seconds > 0);
	const animation = $derived.by<ItemCooldownAnimation | null>(() => {
		const duration = definition()?.durationSeconds;
		return active && deadline !== undefined && duration != null && duration > 0
			? { deadlineMs: deadline, durationSeconds: duration }
			: null;
	});
	return {
		get seconds(): number {
			return seconds;
		},
		get animation(): ItemCooldownAnimation | null {
			return animation;
		},
	};
}
