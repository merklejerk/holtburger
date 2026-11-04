<script lang="ts">
	import "./client-housing.css";
	import ClientHousingManagement from "./ClientHousingManagement.svelte";
	import type { ClientHousingManagementState } from "./client-housing-management-state";
	import { housingTypeLabel } from "./client-housing-presentation";
	import { housingMapPosition } from "./client-housing-map";
	import { formatWorldMapCoordinates } from "../lib/game/map/map-coordinates";
	import type { HousingSnapshot } from "./client-housing-contract";

	interface Props {
		/** Retained authority snapshot; mounting the tab never queries the server. */
		readonly housing: HousingSnapshot;
		readonly management: ClientHousingManagementState | null;
		readonly onRefresh: () => Promise<void>;
	}
	const { housing, management, onRefresh }: Props = $props();

	function date(seconds: number): string {
		return new Date(seconds * 1000).toLocaleString();
	}
</script>

<div class="housing-tab">
	{#if housing.home.kind === "unqueried"}
		<p class="ui-muted" role="status">
			{housing.refreshing
				? "Loading housing information…"
				: "Housing information unavailable."}
		</p>
		{#if !housing.refreshing}<button
				class="ui-button"
				onclick={() => void onRefresh()}>Retry</button
			>{/if}
	{:else if housing.home.kind === "none"}
		<p class="ui-muted">No current home.</p>
	{:else}
		{@const home = housing.home.home}
		{@const position = housingMapPosition(housing)}
		<dl class="ui-facts housing-summary">
			<dt>Type</dt>
			<dd class="housing-type">{housingTypeLabel(home.houseType)}</dd>
			{#if position !== null}
				<dt>Location</dt>
				<dd class="housing-location">
					<strong>{formatWorldMapCoordinates(position)}</strong>
				</dd>
			{/if}
			<dt>Maintenance</dt>
			<dd>
				{home.maintenanceFree
					? "Free this period"
					: home.maintenancePaid
						? "Paid"
						: "Due"}
			</dd>
			{#if home.period !== null}
				<dt class="housing-maintenance-deadline">
					{home.period.nextDue === null
						? "Period ends"
						: home.maintenancePaid
							? "Next payment due"
							: "Payment deadline"}
				</dt>
				<dd>
					{date(
						home.period.nextDue === null
							? home.period.end
							: home.period.nextDue,
					)}
				</dd>
			{/if}
		</dl>
		<details
			class="ui-disclosure ui-disclosure-section"
			open={!home.maintenanceFree && !home.maintenancePaid}
		>
			<summary>Maintenance</summary>
			<div class="ui-disclosure-body">
				{#if home.rent.length > 0}
					<table class="housing-table">
						<thead
							><tr
								><th scope="col">Item</th><th scope="col">Paid / required</th
								></tr
							></thead
						><tbody>
							{#each home.rent as payment (payment.wcid)}<tr
									><th scope="row">{payment.name}</th><td
										>{payment.paid.toLocaleString()} / {payment.required.toLocaleString()}</td
									></tr
								>{/each}
						</tbody>
					</table>
				{:else}<p class="ui-muted">No items required.</p>{/if}
			</div>
		</details>
		<details class="ui-disclosure ui-disclosure-section">
			<summary>Property details</summary>
			<div class="ui-disclosure-body">
				<dl class="ui-facts">
					<dt>Purchased</dt>
					<dd>
						{home.boughtAt === null ? "Date unavailable" : date(home.boughtAt)}
					</dd>
				</dl>
				{#if home.buy.length > 0}<table class="housing-table">
						<thead
							><tr
								><th scope="col">Purchase item</th><th scope="col">Quantity</th
								></tr
							></thead
						><tbody>
							{#each home.buy as payment (payment.wcid)}<tr
									><th scope="row">{payment.name}</th><td
										>{payment.required.toLocaleString()}</td
									></tr
								>{/each}
						</tbody>
					</table>{/if}
			</div>
		</details>
	{/if}
	{#if housing.home.kind === "owned" && management !== null}
		{#key housing.access.generation}<ClientHousingManagement
				model={management}
			/>{/key}
	{/if}
</div>
