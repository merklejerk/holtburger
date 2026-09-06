<script lang="ts" module>
	import type { ClientHudIconName } from "./ClientHudIcon.svelte";

	/** One displayed game-panel shortcut, shared by sizing and rendering. */
	interface ClientShortcut {
		/** Glyph identifying the panel and its current action. */
		readonly icon: ClientHudIconName;
		/** Accessible panel name. */
		readonly label: string;
	}

	const standardShortcuts: readonly ClientShortcut[] = [
		{ icon: "inventory", label: "Inventory" },
		{ icon: "training", label: "Training" },
		{ icon: "spells", label: "Spells" },
		{ icon: "party", label: "Party" },
		{ icon: "map", label: "Map" },
		{ icon: "journal", label: "Journal" },
		{ icon: "settings", label: "Settings" },
	];
	/** Choose the launch-capability-specific list once for layout and the dock. */
	export function createClientShortcuts(
		debugEnabled: boolean,
	): readonly ClientShortcut[] {
		return debugEnabled
			? [...standardShortcuts, { icon: "debug" as const, label: "Debug" }]
			: standardShortcuts;
	}
</script>

<script lang="ts">
	import ClientHudIcon from "./ClientHudIcon.svelte";

	interface Props {
		/** The same visible list used to determine the initial dock width. */
		readonly shortcuts: readonly ClientShortcut[];
		readonly debugOpen: boolean;
		readonly onDebug: () => void;
	}

	const { shortcuts, debugOpen, onDebug }: Props = $props();
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
