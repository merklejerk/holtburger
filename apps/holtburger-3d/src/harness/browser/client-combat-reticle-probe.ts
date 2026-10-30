import { createUiThemeLoader } from "../../app/ui-theme";
import themeUrl from "./themes/combat-indicators.css?url&no-inline";
import { mount, tick, unmount } from "svelte";
import ClientCombatReticle from "../../client/ClientCombatReticle.svelte";
import ClientTargetIndicator from "../../client/ClientTargetIndicator.svelte";
import type { ClientEntityScreenPoint } from "../../client/client-entity-projection";

/** Verify overlay placement, coexistence, animation policy, and RAF teardown without runtime assets. */
export async function probeClientCombatReticle() {
	const target = document.createElement("div");
	target.id = "combat-reticle-theme-probe";
	const loader = createUiThemeLoader(document);
	document.body.append(target);
	let frame: ClientEntityScreenPoint | null = null;
	let reads = 0;
	const reticle = mount(ClientCombatReticle, {
		target,
		props: {
			readFrame: () => {
				reads++;
				return frame;
			},
		},
	});
	const selection = mount(ClientTargetIndicator, {
		target,
		props: {
			selectedGuid: 8,
			readFrame: () => ({ x: 100, y: 100, rotationRadians: 0 }),
		},
	});
	const nextFrame = () =>
		new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	try {
		await tick();
		await nextFrame();
		const marker = target.querySelector<HTMLDivElement>(".combat-reticle");
		const arrow = target.querySelector<HTMLDivElement>(".target-indicator");
		if (marker === null || arrow === null)
			throw new Error("Target overlays did not mount.");
		const expectPosition = (expected: string): void => {
			if (marker.style.transform !== expected)
				throw new Error("Combat overlay did not follow the projected center.");
		};
		if (!marker.hidden)
			throw new Error("Absent engagement displayed a combat reticle.");
		frame = { x: 125, y: 210 };
		await nextFrame();
		if (marker.hidden || arrow.hidden)
			throw new Error(
				"Combat overlay placement or selection coexistence failed.",
			);
		expectPosition("translate3d(125px, 210px, 0px)");
		if (
			getComputedStyle(marker).pointerEvents !== "none" ||
			target.querySelectorAll(".combat-reticle-diamond").length !== 4
		)
			throw new Error("Combat reticle geometry or pointer policy failed.");
		const orbit = target.querySelector(".combat-reticle-orbit");
		if (orbit === null) throw new Error("Combat reticle orbit did not mount.");
		const reducedMotion = matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;
		if ((getComputedStyle(orbit).animationName === "none") !== reducedMotion)
			throw new Error("Combat reticle motion preference failed.");
		const diamond = target.querySelector<SVGSVGElement>(
			".combat-reticle-diamond",
		);
		const body = target.querySelector(".diamond-body");
		const border = target.querySelector(".diamond-border");
		const pulse = target.querySelector(".combat-reticle-pulse");
		if (diamond === null || body === null || border === null || pulse === null)
			throw new Error("Reticle paint elements did not mount.");
		const baselineSize = getComputedStyle(diamond).width;
		const baselineFill = getComputedStyle(body).fill;
		await loader.replace(themeUrl, null);
		if (
			getComputedStyle(diamond).width !== "36px" ||
			getComputedStyle(diamond).height !== "36px"
		)
			throw new Error("Theme size did not reach the mounted reticle.");
		if (
			getComputedStyle(body).fill !== "rgb(18, 171, 52)" ||
			getComputedStyle(body).stroke !== "rgb(171, 205, 239)" ||
			getComputedStyle(border).stroke !== "rgb(18, 52, 86)"
		)
			throw new Error("Theme reticle colors did not inherit.");
		if (
			getComputedStyle(body).strokeWidth !== "3px" ||
			getComputedStyle(border).strokeWidth !== "7px"
		)
			throw new Error("Theme reticle stroke widths did not inherit.");
		if (!getComputedStyle(diamond).filter.includes("7px"))
			throw new Error("Theme reticle glow did not inherit.");
		if (
			!reducedMotion &&
			(getComputedStyle(orbit).animationDuration !== "1.75s" ||
				getComputedStyle(pulse).animationDuration !== "0.4s")
		)
			throw new Error("Theme reticle animation durations did not inherit.");
		target.style.setProperty("--ui-combat-reticle-size", "44px");
		if (getComputedStyle(diamond).width !== "44px")
			throw new Error("Live inherited reticle size change failed.");
		target.style.removeProperty("--ui-combat-reticle-size");
		await loader.replace(null, null);
		if (
			getComputedStyle(diamond).width !== baselineSize ||
			getComputedStyle(body).fill !== baselineFill
		)
			throw new Error("Reticle theme removal did not restore base appearance.");

		frame = { x: 230, y: 175 };
		await nextFrame();
		expectPosition("translate3d(230px, 175px, 0px)");
		frame = null;
		await nextFrame();
		if (!marker.hidden || arrow.hidden)
			throw new Error(
				"Ending combat changed selection or retained its reticle.",
			);
	} finally {
		await loader.dispose();
		await unmount(reticle);
		await unmount(selection);
		target.remove();
	}
	const retiredReads = reads;
	await nextFrame();
	if (reads !== retiredReads)
		throw new Error("Combat reticle continued polling after unmount.");
	return {
		passed: true,
		diamonds: 4,
		followsProjection: true,
		selectionIndependent: true,
		themeInheritance: true,
		liveThemeReplacement: true,
		teardown: true,
	};
}
