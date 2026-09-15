import { tick } from "svelte";

/** Exercise production spell membership, static lookup, image decoding, and panel lifetimes. */
export async function probeClientSpells(
	emit: (event: string, payload: unknown) => void,
	holdReferences: () => () => void,
	loadReferences: (ids: readonly number[]) => Promise<unknown>,
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
	const ids = Array.from({ length: 512 }, (_, i) => i + 1);
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
	const toggleSpell = (id: number) => {
		const header = document.querySelector<HTMLButtonElement>(
			`[data-spell-id="${id}"] .spell-header`,
		);
		if (header === null) throw new Error(`Missing spell header ${id}.`);
		header.click();
	};
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
	emit("client-player-spells-updated", { spellIds: [600, 601] });
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
	await loadReferences([600, 601]);
	await tick();
	if (
		document.querySelector('[data-spell-id="600"]') !== null ||
		document.querySelectorAll("[data-spell-id]").length !== 1
	)
		throw new Error("Retired character lookup replaced current spell rows.");
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
