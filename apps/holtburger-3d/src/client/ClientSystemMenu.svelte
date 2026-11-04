<script lang="ts">
	import { requestElectronClientClose } from "../lib/host/electron-host-transport";
	import PopupMenu from "../app/PopupMenu.svelte";
	import PowerIcon from "../assets/icons/hud-power.svg?component";

	interface Props {
		/** Authority admission and local submission guard. */
		readonly canReturn: boolean;
		/** Disconnect remains available during entry and portal staging. */
		readonly canDisconnect: boolean;
		/** Character logout retains the login session. */
		readonly onReturnToMainMenu: () => void;
		/** Full server disconnect ends the session. */
		readonly onDisconnect: () => void;
	}
	const { canReturn, canDisconnect, onReturnToMainMenu, onDisconnect }: Props =
		$props();
	let button = $state<HTMLButtonElement>();
	let open = $state(false);
	/** Called only after existing modal, editor, and gameplay Escape cancellation. */
	export function show(): void {
		if (canReturn || canDisconnect) open = true;
	}
	const items = $derived([
		{ action: "logout", label: "Return to main menu", disabled: !canReturn },
		{ action: "disconnect", label: "Disconnect", disabled: !canDisconnect },
		{ action: "quit", label: "Quit application", disabled: false },
	] as const);
</script>

<button
	bind:this={button}
	class="client-system-menu ui-hud-button ui-icon-button"
	type="button"
	aria-label="System menu"
	title="System menu"
	aria-haspopup="menu"
	aria-expanded={open}
	onclick={() => (open = !open)}><PowerIcon /></button
>
{#if open && button !== undefined}
	<PopupMenu
		anchor={button}
		label="System"
		{items}
		onclose={() => (open = false)}
		onselect={(action) => {
			if (action === "logout") onReturnToMainMenu();
			else if (action === "disconnect") onDisconnect();
			else
				void requestElectronClientClose().catch((error) =>
					console.error(error),
				);
		}}
	/>
{/if}

<style>
	@layer components {
		.client-system-menu {
			position: fixed;
			top: 8px;
			right: 8px;
			z-index: 500;
			width: 28px;
			height: 28px;
			min-height: 0;
			padding: 5px;
		}
	}
</style>
