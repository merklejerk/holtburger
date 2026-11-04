import { tick } from "svelte";
import { showVisualPopover } from "../app/visual-popover";
import {
	progressionTargetKey,
	type StatTarget,
} from "./client-character-sheet-contract";
import type { ClientCharacterSheetState } from "./client-character-sheet-state";
import type { ProgressionGain } from "./client-progression-gain";
import { CLIENT_TUNING } from "./client-tuning";

/** The panel supplies visibility and the revision committed by its normal display sampler. */
interface ProgressionFeedbackDisplay {
	readonly owner: ClientCharacterSheetState;
	readonly visible: boolean;
	readonly revision: number;
}

/** Visible-only presentation owner; each label/ring has an independent, bounded lifetime. */
export function progressionFeedback(
	node: HTMLElement,
	initial: ProgressionFeedbackDisplay,
) {
	const tuning = CLIENT_TUNING.characterSheet.feedback;
	let display = initial;
	let unsubscribe: (() => void) | null = null;
	let queued: ProgressionGain[] = [];
	let generation = 0;
	let serial = 0;
	const animations = new Set<Animation>();
	const decorations = new Set<HTMLElement>();
	const restarts = new WeakMap<HTMLElement, Animation>();
	// Only live top-layer effects need anchor checks; no frame work survives their lifetime.
	const anchors = new Map<
		HTMLElement,
		{ source: HTMLElement; bounds: DOMRect }
	>();
	let anchorFrame = 0;
	const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
	const animate = (
		element: HTMLElement,
		frames: Keyframe[],
		duration: number,
		remove: boolean,
		restart = false,
	) => {
		if (restart) restarts.get(element)?.cancel();
		const animation = element.animate(frames, { duration, easing: "ease-out" });
		animations.add(animation);
		if (restart) restarts.set(element, animation);
		const finish = () => {
			animations.delete(animation);
			if (restarts.get(element) === animation) restarts.delete(element);
			if (remove) {
				element.remove();
				decorations.delete(element);
				anchors.delete(element);
			}
		};
		// Cancellation is expected when hiding, resetting, or restarting a pulse.
		void animation.finished.then(finish, finish);
	};
	const clear = () => {
		generation++;
		cancelAnimationFrame(anchorFrame);
		anchorFrame = 0;
		anchors.clear();
		queued = [];
		for (const animation of animations) animation.cancel();
		animations.clear();
		for (const decoration of decorations) decoration.remove();
		decorations.clear();
	};
	const visible = (element: HTMLElement): boolean => {
		if (
			!element.checkVisibility({ checkVisibilityCSS: true }) ||
			element.closest("[hidden], [inert]")
		)
			return false;
		const rect = element.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return false;
		// Do not celebrate rows outside the current scroller viewport.
		for (
			let parent = element.parentElement;
			parent !== null;
			parent = parent.parentElement
		) {
			const style = getComputedStyle(parent);
			const bounds = parent.getBoundingClientRect();
			if (
				(style.overflowY !== "visible" &&
					(rect.bottom <= bounds.top || rect.top >= bounds.bottom)) ||
				(style.overflowX !== "visible" &&
					(rect.right <= bounds.left || rect.left >= bounds.right))
			)
				return false;
		}
		return true;
	};
	const rowFor = (target: StatTarget) =>
		[...node.querySelectorAll<HTMLElement>("[data-progression-target]")].find(
			(row) => row.dataset.progressionTarget === progressionTargetKey(target),
		);
	const decorate = (summary: HTMLElement, className: string) => {
		const element = document.createElement("span");
		element.className = className;
		element.setAttribute("aria-hidden", "true");
		summary.append(element);
		decorations.add(element);
		return element;
	};
	// Native popovers escape window/scroll clipping without intercepting input or focus.
	const float = (
		element: HTMLElement,
		source: HTMLElement,
		bounds: DOMRect,
	) => {
		element.classList.add("progression-reward-floating");
		showVisualPopover(element, bounds);
		anchors.set(element, { source, bounds: source.getBoundingClientRect() });
		const monitor = () => {
			anchorFrame = 0;
			for (const [effect, anchor] of anchors) {
				if (!effect.isConnected) {
					anchors.delete(effect);
					continue;
				}
				const next = anchor.source.getBoundingClientRect();
				if (
					!anchor.source.isConnected ||
					!visible(anchor.source) ||
					next.x !== anchor.bounds.x ||
					next.y !== anchor.bounds.y ||
					next.width !== anchor.bounds.width ||
					next.height !== anchor.bounds.height
				) {
					clear();
					return;
				}
			}
			if (anchors.size > 0) anchorFrame = requestAnimationFrame(monitor);
		};
		if (anchorFrame === 0) anchorFrame = requestAnimationFrame(monitor);
	};
	const play = (gain: ProgressionGain) => {
		const row = rowFor(gain.target);
		const summary = row?.querySelector<HTMLElement>("summary");
		if (summary !== null && summary !== undefined && visible(summary)) {
			const icon = summary.querySelector<HTMLElement>(".stat-icon");
			const value = summary.querySelector<HTMLElement>(".progression-value");
			const still = reduced();
			const trained = gain.reward.kind === "trained";
			if (icon !== null) {
				const bounds = icon.getBoundingClientRect();
				const burst = icon.cloneNode(true);
				if (!(burst instanceof HTMLElement))
					throw new Error("Stat icon copy must be an HTML element");
				burst.removeAttribute("data-stat-icon");
				burst.setAttribute("aria-hidden", "true");
				summary.append(burst);
				decorations.add(burst);
				float(burst, summary, bounds);
				animate(
					burst,
					still
						? [{ filter: "brightness(1.9)" }, { filter: "brightness(1)" }]
						: [
								{ transform: "scale(1)", filter: "brightness(1)" },
								{
									transform: `scale(${trained ? tuning.trainingIconScale : tuning.iconScale})`,
									filter: "brightness(1.9)",
									offset: 0.35,
								},
								{ transform: "scale(1)", filter: "brightness(1)" },
							],
					tuning.popMs,
					true,
				);
				if (!still) {
					const ring = decorate(summary, "progression-reward-ring");
					float(ring, summary, bounds);
					animate(
						ring,
						[
							{ transform: "scale(0.95)", opacity: 1 },
							{ transform: "scale(1.3)", opacity: 1, offset: 0.25 },
							{ transform: `scale(${tuning.ringScale})`, opacity: 0 },
						],
						tuning.ringMs,
						true,
					);
				}
			}
			if (value !== null && !still)
				animate(
					value,
					[
						{ transform: "translateY(0)" },
						{ transform: "translateY(-3px)", offset: 0.35 },
						{ transform: "translateY(0)" },
					],
					tuning.popMs,
					false,
					true,
				);
			const label = decorate(summary, "progression-reward-label");
			float(label, summary, summary.getBoundingClientRect());
			label.textContent =
				gain.reward.kind === "trained" ? "Trained" : `+${gain.reward.amount}`;
			// Deterministic small offsets distinguish simultaneous rewards without coalescing them.
			label.style.paddingInlineEnd = `${(serial++ % 3) * tuning.labelOffsetPx}px`;
			animate(
				label,
				still
					? [{ opacity: 1 }, { opacity: 0 }]
					: [
							{ opacity: 1, transform: "translateY(0)" },
							{
								opacity: 0,
								transform: `translateY(-${tuning.floatDistancePx}px)`,
							},
						],
				trained ? tuning.trainingMs : tuning.floatMs,
				true,
			);
			if (trained) {
				const wash = decorate(summary, "progression-training-wash");
				animate(
					wash,
					[{ opacity: 0.5 }, { opacity: 0 }],
					tuning.trainingMs,
					true,
				);
			}
		}
		for (const target of gain.synergies) {
			const value =
				rowFor(target)?.querySelector<HTMLElement>(".progression-value");
			if (value !== undefined && value !== null && visible(value)) {
				const color = getComputedStyle(node)
					.getPropertyValue("--ui-color-accent")
					.trim();
				animate(
					value,
					[
						{ color, textShadow: `0 0 8px ${color}` },
						{ color: getComputedStyle(value).color, textShadow: "none" },
					],
					tuning.synergyMs,
					false,
					true,
				);
			}
		}
	};
	// Each continuation drains the queue synchronously after commit; stale generations cannot block new work.
	const flush = async () => {
		const current = generation;
		await tick();
		if (current !== generation || !display.visible) return;
		const ready = queued.filter((gain) => gain.revision <= display.revision);
		queued = queued.filter((gain) => gain.revision > display.revision);
		for (const gain of ready) play(gain);
	};
	const subscribe = () => {
		if (!display.visible) return;
		unsubscribe = display.owner.subscribeGains((gain) => {
			if (gain === null) clear();
			else {
				queued.push(gain);
				void flush();
			}
		});
	};
	const press = (event: PointerEvent | KeyboardEvent) => {
		if (
			event instanceof KeyboardEvent &&
			(event.repeat || (event.key !== " " && event.key !== "Enter"))
		)
			return;
		if (event instanceof PointerEvent && event.button !== 0) return;
		const button =
			event.target instanceof Element
				? event.target.closest<HTMLButtonElement>("button.ui-stat-action")
				: null;
		if (!display.visible || button === null || button.disabled || reduced())
			return;
		// The arrow owns a centering transform; compress the button without replacing it.
		animate(
			button,
			[
				{ transform: "scale(1)" },
				{ transform: "scale(0.86)", offset: 0.3 },
				{ transform: "scale(1)" },
			],
			tuning.pressMs,
			false,
			true,
		);
	};
	node.addEventListener("pointerdown", press);
	node.addEventListener("keydown", press);
	subscribe();
	return {
		update(next: ProgressionFeedbackDisplay) {
			const reconnect =
				display.owner !== next.owner || display.visible !== next.visible;
			display = next;
			if (reconnect) {
				unsubscribe?.();
				unsubscribe = null;
				clear();
				subscribe();
			}
			void flush();
		},
		destroy() {
			unsubscribe?.();
			clear();
			node.removeEventListener("pointerdown", press);
			node.removeEventListener("keydown", press);
		},
	};
}
