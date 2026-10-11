import { tick } from "svelte";
import type { ClientVitalWarningThresholds } from "../../client/client-settings-contract";
import { CLIENT_VITAL_WARNING_RECOVERY_MARGIN_PERCENT } from "../../client/client-settings-values";
import type { ClientVital } from "../../client/client-host-contract";

/** Verify production overlay behavior and independent vital controls without visual acceptance. */
export async function probeVitalWarnings(
	set: (vitals: readonly ClientVital[], enabled: boolean) => void,
	readThresholds: () => ClientVitalWarningThresholds,
) {
	const require = (condition: boolean, message: string) => {
		if (!condition) throw new Error(message);
	};
	const element = (selector: string): HTMLElement => {
		const node = document.querySelector<HTMLElement>(selector);
		if (node === null)
			throw new Error(`Missing vital-warning element: ${selector}`);
		return node;
	};
	const thresholds = readThresholds();
	const vital = (kind: ClientVital["kind"], percent: number): ClientVital => ({
		kind,
		current: percent,
		maximum: 100,
	});
	const apply = async (vitals: readonly ClientVital[], enabled = true) => {
		set(vitals, enabled);
		await tick();
	};
	await apply([], false);
	await apply([vital("mana", 0), vital("health", thresholds.health)]);
	const overlay = element(".vital-warning-overlay");
	require(overlay.dataset.vitalWarning ===
		"health", "Health did not take priority");
	require(getComputedStyle(overlay).pointerEvents ===
		"none", "Overlay intercepts pointer input");
	const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
	const kinds = ["health", "stamina", "mana"] as const;
	for (const kind of kinds) {
		const thresholdPercent = thresholds[kind];
		const recoveryPercent =
			thresholdPercent + CLIENT_VITAL_WARNING_RECOVERY_MARGIN_PERCENT;
		await apply([], false);
		await apply([vital(kind, thresholdPercent + 1)]);
		require(overlay.dataset.vitalWarning ===
			"none", `${kind} activated above the threshold`);
		await apply([vital(kind, thresholdPercent)]);
		require(overlay.dataset.vitalWarning ===
			kind, `${kind} did not activate at the threshold`);
		const layer = element(`.warning-layer.${kind}`);
		const glow = element(`.warning-layer.${kind} .warning-glow`);
		const veins = element(`.warning-layer.${kind} .warning-veins`);
		require(veins.querySelectorAll("svg").length ===
			4, `${kind} vein artwork is missing a corner`);
		require(veins.parentElement ===
			glow, `${kind} veins do not share the vignette pulse parent`);
		const reference = document.createElement("span");
		reference.style.color = `var(--ui-color-${kind})`;
		overlay.append(reference);
		const expectedColor = getComputedStyle(reference).color;
		reference.remove();
		require(getComputedStyle(
			element(`.warning-layer.${kind} .warning-vignette`),
		).backgroundImage.includes(
			expectedColor,
		), `${kind} vignette ignored its theme color`);
		require(getComputedStyle(veins).color ===
			expectedColor, `${kind} veins ignored their theme color`);
		for (const corner of veins.querySelectorAll<HTMLElement>(".vein-corner")) {
			const bounds = corner.getBoundingClientRect();
			require(!(
				bounds.left <= innerWidth / 2 &&
				bounds.right >= innerWidth / 2 &&
				bounds.top <= innerHeight / 2 &&
				bounds.bottom >= innerHeight / 2
			), `${kind} veins overlap the viewport center`);
		}
		const canvas = element(".client-canvas");
		const bounds = canvas.getBoundingClientRect();
		require(document.elementFromPoint(
			bounds.left + bounds.width / 2,
			bounds.top + bounds.height / 2,
		) === canvas, `${kind} warning prevents viewport hit testing`);
		require(getComputedStyle(layer).transitionDuration ===
			"0s", `${kind} warning still interpolates intensity`);
		require(getComputedStyle(veins).transitionDuration ===
			"0s", `${kind} veins still interpolate intensity`);
		const appearance = getComputedStyle(glow);
		const animation = glow.getAnimations()[0];
		if (reducedMotion) {
			require(appearance.animationName ===
				"none", `${kind} still pulses with reduced motion`);
		} else {
			require(appearance.animationPlayState ===
				"running", `${kind} pulse is paused`);
			if (animation === undefined)
				throw new Error(`${kind} pulse animation is missing`);
			animation.pause();
			animation.currentTime = 0;
			const trough = Number(getComputedStyle(glow).opacity);
			const duration = animation.effect?.getComputedTiming().duration;
			if (typeof duration !== "number")
				throw new Error(`${kind} pulse duration is not numeric`);
			animation.currentTime = duration / 2;
			require(Number(getComputedStyle(glow).opacity) >
				trough, `${kind} pulse does not change opacity`);
		}
		// Hold the pulse phase to isolate percentage-driven changes in rendered opacity or size.
		const corner = element(`.warning-layer.${kind} .vein-corner`);
		const size = corner.getBoundingClientRect();
		const pulseOpacity = getComputedStyle(glow).opacity;
		const layerOpacity = getComputedStyle(layer).opacity;
		const veinOpacity = getComputedStyle(veins).opacity;
		require(Number(layerOpacity) > 0 &&
			Number(veinOpacity) > 0, `${kind} warning has no visible intensity`);
		for (const percent of [
			thresholdPercent,
			Math.floor(thresholdPercent / 2),
			0,
			recoveryPercent - 1,
		]) {
			await apply([vital(kind, percent)]);
			require(getComputedStyle(layer).opacity ===
				layerOpacity, `${kind} glow intensity scales with depletion`);
			require(getComputedStyle(veins).opacity ===
				veinOpacity, `${kind} vein intensity scales with depletion`);
			require(getComputedStyle(glow).opacity ===
				pulseOpacity, `${kind} pulse brightness changes with depletion`);
			const bounds = corner.getBoundingClientRect();
			require(bounds.width === size.width &&
				bounds.height ===
					size.height, `${kind} vein size scales with depletion`);
		}
		animation?.play();
		await apply([vital(kind, recoveryPercent)]);
		require(overlay.dataset.vitalWarning ===
			"none", `${kind} recovery did not clear warnings`);
		require(getComputedStyle(layer).opacity ===
			"0", `${kind} recovery did not immediately clear the layer`);
		require(getComputedStyle(veins).opacity ===
			"0", `${kind} recovery did not immediately clear veins`);
	}
	await apply([vital("health", 0)], false);
	require(getComputedStyle(overlay).visibility ===
		"hidden", "Inactive gameplay retains visible warning");
	await apply([
		vital(
			"health",
			thresholds.health + CLIENT_VITAL_WARNING_RECOVERY_MARGIN_PERCENT - 1,
		),
	]);
	require(overlay.dataset.vitalWarning ===
		"none", "Suppression retained warning state");
	const settingsButton = document.querySelector<HTMLButtonElement>(
		'button[aria-label="Settings"]',
	);
	if (settingsButton === null) throw new Error("Settings shortcut is missing");
	settingsButton.click();
	await tick();
	const tab = document.querySelector<HTMLButtonElement>("#settings-tab-ui");
	if (tab === null) throw new Error("UI settings tab is missing");
	tab.click();
	await tick();
	const edit = async (kind: ClientVital["kind"], value: number) => {
		const label =
			kind === "health" ? "Health" : kind === "stamina" ? "Stamina" : "Mana";
		const slider = document.querySelector<HTMLInputElement>(
			`input[aria-label="${label} warning threshold"]`,
		);
		if (slider === null)
			throw new Error(`${kind} threshold control is missing`);
		slider.value = String(value);
		slider.dispatchEvent(new Event("input", { bubbles: true }));
		await tick();
	};
	for (const kind of kinds) await edit(kind, 20);
	for (const kind of kinds) {
		await apply([vital(kind, 35)]);
		require(overlay.dataset.vitalWarning ===
			"none", `${kind} activated before its threshold edit`);
		await edit(kind, 40);
		require(readThresholds()[kind] ===
			40, `${kind} threshold edit was not retained`);
		for (const other of kinds) {
			if (other !== kind)
				require(readThresholds()[other] ===
					20, `${kind} edit changed the ${other} threshold`);
		}
		require(overlay.dataset.vitalWarning ===
			kind, `${kind} did not respond to its threshold edit`);
		require(Number(
			getComputedStyle(element(`.warning-layer.${kind} .warning-veins`))
				.opacity,
		) > 0, `${kind} veins did not activate with the glow`);
		await apply([
			vital(kind, 40 + CLIENT_VITAL_WARNING_RECOVERY_MARGIN_PERCENT),
		]);
		require(overlay.dataset.vitalWarning ===
			"none", `${kind} custom threshold did not clear on recovery`);
		await edit(kind, 20);
	}
	const close = document.querySelector<HTMLButtonElement>(
		'.hud-window[aria-label="Settings"] button[aria-label="Close Settings"]',
	);
	if (close === null) throw new Error("Settings close control is missing");
	close.click();
	await tick();
	// A real stylesheet override proves theme values reach every rendered consumer.
	const theme = document.createElement("style");
	theme.textContent = `@layer overrides { :root {
		--ui-vital-warning-health-opacity: .72;
		--ui-vital-warning-stamina-opacity: .62;
		--ui-vital-warning-mana-opacity: .52;
		--ui-vital-warning-vein-opacity: .4;
		--ui-vital-warning-pulse-duration: 2400ms;
		--ui-vital-warning-pulse-minimum-opacity: .25;
		--ui-vital-warning-vein-corner-size: 24%;
		--ui-vital-warning-glow-clear-extent: 45%;
	} }`;
	document.head.append(theme);
	try {
		for (const [kind, opacity] of [
			["health", 0.72],
			["stamina", 0.62],
			["mana", 0.52],
		] as const) {
			await apply([], false);
			await apply([vital(kind, 0)]);
			const layer = element(`.warning-layer.${kind}`);
			const glow = element(`.warning-layer.${kind} .warning-glow`);
			const veins = element(`.warning-layer.${kind} .warning-veins`);
			const vignette = element(`.warning-layer.${kind} .warning-vignette`);
			const corner = element(`.warning-layer.${kind} .vein-corner`);
			require(Number(getComputedStyle(layer).opacity) ===
				opacity, `${kind} theme intensity ignored`);
			require(Number(getComputedStyle(veins).opacity) ===
				0.4, `${kind} theme vein intensity ignored`);
			const bounds = overlay.getBoundingClientRect();
			const size = corner.getBoundingClientRect();
			require(Math.abs(size.width - bounds.width * 0.24) < 1 &&
				Math.abs(size.height - bounds.height * 0.24) <
					1, `${kind} theme corner size ignored`);
			require(getComputedStyle(vignette).backgroundImage.includes(
				"45%",
			), `${kind} theme glow extent ignored`);
			if (!reducedMotion) {
				const animation = glow.getAnimations()[0];
				if (animation === undefined)
					throw new Error(`${kind} themed pulse missing`);
				require(animation.effect?.getComputedTiming().duration ===
					2400, `${kind} theme pulse duration ignored`);
				animation.pause();
				animation.currentTime = 0;
				require(Number(getComputedStyle(glow).opacity) ===
					0.25, `${kind} theme pulse trough ignored`);
				animation.play();
			} else {
				require(getComputedStyle(glow).animationName ===
					"none", `${kind} theme bypasses reduced motion`);
			}
		}
	} finally {
		theme.remove();
	}
	return {
		passed: true,
		themeOverrides: true,
		reducedMotion,
		healthPriority: true,
		pulse: !reducedMotion,
		vitalVeins: kinds,
		independentThresholdControls: true,
		fixedIntensityAndSize: true,
		recovery: true,
		inputPassthrough: true,
		lifecycleReset: true,
	};
}
