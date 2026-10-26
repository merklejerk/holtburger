<script lang="ts" module>
	import {
		CLIENT_PANEL_SHORTCUT_ACTIONS,
		type ClientPanelShortcut,
	} from "../lib/input/input-contract";
	import type { ClientHudIconName } from "./ClientHudIcon.svelte";

	/** Implemented floating system windows; the combat action does not open a panel. */
	export type ClientSystemPanel =
		| "inventory"
		| "debug"
		| "settings"
		| "characterSheet"
		| "world"
		| "social"
		| "journal";

	/** Shared dispatch targets for configured keyboard actions and dock hints. */
	export const PANEL_SHORTCUTS = {
		toggleInventory: "inventory",
		toggleCharacter: "characterSheet",
		toggleSocial: "social",
		toggleWorld: "world",
		toggleJournal: "journal",
		toggleSettings: "settings",
	} as const satisfies Readonly<Record<ClientPanelShortcut, ClientSystemPanel>>;

	function systemPanel(icon: ClientHudIconName): ClientSystemPanel | null {
		if (icon === "party") return "social";
		return icon === "training"
			? "characterSheet"
			: icon === "inventory" ||
				  icon === "debug" ||
				  icon === "settings" ||
				  icon === "world" ||
				  icon === "journal"
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
		{ icon: "training", label: "Character" },
		{ icon: "party", label: "Social" },
		{ icon: "world", label: "World" },
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
	import { presentClientBinding } from "./client-binding-catalog";
	import type { ClientCombatMode } from "./client-host-contract";
	import type { ClientKeyboardConfiguration } from "../lib/input/input-contract";
	import { type InputDisplayPlatform } from "../lib/input/input-presentation";
	import ClientHudIcon from "./ClientHudIcon.svelte";
	import ClientHudTray from "./ClientHudTray.svelte";
	import {
		createClientHudPanelPlacement,
		type ClientHudPlacement,
		type ClientHudViewport,
	} from "./client-hud-layout";
	import { CLIENT_UI_DEFAULTS } from "./client-ui-defaults";
	import { hudTrayOrientation } from "./client-hud-tray-layout";

	interface Props {
		/** Saved anchor and orientation; old resized dimensions are normalized to tray defaults. */
		readonly placement: ClientHudPlacement;
		readonly editable: boolean;
		readonly viewport: ClientHudViewport;
		readonly onPlacementChange: (placement: ClientHudPlacement) => void;
		/** Accepted keyboard bindings for stance and system-panel hints. */
		readonly input: ClientKeyboardConfiguration;
		readonly displayPlatform: InputDisplayPlatform;
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
		placement,
		editable,
		viewport,
		onPlacementChange,
		input,
		displayPlatform,
		shortcuts,
		activePanel,
		onToggle,
		combatMode,
		combatEnabled,
		onToggleCombat,
	}: Props = $props();
	const trayPlacement = $derived.by(() => {
		const defaults = createClientHudPanelPlacement(
			CLIENT_UI_DEFAULTS.shortcuts,
			viewport,
			shortcuts.length,
		);
		// Resizable saves had no orientation contract; square saves start horizontally.
		const vertical = placement.preferredHeight > placement.preferredWidth;
		return {
			...placement,
			preferredWidth: vertical
				? defaults.preferredHeight
				: defaults.preferredWidth,
			preferredHeight: vertical
				? defaults.preferredWidth
				: defaults.preferredHeight,
		};
	});
	const combatShortcut = $derived(
		presentClientBinding(
			input,
			{ kind: "client", action: "toggleCombat" },
			displayPlatform,
		),
	);
	const orientation = $derived(hudTrayOrientation(trayPlacement));
</script>

<ClientHudTray
	label="Game shortcuts"
	placement={trayPlacement}
	gapCount={shortcuts.length - 1}
	{editable}
	{viewport}
	{onPlacementChange}
>
	<nav
		class="shortcut-dock"
		class:vertical={orientation === "vertical"}
		style:--shortcut-count={shortcuts.length}
		aria-label="Game shortcuts"
	>
		{#each shortcuts as shortcut}
			{@const panel = systemPanel(shortcut.icon)}
			{@const panelAction = CLIENT_PANEL_SHORTCUT_ACTIONS.find(
				(action) => PANEL_SHORTCUTS[action] === panel,
			)}
			{@const panelBinding =
				panelAction === undefined
					? null
					: presentClientBinding(
							input,
							{ kind: "client", action: panelAction },
							displayPlatform,
						)}
			{@const combat = shortcut.icon === "combat"}
			{@const combatActive = combatMode !== "peace" && combatMode !== "unknown"}
			<button
				type="button"
				class="ui-hud-button ui-icon-button"
				title={combat
					? `Combat stance: ${combatMode}. Toggle peace/combat (${combatShortcut.description})`
					: panel === null
						? `${shortcut.label} (stub)`
						: panel === "debug"
							? "Client diagnostics"
							: panelBinding === null
								? shortcut.label
								: `${shortcut.label} (${panelBinding.description})`}
				aria-label={combat
					? `${shortcut.label} (${combatShortcut.description})`
					: shortcut.label}
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
</ClientHudTray>

<style>
	@layer components {
		.shortcut-dock {
			display: grid;
			box-sizing: border-box;
			width: 100%;
			height: 100%;
			grid-template-columns: repeat(var(--shortcut-count), minmax(0, 1fr));
			gap: calc(var(--ui-hud-icon-gap) * var(--ui-icon-scale));
		}
		.shortcut-dock.vertical {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: repeat(var(--shortcut-count), minmax(0, 1fr));
		}
		button {
			pointer-events: auto;
			min-width: 0;
			min-height: 0;
			padding: calc(8px * var(--ui-icon-scale));
		}
	}
</style>
