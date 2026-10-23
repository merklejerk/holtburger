<script lang="ts">
	import { onMount, onDestroy, untrack } from "svelte";
	import UiDialog from "../app/UiDialog.svelte";
	import { formatQuantity } from "../app/quantity-format";
	import ClientHudIcon from "./ClientHudIcon.svelte";
	import type { ClientAllegianceState } from "./client-allegiance-state";
	import type { AllegianceMember } from "./client-allegiance-contract";
	interface Props {
		/** Session-owned facts and interaction policy. */
		readonly owner: ClientAllegianceState;
		/** Only active presentation maintains fresh details and hosts reviews. */
		readonly visible: boolean;
	}
	const { owner, visible }: Props = $props();
	let view = $state(untrack(() => owner.read()));
	const profile = $derived(view.snapshot?.profile);
	const busy = $derived(!view.enabled || view.submitting);
	const vassals = $derived(
		profile?.directVassals.toSorted(
			(a, b) =>
				a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
				a.guid - b.guid,
		) ?? [],
	);
	/** App-local tree layout uses supplied roles; dotted ancestry never asserts a direct link. */
	const relationships = $derived.by(() => {
		const rows: {
			member: AllegianceMember;
			label: string;
			depth: number;
			ancestryGap: boolean;
			followingSibling: boolean;
			role: "patron" | "vassal" | null;
		}[] = [];
		if (profile == null) return rows;
		const { monarch, patron, selfMember } = profile;
		if (monarch !== null && monarch.guid !== selfMember?.guid)
			rows.push({
				member: monarch,
				label: monarch.guid === patron?.guid ? "Patron / Monarch" : "Monarch",
				depth: 0,
				ancestryGap: false,
				followingSibling: false,
				role: monarch.guid === patron?.guid ? "patron" : null,
			});
		const patronDepth =
			monarch !== null && monarch.guid !== patron?.guid ? 1 : 0;
		if (patron !== null && patron.guid !== monarch?.guid)
			rows.push({
				member: patron,
				label: "Patron",
				depth: patronDepth,
				ancestryGap: monarch !== null,
				followingSibling: false,
				role: "patron",
			});
		const selfDepth = patron === null ? 0 : patronDepth + 1;
		if (selfMember !== null)
			rows.push({
				member: selfMember,
				label: selfMember.guid === monarch?.guid ? "You / Monarch" : "You",
				depth: selfDepth,
				ancestryGap: false,
				followingSibling: false,
				role: null,
			});
		vassals.forEach((member, index) =>
			rows.push({
				member,
				label: "Vassal",
				depth: selfMember === null ? 0 : selfDepth + 1,
				ancestryGap: false,
				followingSibling: index < vassals.length - 1,
				role: "vassal",
			}),
		);
		return rows;
	});

	onMount(() => {
		view = owner.read();
		return owner.subscribe(() => {
			view = owner.read();
		});
	});
	$effect(() => owner.setVisible(visible));
	onDestroy(() => owner.setVisible(false));
</script>

{#snippet memberInfo(
	member: AllegianceMember,
	label: string,
	showContribution: boolean,
)}
	{@const displayName =
		member.title === null ? member.name : `${member.title} ${member.name}`}
	<div class="ui-list-content member-info">
		<div class="member-heading">
			<span
				class="ui-presence"
				class:online={member.online}
				role="img"
				aria-label={member.online ? "Online" : "Offline"}
				title={member.online ? "Online" : "Offline"}
				><ClientHudIcon name={member.online ? "online" : "offline"} /></span
			>
			<strong class="ui-list-name" title={displayName}>{displayName}</strong>
		</div>
		<span class="ui-muted"
			>{label} · Rank {member.rank}{member.level === null
				? ""
				: ` · Level ${member.level}`}</span
		>
		{#if showContribution}<span class="ui-muted"
				>Contributed XP: {formatQuantity(member.contributedXp)}</span
			>{/if}
	</div>
{/snippet}

<div class="allegiance">
	{#if profile == null}
		<p class="ui-muted">Loading allegiance details…</p>
	{:else if profile.monarch === null}
		<p class="ui-muted">No allegiance.</p>
	{:else}
		<dl class="ui-facts" aria-label="Allegiance summary">
			<dt>Allegiance name</dt>
			<dd>{profile.name}</dd>
			<dt>Your rank</dt>
			<dd>{profile.rank}</dd>
			<dt>Total members</dt>
			<dd>{formatQuantity(profile.totalMembers)}</dd>
			<dt>Your descendants</dt>
			<dd>{formatQuantity(profile.totalDescendants)}</dd>
		</dl>
		<details class="ui-disclosure ui-disclosure-section" open>
			<summary>Relationships</summary>
			<div class="ui-disclosure-body ui-inset">
				<ul class="ui-scroll-list" aria-label="Allegiance relationships">
					{#each relationships as row, index (row.member.guid)}
						{@const next = relationships[index + 1]}
						<li
							class="ui-list-row ui-list-row-nowrap relationship-row"
							class:relationship-child={row.depth > 0}
							class:ancestry-gap={row.ancestryGap}
							class:following-sibling={row.followingSibling}
							class:self={row.member.guid === profile.selfMember?.guid}
							style:--relationship-depth={row.depth}
							data-relationship={row.role ?? "context"}
						>
							{#if next !== undefined && next.depth > row.depth}<span
									class="relationship-stem"
									aria-hidden="true"
								></span>{/if}
							{#if row.ancestryGap}<span
									class="ancestry-marker"
									role="img"
									aria-label="Intermediate ancestry not supplied"
									title="Intermediate ancestry not supplied">⋮</span
								>{/if}
							{@render memberInfo(row.member, row.label, row.role === "vassal")}
							{#if row.role !== null}
								<div class="ui-icon-actions ui-list-actions">
									<button
										class="ui-button ui-icon-button"
										type="button"
										disabled={busy}
										aria-label={row.role === "patron"
											? `Break allegiance with ${row.member.name}`
											: `Dismiss ${row.member.name} as vassal`}
										title={row.role === "patron"
											? `Break allegiance with ${row.member.name}`
											: `Dismiss ${row.member.name} as vassal`}
										onclick={() => {
											if (row.role !== null)
												owner.review(row.role, row.member.guid);
										}}><ClientHudIcon name="remove" /></button
									>
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			</div>
		</details>
		{#if profile.selfMember !== null}
			<details class="ui-disclosure ui-disclosure-section" open>
				<summary>Your XP</summary>
				<div class="ui-disclosure-body">
					<dl class="ui-facts">
						<dt>Contributed XP</dt>
						<dd>{formatQuantity(profile.selfMember.contributedXp)}</dd>
					</dl>
				</div>
			</details>
		{/if}
	{/if}
	<details class="ui-disclosure ui-disclosure-section" open>
		<summary>Presence</summary>
		<div class="ui-disclosure-body">
			<label class="ui-checkbox"
				><input
					type="checkbox"
					checked={view.preferences?.showLogons === true}
					disabled={busy || view.preferences === null}
					onchange={(event) =>
						owner.request({
							kind: "showLogons",
							enabled: event.currentTarget.checked,
						})}
				/>Show allegiance logons</label
			>
		</div>
	</details>
	{#if view.feedback}<p role="status">{view.feedback}</p>{/if}
</div>

{#if visible && view.review !== null}
	<UiDialog
		className="client-allegiance-break-dialog"
		title={view.review.role === "patron"
			? "Break allegiance"
			: "Dismiss vassal"}
		onCancel={() => owner.cancelReview()}
	>
		<p>
			{view.review.role === "patron" ? "Break allegiance with" : "Dismiss"}
			<strong>{view.review.name}</strong>{view.review.role === "vassal"
				? " as your vassal"
				: ""}?
		</p>
		<div class="ui-dialog-actions">
			<button
				class="ui-button"
				type="button"
				onclick={() => owner.cancelReview()}>Cancel</button
			><button
				class="ui-button"
				type="button"
				disabled={busy}
				onclick={() => owner.confirmReview()}
				>{view.review.role === "patron"
					? "Break allegiance"
					: "Dismiss vassal"}</button
			>
		</div>
	</UiDialog>
{/if}

<style>
	@layer components {
		.allegiance {
			display: grid;
			gap: 0.5rem;
		}
		.relationship-row {
			/* Branches meet the first-line presence icon, independent of row height. */
			--relationship-inset: var(--ui-list-row-padding-block);
			--relationship-junction: calc(
				var(--relationship-inset) +
					max(0.5lh, calc(var(--ui-presence-size) * var(--ui-icon-scale)) / 2)
			);
			position: relative;
			/* Taller themed actions must not move the first-line tree junction. */
			align-items: flex-start;
			padding-inline-start: calc(
				var(--relationship-depth) *
					calc(var(--ui-list-tree-indent) * var(--ui-icon-scale))
			);
		}
		.relationship-row .ui-list-actions {
			align-self: center;
		}
		.relationship-child::before,
		.relationship-child::after {
			content: "";
			position: absolute;
			left: calc(
				(var(--relationship-depth) - 1) *
					calc(var(--ui-list-tree-indent) * var(--ui-icon-scale)) +
					calc(var(--ui-presence-size) * var(--ui-icon-scale)) / 2
			);
			border-color: var(--ui-color-border);
		}
		.relationship-child::before {
			top: 0;
			height: var(--relationship-junction);
			border-left: 1px solid var(--ui-color-border);
		}
		.relationship-child::after {
			top: var(--relationship-junction);
			width: calc(
				calc(var(--ui-list-tree-indent) * var(--ui-icon-scale)) -
					calc(var(--ui-presence-size) * var(--ui-icon-scale)) / 2
			);
			border-top: 1px solid var(--ui-color-border);
		}
		.relationship-stem {
			position: absolute;
			left: calc(
				var(--relationship-depth) *
					calc(var(--ui-list-tree-indent) * var(--ui-icon-scale)) +
					calc(var(--ui-presence-size) * var(--ui-icon-scale)) / 2
			);
			top: calc(
				var(--relationship-junction) +
					calc(var(--ui-presence-size) * var(--ui-icon-scale)) / 2
			);
			bottom: -1px;
			border-left: 1px solid var(--ui-color-border);
		}
		.following-sibling::before {
			height: 100%;
		}
		.ancestry-gap {
			--relationship-inset: calc(var(--ui-list-row-padding-block) * 3);
			padding-top: var(--relationship-inset);
		}
		.ancestry-gap::before {
			border-left-style: dotted;
		}
		.ancestry-marker {
			position: absolute;
			top: 0;
			left: calc(
				var(--relationship-depth) *
					calc(var(--ui-list-tree-indent) * var(--ui-icon-scale))
			);
			color: var(--ui-color-muted);
		}
		.self .ui-list-name {
			color: var(--ui-color-highlight);
		}
		.member-info {
			display: grid;
			/* Reserve the presence-icon column on every line, keeping stems clear. */
			grid-template-columns:
				calc(var(--ui-presence-size) * var(--ui-icon-scale))
				minmax(0, 1fr);
			gap: var(--ui-list-detail-gap) var(--ui-list-icon-gap);
		}
		.member-heading {
			grid-column: 1 / -1;
			display: flex;
			align-items: center;
			gap: var(--ui-list-icon-gap);
		}
		.member-info > .ui-muted {
			grid-column: 2;
		}
		p,
		dl,
		ul {
			margin: 0;
		}
	}
</style>
