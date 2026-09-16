import { tick } from "svelte";
import {
	spellSearchEntry,
	spellSearchWords,
	matchesSpellSearch,
} from "../../client/client-spell-search";

/** Exercise production spell membership, static lookup, image decoding, and panel lifetimes. */
export async function probeClientSpells(
	emit: (event: string, payload: unknown) => void,
	holdReferences: () => () => void,
	loadReferences: (ids: readonly number[]) => Promise<unknown>,
	readReferenceRequests: () => number,
) {
	const button = (label: string) => {
		const element = document.querySelector<HTMLButtonElement>(
			`button[aria-label="${label}"]`,
		);
		if (element === null) throw new Error(`Missing ${label} button.`);
		element.click();
	};
	const waitFor = async (predicate: () => boolean) => {
		const deadline = performance.now() + 5000;
		while (!predicate()) {
			if (performance.now() > deadline)
				throw new Error("Spell panel integration timed out.");
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		await tick();
	};
	const ids = Array.from({ length: 1024 }, (_, i) => i + 1);
	emit("client-player-spells-updated", { spellIds: [...ids, 999999] });
	button("Spells");
	await waitFor(
		() =>
			document.querySelectorAll("[data-spell-id] img").length === ids.length,
	);
	if (document.querySelectorAll("[data-spell-id]").length !== ids.length + 1)
		throw new Error("Missing definition suppressed a known spell.");
	const missing = document.querySelector('[data-spell-id="999999"]');
	if (!missing?.textContent?.includes("Spell definition is missing."))
		throw new Error("Missing definition was not diagnosed.");

	const input = () => {
		const element = document.querySelector<HTMLInputElement>(
			'[aria-label="Search spell names"]',
		);
		if (element === null) throw new Error("Missing spell search input.");
		return element;
	};
	const searchFor = async (text: string) => {
		input().value = text;
		input().dispatchEvent(new Event("input", { bubbles: true }));
		await tick();
	};
	const pill = (label: string) => {
		const element = [
			...document.querySelectorAll<HTMLButtonElement>(".filter-pills button"),
		].find((button) => button.textContent?.trim() === label);
		if (element === undefined) throw new Error(`Missing ${label} filter.`);
		element.click();
	};
	// Casting routes select predictable subsets and union within their category.
	pill("Targeted");
	await tick();
	if (
		document.querySelectorAll("[data-spell-id]:not([hidden])").length !==
		ids.length / 2
	)
		throw new Error("Selected target filter did not select targeted spells.");
	pill("Self");
	await tick();
	if (
		document.querySelectorAll("[data-spell-id]:not([hidden])").length !==
		ids.length
	)
		throw new Error("Casting route alternatives did not union.");
	button("Reset spell search and filters");
	await tick();
	const timings: number[] = [];
	const longTasks: number[] = [];
	const observer = new PerformanceObserver((list) => {
		longTasks.push(...list.getEntries().map((entry) => entry.duration));
	});
	observer.observe({ type: "longtask" });
	const matchingTimings: number[] = [];
	const requestBaseline = readReferenceRequests();
	const entries = [...document.querySelectorAll(".spell-header")].map(
		(header) => spellSearchEntry(header.textContent ?? "", null),
	);
	for (let repeat = 0; repeat < 20; repeat++) {
		for (const query of ["acid prot", "self frost", "zzzz", ""]) {
			// Separate input tasks so the synthetic loop does not manufacture one long task.
			await new Promise((resolve) => setTimeout(resolve, 0));
			const matchingStart = performance.now();
			const terms = spellSearchWords(query);
			entries.filter((entry) => matchesSpellSearch(entry, terms, []));
			matchingTimings.push(performance.now() - matchingStart);
			const start = performance.now();
			await searchFor(query);
			timings.push(performance.now() - start);
			const expected =
				query === "" ? ids.length + 1 : query === "zzzz" ? 0 : ids.length / 2;
			if (
				document.querySelectorAll("[data-spell-id]:not([hidden])").length !==
				expected
			)
				throw new Error("Name terms did not intersect.");
		}
	}
	await new Promise((resolve) => setTimeout(resolve, 0));
	observer.disconnect();
	timings.sort((a, b) => a - b);
	matchingTimings.sort((a, b) => a - b);
	const p95 = timings[Math.floor(timings.length * 0.95)];
	if (p95 === undefined || p95 >= 50)
		throw new Error(`Spell search DOM update p95 exceeded 50ms: ${p95}`);
	await searchFor("acid prot");
	pill("Acid");
	await tick();
	if (
		document.querySelectorAll("[data-spell-id]:not([hidden])").length !==
		ids.length / 2
	)
		throw new Error("Name/tag intersection failed.");
	pill("Fire");
	await tick();
	if (
		document.querySelectorAll("[data-spell-id]:not([hidden])").length !==
		ids.length / 2
	)
		throw new Error("Filter union failed to preserve matching acid spells.");
	pill("Fire");
	pill("Beneficial");
	await tick();
	if (
		document.querySelectorAll("[data-spell-id]:not([hidden])").length !==
		ids.length / 2
	)
		throw new Error("Beneficial filter excluded beneficial spells.");
	pill("Harmful");
	await tick();
	if (
		document.querySelectorAll("[data-spell-id]:not([hidden])").length !==
		ids.length / 2
	)
		throw new Error("Disposition union failed to intersect search.");
	pill("Harmful");
	pill("Beneficial");
	pill("Acid");
	button("Reset spell search and filters");
	await tick();
	if (
		input().value !== "" ||
		document.querySelectorAll('.filter-pills [aria-pressed="true"]').length !==
			0 ||
		document.querySelectorAll("[data-spell-id]:not([hidden])").length !==
			ids.length + 1
	)
		throw new Error("Reset did not clear search and filters.");
	pill("Acid");
	pill("Frost");
	await tick();
	if (
		document.querySelectorAll("[data-spell-id]:not([hidden])").length !==
		ids.length
	)
		throw new Error("Damage pills did not union.");
	pill("Life");
	await tick();
	if (
		document.querySelectorAll("[data-spell-id]:not([hidden])").length !==
		ids.length / 2
	)
		throw new Error("School failed to intersect damage union.");
	pill("Item");
	await tick();
	if (
		document.querySelectorAll("[data-spell-id]:not([hidden])").length !==
		ids.length
	)
		throw new Error("School union failed within category.");
	pill("Life");
	pill("Item");
	pill("Acid");
	pill("Frost");
	await searchFor("");
	const filteringContentRequests = readReferenceRequests() - requestBaseline;
	if (filteringContentRequests !== 0)
		throw new Error("Filtering issued content requests.");
	const toggleSpell = (id: number) => {
		const header = document.querySelector<HTMLButtonElement>(
			`[data-spell-id="${id}"] .spell-header`,
		);
		if (header === null) throw new Error(`Missing spell header ${id}.`);
		header.click();
	};
	toggleSpell(1);
	await tick();
	await searchFor("frost");
	if (document.querySelector(".spell-details") !== null)
		throw new Error("Hidden spell retained expanded inspection.");
	button("Close Spells");
	await tick();
	button("Spells");
	await waitFor(
		() =>
			document.querySelectorAll("[data-spell-id]:not([hidden])").length ===
			ids.length / 2,
	);
	if (input().value !== "frost")
		throw new Error("Search did not survive panel remount.");
	await searchFor("");
	toggleSpell(1);
	await tick();
	if (
		!document
			.querySelector('[data-spell-id="1"] .spell-details')
			?.textContent?.includes("Fixture spell description.")
	)
		throw new Error("Expanded spell omitted authored details.");
	if (
		!document
			.querySelector('[data-spell-id="1"] .spell-details')
			?.textContent?.includes("Authored recipient: Creature")
	)
		throw new Error("Expanded spell omitted authored recipient metadata.");
	if (
		!document
			.querySelector('[data-spell-id="1"] .spell-details')
			?.textContent?.includes("Range: 27.3 yds.")
	)
		throw new Error("Expanded spell omitted character-derived range.");
	await waitFor(
		() =>
			document.querySelectorAll('[data-spell-id="1"] .component-icon img')
				.length === 2,
	);
	if (
		!document
			.querySelector('[data-spell-id="1"] [aria-label="Spell formula"]')
			?.textContent?.includes("Prismatic Taper")
	)
		throw new Error("Formula omitted component names.");
	emit("client-spell-inspection-context", { revision: 2, player: 1 });
	await waitFor(
		() =>
			document
				.querySelector('[data-spell-id="1"] .spell-details')
				?.textContent?.includes("Range: 32.8 yds.") === true &&
			document.querySelectorAll('[data-spell-id="1"] .component-icon img')
				.length === 2,
	);
	const names = [
		...document.querySelectorAll(
			'[data-spell-id="1"] [aria-label="Spell formula"] li',
		),
	].map((row) => row.textContent?.trim());
	if (names.join(",") !== "Prismatic Taper,Prismatic Taper")
		throw new Error("Context refresh lost repeated formula slots.");
	toggleSpell(3);
	await tick();
	if (document.querySelector('[data-spell-id="1"] .spell-details') !== null)
		throw new Error("Opening another spell retained the previous expansion.");
	toggleSpell(3);
	await tick();
	if (document.querySelector(".spell-details") !== null)
		throw new Error("Clicking the expanded spell did not collapse it.");
	toggleSpell(1);
	emit("client-player-spells-updated", { spellIds: [1, 3] });
	await waitFor(
		() => document.querySelector('[data-spell-id="1"] .spell-details') !== null,
	);
	const originalUrl = document.querySelector<HTMLImageElement>(
		'[data-spell-id="1"] img',
	)?.src;
	button("Close Spells");
	await tick();
	// Let unmount release its display lease before checking the persistent owner.
	await new Promise((resolve) => setTimeout(resolve, 25));
	emit("client-player-spells-updated", { spellIds: [3, 1] });
	button("Spells");
	await waitFor(
		() => document.querySelectorAll("[data-spell-id] img").length === 2,
	);
	if (
		document.querySelector<HTMLImageElement>('[data-spell-id="1"] img')?.src !==
		originalUrl
	)
		throw new Error("Reopening prepared a replacement spell image.");
	const ordered = [
		...document.querySelectorAll<HTMLElement>("[data-spell-id]"),
	].map((row) => row.dataset.spellId);
	if (ordered.join(",") !== "1,3")
		throw new Error(
			"Reopened spell panel retained stale membership or ordering.",
		);
	const release = holdReferences();
	emit("client-player-spells-updated", { spellIds: [1600, 1601] });
	await waitFor(
		() =>
			document
				.querySelector('[aria-label="Known spells"]')
				?.textContent?.includes("Loading spells…") === true,
	);
	emit("client-lifecycle-changed", {
		kind: "character-selection",
		characters: [],
	});
	await waitFor(
		() =>
			document
				.querySelector('[aria-label="Known spells"]')
				?.textContent?.includes("Waiting for spellbook…") === true,
	);
	emit("client-player-spells-updated", { spellIds: [1] });
	await waitFor(
		() => document.querySelectorAll("[data-spell-id] img").length === 1,
	);
	release();
	await loadReferences([1600, 1601]);
	await tick();
	if (
		document.querySelector('[data-spell-id="1600"]') !== null ||
		document.querySelectorAll("[data-spell-id]").length !== 1
	)
		throw new Error("Retired character lookup replaced current spell rows.");
	emit("client-player-spells-updated", { spellIds: [2000] });
	await waitFor(
		() => document.querySelector('[data-spell-id="2000"] img') !== null,
	);
	pill("Direct");
	pill("Harmful");
	await searchFor("harm");
	if (document.querySelectorAll("[data-spell-id]:not([hidden])").length !== 1)
		throw new Error("Direct damage did not match Harm.");
	button("Reset spell search and filters");
	await tick();
	emit("client-player-spells-updated", { spellIds: [2000, 2001] });
	await waitFor(
		() => document.querySelector('[data-spell-id="2001"] img') !== null,
	);
	pill("Misc");
	await tick();
	const visibleIds = () =>
		[...document.querySelectorAll("[data-spell-id]:not([hidden])")].map((row) =>
			row.getAttribute("data-spell-id"),
		);
	if (visibleIds().join(",") !== "2001")
		throw new Error("Misc did not select the armor effect.");
	pill("Direct");
	await tick();
	if (visibleIds().length !== 2)
		throw new Error("Misc and Direct did not union.");
	pill("Beneficial");
	await tick();
	if (visibleIds().join(",") !== "2001")
		throw new Error("Misc union did not intersect disposition.");
	button("Reset spell search and filters");
	await tick();
	emit("client-player-spells-updated", { spellIds: [] });
	await waitFor(
		() =>
			document
				.querySelector('[aria-label="Known spells"]')
				?.textContent?.includes("No spells known.") === true,
	);
	button("Close Spells");
	return {
		largeList: ids.length,
		searchDomUpdateP95Ms: p95,
		searchDomUpdateMedianMs: timings[Math.floor(timings.length / 2)],
		searchMatchingP95Ms:
			matchingTimings[Math.floor(matchingTimings.length * 0.95)],
		searchLongTasksMs: longTasks,
		browser: navigator.userAgent,
		searchMatchingMeanMs:
			matchingTimings.reduce((a, b) => a + b, 0) / matchingTimings.length,
		filteringContentRequests,
		searchAndTagIntersections: true,
		inlineDetails: true,
		formulaComponents: true,
		contextRefresh: true,
		reopenedArtworkReused: true,
		missingDefinitionVisible: true,
		characterResetDuringLookup: true,
		reopenedMembership: ordered,
		empty: true,
	};
}
