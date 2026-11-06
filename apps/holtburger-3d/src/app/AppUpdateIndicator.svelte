<script lang="ts">
	import { onMount } from "svelte";
	import DownloadIcon from "../assets/icons/hud-download.svg?component";
	import { formatError } from "../lib/format-error";
	import { APP_BUILD_LABEL } from "./app-build";
	import type { UpdateSnapshot } from "./app-update-contract";
	import { createAppUpdateTransport } from "./app-update-transport";

	/** Hourly/event-driven native decisions are cold footer presentation state. */
	let availability = $state<UpdateSnapshot["availability"]>({
		kind: "unknown",
	});
	/** Only an explicit browser-opening failure is presented to the user. */
	let openingFailure = $state<string | null>(null);
	let openDownloads: (() => Promise<void>) | null = null;
	const label = $derived(
		availability.kind === "available"
			? `Update available: v${availability.version} — open downloads`
			: "",
	);
	const updateAvailable = $derived(availability.kind === "available");

	async function open(): Promise<void> {
		if (openDownloads === null) return;
		openingFailure = null;
		try {
			await openDownloads();
		} catch (error) {
			openingFailure = `Could not open update downloads: ${formatError(error)}`;
			console.error(openingFailure);
		}
	}

	onMount(() => {
		const bridge = window.holtburgerUpdates;
		if (bridge === undefined) return;
		const transport = createAppUpdateTransport(bridge);
		openDownloads = transport.openDownloads;
		let active = true;
		let token: string | null = null;
		const report = (error: unknown) =>
			console.error(`Update presentation failed: ${formatError(error)}`);
		// Pregame screens unmount on gameplay entry; document visibility covers minimizing/hiding.
		const visible = () => document.visibilityState === "visible";
		const updateVisibility = () => {
			if (token !== null)
				void transport
					.setPregameVisible(token, visible())
					.then((status) => {
						if (status === "retired") token = null;
					})
					.catch(report);
		};
		const unsubscribe = transport.subscribe((snapshot) => {
			availability = snapshot.availability;
		}, report);
		document.addEventListener("visibilitychange", updateVisibility);
		void transport.registerPregame(visible()).then((registered) => {
			if (!active) {
				void transport.releasePregame(registered).catch(report);
				return;
			}
			token = registered;
			updateVisibility();
		}, report);
		return () => {
			active = false;
			openDownloads = null;
			unsubscribe();
			document.removeEventListener("visibilitychange", updateVisibility);
			if (token !== null) void transport.releasePregame(token).catch(report);
		};
	});
</script>

<span
	class="pregame-build-label"
	class:update-available={updateAvailable}
	aria-label="Build information">{APP_BUILD_LABEL}</span
>
{#if updateAvailable}
	<button
		class="ui-button ui-icon-button pregame-quiet pregame-update"
		type="button"
		title={label}
		aria-label={label}
		onclick={() => void open()}
	>
		<span class="pregame-icon" aria-hidden="true"><DownloadIcon /></span>
	</button>
{/if}
{#if openingFailure}<span role="alert" class="ui-error">{openingFailure}</span
	>{/if}
