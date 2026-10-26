<script lang="ts">
	import PopupMenu, { type PopupMenuItem } from "../../app/PopupMenu.svelte";
	import UiPaletteDropdown from "../../app/UiPaletteDropdown.svelte";

	interface Props {
		/** Retained tab visibility dismisses transient popovers when the tab is hidden. */
		readonly visible: boolean;
		/** Commands produce local feedback without a game session. */
		readonly onNotice: (message: string) => void;
	}
	const { visible, onNotice }: Props = $props();
	let destination = $state("holtburg");
	let shade = $state(0);
	let labels = $state(true);
	let creatures = $state(true);
	let players = $state(false);
	let trigger = $state<HTMLButtonElement>();
	let open = $state(false);
	const colors = ["#713d32", "#c49765", "#74977b", "#627eaa", "#b68cb8"];
	/** Production menus cover commands, checked leaves, disabled rows and a submenu. */
	type Action =
		"inspect" | "unavailable" | "labels" | "markers" | "creatures" | "players";
	const items = $derived<readonly PopupMenuItem<Action>[]>([
		{ action: "inspect", label: "Inspect supplies", disabled: false },
		{ action: "unavailable", label: "Unavailable action", disabled: true },
		{
			action: "labels",
			label: "Show labels",
			disabled: false,
			selection: { kind: "checkbox", checked: labels },
		},
		{
			action: "markers",
			label: "Map markers",
			disabled: false,
			selection: { kind: "summary", checked: creatures || players },
			children: [
				{
					action: "creatures",
					label: "Creatures",
					disabled: false,
					selection: { kind: "checkbox", checked: creatures },
				},
				{
					action: "players",
					label: "Players",
					disabled: false,
					selection: { kind: "checkbox", checked: players },
				},
			],
		},
	]);
	$effect(() => {
		if (!visible) open = false;
	});
	function select(action: Action): void {
		switch (action) {
			case "inspect":
				onNotice("Inspect supplies — preview only.");
				break;
			case "labels":
				labels = !labels;
				break;
			case "creatures":
				creatures = !creatures;
				break;
			case "players":
				players = !players;
				break;
			case "markers":
			case "unavailable":
				throw new Error(`Non-selectable showcase command: ${action}`);
		}
	}
</script>

<div class="dropdown-specimens">
	<label class="ui-label"
		>Destination
		<select class="ui-input" bind:value={destination}>
			<optgroup label="Towns">
				<option value="holtburg">Holtburg</option>
				<option value="shoushi">Shoushi</option>
				<option value="yaraq">Yaraq</option>
			</optgroup>
			<option disabled>Unavailable destination</option>
		</select>
	</label>
	<label class="ui-label"
		>Disabled dropdown
		<select class="ui-input" disabled
			><option>No destinations available</option></select
		>
	</label>
	<div class="ui-label">
		Palette picker
		<UiPaletteDropdown
			label="Preview color"
			{colors}
			value={shade}
			{visible}
			disabled={false}
			onchange={(index) => (shade = index)}
		/>
	</div>
	<div class="ui-label">
		Disabled palette picker
		<UiPaletteDropdown
			label="Disabled preview color"
			{colors}
			value={shade}
			{visible}
			disabled={true}
			onchange={() => {}}
		/>
	</div>
	<button
		bind:this={trigger}
		type="button"
		class="ui-button"
		aria-haspopup="menu"
		aria-expanded={open}
		onclick={() => (open = !open)}>Open command dropdown</button
	>
	<p class="ui-muted">
		Native selects use the platform picker. Palette and command popovers use the
		app’s shared menu.
	</p>
</div>

{#if open && trigger}
	<PopupMenu
		anchor={trigger}
		label="Showcase commands"
		{items}
		onselect={select}
		onclose={() => (open = false)}
	/>
{/if}

<style>
	@layer components {
		.dropdown-specimens {
			display: grid;
			gap: 12px;
			align-content: start;
		}
	}
</style>
