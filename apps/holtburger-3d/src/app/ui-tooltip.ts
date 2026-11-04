import type { FrontendTuning } from "../lib/frontend-tuning-contract";

/** Pending and visible disclosure share one target; a cell cannot be both at once. */
export interface UiTooltipDisclosure<T> {
	/** Whether disclosure is waiting for dwell or has reached the surface. */
	readonly kind: "pending" | "visible";
	/** The one cell whose disclosure is owned by this state. */
	readonly target: T;
}

/** Pointer and focus lifetimes share one disclosure clock and one visible target. */
export class UiTooltipController<T> {
	#pointer: T | null = null;
	#focus: T | null = null;
	#latest: "pointer" | "focus" = "pointer";
	#suppressed = new Set<T>();
	#disclosure: UiTooltipDisclosure<T> | null = null;
	#warmUntil = -Infinity;
	#timer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly tuning: FrontendTuning["tooltips"],
		private readonly eligible: (target: T) => boolean,
		private readonly publish: (
			disclosure: UiTooltipDisclosure<T> | null,
		) => void,
		private readonly now: () => number,
	) {}

	get visible(): T | null {
		return this.#disclosure?.kind === "visible"
			? this.#disclosure.target
			: null;
	}

	/** Move between cells without restarting a pending dwell inside the same cell. */
	point(target: T | null): void {
		if (target === this.#pointer) return;
		if (this.visible !== null && this.#pointer === this.visible)
			this.#warmUntil = this.now() + this.tuning.switchGraceMs;
		this.#pointer = target;
		if (target !== null) this.#latest = "pointer";
		this.refresh();
	}

	/** Only intentional focus admitted by the existing keyboard policy reaches this method. */
	focus(target: T | null): void {
		if (target === this.#focus) return;
		this.#focus = target;
		if (target !== null) this.#latest = "focus";
		this.refresh();
	}

	/** Reconcile mutations without treating changing label text as fresh engagement. */
	refresh(): void {
		if (this.#pointer !== null && !this.eligible(this.#pointer))
			this.#pointer = null;
		if (this.#focus !== null && !this.eligible(this.#focus)) this.#focus = null;
		for (const target of this.#suppressed)
			if (target !== this.#pointer && target !== this.#focus)
				this.#suppressed.delete(target);
		if (this.visible !== null && !this.eligible(this.visible)) this.#show(null);
		const allowed = (target: T | null) =>
			target !== null && !this.#suppressed.has(target) ? target : null;
		const preferred =
			this.#latest === "pointer"
				? allowed(this.#pointer)
				: allowed(this.#focus);
		const next = preferred ?? allowed(this.#focus) ?? allowed(this.#pointer);
		if (next === this.visible && next !== null) {
			this.#cancelTimer();
			return;
		}
		if (next !== null) {
			if (
				next === this.#focus ||
				this.visible !== null ||
				this.now() < this.#warmUntil
			) {
				this.#show(next);
			} else if (!(
				this.#disclosure?.kind === "pending" && next === this.#disclosure.target
			)) {
				this.#cancelTimer();
				this.#setDisclosure({ kind: "pending", target: next });
				this.#timer = setTimeout(() => {
					this.#cancelTimer();
					if (this.eligible(next)) this.#show(next);
					else {
						this.#setDisclosure(null);
						this.refresh();
					}
				}, this.tuning.openDelayMs);
			}
		} else {
			if (this.#disclosure?.kind === "pending") {
				this.#cancelTimer();
				this.#setDisclosure(null);
			}
			if (this.visible !== null && this.#timer === undefined)
				this.#timer = setTimeout(
					() => this.#show(null),
					this.tuning.closeDelayMs,
				);
		}
	}

	/** Escape keeps a continuous hover/focus dismissed until a new engagement. */
	dismiss(): boolean {
		const wasVisible = this.visible !== null;
		if (this.#pointer !== null) this.#suppressed.add(this.#pointer);
		if (this.#focus !== null) this.#suppressed.add(this.#focus);
		this.#warmUntil = -Infinity;
		this.#show(null);
		return wasVisible;
	}

	/** Input interruption or disposal retires the whole engagement, including grace. */
	reset(): void {
		this.#pointer = null;
		this.#focus = null;
		this.#suppressed.clear();
		this.#warmUntil = -Infinity;
		this.#show(null);
	}

	#cancelTimer(): void {
		clearTimeout(this.#timer);
		this.#timer = undefined;
	}

	#show(target: T | null): void {
		this.#cancelTimer();
		this.#setDisclosure(target === null ? null : { kind: "visible", target });
	}

	/** Publish every lifetime transition, including cancelled/invalid delayed opens. */
	#setDisclosure(disclosure: UiTooltipDisclosure<T> | null): void {
		if (
			disclosure?.kind === this.#disclosure?.kind &&
			disclosure?.target === this.#disclosure?.target
		)
			return;
		this.#disclosure = disclosure;
		this.publish(disclosure);
	}
}
