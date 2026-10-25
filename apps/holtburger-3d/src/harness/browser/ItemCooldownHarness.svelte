<script lang="ts">
	import { onMount, tick } from "svelte";
	import ClientItemInspection from "../../client/ClientItemInspection.svelte";
	import { decodeObjectInspectionResult } from "../../client/client-object-inspection-contract";
	import inspectionFixture from "../../client/fixtures/object-inspection-wire.json";
	import ItemGridCell from "../../app/ItemGridCell.svelte";
	import {
		provideItemCooldowns,
		ITEM_COOLDOWN_CADENCE_SECONDS,
	} from "../../app/item-cooldowns.svelte";
	import type { UiIconDisplay } from "../../app/ui-icon-repository";

	const source = provideItemCooldowns();
	const result = decodeObjectInspectionResult(inspectionFixture.item);
	if (
		result.outcome.kind !== "ready" ||
		result.outcome.inspection.details.kind !== "item"
	)
		throw new Error("Cooldown fixture requires an item inspection");
	const inspection = result.outcome.inspection;
	const inspectedItem = {
		...result.outcome.inspection.details.details,
		progression: null,
		spells: [],
		cooldown: { groupId: 213, durationSeconds: 2 },
	};
	// Tiny checked-in synthetic artwork keeps this browser check independent of client assets.
	const display: UiIconDisplay = {
		kind: "ready",
		url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=",
	};
	const cells = [
		{ groupId: 213, durationSeconds: 2 },
		{ groupId: 213, durationSeconds: 4 },
		null,
		{ groupId: 213, durationSeconds: null },
		{ groupId: 1000, durationSeconds: 15 },
	];
	let mounted = $state(true);
	let root: HTMLDivElement;

	function cell(guid: number): HTMLButtonElement {
		const element = root.querySelector<HTMLButtonElement>(
			`[data-item-guid="${guid}"]`,
		);
		if (element === null)
			throw new Error(`Missing cooldown fixture cell ${guid}`);
		return element;
	}
	function require(condition: boolean, message: string): void {
		if (!condition) throw new Error(message);
	}
	const delay = (ms: number) =>
		new Promise<void>((resolve) => setTimeout(resolve, ms));

	async function probe() {
		await tick();
		let idleMutations = 0;
		let artworkMutations = 0;
		const idle = new MutationObserver((records) => {
			idleMutations += records.length;
		});
		for (const guid of [3, 5])
			idle.observe(cell(guid), {
				attributes: true,
				childList: true,
				subtree: true,
			});
		const artwork = new MutationObserver((records) => {
			artworkMutations += records.length;
		});
		const images = [...root.querySelectorAll("img")];
		for (const image of images) artwork.observe(image, { attributes: true });
		const started = performance.now();
		source.replace({
			receivedAtMs: started,
			cooldowns: [{ groupId: 213, remainingSeconds: 2.4 }],
		});
		await tick();
		require(root.querySelectorAll("[data-item-cooldown]").length ===
			2, "Only duration-bearing active cells should animate");
		require(cell(4).title.includes(
			"Ready in 3s",
		), "Missing duration must still show shared cooldown status");
		require(root
			.querySelector("[data-inspection-cooldown]")
			?.textContent?.includes("Cooldown remaining") ===
			true, "An item without XP progression must still show its live cooldown in inspection");
		let tooltipMutations = 0;
		const tooltip = new MutationObserver((records) => {
			tooltipMutations += records.length;
		});
		for (const guid of [1, 2, 4])
			tooltip.observe(cell(guid), {
				attributes: true,
				attributeFilter: ["title", "aria-label"],
			});
		const titles = [1, 2, 4].map((guid) => cell(guid).title);
		const fill = cell(1).querySelector<HTMLElement>("[data-item-cooldown]");
		if (fill === null) throw new Error("Missing active overlay");
		const animation = fill.getAnimations()[0];
		if (animation === undefined)
			throw new Error("Cooldown must use a browser CSS animation");
		root.style.setProperty("--ui-item-cooldown-fill", "rgb(12, 34, 56)");
		require(getComputedStyle(fill).backgroundColor ===
			"rgb(12, 34, 56)", "Theme token did not reach the overlay");
		await delay(1200);
		require(root
			.querySelector("[data-inspection-cooldown]")
			?.textContent?.includes("2s") ===
			true, "Inspection countdown did not advance at its own cadence");
		require(titles.every(
			(title, index) => title === cell([1, 2, 4][index]).title,
		) &&
			tooltipMutations ===
				0, "Countdown ticks rebuilt native tooltips or accessible labels");
		tooltip.disconnect();
		require(fill === cell(1).querySelector("[data-item-cooldown]") &&
			fill.getAnimations()[0] ===
				animation, "Text ticks restarted the fill animation");
		const shorterFill = cell(2).querySelector<HTMLElement>(
			"[data-item-cooldown]",
		);
		if (shorterFill === null) throw new Error("Missing second group overlay");
		const firstScale = new DOMMatrixReadOnly(getComputedStyle(fill).transform)
			.m22;
		const secondScale = new DOMMatrixReadOnly(
			getComputedStyle(shorterFill).transform,
		).m22;
		require(firstScale > 0 &&
			firstScale < 1 &&
			Math.abs(firstScale - secondScale * 2) <
				0.05, "Fill did not use each item's configured duration");
		await delay(1400);
		require(root.querySelectorAll("[data-item-cooldown]").length ===
			0, "Overlay did not expire without a server removal");
		require(!cell(4).title.includes(
			"Ready in",
		), "Cooldown status survived expiry");
		require(idleMutations === 0 &&
			artworkMutations === 0, "Countdown mutated unrelated cells or artwork");
		require(images.every(
			(image, index) => image === root.querySelectorAll("img")[index],
		), "Countdown replaced icon image nodes");
		// Recovery can deliver a timer before its item is mounted; remount reads the same deadline.
		mounted = false;
		await tick();
		source.replace({
			receivedAtMs: performance.now(),
			cooldowns: [{ groupId: 213, remainingSeconds: 8 }],
		});
		mounted = true;
		await tick();
		require(cell(1).title.includes(
			"Ready in 8s",
		), "Remounted item did not find the existing group timer");
		const remountedTitle = cell(1).title;
		let cadenceMutations = 0;
		const cadenceObserver = new MutationObserver((records) => {
			cadenceMutations += records.length;
		});
		cadenceObserver.observe(cell(1), {
			attributes: true,
			attributeFilter: ["title", "aria-label"],
		});
		await delay(ITEM_COOLDOWN_CADENCE_SECONDS.tooltip * 1000 - 200);
		require(cell(1).title === remountedTitle &&
			cadenceMutations === 0, "Tooltip refreshed before its cadence elapsed");
		await delay(400);
		require(cell(1).title !== remountedTitle &&
			cadenceMutations ===
				2, "Tooltip did not publish one countdown update at its cadence");
		cadenceObserver.disconnect();
		source.replace(null);
		await tick();
		require(root.querySelectorAll("[data-item-cooldown]").length ===
			0, "Character reset retained cooldown overlays");
		// Relog can retain the same item-cell instances. A fresh baseline must restore
		// their group subscriptions without a new local use or a component remount.
		source.replace({
			receivedAtMs: performance.now(),
			cooldowns: [{ groupId: 213, remainingSeconds: 11 }],
		});
		await tick();
		require(root.querySelectorAll("[data-item-cooldown]").length === 2 &&
			cell(1).title.includes(
				"Ready in 11s",
			), "Fresh character baseline did not restore mounted item cooldowns");
		require(root
			.querySelector("[data-inspection-cooldown]")
			?.textContent?.includes("Cooldown remaining") ===
			true, "Fresh character baseline did not restore the inspected countdown");
		idle.disconnect();
		artwork.disconnect();
		return {
			sharedCooldownStatus: true,
			inspectionWithoutProgression: true,
			tooltipMutations,
			cadenceMutations,
			cssAnimationRetained: true,
			themeToken: true,
			independentItemDurations: true,
			expiry: true,
			remount: true,
			reset: true,
			restoredAfterCharacterReset: true,
			idleMutations,
			artworkMutations,
		};
	}

	onMount(() => {
		const harnessGlobal = window as typeof window & {
			/** Focused nonvisual browser assertions over the production item cell. */
			__HOLTBURGER_ITEM_COOLDOWNS__?: typeof probe;
		};
		harnessGlobal.__HOLTBURGER_ITEM_COOLDOWNS__ = probe;
		return () => {
			delete harnessGlobal.__HOLTBURGER_ITEM_COOLDOWNS__;
		};
	});
</script>

<div bind:this={root} class="ui-theme ui-item-grid">
	{#if mounted}
		{#each cells as cooldown, index}
			<ItemGridCell
				itemGuid={index + 1}
				label={`Essence ${index + 1}`}
				{display}
				{cooldown}
				equipped={false}
				selected={false}
				disabled={false}
				onselect={() => {}}
			/>
		{/each}
		<ClientItemInspection
			{inspection}
			item={inspectedItem}
			nameColor={null}
			spells={null}
			icons={null}
			onSetWaypoint={() => {}}
		/>
	{/if}
</div>
