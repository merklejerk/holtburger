import { createUiThemeLoader } from "../../app/ui-theme";
import travelersKitUrl from "../../app/themes/travelers-kit.css?url&no-inline";
import { xpPresentation } from "../../client/client-xp-feedback";
import {
	characterSheetSchema,
	type CharacterSheet,
} from "../../client/client-character-sheet-contract";
import { CLIENT_TUNING } from "../../client/client-tuning";

/** Observe real rendered frames; timing checks must not seek or finish production effects. */
export async function probeXpFeedback(
	harness: { setCharacterSheet(sheet: unknown): void },
	input: unknown,
) {
	const base = characterSheetSchema.parse(input);
	const hud = document.querySelector<HTMLElement>(".character-hud");
	if (hud === null) throw new Error("Missing character HUD");
	const fill = hud.querySelector<HTMLElement>(".xp-fill");
	const edge = hud.querySelector<HTMLElement>(".xp-edge");
	const track = hud.querySelector<HTMLElement>(".xp-track");
	const progress = hud.querySelector<HTMLProgressElement>("progress");
	if (fill === null || edge === null || track === null || progress === null)
		throw new Error("Missing XP markup");
	const tuning = CLIENT_TUNING.xpFeedback;
	const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
	const pool = [...hud.querySelectorAll<HTMLElement>(".xp-sparkle")];
	for (const slot of pool) {
		const svg = slot.querySelector("svg");
		if (svg === null) throw new Error("Missing sparkle artwork");
		const container = slot.getBoundingClientRect();
		const artwork = svg.getBoundingClientRect();
		if (
			Math.abs(artwork.x - container.x) > 0.1 ||
			Math.abs(artwork.y - container.y) > 0.1
		)
			throw new Error(
				`Sparkle artwork offset from its container: x=${artwork.x - container.x}, y=${artwork.y - container.y}`,
			);
	}
	const active = () => pool.filter((slot) => Number(slot.style.opacity) > 0);
	const fraction = () =>
		new DOMMatrixReadOnly(getComputedStyle(fill).transform).a;
	const sleep = (ms: number) =>
		new Promise((resolve) => setTimeout(resolve, ms));
	const nextFrame = () =>
		new Promise<number>((resolve) => requestAnimationFrame(resolve));
	async function waitFor(condition: () => boolean, message: string) {
		const deadline = performance.now() + 5_000;
		while (!condition()) {
			if (performance.now() >= deadline) throw new Error(message);
			await nextFrame();
		}
	}
	let sheet: CharacterSheet = {
		...base,
		level: {
			...base.level,
			level: 10,
			currentXp: "9007199254740993",
			xpIntoLevel: "100",
			xpForNextLevel: "1000",
		},
	};
	const publish = (next: CharacterSheet) => {
		sheet = next;
		harness.setCharacterSheet(next);
	};
	harness.setCharacterSheet(null);
	await sleep(CLIENT_TUNING.characterSheet.displayIntervalMs + 40);
	publish(sheet);
	await waitFor(() => fraction() === 0.1, "Initial XP snapshot did not settle");
	if (active().length !== 0 || Number(edge.style.opacity) !== 0)
		throw new Error("Initial snapshot celebrated XP");
	publish({
		...sheet,
		level: {
			...sheet.level,
			currentXp: "9007199254740994",
			xpIntoLevel: "900",
		},
	});
	await waitFor(
		() => Number(progress.value) === 90,
		"XP award was not sampled",
	);
	if (!reduced) {
		if (Number(edge.style.opacity) !== 1 || active().length !== 0)
			throw new Error("Moving glow did not precede particle emission");
		publish({
			...sheet,
			level: {
				...sheet.level,
				currentXp: "9007199254740995",
				xpIntoLevel: "950",
			},
		});
		await waitFor(() => {
			const current = fraction();
			if (current < 0.95) {
				if (active().length !== 0)
					throw new Error("Retargeted fill emitted particles before arrival");
				const expectedX = Math.min(
					track.clientWidth - edge.clientWidth,
					track.clientWidth * current,
				);
				if (
					Math.abs(Number.parseFloat(getComputedStyle(edge).left) - expectedX) >
					1
				)
					throw new Error("Glow detached from fill edge");
				return false;
			}
			if (active().length === 0)
				throw new Error("Arrival frame had no particle burst");
			return true;
		}, "Retargeted XP fill never arrived");
	} else {
		if (fraction() !== 0.9 || active().length !== 0)
			throw new Error("Reduced motion animated fill or particles");
		publish({
			...sheet,
			level: {
				...sheet.level,
				currentXp: "9007199254740995",
				xpIntoLevel: "950",
			},
		});
		await waitFor(
			() => fraction() === 0.95,
			"Reduced-motion update did not snap",
		);
	}
	const firstBurst = active();
	if (!reduced) {
		if (
			firstBurst.length !==
			Math.min(tuning.sparkleCount, tuning.sparkleCapacity)
		)
			throw new Error("Burst did not respect particle count");
		const heights = firstBurst.map((slot) => Number.parseFloat(slot.style.top));
		if (
			heights.some(
				(y) => y < edge.offsetTop || y > edge.offsetTop + edge.offsetHeight,
			)
		)
			throw new Error("Particles were born outside the vertical tip");
		if (
			firstBurst.length > 1 &&
			Math.max(...heights) - Math.min(...heights) <
				(edge.offsetHeight * (firstBurst.length - 2)) / firstBurst.length
		)
			throw new Error("Particles did not span the vertical tip");
	}
	// A subpixel gain must arrive and emit together instead of waiting a full-width travel time.
	publish({
		...sheet,
		level: {
			...sheet.level,
			currentXp: "9007199254740996",
			xpIntoLevel: "951",
		},
	});
	await waitFor(() => {
		if (fraction() !== 0.951) return false;
		if (
			!reduced &&
			active().length !==
				Math.min(tuning.sparkleCount * 2, tuning.sparkleCapacity)
		)
			throw new Error("Small gain arrived without its burst");
		return true;
	}, "Small gain never arrived");
	if (
		tuning.sparkleCapacity >= tuning.sparkleCount * 2 &&
		firstBurst.some((slot) => Number(slot.style.opacity) <= 0)
	)
		throw new Error("New gain cleared airborne particles");
	await sleep(tuning.sparkleMs * 0.5);
	if (!reduced)
		for (const slot of firstBurst) {
			if (Number(slot.style.opacity) <= 0)
				throw new Error("Particles expired before their lifetime");
			const bounds = slot.getBoundingClientRect();
			slot.style.pointerEvents = "auto";
			const front = document.elementFromPoint(
				bounds.x + bounds.width / 2,
				bounds.y + bounds.height / 2,
			);
			slot.style.removeProperty("pointer-events");
			if (front === null || !slot.contains(front))
				throw new Error("Particle flight was covered by the vitals");
		}
	await sleep(tuning.sparkleMs + 40);
	if (active().length !== 0 || Number(edge.style.opacity) !== 0)
		throw new Error("XP effects did not expire");
	publish({ ...sheet, level: { ...sheet.level, unspentXp: "0" } });
	await sleep(CLIENT_TUNING.characterSheet.displayIntervalMs + 40);
	if (active().length !== 0) throw new Error("Spending XP emitted particles");
	publish({
		...sheet,
		level: {
			...sheet.level,
			level: 13,
			currentXp: "9007199254741995",
			xpIntoLevel: "50",
		},
	});
	await waitFor(
		() => Number(progress.value) === 5 && fraction() === 0.05,
		"Level rollover did not finish at authoritative XP",
	);
	if (!reduced && active().length === 0)
		throw new Error("Level rollover did not emit particles");
	harness.setCharacterSheet(null);
	await sleep(CLIENT_TUNING.characterSheet.displayIntervalMs + 40);
	if (active().length !== 0 || Number(edge.style.opacity) !== 0)
		throw new Error("Reset retained XP effects");
	publish({ ...sheet, level: { ...sheet.level, xpForNextLevel: "0" } });
	await waitFor(() => fraction() === 1, "Capped XP baseline did not fill");
	publish({
		...sheet,
		level: { ...sheet.level, currentXp: "9007199254741996" },
	});
	await waitFor(
		() =>
			reduced
				? progress.title === xpPresentation(sheet.level).description
				: active().length > 0,
		"Capped gain did not provide feedback",
	);
	const appearance = await probeXpTheme(hud, harness, sheet);
	sheet = appearance.sheet;
	harness.setCharacterSheet(null);
	await sleep(CLIENT_TUNING.characterSheet.displayIntervalMs + 40);
	publish({
		...sheet,
		level: {
			...sheet.level,
			level: 10,
			xpForNextLevel: "1000",
			xpIntoLevel: "100",
		},
	});
	await waitFor(() => fraction() === 0.1, "Preview baseline failed");
	publish({
		...sheet,
		level: {
			...sheet.level,
			currentXp: "9007199254742996",
			xpIntoLevel: "600",
		},
	});
	await waitFor(() => fraction() === 0.6, "Preview gain did not arrive");
	await sleep(tuning.sparkleMs * 0.25);
	return {
		reducedMotion: reduced,
		sameFrameArrival: true,
		smallGainArrival: true,
		verticalTipDistribution: true,
		airborneRetention: true,
		rollover: true,
		cappedGain: true,
		snapshotReset: true,
		particleCapacity: tuning.sparkleCapacity,
		liveThemeSwap: appearance.liveThemeSwap,
		travelerFillMaterial: appearance.travelerFillMaterial,
	};
}

/** Let the real animation loop finish, including its last particle frame. */
export async function settleXpFeedback() {
	await new Promise((resolve) =>
		setTimeout(
			resolve,
			Math.max(
				CLIENT_TUNING.xpFeedback.sparkleMs,
				CLIENT_TUNING.xpFeedback.levelUpMs,
				CLIENT_TUNING.xpFeedback.reducedMotionHighlightMs,
				CLIENT_TUNING.xpFeedback.gainMs,
			) + 40,
		),
	);
	const hud = document.querySelector<HTMLElement>(".character-hud");
	if (hud === null) throw new Error("Missing character HUD");
	if (
		[...hud.querySelectorAll<HTMLElement>(".xp-sparkle, .xp-edge")].some(
			(slot) => Number(slot.style.opacity) > 0,
		)
	)
		throw new Error("XP animation loop did not settle");
}

/** Theme-owned paint must update on retained HUD markup, including an in-flight celebration. */
async function probeXpTheme(
	hud: HTMLElement,
	harness: { setCharacterSheet(sheet: unknown): void },
	before: CharacterSheet,
) {
	const loader = createUiThemeLoader(document);
	const fill = hud.querySelector<HTMLElement>(".xp-fill");
	const edge = hud.querySelector<HTMLElement>(".xp-edge");
	const track = hud.querySelector<HTMLElement>(".xp-track");
	const identity = hud.querySelector<HTMLElement>(".identity-block");
	const level = hud.querySelector<HTMLElement>(".level");
	const sparkle = hud.querySelector<HTMLElement>(".xp-sparkle");
	if (
		fill === null ||
		edge === null ||
		track === null ||
		identity === null ||
		level === null ||
		sparkle === null
	)
		throw new Error("Missing XP theme targets");
	const nextFrame = () =>
		new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	const theme = (color: string, size: number) =>
		`data:text/css,${encodeURIComponent(`:root {
		--ui-character-xp-color: rgb(12, 34, 56);
		--ui-xp-celebration-color: ${color};
		--ui-xp-sparkle-size: ${size}px;
		--ui-xp-sparkle-glow-radius: 6px;
		--ui-xp-edge-width: 4px;
		--ui-xp-edge-outset: 5px;
		--ui-xp-edge-glow-radius: 11px;
		--ui-xp-celebration-brightness: 0;
		--ui-progress-fill-image: linear-gradient(rgb(15, 25, 35), rgb(45, 55, 65));
	}`)}`;
	const sheet = {
		...before,
		level: {
			...before.level,
			level: before.level.level + 1,
			currentXp: (BigInt(before.level.currentXp) + 1n).toString(),
		},
	};
	try {
		const idleDeadline = performance.now() + 5_000;
		while (identity.hasAttribute("data-xp-celebration")) {
			if (performance.now() >= idleDeadline)
				throw new Error(
					"Earlier celebration did not settle before theme verification",
				);
			await nextFrame();
		}
		await loader.replace(travelersKitUrl, null);
		if (!getComputedStyle(fill).backgroundImage.includes("linear-gradient"))
			throw new Error("Traveler material did not reach the animated XP fill");
		await loader.replace(null, theme("rgb(180, 40, 60)", 13));
		await nextFrame();
		if (getComputedStyle(track).color !== "rgb(12, 34, 56)")
			throw new Error("Theme XP fill color was ignored");
		if (
			getComputedStyle(sparkle).width !== "13px" ||
			!getComputedStyle(sparkle).filter.includes("6px")
		)
			throw new Error("Particle size or glow ignored its theme");
		if (
			edge.offsetHeight !== track.clientHeight + 10 ||
			edge.clientWidth !== 4 ||
			!getComputedStyle(edge).boxShadow.includes("11px")
		)
			throw new Error("Edge geometry or glow ignored its theme");
		if (!getComputedStyle(fill).backgroundImage.includes("15, 25, 35"))
			throw new Error("Theme fill material was ignored");
		harness.setCharacterSheet(sheet);
		const deadline = performance.now() + 5_000;
		while (!identity.hasAttribute("data-xp-celebration")) {
			if (performance.now() >= deadline)
				throw new Error("Theme probe did not start a celebration");
			await nextFrame();
		}
		if (
			getComputedStyle(track).color !== "rgb(180, 40, 60)" ||
			getComputedStyle(sparkle).color !== "rgb(180, 40, 60)"
		)
			throw new Error("Celebration ignored the active theme");
		if (getComputedStyle(track).filter !== "brightness(1)")
			throw new Error("Theme could not disable celebration brightness");
		await loader.replace(null, theme("rgb(30, 190, 210)", 17));
		await nextFrame();
		if (!identity.hasAttribute("data-xp-celebration"))
			throw new Error(
				"Theme changed after the celebration had already expired",
			);
		if (
			getComputedStyle(track).color !== "rgb(30, 190, 210)" ||
			getComputedStyle(sparkle).color !== "rgb(30, 190, 210)" ||
			getComputedStyle(sparkle).width !== "17px"
		)
			throw new Error("Active celebration retained stale theme paint");
		if (
			!matchMedia("(prefers-reduced-motion: reduce)").matches &&
			getComputedStyle(level).color !== "rgb(30, 190, 210)"
		)
			throw new Error("Level pop retained stale theme color");
		if (document.querySelector(".character-hud") !== hud)
			throw new Error("Theme swap replaced the retained HUD");
		return { sheet, liveThemeSwap: true, travelerFillMaterial: true };
	} finally {
		await loader.dispose();
	}
}
