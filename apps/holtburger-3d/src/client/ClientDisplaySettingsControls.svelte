<script lang="ts">
	import { onMount } from "svelte";
	import {
		observeWindowDisplay,
		windowDisplayBridge,
	} from "../app/window-display-transport";
	import {
		type WindowDisplayRequest,
		type WindowDisplaySnapshot,
	} from "../app/window-display-contract";
	import { formatError } from "../lib/format-error";

	const bridge = windowDisplayBridge();
	/** Cold native events update controls only when window geometry or display policy changes. */
	let snapshot = $state<WindowDisplaySnapshot | null>(null);
	let pending = $state(false);
	let error = $state<string | null>(null);
	let disabled = $derived(pending || snapshot === null || snapshot.busy);
	let selectedSize = $derived.by(() => {
		const current = snapshot;
		if (current === null) return "custom";
		return current.presets
			.findIndex(
				(size) =>
					size.width === current.contentSize.width &&
					size.height === current.contentSize.height,
			)
			.toString();
	});

	onMount(() => {
		if (bridge === undefined) return;
		return observeWindowDisplay(
			bridge,
			(value) => {
				snapshot = value;
			},
			(failure) => {
				error = formatError(failure);
			},
		);
	});
	async function change(request: WindowDisplayRequest): Promise<void> {
		if (bridge === undefined || disabled) return;
		pending = true;
		error = null;
		try {
			await bridge.change(request);
		} catch (failure) {
			error = formatError(failure);
		} finally {
			pending = false;
		}
	}
	function chooseSize(value: string): void {
		const size = snapshot?.presets[Number(value)];
		if (size === undefined) return;
		void change({ kind: "size", size });
	}
</script>

{#if bridge !== undefined}
	<fieldset class="ui-fieldset ui-fieldset-section">
		<legend>Display</legend>
		<div class="ui-fieldset-body settings-section">
			{#if snapshot !== null}
				<label class="ui-checkbox"
					><input
						type="checkbox"
						checked={snapshot.fullscreen}
						{disabled}
						onchange={(event) =>
							void change({
								kind: "fullscreen",
								enabled: event.currentTarget.checked,
							})}
					/> Fullscreen (F11)</label
				>
				<label class="ui-checkbox"
					><input
						type="checkbox"
						checked={snapshot.freeResize}
						disabled={disabled || snapshot.fullscreen}
						onchange={(event) =>
							void change({
								kind: "free-resize",
								enabled: event.currentTarget.checked,
							})}
					/> Free resize</label
				>
				<label
					>Window size
					<select
						value={selectedSize}
						disabled={disabled || snapshot.fullscreen}
						onchange={(event) => chooseSize(event.currentTarget.value)}
					>
						{#if selectedSize === "-1"}<option value="-1"
								>Custom — {snapshot.contentSize.width} × {snapshot.contentSize
									.height}</option
							>{/if}
						{#each snapshot.presets as size, index}<option
								value={index.toString()}>{size.width} × {size.height}</option
							>{/each}
					</select>
				</label>
			{:else}<p>Loading display settings…</p>{/if}
			{#if error !== null}<p role="alert">{error}</p>{/if}
		</div>
	</fieldset>
{/if}
