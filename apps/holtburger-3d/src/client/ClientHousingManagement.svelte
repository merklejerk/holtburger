<script lang="ts">
	import { onMount } from "svelte";
	import { CLIENT_TUNING } from "./client-tuning";
	import type {
		ClientHousingManagementState,
		HousingManagementView,
	} from "./client-housing-management-state";
	interface Props {
		/** App/session lifetime owns submitted administration. */ readonly model: ClientHousingManagementState;
	}
	const { model }: Props = $props();
	/** Markup pulls a bounded display snapshot rather than subscribing to raw session events. */
	let view = $state<HousingManagementView | null>(null);
	/** Cold form input, never retained as an authoritative guest entry. */
	let guestName = $state("");
	/** Occupant booting is independent of editing the guest list. */
	let occupantName = $state("");
	function act(action: () => void): void {
		action();
		view = model.read();
	}
	function addGuest(event: SubmitEvent): void {
		event.preventDefault();
		const name = guestName.trim();
		if (name.length > 0) act(() => model.request({ kind: "addGuest", name }));
	}
	function boot(event: SubmitEvent): void {
		event.preventDefault();
		const name = occupantName.trim();
		act(() =>
			model.request(
				name.length === 0
					? { kind: "bootEveryone" }
					: { kind: "bootGuest", name },
			),
		);
	}

	onMount(() => {
		view = model.read();
		const timer = setInterval(() => {
			view = model.read();
		}, CLIENT_TUNING.inventory.displayIntervalMs);
		return () => clearInterval(timer);
	});
</script>

<section
	aria-label="Manage housing"
	class="housing-management"
	aria-busy={view?.pending === true}
>
	{#if view !== null}
		<details
			class="ui-disclosure ui-disclosure-section"
			aria-label="Access permissions"
		>
			<summary>Access &amp; guests</summary>
			<div class="ui-disclosure-body">
				{#if view.records === null && !view.loading}
					<button
						class="ui-button"
						disabled={view.pending}
						onclick={() => void model.refresh()}>Retry</button
					>
				{/if}
				<fieldset
					class="ui-fieldset"
					disabled={!view.editable || view.confirmation !== null}
					aria-label="Access controls"
				>
					<label class="housing-toggle"
						><input
							type="checkbox"
							checked={view.publicEntry}
							onchange={(event) =>
								act(() =>
									model.request({
										kind: "publicEntry",
										enabled: event.currentTarget.checked,
									}),
								)}
						/>Public entry</label
					>
					<label class="housing-toggle"
						><input
							type="checkbox"
							aria-label="Allegiance entry"
							checked={view.allegianceEntry}
							onchange={(event) =>
								act(() =>
									model.request({
										kind: "allegianceEntry",
										enabled: event.currentTarget.checked,
									}),
								)}
						/>Allegiance entry</label
					>
					<label class="housing-toggle"
						><input
							type="checkbox"
							aria-label="Allegiance storage"
							checked={view.allegianceStorage}
							onchange={(event) =>
								act(() =>
									model.request({
										kind: "allegianceStorage",
										enabled: event.currentTarget.checked,
									}),
								)}
						/>Allegiance storage</label
					>
					<section
						class="housing-guest-access ui-inset"
						aria-label="Guest access"
					>
						{#if view.guests !== null}
							<form class="housing-form-row" onsubmit={addGuest}>
								<input
									class="ui-input"
									aria-label="Guest character name"
									bind:value={guestName}
									autocomplete="off"
									placeholder="Character name"
								/><button
									class="ui-button"
									disabled={guestName.trim().length === 0}
									type="submit">Add guest</button
								>
							</form>
							<ul class="housing-guest-list ui-scroll-list">
								{#each view.guests as guest (guest.character)}
									<li class="housing-guest-row ui-list-row">
										<strong>{guest.name}</strong>
										<label class="housing-toggle"
											><input
												type="checkbox"
												aria-label={`Storage access for ${guest.name}`}
												checked={guest.storageChecked}
												onchange={(event) =>
													act(() =>
														model.request({
															kind: "storage",
															name: guest.name,
															allowed: event.currentTarget.checked,
														}),
													)}
											/>Storage access</label
										>
										<button
											class="ui-button"
											aria-label={`Remove ${guest.name}`}
											onclick={() =>
												act(() =>
													model.request({
														kind: "removeGuest",
														name: guest.name,
													}),
												)}>Remove</button
										>
									</li>
								{:else}<li class="ui-muted">No guests.</li>{/each}
							</ul>
							<div class="housing-form-row">
								<button
									class="ui-button"
									disabled={view.guests.length === 0}
									onclick={() =>
										act(() => model.request({ kind: "removeAllStorage" }))}
									>Revoke all storage access</button
								>
								<button
									class="ui-button"
									disabled={view.guests.length === 0}
									onclick={() =>
										act(() => model.request({ kind: "removeAllGuests" }))}
									>Remove all guests</button
								>
							</div>
						{:else}<p class="ui-muted">
								{view.loading
									? "Loading permissions…"
									: "Permissions unavailable."}
							</p>{/if}
					</section>
					<form class="housing-form-row" onsubmit={boot}>
						<input
							class="ui-input"
							aria-label="Occupant character name"
							bind:value={occupantName}
							autocomplete="off"
							placeholder="Character name"
						/>
						<button
							class="ui-button"
							type="submit"
							title="Boot without removing guest access"
						>
							{occupantName.trim().length === 0 ? "Boot all" : "Boot"}
						</button>
					</form>
				</fieldset>
			</div>
		</details>
		<details
			class="ui-disclosure ui-disclosure-section"
			aria-label="Decorations"
		>
			<summary>Decorations</summary>
			<div class="ui-disclosure-body">
				<fieldset
					class="ui-fieldset"
					disabled={!view.editable || view.confirmation !== null}
				>
					<div class="housing-form-row">
						<button
							class="ui-button"
							onclick={() =>
								act(() => model.request({ kind: "hooks", enabled: true }))}
							>Show empty hooks</button
						>
						<button
							class="ui-button"
							onclick={() =>
								act(() => model.request({ kind: "hooks", enabled: false }))}
							>Hide empty hooks</button
						>
					</div>
				</fieldset>
			</div>
		</details>

		<details
			class="ui-disclosure ui-disclosure-section"
			aria-label="Advanced housing actions"
		>
			<summary>Advanced</summary>
			<div class="ui-disclosure-body">
				<fieldset
					class="ui-fieldset"
					disabled={!view.editable || view.confirmation !== null}
				>
					<button
						class="ui-button housing-danger"
						onclick={() => act(() => model.request({ kind: "abandon" }))}
						>Abandon home…</button
					>
				</fieldset>
			</div>
		</details>
	{/if}
</section>
