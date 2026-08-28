<script lang="ts">
	import ClientHudIcon, {
		type ClientHudIconName,
	} from "./ClientHudIcon.svelte";

	interface Props {
		readonly debugEnabled: boolean;
		readonly debugOpen: boolean;
		readonly onDebug: () => void;
	}

	const { debugEnabled, debugOpen, onDebug }: Props = $props();

	const standardShortcuts: readonly {
		icon: ClientHudIconName;
		label: string;
	}[] = [
		{ icon: "inventory", label: "Inventory" },
		{ icon: "training", label: "Training" },
		{ icon: "spells", label: "Spells" },
		{ icon: "party", label: "Party" },
		{ icon: "map", label: "Map" },
		{ icon: "journal", label: "Journal" },
		{ icon: "settings", label: "Settings" },
	];
	const shortcuts = $derived(
		debugEnabled
			? [...standardShortcuts, { icon: "debug" as const, label: "Debug" }]
			: standardShortcuts,
	);
</script>

<nav
	class="shortcut-dock"
	style:--shortcut-count={shortcuts.length}
	aria-label="Game panels"
>
	{#each shortcuts as shortcut}
		<button
			type="button"
			title={shortcut.icon === "debug"
				? "Client diagnostics"
				: `${shortcut.label} (stub)`}
			aria-label={shortcut.label}
			aria-pressed={shortcut.icon === "debug" ? debugOpen : undefined}
			onclick={() => {
				if (shortcut.icon === "debug") onDebug();
			}}
		>
			<ClientHudIcon name={shortcut.icon} />
		</button>
	{/each}
</nav>

<style>
	.shortcut-dock {
		display: grid;
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		grid-template-columns: repeat(var(--shortcut-count), minmax(0, 1fr));
		gap: 5px;
	}
	button {
		min-width: 0;
		min-height: 0;
		padding: 8px;
		border: 1px solid rgb(242 242 232 / 0.58);
		background: rgb(20 22 21 / 0.36);
		color: rgb(242 242 232 / 0.92);
		box-shadow: 0 2px 8px rgb(0 0 0 / 0.25);
	}
	button:hover {
		border-color: rgb(239 208 111 / 0.88);
		background: rgb(35 35 29 / 0.62);
	}
</style>
