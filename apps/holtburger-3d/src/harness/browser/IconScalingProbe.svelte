<script lang="ts">
	import ClientHudTray from "../../client/ClientHudTray.svelte";
	import ItemGridStrip from "../../app/ItemGridStrip.svelte";
	import ItemGridCell from "../../app/ItemGridCell.svelte";
	import ClientVendorCurrencyAmount from "../../client/ClientVendorCurrencyAmount.svelte";
	import iconUrl from "../../assets/icons/equipment-sigil.svg?url";
	const display = { kind: "ready", url: iconUrl } as const;
</script>

<div data-scale-icons>
	<ItemGridStrip orientation="horizontal">
		<ItemGridCell
			label="Scaling fixture"
			itemGuid={1}
			{display}
			equipped={true}
			count={1250}
			structure={{ current: 3, max: 10 }}
			selected={false}
			disabled={false}
			onselect={() => {}}
		/>
	</ItemGridStrip>
	<ClientVendorCurrencyAmount name="Pyreals" {display} amount={100} />
</div>

{#each [{ label: "Scale tray fixture", width: 1000 }, { label: "Constrained scale tray fixture", width: 100 }] as fixture}
	<ClientHudTray
		label={fixture.label}
		placement={{
			horizontal: { alignment: "start", offset: 16 },
			vertical: { alignment: "start", offset: 96 },
			preferredWidth: 158,
			preferredHeight: 32,
		}}
		editable={false}
		viewport={{ width: fixture.width, height: 1000 }}
		onPlacementChange={() => {}}><span></span></ClientHudTray
	>
{/each}
