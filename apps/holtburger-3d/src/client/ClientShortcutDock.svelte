<script lang="ts" module>
	import type { ClientHudIconName } from "./ClientHudIcon.svelte";

	/** Implemented floating system windows; the combat action does not open a panel. */
	export type ClientSystemPanel = "inventory" | "debug" | "spells" | "settings";

	function systemPanel(icon: ClientHudIconName): ClientSystemPanel | null {
		return icon === "inventory" ||
			icon === "debug" ||
			icon === "spells" ||
			icon === "settings"
			? icon
			: null;
	}

	/** One displayed system shortcut, shared by sizing and rendering. */
	interface ClientShortcut {
		/** Glyph identifying the shortcut. */
		readonly icon: ClientHudIconName;
		/** Accessible shortcut name. */
		readonly label: string;
	}

	const standardShortcuts: readonly ClientShortcut[] = [
		{ icon: "combat", label: "Combat stance" },
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
	import type { ClientCombatMode } from "./client-host-contract";
	import ClientHudIcon from "./ClientHudIcon.svelte";

	interface Props {
		/** Server-confirmed stance, independent of the active panel. */
		readonly combatMode: ClientCombatMode;
		/** Whether gameplay currently accepts stance changes. */
		readonly combatEnabled: boolean;
		/** Execute the stance action without changing the open panel. */
		readonly onToggleCombat: () => void;
		/** The same visible list used to determine the initial dock width. */
		readonly shortcuts: readonly ClientShortcut[];
		readonly activePanel: ClientSystemPanel | null;
		readonly onToggle: (panel: ClientSystemPanel) => void;
	}

	const {
		shortcuts,
		activePanel,
		onToggle,
		combatMode,
		combatEnabled,
		onToggleCombat,
	}: Props = $props();
</script>

<nav
	class="shortcut-dock"
	style:--shortcut-count={shortcuts.length}
	aria-label="Game shortcuts"
>
	{#each shortcuts as shortcut}
		{@const panel = systemPanel(shortcut.icon)}
		{@const combat = shortcut.icon === "combat"}
		{@const combatActive = combatMode !== "peace" && combatMode !== "unknown"}
		<button
			type="button"
			class="ui-hud-button"
			title={combat
				? `Combat stance: ${combatMode}. Toggle peace/combat (~)`
				: panel === null
					? `${shortcut.label} (stub)`
					: panel === "debug"
						? "Client diagnostics"
						: shortcut.label}
			aria-label={shortcut.label}
			aria-pressed={combat
				? combatActive
				: panel === null
					? undefined
					: activePanel === panel}
			disabled={combat && (!combatEnabled || combatMode === "unknown")}
			onclick={() => {
				if (combat) onToggleCombat();
				else if (panel !== null) onToggle(panel);
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
