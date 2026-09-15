<script lang="ts" module>
	import type { ClientHudIconName } from "./ClientHudIcon.svelte";

	/** Implemented floating system windows; other dock glyphs remain placeholders. */
	export type ClientSystemPanel = "inventory" | "debug" | "spells";

	function systemPanel(icon: ClientHudIconName): ClientSystemPanel | null {
		return icon === "inventory" || icon === "debug" || icon === "spells"
			? icon
			: null;
	}

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
		readonly activePanel: ClientSystemPanel | null;
		readonly onToggle: (panel: ClientSystemPanel) => void;
	}

	const { shortcuts, activePanel, onToggle }: Props = $props();
</script>

<nav
	class="shortcut-dock"
	style:--shortcut-count={shortcuts.length}
	aria-label="Game panels"
>
	{#each shortcuts as shortcut}
		{@const panel = systemPanel(shortcut.icon)}
		<button
			type="button"
			class="ui-hud-button"
			title={panel === null
				? `${shortcut.label} (stub)`
				: panel === "debug"
					? "Client diagnostics"
					: shortcut.label}
			aria-label={shortcut.label}
			aria-pressed={panel === null ? undefined : activePanel === panel}
			onclick={() => {
				if (panel !== null) onToggle(panel);
			}}
		>
			<ClientHudIcon name={shortcut.icon} />
		</button>
	{/each}
</nav>

<style>
	@layer components {
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
		}
	}
</style>
