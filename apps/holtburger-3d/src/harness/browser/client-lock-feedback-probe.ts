import { createUiThemeLoader } from "../../app/ui-theme";
import themeUrl from "./themes/combat-indicators.css?url&no-inline";
import { mount, tick, unmount } from "svelte";
import ClientLockFeedback from "../../client/ClientLockFeedback.svelte";
import { ClientLockFeedbackEffects } from "../../client/client-lock-feedback";
import { CLIENT_LOCK_FEEDBACK_TUNING } from "../../client/client-tuning";
import type { ClientLockFeedback as Feedback } from "../../client/client-lock-feedback-contract";

/** Real DOM/SVG animation and teardown, using the production lifetime owner without runtime assets. */
export async function probeClientLockFeedback() {
	const target = document.createElement("div");
	target.id = "lock-feedback-theme-probe";
	const loader = createUiThemeLoader(document);
	document.body.append(target);
	const effects = new ClientLockFeedbackEffects();
	const feedback: Feedback = {
		target: 7,
		generation: 2,
		worldGeneration: 3,
		outcome: "failed",
	};
	let nowMs = 0;
	let position = { x: 120, y: 210 };
	let reads = 0;
	const overlay = mount(ClientLockFeedback, {
		target,
		props: {
			readFrames: () => {
				reads++;
				return effects.readFrames(nowMs, 3, () => position);
			},
		},
	});
	const nextFrame = () =>
		new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	const marker = () =>
		target.querySelector<HTMLDivElement>(".lock-feedback-marker");
	let mounted = true;
	try {
		await tick();
		await nextFrame();
		if (marker() !== null)
			throw new Error("Idle lock feedback displayed an icon.");
		effects.accept(feedback, nowMs, CLIENT_LOCK_FEEDBACK_TUNING);
		await nextFrame();
		const first = marker();
		const icon = first?.querySelector(".lock-feedback-icon");
		if (
			first === null ||
			icon === null ||
			icon === undefined ||
			first.querySelector("svg") === null
		)
			throw new Error("Failure feedback did not mount authored SVG artwork.");
		if (
			first.style.transform !== "translate3d(120px, 210px, 0px)" ||
			getComputedStyle(first).pointerEvents !== "none"
		)
			throw new Error("Lock feedback placement or pointer policy failed.");
		const animation = icon.getAnimations()[0];
		if (
			animation === undefined ||
			animation.effect?.getTiming().duration !==
				CLIENT_LOCK_FEEDBACK_TUNING.failureLifetimeMs
		)
			throw new Error(
				"Failure feedback did not start its configured CSS animation.",
			);
		const svg = first.querySelector("svg");
		const body = first.querySelector("rect");
		if (svg === null || body === null)
			throw new Error("Lock artwork is missing its paint surfaces.");
		const baselineSize = getComputedStyle(icon).width;
		const baselineStroke = getComputedStyle(svg).strokeWidth;
		const baselineBody = getComputedStyle(body).fill;
		await loader.replace(themeUrl, null);
		if (
			marker() !== first ||
			getComputedStyle(icon).width !== "54px" ||
			getComputedStyle(icon).height !== "54px"
		)
			throw new Error(
				"Inherited theme size did not update the mounted lock icon.",
			);
		if (
			getComputedStyle(svg).strokeWidth !== "5px" ||
			getComputedStyle(svg).stroke !== "rgb(171, 52, 18)" ||
			getComputedStyle(body).fill !== "rgb(18, 52, 86)"
		)
			throw new Error("Lock theme stroke and fill did not reach the SVG.");
		const reducedMotion = matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;
		if (!reducedMotion) {
			animation.pause();
			animation.currentTime =
				CLIENT_LOCK_FEEDBACK_TUNING.failureLifetimeMs * 0.12;
			const matrix = new DOMMatrixReadOnly(getComputedStyle(icon).transform);
			const angle = (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
			if (Math.abs(matrix.m41 + 7) > 0.01 || Math.abs(angle + 9) > 0.01)
				throw new Error(
					"Themed shake distance and angle did not reach the running animation.",
				);
		}
		effects.accept(feedback, ++nowMs, CLIENT_LOCK_FEEDBACK_TUNING);
		await nextFrame();
		if (
			marker() === first ||
			target.querySelectorAll(".lock-feedback-marker").length !== 1
		)
			throw new Error("Repeated failure did not restart exactly one icon.");
		effects.accept(
			{ ...feedback, outcome: "unlocked" },
			++nowMs,
			CLIENT_LOCK_FEEDBACK_TUNING,
		);
		await nextFrame();
		const success = marker();
		const shackle = success?.querySelector(".lock-feedback-shackle");
		if (
			success?.dataset.outcome !== "unlocked" ||
			shackle === null ||
			shackle === undefined
		)
			throw new Error(
				"Success did not replace the failure with an opening lock.",
			);
		if (
			!matchMedia("(prefers-reduced-motion: reduce)").matches &&
			shackle.getAnimations().length !== 1
		)
			throw new Error("Success shackle did not animate open.");
		const successIcon = success.querySelector(".lock-feedback-icon");
		const successSvg = success.querySelector("svg");
		const successBody = success.querySelector("rect");
		if (successIcon === null || successSvg === null || successBody === null)
			throw new Error("Success artwork is missing its paint surfaces.");
		if (
			getComputedStyle(successSvg).stroke !== "rgb(18, 171, 52)" ||
			!getComputedStyle(successIcon).filter.includes("8px") ||
			!getComputedStyle(successIcon).filter.includes("rgb(171, 205, 239)")
		)
			throw new Error("Themed success stroke or glow did not apply.");
		if (!reducedMotion) {
			const pop = successIcon.getAnimations()[0];
			const opening = shackle.getAnimations()[0];
			if (pop === undefined || opening === undefined)
				throw new Error("Success animations are missing.");
			pop.pause();
			opening.pause();
			pop.currentTime = CLIENT_LOCK_FEEDBACK_TUNING.successLifetimeMs * 0.22;
			const peak = new DOMMatrixReadOnly(
				getComputedStyle(successIcon).transform,
			);
			if (Math.abs(peak.a - 1.4) > 0.01 || Math.abs(peak.m42 + 8) > 0.01)
				throw new Error("Themed success pop scale and rise did not apply.");
			pop.currentTime = CLIENT_LOCK_FEEDBACK_TUNING.successLifetimeMs;
			const end = new DOMMatrixReadOnly(
				getComputedStyle(successIcon).transform,
			);
			if (Math.abs(end.m42 + 30) > 0.01)
				throw new Error("Themed final rise did not apply.");
			opening.currentTime = CLIENT_LOCK_FEEDBACK_TUNING.successLifetimeMs;
		}
		const openMatrix = new DOMMatrixReadOnly(
			getComputedStyle(shackle).transform,
		);
		if (
			Math.abs((Math.atan2(openMatrix.b, openMatrix.a) * 180) / Math.PI - 55) >
			0.01
		)
			throw new Error("Themed opening angle did not reach the shackle.");
		// Replacing/removing a stylesheet must update paint without restarting the effect.
		await loader.replace(null, null);
		if (
			marker() !== success ||
			getComputedStyle(successIcon).width !== baselineSize ||
			getComputedStyle(successSvg).strokeWidth !== baselineStroke ||
			getComputedStyle(successBody).fill !== baselineBody
		)
			throw new Error(
				"Removing the lock theme did not restore base appearance in place.",
			);
		position = { x: 180, y: 240 };
		await nextFrame();
		if (
			marker() !== success ||
			success.style.transform !== "translate3d(180px, 240px, 0px)"
		)
			throw new Error("Moving the target restarted or detached its effect.");
		nowMs += CLIENT_LOCK_FEEDBACK_TUNING.successLifetimeMs;
		await nextFrame();
		if (marker() !== null)
			throw new Error("Expired lock feedback retained its DOM.");
		effects.accept(feedback, nowMs, CLIENT_LOCK_FEEDBACK_TUNING);
		await nextFrame();
		effects.clear();
		await nextFrame();
		if (marker() !== null) throw new Error("Reset retained lock feedback.");
		await unmount(overlay);
		mounted = false;
		const readsAtUnmount = reads;
		await nextFrame();
		if (reads !== readsAtUnmount)
			throw new Error("Lock feedback kept polling after unmount.");
		return {
			passed: true,
			repeatedFailure: true,
			liveThemeReplacement: true,
			themedMotion: true,
			success: true,
			expiry: true,
			teardown: true,
		};
	} finally {
		await loader.dispose();
		if (mounted) await unmount(overlay);
		target.remove();
	}
}
