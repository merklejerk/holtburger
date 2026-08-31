<script lang="ts">
	export type ClientHudIconName =
		| "buffed"
		| "debuffed"
		| "encumbered"
		| "sick"
		| "inventory"
		| "training"
		| "spells"
		| "party"
		| "map"
		| "journal"
		| "settings"
		| "debug"
		| "speech"
		| "precise-jump"
		| "locked"
		| "unlocked";

	interface Props {
		readonly name: ClientHudIconName;
	}

	const { name }: Props = $props();
</script>

<svg viewBox="0 0 24 24" aria-hidden="true">
	{#if name === "buffed"}
		<path d="M12 2 14.8 9.2 22 12l-7.2 2.8L12 22l-2.8-7.2L2 12l7.2-2.8Z" />
	{:else if name === "debuffed"}
		<path d="M4 5h16l-5 6v7l-6 3V11Zm5 0 6 14" />
	{:else if name === "encumbered"}
		<path d="M7 9h10l2 12H5Zm3 0V6a2 2 0 0 1 4 0v3M8 14h8" />
	{:else if name === "sick"}
		<path d="M8 4h8v5h4v8h-4v4H8v-4H4V9h4Zm1 8h6M9 16c2-2 4-2 6 0" />
	{:else if name === "inventory"}
		<path d="M4 7h16v14H4Zm4 0V5a4 4 0 0 1 8 0v2M8 12h8" />
	{:else if name === "training"}
		<path d="m3 8 9-5 9 5-9 5Zm4 3v5c3 3 7 3 10 0v-5M21 8v8" />
	{:else if name === "spells"}
		<path
			d="M4 4h7a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H4Zm16 0h-6v16a3 3 0 0 1 3-3h3ZM8 8h2M8 11h2"
		/>
	{:else if name === "party"}
		<circle cx="8" cy="8" r="3" /><circle cx="17" cy="9" r="2.5" /><path
			d="M2.5 20c.5-5 2-7 5.5-7s5 2 5.5 7M13 15c4-2 7 0 8 5"
		/>
	{:else if name === "map"}
		<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Zm6-2v16m6-14v16" />
	{:else if name === "journal"}
		<path d="M5 3h13v18H5Zm4 0v18M12 8h3m-3 4h3" />
	{:else if name === "settings"}
		<path
			d="m12 3 2 2 3-.5.5 3 2 2-2 2 .5 3-3 .5-2 2-2-2-3 .5-.5-3-2-2 2-2-.5-3 3-.5Z"
		/><circle cx="12" cy="10" r="3" />
	{:else if name === "debug"}
		<path d="M8 9h8v8a4 4 0 0 1-8 0Zm4 0V5m-3 0h6M5 12h3m8 0h3M5 17h3m8 0h3" />
	{:else if name === "speech"}
		<path d="M3 4h18v13H9l-5 4v-4H3Z" />
	{:else if name === "precise-jump"}
		<circle cx="12" cy="12" r="6.5" /><circle cx="12" cy="12" r="2" /><path
			d="M12 2v3M12 19v3M2 12h3M19 12h3"
		/>
	{:else if name === "locked"}
		<rect x="5" y="10" width="14" height="11" rx="2" /><path
			d="M8 10V7a4 4 0 0 1 8 0v3"
		/>
	{:else}
		<rect x="5" y="10" width="14" height="11" rx="2" /><path
			d="M9 10V7a4 4 0 0 1 7-2"
		/>
	{/if}
</svg>

<style>
	svg {
		display: block;
		width: 100%;
		height: 100%;
		fill: none;
		stroke: currentcolor;
		stroke-width: 1.7;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
