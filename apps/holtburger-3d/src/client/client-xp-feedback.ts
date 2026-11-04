import { formatQuantity, progressPercent } from "../app/quantity-format";
import type { CharacterSheet } from "./client-character-sheet-contract";
import { CLIENT_TUNING } from "./client-tuning";

/** Exact hover/accessibility text and visual target share the level-cap decision. */
export function xpPresentation(level: CharacterSheet["level"] | null): {
	/** Clamped fill target, with a completed bar at the level cap. */
	readonly percent: number;
	/** Exact XP quantities for hover and accessibility, absent before hydration. */
	readonly description: string | undefined;
} {
	if (level === null) return { percent: 0, description: undefined };
	const maximum = BigInt(level.xpForNextLevel);
	if (maximum === 0n)
		return {
			percent: 100,
			description: `Maximum level · ${formatQuantity(BigInt(level.currentXp))} total XP`,
		};
	const current = BigInt(level.xpIntoLevel);
	return {
		percent: progressPercent(current, maximum),
		description: `${formatQuantity(current)} / ${formatQuantity(maximum)} XP`,
	};
}

/** Total XP survives purchases and rollovers; percentages and spendable XP do not. */
export function xpChange(
	before: Pick<CharacterSheet, "character" | "level"> | null,
	after: Pick<CharacterSheet, "character" | "level"> | null,
) {
	if (before === null || after === null || before.character !== after.character)
		return "snap";
	const previous = BigInt(before.level.currentXp);
	const current = BigInt(after.level.currentXp);
	if (current < previous || after.level.level < before.level.level)
		return "snap";
	// Level and total XP may reach the sampled sheet in separate updates.
	if (after.level.level > before.level.level) return "level-up";
	return current > previous ? "gain" : "unchanged";
}

/** Bounded phase progress; a zero-duration phase completes immediately, even at birth. */
export function xpAnimationProgress(
	elapsedMs: number,
	durationMs: number,
): number {
	return durationMs === 0
		? 1
		: Math.max(0, Math.min(1, elapsedMs / durationMs));
}

/** One moving fill segment; rollover may continue from zero into the next level. */
interface FillMotion {
	/** Starting fraction of the full bar, independent of layout width. */
	readonly from: number;
	/** Destination fraction of the full bar. */
	readonly to: number;
	/** Monotonic start time in milliseconds. */
	readonly startedAt: number;
	/** Distance-scaled travel duration in milliseconds. */
	readonly durationMs: number;
	/** Next level's fill after reaching 100%, or null for an ordinary arrival. */
	readonly rollover: number | null;
}

/** A particle's immutable launch conditions; the clock determines its complete flight. */
interface SparkleFlight {
	/** Birth time on the same clock that advances the bar. */
	readonly bornAt: number;
	/** Rightward speed in CSS pixels per second. */
	readonly velocityX: number;
}

/** One frame loop owns fill movement, arrival emission, and ballistic particle flight. */
export function createXpFeedback(node: HTMLElement) {
	const tuning = CLIENT_TUNING.xpFeedback;
	function required(selector: string): HTMLElement {
		const element = node.querySelector<HTMLElement>(selector);
		if (element === null) throw new Error(`XP feedback requires ${selector}`);
		return element;
	}
	const fill = required(".xp-fill");
	const edge = required(".xp-edge");
	const level = required(".level");
	const pool = [...node.querySelectorAll<HTMLElement>(".xp-sparkle")];
	const flights = new Map<HTMLElement, SparkleFlight>();
	const reduced = matchMedia("(prefers-reduced-motion: reduce)");

	let previous: CharacterSheet | null = null;
	let value = 0;
	let target = 0;
	let motion: FillMotion | null = null;
	/** Level-up pop or reduced-motion highlight; no separate animation clock. */
	let celebration: {
		/** Monotonic start time in milliseconds. */
		readonly startedAt: number;
		/** Distinguishes the level pop from the reduced-motion color highlight. */
		readonly levelUp: boolean;
	} | null = null;
	let frame = 0;

	function move(to: number, now: number, rollover: number | null): void {
		motion = {
			from: value,
			to,
			startedAt: now,
			durationMs: Math.abs(to - value) * tuning.gainMs,
			rollover,
		};
	}
	function emit(now: number): void {
		const slots = [
			...pool.filter((slot) => !flights.has(slot)),
			...flights.keys(),
		].slice(0, tuning.sparkleCount);
		const tipTop = edge.offsetTop;
		const tipHeight = edge.offsetHeight;
		for (const [index, slot] of slots.entries()) {
			flights.delete(slot);
			// Each particle owns a band of the vertical tip, with noise inside that band.
			slot.style.left = `${value * 100}%`;
			slot.style.top = `${tipTop + tipHeight * ((index + Math.random()) / slots.length)}px`;
			const speed = tuning.sparkleHorizontalSpeed;
			flights.set(slot, {
				bornAt: now,
				velocityX: speed.min + Math.random() * (speed.max - speed.min),
			});
		}
	}
	function endCelebration(): void {
		celebration = null;
		node.removeAttribute("data-xp-celebration");
		node.style.removeProperty("--xp-celebration-pulse");
		level.style.removeProperty("transform");
	}
	function paint(now: number): void {
		if (motion !== null) {
			const progress = xpAnimationProgress(
				now - motion.startedAt,
				motion.durationMs,
			);
			value =
				progress === 1
					? motion.to
					: motion.from + (motion.to - motion.from) * progress;
			if (progress === 1) {
				const rollover = motion.rollover;
				motion = null;
				// Position and particle birth are committed together in this very frame.
				emit(now);
				if (rollover !== null) {
					// Paint the completed bar once before starting the next level's segment.
					motion = {
						from: 0,
						to: rollover,
						startedAt: now,
						durationMs: rollover * tuning.gainMs,
						rollover: null,
					};
				}
			}
		}
		fill.style.transform = `scaleX(${value})`;
		edge.style.left = `clamp(0px, ${value * 100}%, calc(100% - var(--ui-xp-edge-width)))`;
		edge.style.opacity = motion === null ? "0" : "1";
		for (const [slot, flight] of flights) {
			const ageMs = Math.max(0, now - flight.bornAt);
			const life = xpAnimationProgress(ageMs, tuning.sparkleMs);
			if (life >= 1) {
				slot.style.opacity = "0";
				flights.delete(slot);
				continue;
			}
			const seconds = ageMs / 1_000;
			slot.style.transform = `translate(-50%, -50%) translate(${flight.velocityX * seconds}px, ${0.5 * tuning.sparkleGravity * seconds * seconds}px) scale(${1 - 0.65 * life}) rotate(${90 * life}deg)`;
			slot.style.opacity = `${1 - life}`;
		}
		if (celebration !== null) {
			const duration = celebration.levelUp
				? tuning.levelUpMs
				: tuning.reducedMotionHighlightMs;
			const progress = xpAnimationProgress(
				now - celebration.startedAt,
				duration,
			);
			const pulse = Math.sin(Math.PI * progress);
			node.style.setProperty("--xp-celebration-pulse", `${pulse}`);
			if (celebration.levelUp && !reduced.matches) {
				level.style.transform = `scale(${1 + (tuning.levelScale - 1) * pulse})`;
			}
			if (progress === 1) endCelebration();
		}
	}
	function schedule(): void {
		if (
			frame === 0 &&
			(motion !== null || flights.size > 0 || celebration !== null)
		)
			frame = requestAnimationFrame(tick);
	}
	function tick(now: number): void {
		frame = 0;
		paint(now);
		schedule();
	}
	function clear(): void {
		cancelAnimationFrame(frame);
		frame = 0;
		motion = null;
		endCelebration();
		for (const slot of flights.keys()) slot.style.opacity = "0";
		flights.clear();
		edge.style.opacity = "0";
	}
	function motionPreferenceChanged(): void {
		if (!reduced.matches) return;
		clear();
		value = target;
		fill.style.transform = `scaleX(${value})`;
	}
	reduced.addEventListener("change", motionPreferenceChanged);
	return {
		update(sheet: CharacterSheet | null, percent: number): void {
			const change = xpChange(previous, sheet);
			previous = sheet;
			const next = percent / 100;
			if (change === "unchanged" && target === next) return;
			target = next;
			if (change === "snap" || change === "unchanged") {
				clear();
				value = next;
				fill.style.transform = `scaleX(${value})`;
				return;
			}
			const now = performance.now();
			paint(now);
			const levelUp = change === "level-up";
			if (reduced.matches) {
				clear();
				value = next;
				celebration = { startedAt: now, levelUp: false };
				node.dataset.xpCelebration = "gain";
			} else {
				move(levelUp ? 1 : next, now, levelUp ? next : null);
				if (levelUp) {
					celebration = { startedAt: now, levelUp: true };
					node.dataset.xpCelebration = "level-up";
				}
			}
			paint(now);
			schedule();
		},
		/** Snapshot retirement prevents replay and cancels every pending frame and flight. */
		reset(): void {
			clear();
			previous = null;
		},
		destroy(): void {
			clear();
			reduced.removeEventListener("change", motionPreferenceChanged);
		},
	};
}
