<script lang="ts">
	import ClientHudTray from "../../client/ClientHudTray.svelte";
	import ClientHudWindow from "../../client/ClientHudWindow.svelte";
	import type { ClientHudPlacement } from "../../client/client-hud-layout";
	import ItemGridStrip from "../../app/ItemGridStrip.svelte";
	import ItemGridCell from "../../app/ItemGridCell.svelte";
	import ClientVendorCurrencyAmount from "../../client/ClientVendorCurrencyAmount.svelte";
	import iconUrl from "../../assets/icons/equipment-sigil.svg?url";
	const display = { kind: "ready", url: iconUrl } as const;
	const initialPlacement: ClientHudPlacement = {
		horizontal: { alignment: "start", offset: 20 },
		vertical: { alignment: "start", offset: 30 },
		preferredWidth: 200,
		preferredHeight: 150,
	};
	let placement = $state(initialPlacement);
	let changes = 0;
	/** Read the production shell's saved intent independently of its displayed rectangle. */
	export function geometry() {
		return { placement, changes };
	}
	/** Begin each scale sample with the same test-owned preferred geometry. */
	export function resetGeometry() {
		placement = initialPlacement;
		changes = 0;
	}
</script>

<ClientHudWindow
	title="Scale geometry fixture"
	icon="debug"
	{placement}
	viewport={{ width: 1000, height: 1000 }}
	minWidth={60}
	minHeight={60}
	onClose={() => {}}
	onPlacementChange={(next) => {
		placement = next;
		changes++;
	}}
>
	<p>Geometry fixture</p>
</ClientHudWindow>

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
		gapCount={0}
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
