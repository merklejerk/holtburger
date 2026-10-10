import { tick } from "svelte";
import {
	CLIENT_ENVIRONMENT_INTERVAL_MS,
	type ClientEnvironmentSample,
} from "../../client/client-environment";
import { MINUTES_PER_GAME_DAY } from "../../client/client-environment-settings";
import { ENVIRONMENT_FIXTURE_DAY_SECONDS } from "../../client/client-environment.test-support";

/** Fixture controls leave user choices to the production Settings DOM. */
export interface ClientEnvironmentProbeDependencies {
	readonly setServerTime: (seconds: number | null) => void;
	readonly readPresentation: () => ClientEnvironmentSample | null;
	readonly placeMinimapAtBottom: () => void;
}

/** Check browser composition and geometry without visual acceptance. */
export async function probeClientEnvironment(
	dependencies: ClientEnvironmentProbeDependencies,
) {
	const settle = async () => {
		await tick();
		await new Promise<void>((resolve) =>
			window.setTimeout(resolve, CLIENT_ENVIRONMENT_INTERVAL_MS * 2),
		);
	};
	const assert = (condition: boolean, message: string) => {
		if (!condition) throw new Error(message);
	};
	const readText = () =>
		document.querySelector('[aria-label="Dereth time"]')?.textContent?.trim();
	const readWeather = () =>
		document
			.querySelector('.minimap-environment [role="img"]')
			?.getAttribute("aria-label");
	dependencies.setServerTime(ENVIRONMENT_FIXTURE_DAY_SECONDS * 1.9);
	await settle();
	assert(
		readText() === "21:36" && readWeather() === "Rainy",
		"Initial minimap server environment mismatch.",
	);
	document
		.querySelector<HTMLButtonElement>('button[aria-label="Settings"]')
		?.click();
	await tick();
	document.querySelector<HTMLButtonElement>("#settings-tab-ui")?.click();
	await tick();
	assert(
		[...document.querySelectorAll("#settings-section-ui > details > summary")]
			.map((summary) => summary.textContent?.trim())
			.join(",") === "Time and weather,Fonts,Scaling,HUD layout",
		"UI settings subsections are missing or out of order.",
	);
	const change = async (label: string, value: string | boolean) => {
		const node = [
			...document.querySelectorAll<HTMLLabelElement>(
				"#settings-section-ui label",
			),
		].find((candidate) => candidate.textContent?.trim().startsWith(label));
		const control = node?.querySelector("select, input");
		if (!(
			control instanceof HTMLInputElement ||
			control instanceof HTMLSelectElement
		))
			throw new Error(`Environment control missing: ${label}`);
		if (typeof value === "boolean") {
			if (!(control instanceof HTMLInputElement) || control.type !== "checkbox")
				throw new Error(
					`Environment boolean control is not a checkbox: ${label}`,
				);
			control.checked = value;
		} else control.value = value;
		control.dispatchEvent(
			new Event(
				control instanceof HTMLInputElement && control.type === "range"
					? "input"
					: "change",
				{ bubbles: true },
			),
		);
		await tick();
	};
	await change("Use 24-hour clock", false);
	assert(readText() === "9:36 PM", "Clock format did not update immediately.");
	await change("Use fixed local time", true);
	await change("Local weather", "0");
	await settle();
	const fixed = dependencies.readPresentation();
	assert(
		fixed?.selection.timeOfDay === 0.5 &&
			fixed.environment.sky?.dayGroupName === "Sunny",
		"Overrides did not resolve coherent presentation.",
	);
	assert(
		readText() === "9:36 PM" && readWeather() === "Rainy",
		"Overrides contaminated minimap facts.",
	);
	dependencies.setServerTime(ENVIRONMENT_FIXTURE_DAY_SECONDS * 2.1);
	await settle();
	assert(
		readText() === "2:24 AM" && readWeather() === "Sunny",
		"Minimap did not follow day rollover.",
	);
	assert(
		dependencies.readPresentation()?.selection.timeOfDay === 0.5,
		"Rollover replaced fixed local time.",
	);
	const slider = document.querySelector<HTMLInputElement>(
		'#settings-section-ui input[type="range"]:not(:disabled)',
	);
	assert(
		slider?.max === String(MINUTES_PER_GAME_DAY - 1) && slider.step === "1",
		"Fixed time slider does not cover the full day at minute precision.",
	);
	await change("Fixed time", "1");
	assert(
		dependencies.readPresentation()?.selection.timeOfDay ===
			1 / MINUTES_PER_GAME_DAY,
		"Fixed-time controls lost minute precision.",
	);
	assert(
		slider?.getAttribute("aria-valuetext") === "12:01 AM",
		"Fixed time slider did not honor the selected clock format.",
	);
	await change("Fixed time", String(MINUTES_PER_GAME_DAY - 1));
	assert(
		slider?.getAttribute("aria-valuetext") === "11:59 PM",
		"Fixed time slider cannot reach the last minute of the day.",
	);
	await change("Use fixed local time", false);
	await change("Local weather", "server");
	assert(
		Math.abs(
			(dependencies.readPresentation()?.selection.timeOfDay ?? -1) - 0.1,
		) < 1e-6,
		"Reset did not delegate to current server time.",
	);
	dependencies.placeMinimapAtBottom();
	await settle();
	const footer = document.querySelector<HTMLElement>(".minimap-footer");
	if (footer === null) throw new Error("Minimap footer missing.");
	const before = footer.getBoundingClientRect();
	assert(
		before.left >= -1 &&
			before.right <= window.innerWidth + 1 &&
			before.bottom <= window.innerHeight + 1,
		"Bottom-anchored footer is outside viewport.",
	);
	footer.style.fontSize = "24px";
	await settle();
	const after = footer.getBoundingClientRect();
	assert(
		after.height > before.height &&
			after.bottom <= window.innerHeight + 1 &&
			after.left >= -1 &&
			after.right <= window.innerWidth + 1,
		"Font growth did not reserve footer footprint.",
	);
	footer.style.removeProperty("font-size");
	dependencies.setServerTime(null);
	await settle();
	assert(
		readText() === "—" && readWeather() === "Weather unavailable",
		"Missing server facts were fabricated.",
	);
	return {
		passed: true,
		sourceIsolation: true,
		controls: true,
		rollover: true,
		unavailable: true,
		footer: {
			initialHeight: before.height,
			enlargedHeight: after.height,
			bottom: after.bottom,
		},
	};
}
