import { tick } from "svelte";
import type { ResolvedEnchantments } from "../../client/client-enchantments-contract";
import type { ClientToast } from "../../client/client-toast-center";

/** Inspect browser animation state rather than judging the visual design. */
export async function probeHudAttention(
	set: (toast: ClientToast | null, resolved: ResolvedEnchantments) => void,
) {
	const require = (condition: boolean, message: string) => {
		if (!condition) throw new Error(message);
	};
	const element = (selector: string): HTMLElement => {
		const node = document.querySelector<HTMLElement>(selector);
		if (node === null)
			throw new Error(`Missing attention element: ${selector}`);
		return node;
	};
	const empty: ResolvedEnchantments = { instances: [], groups: [] };
	const key = { spellId: 10, layer: 1 };
	const baseline: ResolvedEnchantments = {
		instances: [
			{
				key,
				spellCategory: 7,
				powerLevel: 100,
				kind: "beneficial",
				remainingSeconds: 80,
				statModType: 0,
				statModKey: 0,
				statModValue: 1,
			},
		],
		groups: [
			{
				affectedStat: { kind: "attribute", key: 1 },
				operation: "additive",
				channel: "ordinary",
				spellCategory: 7,
				effective: key,
				overridden: [],
			},
		],
	};
	const toast: ClientToast = {
		id: 71001,
		message: "Attention probe",
		tone: "status",
	};
	const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
	const theme = document.createElement("style");
	theme.textContent = `@layer overrides { :root {
		--ui-toast-pop-duration: 2s;
		--ui-toast-pop-scale: .6;
		--ui-toast-pop-peak-scale: 1.3;
		--ui-toast-pop-easing: linear;
		--ui-toast-exit-duration: 40ms;
		--ui-hud-pulse-duration: 3s;
		--ui-hud-pulse-scale: 1.4;
		--ui-hud-pulse-easing: linear;
	} }`;
	const apply = async (
		notice: ClientToast | null,
		snapshot: ResolvedEnchantments,
	) => {
		set(notice, snapshot);
		await tick();
	};
	try {
		await apply(null, empty);
		await apply(toast, baseline);
		const defaultMotion = reduced
			? null
			: (() => {
					const read = (selector: string, phases: readonly number[]) => {
						const node = element(selector);
						const animation = node.getAnimations()[0];
						if (animation === undefined)
							throw new Error(`Default animation absent: ${selector}`);
						const duration = animation.effect?.getTiming().duration;
						if (typeof duration !== "number")
							throw new Error(`Non-numeric default duration: ${selector}`);
						animation.pause();
						const scales = phases.map((phase) => {
							animation.currentTime = duration * phase;
							return new DOMMatrix(getComputedStyle(node).transform).a;
						});
						animation.finish();
						return { durationMs: duration, scales };
					};
					return {
						toast: read(".client-toast-ephemeral", [0, 0.6]),
						tray: read('button[aria-label="Beneficial enchantments"]', [0.5]),
					};
				})();
		// Retire the first entrance and mount fresh nodes under the override stylesheet.
		await apply(null, empty);
		await new Promise<void>((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
		);
		// Complete any outgoing default toast so it cannot be selected by the themed checks.
		for (const node of document.querySelectorAll(".client-toast")) {
			for (const animation of node.getAnimations()) animation.finish();
		}
		await tick();
		document.head.append(theme);
		await apply(null, empty);
		await apply(toast, baseline);
		const button = element('button[aria-label="Beneficial enchantments"]');
		const notice = element(".client-toast-ephemeral");
		const pulse = button.getAnimations()[0];
		const pop = notice.getAnimations()[0];
		if (reduced) {
			require(pulse === undefined &&
				pop === undefined, "Reduced motion still animates");
			require(getComputedStyle(notice).transitionDuration ===
				"0s", "Reduced motion still fades");
		} else {
			if (pulse === undefined || pop === undefined)
				throw new Error("Entrance animation absent");
			require(pulse.effect?.getTiming().duration ===
				3000, "Pulse ignores theme duration");
			require(pop.effect?.getTiming().duration ===
				2000, "Pop ignores theme duration");
			pulse.pause();
			pulse.currentTime = 1500;
			pop.pause();
			pop.currentTime = 0;
			require(Math.abs(
				new DOMMatrix(getComputedStyle(button).transform).a - 1.4,
			) < 0.001, "Pulse ignores themed peak scale");
			require(Math.abs(
				new DOMMatrix(getComputedStyle(notice).transform).a - 0.6,
			) < 0.001, "Pop ignores themed starting scale");
			pop.currentTime = 1200;
			require(Math.abs(
				new DOMMatrix(getComputedStyle(notice).transform).a - 1.3,
			) < 0.001, "Pop ignores themed overshoot scale");
			require(getComputedStyle(notice).transitionDuration ===
				"0.04s", "Exit ignores theme duration");
			await apply(toast, {
				...baseline,
				instances: baseline.instances.map((item) => ({
					...item,
					remainingSeconds: 20,
				})),
			});
			require(button.getAnimations()[0] === pulse, "Countdown restarts pulse");
			// Ordinary HUD controls retain the game's keyboard owner, even on focus().
			button.focus();
			const focusBefore = document.activeElement;
			const changed = {
				...baseline,
				instances: baseline.instances.map((item) => ({
					...item,
					statModValue: 2,
				})),
			};
			await apply(toast, changed);
			require(element('button[aria-label="Beneficial enchantments"]') ===
				button, "Change replaces button");
			require(document.activeElement ===
				focusBefore, "Change moves keyboard focus");
			const restarted = button.getAnimations()[0];
			require(restarted !== undefined &&
				restarted !== pulse, "Change does not restart pulse");
			await apply(toast, baseline);
			require(button.getAnimations().length === 1 &&
				button.getAnimations()[0] !== restarted, "Rapid change queues pulses");
			const completed = button.getAnimations()[0];
			if (completed === undefined) throw new Error("Restarted pulse absent");
			completed.finish();
			require(getComputedStyle(button).transform ===
				"none", "Finished pulse retains scale");
		}
		const originalBounds = notice.getBoundingClientRect();
		const originalCenterY = originalBounds.top + originalBounds.height / 2;
		await apply(
			{
				...toast,
				id: toast.id + 1,
				message:
					"A replacement message that wraps across several lines. ".repeat(12),
			},
			baseline,
		);
		const replacement = element(".client-toast-ephemeral:last-child");
		const replacementBounds = replacement.getBoundingClientRect();
		const replacementCenterY =
			replacementBounds.top + replacementBounds.height / 2;
		require(Math.abs(replacementCenterY - originalCenterY) <
			0.5, `Toast center moved during replacement: ${originalCenterY} -> ${replacementCenterY}`);
		require(replacement !==
			notice, "Replacement toast reuses the old entrance");
		if (!reduced)
			require(replacement.getAnimations().length >
				0, "Replacement does not pop");
		theme.textContent += `@layer overrides { :root {
			--ui-toast-pop-animation: none; --ui-hud-pulse-animation: none;
		} }`;
		await apply({ ...toast, id: toast.id + 2 }, baseline);
		require(getComputedStyle(button).animationName ===
			"none", "Theme cannot disable pulse");
		require(getComputedStyle(element(".client-toast-ephemeral:last-child"))
			.animationName === "none", "Theme cannot disable toast pop");
		await apply(null, empty);
		require(document.querySelector(
			'button[aria-label="Beneficial enchantments"]',
		) === null, "Final removal retains status icon");
		return {
			reducedMotion: reduced,
			themeOverrides: true,
			defaultMotion,
			stableToastCenter: true,
			replacement: true,
			finalRemoval: true,
		};
	} finally {
		theme.remove();
	}
}
