<script lang="ts">
	import { onMount, untrack } from "svelte";
	import ClientHudIcon from "./ClientHudIcon.svelte";
	import type { ClientFriendsState } from "./client-friends-state";
	interface Props {
		/** Session-lifetime domain owner; tab dismissal retains facts and pending work. */
		readonly owner: ClientFriendsState;
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
	async function add(): Promise<void> {
		const draft = name;
		if (await owner.request({ kind: "add", name: draft })) {
			if (name === draft) name = "";
		}
	}
</script>

<div class="friends">
	<form
		class="add-friend"
		onsubmit={(event) => {
			event.preventDefault();
			void add();
		}}
	>
		<input
			class="ui-input"
			aria-label="Friend name"
			placeholder="Character name"
			bind:value={name}
			disabled={busy}
		/>
		<button
			class="ui-button"
			type="submit"
			disabled={busy || name.trim().length === 0}>Add Friend</button
		>
	</form>
	<details class="ui-disclosure ui-disclosure-section" open>
		<summary>Friends</summary>
		<div class="ui-disclosure-body">
			<input
				class="ui-input"
				aria-label="Search friends"
				placeholder="Search friends"
				value={view.search}
				oninput={(event) =>
					owner.setFilters(event.currentTarget.value, view.onlineOnly)}
			/>
			<label class="ui-checkbox"
				><input
					type="checkbox"
					checked={view.onlineOnly}
					onchange={(event) =>
						owner.setFilters(view.search, event.currentTarget.checked)}
				/>Online only</label
			>
			{#if !view.known}<p class="ui-muted">Friends list has not arrived.</p>
			{:else if view.members.length === 0}<p class="ui-muted">
					{view.search || view.onlineOnly
						? "No matching friends."
						: "No friends added."}
				</p>{/if}
			<div class="ui-inset">
				<ul class="ui-scroll-list" aria-label="Friends">
					{#each view.members as member (member.guid)}
						<li class="ui-list-row ui-list-row-nowrap">
							<div class="ui-list-content friend-info">
								<span
									class="ui-presence"
									class:online={member.online}
									role="img"
									aria-label={member.online ? "Online" : "Offline"}
									title={member.online ? "Online" : "Offline"}
									><ClientHudIcon
										name={member.online ? "online" : "offline"}
									/></span
								>
								<strong class="ui-list-name"
									>{member.name || "Name unavailable"}</strong
								>
								{#if view.pending?.kind === "remove" && view.pending.guid === member.guid}<span
										class="ui-muted">Removing…</span
									>{/if}
							</div>
							<div class="ui-icon-actions ui-list-actions">
								<button
									class="ui-button ui-icon-button"
									type="button"
									aria-label={`Tell ${member.name}`}
									title="Tell (coming later)"
									disabled><ClientHudIcon name="speech" /></button
								>
								<button
									class="ui-button ui-icon-button"
									type="button"
									aria-label={`Remove ${member.name} from friends`}
									title={`Remove ${member.name} from friends`}
									disabled={busy}
									onclick={() =>
										owner.request({ kind: "remove", guid: member.guid })}
									><ClientHudIcon name="remove" /></button
								>
							</div>
						</li>
					{/each}
					{#if view.pending?.kind === "add"}<li class="ui-list-row ui-muted">
							{view.pending.name} · Adding…
						</li>{/if}
				</ul>
			</div>
		</div>
	</details>
	<details class="ui-disclosure ui-disclosure-section" open>
		<summary>Presence</summary>
		<div class="ui-disclosure-body">
			<label class="ui-checkbox"
				><input
					type="checkbox"
					checked={view.preferences?.appearOffline === true}
					disabled={busy || view.preferences === null}
					onchange={(event) =>
						owner.request({
							kind: "appearOffline",
							enabled: event.currentTarget.checked,
						})}
				/>Appear offline</label
			>
		</div>
	</details>
	{#if view.pending?.kind === "appearOffline"}<p role="status">
			Updating presence preference…
		</p>{/if}
	{#if view.feedback}<p role="status">{view.feedback}</p>{/if}
</div>

<style>
	@layer components {
		.friends,
		.add-friend {
			display: grid;
			gap: 0.5rem;
		}
		.add-friend {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.friend-info {
			display: flex;
			align-items: center;
			gap: var(--ui-list-icon-gap);
		}
	}
</style>
