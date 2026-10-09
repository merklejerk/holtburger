<script lang="ts">
	import ClientAllegiancePanel from "./ClientAllegiancePanel.svelte";
	import type { ClientAllegianceState } from "./client-allegiance-state";
	import ClientIgnoresPanel from "./ClientIgnoresPanel.svelte";
	import type { ClientSquelchState } from "./client-squelch-state";
	import { onDestroy, untrack } from "svelte";
	import ClientFriendsPanel from "./ClientFriendsPanel.svelte";
	import type { ClientFriendsState } from "./client-friends-state";
	import ClientHudIcon from "./ClientHudIcon.svelte";
	import UiTabs from "../app/UiTabs.svelte";
	import UiTabPanel from "../app/UiTabPanel.svelte";
	import ClientPartyCreateDialog from "./ClientPartyCreateDialog.svelte";
	import ClientPartyLeaveDialog from "./ClientPartyLeaveDialog.svelte";
	import {
		PARTY_DISPLAY_INTERVAL_MS,
		type ClientPartyState,
	} from "./client-party-state";
	interface Props {
		/** Session-lifetime owner survives window dismissal. */
		readonly owner: ClientPartyState;
		readonly friends: ClientFriendsState;
		readonly squelch: ClientSquelchState;
		readonly allegiance: ClientAllegianceState;
		/** Retained windows hide without discarding tab, scroll, or disclosure state. */
		readonly visible?: boolean;
	}
	const {
		owner,
		friends,
		squelch,
		allegiance,
		visible = true,
	}: Props = $props();
	// The initial read seeds cold markup; only the mounted display timer publishes later facts.
	let view = $state(untrack(() => owner.read()));
	/** The draft belongs to its opening character and retires on lifecycle or party change. */
	let creationPlayer = $state<number | null>(null);
	let selected = $state("party");
	const tabs = [
		{
			value: "party",
			label: "Party",
			id: "social-party-tab",
			panelId: "social-party-panel",
		},
		{
			value: "allegiance",
			label: "Allegiance",
			id: "social-allegiance-tab",
			panelId: "social-allegiance-panel",
		},
		{
			value: "friends",
			label: "Friends",
			id: "social-friends-tab",
			panelId: "social-friends-panel",
		},
		{
			value: "ignores",
			label: "Ignores",
			id: "social-ignores-tab",
			panelId: "social-ignores-panel",
		},
	] as const;
	/** Captured cold party identity retires the handoff draft when membership or leadership changes. */
	let handoff = $state<{ player: number | null; roster: string } | null>(null);
	const rosterKey = (party: typeof view.party) =>
		JSON.stringify(
			party === null
				? null
				: [
						party.name,
						party.leader,
						party.members.map((member) => member.guid).sort((a, b) => a - b),
					],
		);
	const members = $derived(
		[...(view.party?.members ?? [])].sort(
			(a, b) =>
				a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
				a.guid - b.guid,
		),
	);
	const leader = $derived(view.party?.capabilities.isLeader === true);
	const candidates = $derived(
		members.filter((member) => member.guid !== view.player),
	);
	$effect(() => {
		if (!visible) {
			creationPlayer = null;
			handoff = null;
			return;
		}
		const pull = () => {
			const next = owner.read();
			if (
				creationPlayer !== null &&
				(next.player !== creationPlayer || !next.enabled || next.party !== null)
			)
				creationPlayer = null;
			// Do not republish unchanged cold facts, and never copy vital payloads into this graph.
			if (JSON.stringify(view) !== JSON.stringify(next)) view = next;
			if (
				handoff !== null &&
				(!next.enabled ||
					next.player !== handoff.player ||
					rosterKey(next.party) !== handoff.roster)
			)
				handoff = null;
		};
		// Cold visibility owns the timer; reads inside pull must not own its lifetime.
		untrack(pull);
		const timer = setInterval(pull, PARTY_DISPLAY_INTERVAL_MS);
		return () => {
			clearInterval(timer);
		};
	});
	$effect(() => owner.setVisible(visible && selected === "party"));
	onDestroy(() => owner.setVisible(false));
</script>

<div class="ui-body ui-tabbed-panel">
	<UiTabs
		label="Social tabs"
		{tabs}
		{selected}
		onSelect={(value) => {
			selected = value;
		}}
	/>
	<UiTabPanel
		id="social-party-panel"
		labelledBy="social-party-tab"
		active={selected === "party"}
	>
		<div class="social-tab">
			{#if view.pending}<p role="status">Waiting for party state…</p>{/if}
			{#if view.party === null}
				<div class="actions">
					<button
						class="ui-button"
						type="button"
						disabled={!view.enabled || view.preferences === null}
						onclick={() => (creationPlayer = view.player)}>Create Party</button
					>
				</div>
			{:else}
				<dl class="ui-facts party-summary" aria-label="Party summary">
					<dt>Party name</dt>
					<dd>{view.party.name || "Details pending"}</dd>
					<dt>Members</dt>
					<dd>{members.length}</dd>
					<dt>XP / luminance</dt>
					<dd>
						{view.party.shareXp
							? view.party.evenShare
								? "Equal sharing"
								: "Weighted sharing"
							: "No sharing"}
					</dd>
					<dt>Recruitment</dt>
					<dd>{view.party.open ? "All members" : "Leader only"}</dd>
				</dl>
				{#if view.party.locked}<p>
						Locked by content. The server restricts recruitment and reopening.
					</p>{/if}
				{#if view.party.leader === null}<p>
						Waiting for server leadership details.
					</p>{/if}
				<details class="ui-disclosure ui-disclosure-section" open>
					<summary>Roster</summary>
					<div class="ui-disclosure-body ui-inset">
						<ul class="ui-scroll-list party-roster" aria-label="Party members">
							{#each members as entry (entry.guid)}
								<li class="ui-list-row">
									<div class="member-info">
										<div class="member-name">
											{#if entry.guid === view.party.leader}
												<span
													class="member-leader"
													role="img"
													aria-label="Party leader"
													title="Party leader"
												>
													<ClientHudIcon name="leader" />
												</span>
											{/if}
											<strong
												>{entry.name}{entry.guid === view.player
													? " (you)"
													: ""}</strong
											>
										</div>
										<span class="ui-muted">Level {entry.level}</span>
									</div>
									{#if entry.canManage}
										<div class="ui-icon-actions">
											<button
												class="ui-button ui-icon-button"
												type="button"
												aria-label={`Make ${entry.name} party leader`}
												title={`Make ${entry.name} party leader`}
												disabled={!view.enabled}
												onclick={() =>
													owner.request({
														kind: "promote",
														target: entry.guid,
													})}><ClientHudIcon name="leader" /></button
											>
											<button
												class="ui-button ui-icon-button"
												type="button"
												aria-label={`Dismiss ${entry.name} from party`}
												title={`Dismiss ${entry.name} from party`}
												disabled={!view.enabled}
												onclick={() =>
													owner.request({
														kind: "dismiss",
														target: entry.guid,
													})}><ClientHudIcon name="remove" /></button
											>
										</div>
									{/if}
								</li>
							{/each}
						</ul>
					</div>
				</details>
				{#if view.party.capabilities.canChangeOpenness}
					<label
						><input
							type="checkbox"
							checked={view.party.open}
							disabled={!view.enabled}
							onchange={(event) =>
								owner.request({
									kind: "openness",
									open: event.currentTarget.checked,
								})}
						/>Allow members to invite</label
					>
				{/if}
				<div class="actions">
					<button
						class="ui-button"
						type="button"
						disabled={!view.enabled}
						onclick={() => {
							if (leader && candidates.length > 0)
								handoff = {
									player: view.player,
									roster: rosterKey(view.party),
								};
							else owner.leave(null);
						}}>Leave party</button
					>
					{#if leader}
						<button
							class="ui-button"
							type="button"
							disabled={!view.enabled}
							onclick={() => owner.request({ kind: "disband" })}>Disband</button
						>
					{/if}
				</div>
			{/if}
			<details class="ui-disclosure ui-disclosure-section" open>
				<summary>Invitations</summary>
				<div class="ui-disclosure-body">
					<fieldset
						class="ui-fieldset"
						aria-label="Invitation preferences"
						disabled={!view.enabled || view.preferences === null}
					>
						<label
							><input
								type="checkbox"
								checked={view.preferences?.ignoreRequests === true}
								onchange={(event) =>
									owner.request({
										kind: "ignoreRequests",
										enabled: event.currentTarget.checked,
									})}
							/>Ignore party invitations</label
						>
					</fieldset>
				</div>
			</details>
		</div>
	</UiTabPanel>
	<UiTabPanel
		id="social-allegiance-panel"
		labelledBy="social-allegiance-tab"
		active={selected === "allegiance"}
	>
		<div class="social-tab">
			<ClientAllegiancePanel
				owner={allegiance}
				visible={visible && selected === "allegiance"}
			/>
		</div>
	</UiTabPanel>
	<UiTabPanel
		id="social-friends-panel"
		labelledBy="social-friends-tab"
		active={selected === "friends"}
	>
		<div class="social-tab">
			<ClientFriendsPanel owner={friends} />
		</div>
	</UiTabPanel>
	<UiTabPanel
		id="social-ignores-panel"
		labelledBy="social-ignores-tab"
		active={selected === "ignores"}
	>
		<div class="social-tab">
			<ClientIgnoresPanel owner={squelch} />
		</div>
	</UiTabPanel>
</div>
{#if visible && creationPlayer !== null && view.preferences !== null}
	<ClientPartyCreateDialog
		preferences={view.preferences}
		onCancel={() => (creationPlayer = null)}
		onSubmit={(name, settings) => {
			const current = owner.read();
			if (
				current.enabled &&
				current.player === creationPlayer &&
				current.party === null
			)
				owner.create(name, settings);
			creationPlayer = null;
		}}
	/>
{/if}

{#if visible && handoff !== null}
	<ClientPartyLeaveDialog
		{candidates}
		onCancel={() => (handoff = null)}
		onSubmit={(successor) => {
			const current = owner.read();
			if (
				handoff !== null &&
				current.player === handoff.player &&
				rosterKey(current.party) === handoff.roster
			)
				owner.leave(successor);
			handoff = null;
		}}
	/>
{/if}

<style>
	@layer components {
		.actions {
			display: flex;
			flex-wrap: wrap;
			gap: 6px;
		}
		.social-tab {
			display: grid;
			align-content: start;
			gap: 10px;
		}
		.social-tab p,
		.party-summary {
			margin: 0;
		}
		label {
			display: flex;
			align-items: center;
			gap: 6px;
		}
		.party-roster {
			margin: 0;
		}
		.member-info {
			display: flex;
			flex-direction: column;
			gap: 4px;
			flex: 1;
			min-width: 0;
			overflow-wrap: anywhere;
		}
		.member-name {
			display: flex;
			align-items: center;
			gap: 6px;
		}
		.member-leader {
			width: 16px;
			height: 16px;
			flex-shrink: 0;
			color: var(--ui-color-accent);
		}
	}
</style>
