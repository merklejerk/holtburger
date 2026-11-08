<script lang="ts">
	import { onMount } from "svelte";
	import AppUpdateDialog from "./AppUpdateDialog.svelte";
	import DownloadIcon from "../assets/icons/hud-download.svg?component";
	import { formatError } from "../lib/format-error";
	import { APP_BUILD_LABEL } from "./app-build";
	import type { UpdateSnapshot } from "./app-update-contract";
	import { createAppUpdateTransport } from "./app-update-transport";

	/** Native snapshots update only on request transitions and completed checks. */
	let snapshot = $state<UpdateSnapshot>({
		revision: 0,
		availability: { kind: "unknown" },
		check: { kind: "disabled" },
	});
	/** Modal visibility is local to this pregame footer. */
	let showingChanges = $state(false);
	/** A browser or retry action has one outcome; failures cannot overlap a pending action. */
	let action = $state<
		{ kind: "idle" } | { kind: "pending" } | { kind: "failed"; message: string }
	>({ kind: "idle" });
	const busy = $derived(action.kind === "pending");
	const actionFailure = $derived(
		action.kind === "failed" ? action.message : null,
	);
	let transport: ReturnType<typeof createAppUpdateTransport> | null = null;
	const updateAvailable = $derived(snapshot.availability.kind === "available");
	const label = $derived(
		snapshot.availability.kind === "available"
			? `Update available: v${snapshot.availability.releases[0].version} — view changes`
			: "View release changes",
	);

	async function act(
		operation: "refresh" | "openDownloads" | "openHistory",
	): Promise<void> {
		if (transport === null || busy) return;
		action = { kind: "pending" };
		try {
			await transport[operation]();
			action = { kind: "idle" };
		} catch (error) {
			action = {
				kind: "failed",
				message: `Could not complete release action: ${formatError(error)}`,
			};
			console.error(action.message);
		}
	}

	function showChanges(): void {
		showingChanges = true;
		if (!busy) action = { kind: "idle" };
		if (snapshot.check.kind === "idle") void act("refresh");
	}

	onMount(() => {
		const bridge = window.holtburgerUpdates;
		if (bridge === undefined) return;
		const mountedTransport = createAppUpdateTransport(bridge);
		transport = mountedTransport;
		let active = true;
		let token: string | null = null;
		const report = (error: unknown) =>
			console.error(`Update presentation failed: ${formatError(error)}`);
		// Pregame screens unmount on gameplay entry; document visibility covers minimizing/hiding.
		const visible = () => document.visibilityState === "visible";
		const updateVisibility = () => {
			if (token !== null)
				void mountedTransport
					.setPregameVisible(token, visible())
					.then((status) => {
						if (status === "retired") token = null;
					})
					.catch(report);
		};
		const unsubscribe = mountedTransport.subscribe((next) => {
			snapshot = next;
		}, report);
		document.addEventListener("visibilitychange", updateVisibility);
		void mountedTransport.registerPregame(visible()).then((registered) => {
			if (!active) {
				void mountedTransport.releasePregame(registered).catch(report);
				return;
			}
			token = registered;
			updateVisibility();
		}, report);
		return () => {
			active = false;
			transport = null;
			unsubscribe();
			document.removeEventListener("visibilitychange", updateVisibility);
			if (token !== null)
				void mountedTransport.releasePregame(token).catch(report);
		};
	});
</script>

<button
	class="ui-button pregame-quiet pregame-build-label"
	class:update-available={updateAvailable}
	type="button"
	title={label}
	aria-label={label}
	onclick={showChanges}
>
	<span>{APP_BUILD_LABEL}</span>
	{#if updateAvailable}
		<span class="pregame-icon" aria-hidden="true"><DownloadIcon /></span>
	{/if}
</button>
{#if showingChanges}
	<AppUpdateDialog
		{snapshot}
		{actionFailure}
		{busy}
		onRefresh={() => void act("refresh")}
		onDownload={() => void act("openDownloads")}
		onHistory={() => void act("openHistory")}
		onCancel={() => {
			showingChanges = false;
		}}
	/>
{/if}

<style>
	@layer components {
		.pregame-build-label {
			display: inline-flex;
			align-items: center;
			gap: 0.5em;
		}
		.pregame-icon {
			flex-shrink: 0;
		}
	}
</style>
