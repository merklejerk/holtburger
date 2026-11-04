<script lang="ts">
	import { onMount } from "svelte";
	import UiTooltipHost from "../../app/UiTooltipHost.svelte";
	import UiDialog from "../../app/UiDialog.svelte";
	import ItemGridCell from "../../app/ItemGridCell.svelte";
	import SpellCell from "../../client/SpellCell.svelte";
	import ActionCell from "../../client/ActionCell.svelte";
	import ItemQueueCell from "../../app/ItemQueueCell.svelte";
	import ItemCellVisual from "../../app/ItemCellVisual.svelte";
	import { showUiDragGhost } from "../../app/ui-drag-ghost";
	import type { UiIconDisplay } from "../../app/ui-icon-repository";
	import artworkUrl from "../../assets/icons/equipment-weapon.svg?url";
	import { provideClientInput } from "../../client/client-input-context";
	import { AppInput } from "../../lib/input/app-input";
	import { createInputDefaults } from "../../lib/input/input-defaults";
	import { provideAppInputPolicy } from "../../lib/input/app-input-policy-context";
	const { keyboard } = provideAppInputPolicy();
	provideClientInput(new AppInput(createInputDefaults("windows")));
	const problem = [
		{ code: "preparation", detail: "Synthetic artwork diagnostic" },
	] as const;
	const images: readonly UiIconDisplay[] = [
		{ kind: "loading" },
		{ kind: "ready", url: artworkUrl },
		{ kind: "degraded", url: artworkUrl, issues: problem },
		{ kind: "failed", issues: problem },
	];
	let root = $state<HTMLDivElement>();
	let ghost: HTMLDivElement;
	let selected = $state<number | null>(null);
	let removed = $state(0);
	let activations = $state(0);
	let modalOpen = $state(false);
	let earlierModalOpen = $state(false);
	let modalDismissals = $state(0);
	let scopeEscapes = $state(0);
	onMount(() => keyboard.mount(document));
</script>

<div
	bind:this={root}
	class="tooltip-fixture ui-theme"
	data-tooltip-fixture
	tabindex="-1"
	use:keyboard.scope={{
		nativeControls: true,
		keydown: (event) => {
			if (event.key === "Escape" && !modalOpen) {
				scopeEscapes++;
				event.preventDefault();
			}
		},
	}}
	data-scope-escapes={scopeEscapes}
	data-modal-dismissals={modalDismissals}
	data-selected={selected}
	data-removals={removed}
	data-activations={activations}
>
	{#if root}<UiTooltipHost {root} />{/if}
	{#if earlierModalOpen}
		<UiDialog
			title="Earlier DOM modal"
			className="tooltip-test-dialog"
			initialFocus="[data-earlier-modal-cell]"
			onCancel={() => (earlierModalOpen = false)}
		>
			<button
				data-earlier-modal-cell
				data-ui-tooltip="Earlier DOM modal item"
				title="">Earlier modal cell</button
			>
			<button
				data-close-earlier-modal
				onclick={() => (earlierModalOpen = false)}>Close earlier modal</button
			>
		</UiDialog>
	{/if}
	<div class="clip" title="Ancestor native text" data-fixture-panel>
		<button
			data-cell="a"
			data-ui-tooltip={"Alpha\nQuantity: 12"}
			title=""
			aria-label="Alpha"
			aria-describedby="existing-description">A</button
		>
		<button data-cell="b" data-ui-tooltip="Beta" title="" aria-label="Beta"
			>B</button
		>
		<button
			data-cell="disabled"
			data-ui-tooltip="Unavailable equipment slot"
			title=""
			disabled><span>Disabled</span></button
		>
		<div data-ui-tooltip="Outer cell" data-cell="outer">
			<button data-cell="nested">Separate action</button>
		</div>
	</div>
	<span id="existing-description">Existing description</span>
	<div data-ui-tooltip="Parent row label">
		<span data-native-hint title="Exact currency name">Native sub-hint</span>
	</div>
	<button data-open-modal onclick={() => (modalOpen = true)}>Open modal</button>
	<button
		data-cell="long"
		data-ui-tooltip={"Long item details\n".repeat(100)}
		title="">Long details</button
	>
	<div data-other-popover popover="manual">Other surface</div>
	<div class="artwork-fixture">
		{#each images as display, index}
			<ItemGridCell
				itemGuid={index + 1}
				label={`Fixture item ${index + 1}`}
				{display}
				count={7}
				structure={{ current: 5, max: 10 }}
				equipped={true}
				selected={selected === index + 1}
				disabled={false}
				onselect={() => (selected = index + 1)}
			/>
		{/each}
		<SpellCell
			address={null}
			shortcut={{ hint: "F9", description: "F9" }}
			spell={12}
			label="Fixture spell"
			display={images[3]}
			available={true}
			onactivate={() => activations++}
			onexamine={() => {}}
		/>
		<ActionCell
			bar={1}
			digit="1"
			bindingHint="1"
			bindingDescription="1"
			alternateModifier="Shift"
			alternateAction="Inspect"
			content={{ kind: "direct", item: 4, replacement: null }}
			label="Fixture action"
			display={images[3]}
			count={7}
			structure={null}
			capacity={null}
			cooldown={null}
			available={true}
			equipped={false}
			selected={false}
			alternateLabel={null}
			onactivate={() => activations++}
		/>
		<ItemQueueCell
			removeLabel="Remove fixture item"
			removalDisabled={false}
			onremove={() => removed++}
			title=""
			data-ui-tooltip="Queued fixture item"
			aria-label="Queued fixture item"
			onclick={() => activations++}
		>
			<ItemCellVisual
				display={images[3]}
				presentation={{
					label: "Queued fixture item",
					count: 7,
					meter: null,
					equipped: false,
				}}
			/>
		</ItemQueueCell>
	</div>
	<button
		data-clone-artwork
		onclick={() => {
			const source = root?.querySelector<HTMLElement>('[data-item-guid="4"]');
			if (!source) throw new Error("Missing ghost source");
			showUiDragGhost(ghost, source, "Fixture item 4");
		}}>Clone artwork</button
	>
	<div
		bind:this={ghost}
		data-fixture-ghost
		popover="manual"
		aria-hidden="true"
	></div>
	{#if modalOpen}
		<UiDialog
			title="Tooltip modal"
			className="tooltip-test-dialog"
			initialFocus="[data-modal-cell]"
			onCancel={() => {
				modalOpen = false;
				modalDismissals++;
			}}
		>
			<button
				data-modal-cell
				data-ui-tooltip="Modal item"
				title=""
				aria-label="Modal item">Modal cell</button
			>
			<button data-open-earlier-modal onclick={() => (earlierModalOpen = true)}
				>Open earlier DOM modal</button
			>
			<button data-close-modal onclick={() => (modalOpen = false)}
				>Close modal</button
			>
		</UiDialog>
	{/if}
</div>

<style>
	@layer components {
		.tooltip-fixture {
			position: fixed;
			inset: 0;
			padding: 32px;
		}
		.clip {
			display: flex;
			gap: 8px;
			width: 560px;
			height: 48px;
			overflow: hidden;
		}
		button {
			min-width: 80px;
			min-height: 36px;
		}
		[data-native-hint] {
			position: fixed;
			top: 32px;
			right: 32px;
		}
		.artwork-fixture {
			display: flex;
			gap: 12px;
			padding-top: 16px;
		}
		.artwork-fixture :global(.ui-item-cell) {
			position: relative;
			width: 48px;
			height: 48px;
			min-width: 48px;
			padding: 2px;
		}
		[data-fixture-ghost] {
			margin: 0;
			inset: auto;
			pointer-events: none;
		}
	}
</style>
