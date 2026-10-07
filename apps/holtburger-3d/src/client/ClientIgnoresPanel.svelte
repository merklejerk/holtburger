<script lang="ts">
	import { onMount, untrack } from "svelte";
	import ClientHudIcon from "./ClientHudIcon.svelte";
	import type { ClientSquelchState } from "./client-squelch-state";
	interface Props {
		/** Session-owned facts and pending intent survive tab unmount. */
		readonly owner: ClientSquelchState;
	}
	const { owner }: Props = $props();
	let view = $state(untrack(() => owner.read()));
	let name = $state("");
	const busy = $derived(!view.enabled || view.pending !== null);
	onMount(() => {
		view = owner.read();
		return owner.subscribe(() => {
			view = owner.read();
		});
	});
	async function add(scope: "account" | "character"): Promise<void> {
		const draft = name;
		if (
			(await owner.request({ kind: "add", name: draft, scope })) &&
			name === draft
		)
			name = "";
	}
</script>

<div class="ignores">
	<form
		class="add-ignore"
		onsubmit={(event) => {
			event.preventDefault();
			void add("account");
		}}
	>
		<input
			class="ui-input"
			aria-label="Ignore character name"
			placeholder="Character name"
			bind:value={name}
			disabled={busy}
		/>
		<div class="add-actions">
			<button
				class="ui-button"
				type="submit"
				disabled={busy || name.trim().length === 0}>Ignore account</button
			>
			<button
				class="ui-button"
				type="button"
				disabled={busy || name.trim().length === 0}
				onclick={() => add("character")}>Ignore character</button
			>
		</div>
	</form>
	<details class="ui-disclosure ui-disclosure-section" open>
		<summary>Ignores</summary>
		<div class="ui-disclosure-body">
			<input
				class="ui-input"
				aria-label="Search ignores"
				placeholder="Search ignores"
				value={view.search}
				oninput={(event) => owner.setSearch(event.currentTarget.value)}
			/>
			{#if view.known && view.entries.length === 0}<p class="ui-muted">
					{view.search ? "No matching ignores." : "No ignores added."}
				</p>{/if}
			<div class="ui-inset">
				<ul class="ui-scroll-list" aria-label="Ignores">
					{#each view.entries as entry (entry.guid)}
						<li class="ui-list-row ui-list-row-nowrap">
							<div class="ui-list-content ignore-info">
								<strong class="ui-list-name"
									>{entry.name || "Name unavailable"}</strong
								>
								<span class="ui-muted"
									>{entry.account
										? "Entire account"
										: "This character only"}</span
								>
								{#if entry.coverage === "partial"}<span class="ui-muted"
										>{entry.account
											? "Also has character category restrictions"
											: "Some message categories"} · read-only</span
									>
								{:else if entry.coverage === "none" && !entry.account}<span
										class="ui-muted">No message categories · read-only</span
									>{/if}
								{#if view.pending?.kind === "remove" && view.pending.guid === entry.guid}<span
										class="ui-muted">Removing…</span
									>{/if}
							</div>
							{#if entry.removalScope !== null}<div
									class="ui-icon-actions ui-list-actions"
								>
									<button
										class="ui-button ui-icon-button"
										type="button"
										aria-label={`Remove ${entry.account ? "account" : "character"} ignore for ${entry.name}`}
										title={`Remove ${entry.account ? "account" : "character"} ignore for ${entry.name}`}
										disabled={busy}
										onclick={() => {
											if (entry.removalScope !== null)
												void owner.request({
													kind: "remove",
													guid: entry.guid,
													scope: entry.removalScope,
												});
										}}><ClientHudIcon name="remove" /></button
									>
								</div>{/if}
						</li>
					{/each}
					{#if view.pending?.kind === "add"}<li class="ui-list-row ui-muted">
							{view.pending.name} · Adding…
						</li>{/if}
				</ul>
			</div>
		</div>
	</details>
	{#if view.globalCoverage !== "none" || view.legacyAccounts.length > 0}
		<details class="ui-disclosure ui-disclosure-section" open>
			<summary>Other restrictions</summary>
			<div class="ui-disclosure-body">
				{#if view.globalCoverage !== "none"}<p class="ui-muted">
						Global filtering: {view.globalCoverage === "all"
							? "all message categories"
							: "some message categories"}. Editing is not available here yet.
					</p>{/if}
				{#if view.legacyAccounts.length > 0}<p class="ui-muted">
						Additional account restrictions (read-only): {view.legacyAccounts.join(
							", ",
						)}.
					</p>{/if}
			</div>
		</details>
	{/if}
	<p class="ui-muted">
		Saved for this character. Account scope blocks the target’s other characters
		too.
	</p>
	{#if view.feedback}<p role="status">{view.feedback}</p>{/if}
</div>

<style>
	@layer components {
		.ignores,
		.add-ignore {
			display: grid;
			gap: 0.5rem;
		}
		.add-actions {
			display: flex;
			flex-wrap: wrap;
			justify-content: flex-end;
			gap: 6px;
		}
		.ignore-info {
			display: grid;
			gap: 2px;
		}
	}
</style>
