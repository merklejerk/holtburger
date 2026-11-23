<script lang="ts">
	import { parseResidenceInput } from "../explorer/camera/world-input";
	import type { ExplorerLaunchRequest } from "./launcher-contract";

	interface Props {
		busy: boolean;
		canPlay: boolean;
		initialDefaults: ExplorerLaunchRequest | null;
		onBrowseContent: (previous: string | null) => Promise<string | null>;
		onBrowseWeenieCatalog: (previous: string | null) => Promise<string | null>;
		onLaunch: (request: ExplorerLaunchRequest) => Promise<void>;
	}

	const {
		busy,
		canPlay,
		initialDefaults,
		onBrowseContent,
		onBrowseWeenieCatalog,
		onLaunch,
	}: Props = $props();

	let contentPath = $state("");
	let weenieCatalogPath = $state("");
	let locationInput = $state("");
	let hydrated = false;

	$effect(() => {
		if (hydrated || initialDefaults === null) return;
		hydrated = true;
		contentPath = initialDefaults.contentPath ?? "";
		weenieCatalogPath = initialDefaults.weenieCatalogPath ?? "";
		locationInput = initialDefaults.initialLocation ?? "";
	});

	const trimmedLocation = $derived(locationInput.trim());
	const locationInvalid = $derived(
		trimmedLocation.length > 0 && parseResidenceInput(trimmedLocation) === null,
	);
	const overrideCount = $derived(
		(contentPath.trim().length > 0 ? 1 : 0) +
			(weenieCatalogPath.trim().length > 0 ? 1 : 0),
	);
	const canSubmit = $derived(!busy && canPlay && !locationInvalid);

	async function browseContent(): Promise<void> {
		const selected = await onBrowseContent(
			contentPath.trim() === "" ? null : contentPath.trim(),
		);
		if (selected !== null) contentPath = selected;
	}

	async function browseWeenieCatalog(): Promise<void> {
		const selected = await onBrowseWeenieCatalog(
			weenieCatalogPath.trim() === "" ? null : weenieCatalogPath.trim(),
		);
		if (selected !== null) weenieCatalogPath = selected;
	}

	function submit(event: SubmitEvent): void {
		event.preventDefault();
		if (!canSubmit) return;
		void onLaunch({
			contentPath: contentPath.trim() === "" ? null : contentPath.trim(),
			weenieCatalogPath:
				weenieCatalogPath.trim() === "" ? null : weenieCatalogPath.trim(),
			initialLocation: trimmedLocation === "" ? null : trimmedLocation,
		});
	}
</script>

<section
	class="explorer-launcher"
	aria-label="Explorer launcher"
	aria-busy={busy}
>
	<header class="explorer-launcher-header">
		<h1>World Explorer</h1>
		<p>
			Inspect Asheron's Call landblocks, interiors, rendering, and spawned
			entities offline without connecting to a server.
		</p>
	</header>

	<form class="explorer-launcher-form" onsubmit={submit}>
		<div class="explorer-launcher-field">
			<label for="explorer-initial-location">Initial location (optional)</label>
			<input
				id="explorer-initial-location"
				class="ui-input"
				bind:value={locationInput}
				placeholder="Default: 22S, 2W (e.g. 0xA9B4FFFF or 42.1N, 33.6E)"
				aria-invalid={locationInvalid}
				disabled={busy}
			/>
			{#if locationInvalid}
				<small class="explorer-launcher-error" role="alert">
					Enter a landblock hex (e.g. A9B4), cell ID (e.g. 0xA9B40100), or
					coordinates (e.g. 42.1N, 33.6E).
				</small>
			{:else}
				<small>
					Starting landblock, cell ID, or Dereth coordinates (defaults to 22S,
					2W).
				</small>
			{/if}
		</div>

		<details class="ui-disclosure ui-disclosure-section">
			<summary>
				{overrideCount > 0 ? `Advanced (${overrideCount} set)` : "Advanced"}
			</summary>
			<div class="explorer-launcher-advanced ui-disclosure-body ui-inset">
				<div class="explorer-launcher-field">
					<label for="explorer-content-path">Asset directory override</label>
					<div class="explorer-launcher-path-input">
						<input
							id="explorer-content-path"
							class="ui-input"
							bind:value={contentPath}
							placeholder="Use application default"
							disabled={busy}
						/>
						<div class="explorer-launcher-path-actions">
							{#if contentPath}
								<button
									class="ui-button ui-icon-button pregame-quiet"
									type="button"
									aria-label="Clear asset directory"
									title="Use application default"
									disabled={busy}
									onclick={() => (contentPath = "")}>×</button
								>
							{/if}
							<button
								class="ui-button ui-icon-button pregame-quiet"
								type="button"
								aria-label="Browse asset directory"
								title="Browse asset directory"
								disabled={busy}
								onclick={() => void browseContent()}>…</button
							>
						</div>
					</div>
					<small>
						Optional DAT or HBA folder override. Leave blank to use the default
						client asset location.
					</small>
				</div>

				<div class="explorer-launcher-field">
					<label for="explorer-weenie-catalog"
						>Weenie catalog (weenies.hwc)</label
					>
					<div class="explorer-launcher-path-input">
						<input
							id="explorer-weenie-catalog"
							class="ui-input"
							bind:value={weenieCatalogPath}
							placeholder="Auto-discover sibling weenies.hwc"
							disabled={busy}
						/>
						<div class="explorer-launcher-path-actions">
							{#if weenieCatalogPath}
								<button
									class="ui-button ui-icon-button pregame-quiet"
									type="button"
									aria-label="Clear weenie catalog"
									title="Clear weenie catalog"
									disabled={busy}
									onclick={() => (weenieCatalogPath = "")}>×</button
								>
							{/if}
							<button
								class="ui-button ui-icon-button pregame-quiet"
								type="button"
								aria-label="Browse weenie catalog"
								title="Browse weenie catalog"
								disabled={busy}
								onclick={() => void browseWeenieCatalog()}>…</button
							>
						</div>
					</div>
					<small>
						Optional compiled ACE weenie catalog for entity spawning. World,
						Renderer, and Map tools work without it.
					</small>
				</div>
			</div>
		</details>

		<button
			class="pregame-primary pregame-action ui-button launcher-play explorer-launcher-submit"
			type="submit"
			disabled={!canSubmit}>Launch Explorer</button
		>
	</form>
</section>

<style>
	@layer components {
		.explorer-launcher {
			display: grid;
			align-content: start;
			gap: 20px;
			max-width: 560px;
			width: 100%;
			margin-inline: auto;
		}
		.explorer-launcher-header {
			display: grid;
			gap: 6px;
		}
		.explorer-launcher-header h1 {
			margin: 0;
		}
		.explorer-launcher-header p,
		.explorer-launcher-field small {
			margin: 0;
			color: var(--ui-color-muted);
		}
		.explorer-launcher-form {
			display: grid;
			gap: 16px;
		}
		.explorer-launcher-advanced {
			display: grid;
			gap: 16px;
		}
		.explorer-launcher-field {
			display: grid;
			gap: 6px;
		}
		.explorer-launcher-path-input {
			position: relative;
		}
		.explorer-launcher-path-input .ui-input {
			width: 100%;
			padding-inline-end: 54px;
		}
		.explorer-launcher-path-actions {
			display: flex;
			position: absolute;
			inset-block: 2px;
			inset-inline-end: 2px;
		}
		.explorer-launcher-path-actions .ui-icon-button {
			width: 24px;
		}
		.explorer-launcher-error {
			color: var(--ui-color-danger);
		}
		.explorer-launcher-submit {
			margin-top: 8px;
		}
	}
</style>
