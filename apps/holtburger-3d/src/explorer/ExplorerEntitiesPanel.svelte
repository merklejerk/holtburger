<script lang="ts">
	import type { DynamicEntityView } from "../lib/game/runtime/dynamic-entity-feed";
	import ExplorerEntityInspector from "./ExplorerEntityInspector.svelte";
	import ExplorerEntityList from "./ExplorerEntityList.svelte";
	import ExplorerEntitySpawnComposer from "./ExplorerEntitySpawnComposer.svelte";
	import type { HostKinematicBoomStatus } from "../lib/game/camera/host-kinematic-boom-session";
	import type {
		ExplorerCatalogCapability,
		ExplorerWeenieSearchRequest,
		ExplorerWeenieSearchResult,
	} from "./explorer-entity-commands";
	import {
		findExplorerEntityWearer,
		findSelectedExplorerEntity,
		type ExplorerEntityOperation,
		type ExplorerEntityOperationFailure,
		type ExplorerEntitySelection,
	} from "./explorer-entity-panel-state";
	import type {
		ExplorerPossession,
		ExplorerPossessionControls,
		PossessionMotionProbe,
	} from "./explorer-entity-possession";

	interface Props {
		readonly runtimeReady: boolean;
		readonly catalog: ExplorerCatalogCapability | null;
		readonly entities: readonly DynamicEntityView[];
		readonly presentationError: string | null;
		readonly search: (
			request: ExplorerWeenieSearchRequest,
		) => Promise<readonly ExplorerWeenieSearchResult[]>;
		readonly spawn: (wcid: number, distance: number) => Promise<void>;
		readonly despawn: (entity: DynamicEntityView) => Promise<void>;
		/** Possess one entity, or release with `null`. */
		readonly possess: (guid: number | null) => Promise<ExplorerPossession>;
		/** Change the stance the possessed entity holds. */
		readonly setStance: (style: number) => Promise<void>;
		readonly setRunRate: (value: number) => Promise<void>;
		readonly possession: ExplorerPossession | null;
		readonly possessionControls: ExplorerPossessionControls | null;
		readonly readPossessionMotionProbe: () => Promise<PossessionMotionProbe | null>;
		/** Pull one exact current entity only for disclosure-scoped volatile diagnostics. */
		readonly readExplorerEntity: (
			selection: ExplorerEntitySelection,
		) => DynamicEntityView | null;
		/** Pull current boom diagnostics on the inspector's explicit sampling schedule. */
		readonly readBoomCameraStatus: () => HostKinematicBoomStatus | null;
	}

	let {
		runtimeReady,
		catalog,
		entities,
		presentationError,
		search,
		spawn,
		despawn,
		possess,
		setStance,
		setRunRate,
		possession,
		possessionControls,
		readPossessionMotionProbe,
		readExplorerEntity,
		readBoomCameraStatus,
	}: Props = $props();
	let selection = $state<ExplorerEntitySelection | null>(null);
	let pending = $state<ExplorerEntityOperation | null>(null);
	let failure = $state<ExplorerEntityOperationFailure | null>(null);
	let runRateRequestSerial = 0;
	const selected = $derived(findSelectedExplorerEntity(entities, selection));
	const selectedWearer = $derived(findExplorerEntityWearer(entities, selected));
	const catalogReady = $derived(catalog?.status === "available");
	const possessedSelection = $derived.by((): ExplorerEntitySelection | null => {
		if (possession === null || possession.guid === null) return null;
		return {
			guid: possession.guid,
			generation: possession.entityGeneration,
		};
	});
	const spawnFailure = $derived(
		failure?.operation.kind === "spawn" ? failure.message : null,
	);

	$effect(() => {
		if (selection !== null && selected === null) selection = null;
	});

	async function perform(
		operation: ExplorerEntityOperation,
		action: () => Promise<unknown>,
	): Promise<void> {
		if (pending !== null) return;
		pending = operation;
		failure = null;
		try {
			await action();
		} catch (error) {
			failure = { operation, message: errorMessage(error) };
		} finally {
			pending = null;
		}
	}

	function runSpawn(wcid: number, distance: number): Promise<void> {
		return perform({ kind: "spawn" }, () => spawn(wcid, distance));
	}

	function runDespawn(entity: DynamicEntityView): Promise<void> {
		return perform(
			{
				kind: "despawn",
				target: {
					guid: entity.identity.guid,
					generation: entity.generation,
				},
			},
			() => despawn(entity),
		);
	}

	function runPossession(
		entity: DynamicEntityView,
		guid: number | null,
	): Promise<void> {
		return perform(
			{
				kind: "possession",
				target: {
					guid: entity.identity.guid,
					generation: entity.generation,
				},
			},
			() => possess(guid),
		);
	}

	function runStance(entity: DynamicEntityView, style: number): Promise<void> {
		return perform(
			{
				kind: "stance",
				target: {
					guid: entity.identity.guid,
					generation: entity.generation,
				},
			},
			() => setStance(style),
		);
	}

	/** Run-rate edits are coalescible, so do not serialize every native range event. */
	async function runRunRate(
		entity: DynamicEntityView,
		value: number,
	): Promise<void> {
		const serial = ++runRateRequestSerial;
		failure = null;
		try {
			await setRunRate(value);
		} catch (error) {
			if (serial === runRateRequestSerial) {
				failure = {
					operation: {
						kind: "run-rate",
						target: {
							guid: entity.identity.guid,
							generation: entity.generation,
						},
					},
					message: errorMessage(error),
				};
			}
		}
	}

	function errorMessage(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}
</script>

<div class="entities-panel">
	<header class="entities-header">
		<p title={catalog?.status === "available" ? catalog.path : catalog?.reason}>
			<strong>spawned {entities.length}</strong>
			<span aria-hidden="true"> · </span>
			{#if catalog === null}
				<span>reading catalog…</span>
			{:else if catalog.status === "available"}
				<span>catalog ready ({catalog.recordCount.toLocaleString()})</span>
			{:else}
				<span class="invalid">weenie spawning unavailable</span>
			{/if}
		</p>
	</header>

	{#if catalog?.status === "unavailable"}
		<p class="panel-note invalid">{catalog.reason}</p>
	{/if}

	<ExplorerEntitySpawnComposer
		enabled={runtimeReady && catalogReady}
		busy={pending !== null}
		spawning={pending?.kind === "spawn"}
		operationError={spawnFailure}
		{search}
		spawn={runSpawn}
	/>

	{#if presentationError !== null}
		<p class="panel-note invalid" role="alert">{presentationError}</p>
	{/if}

	<div class="population-heading">
		<p class="ac-section-label">Current entities</p>
		<span>{entities.length}</span>
	</div>
	<ExplorerEntityList
		{entities}
		selected={selection}
		possessed={possessedSelection}
		select={(next) => (selection = next)}
	/>

	{#if selected !== null}
		<ExplorerEntityInspector
			{runtimeReady}
			{selected}
			wearer={selectedWearer}
			{pending}
			{failure}
			{possession}
			{readExplorerEntity}
			{readBoomCameraStatus}
			select={(next) => (selection = next)}
			despawn={runDespawn}
			possess={runPossession}
			setStance={runStance}
			setRunRate={(value) => runRunRate(selected, value)}
			{possessionControls}
			{readPossessionMotionProbe}
		/>
	{/if}
</div>

<style>
	.entities-panel {
		display: grid;
		gap: 11px;
		min-width: 0;
	}

	.population-heading {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 8px;
		align-items: center;
	}

	.entities-header {
		min-width: 0;
	}

	.entities-header p,
	.population-heading .ac-section-label,
	.panel-note {
		margin: 0;
	}

	.entities-header p,
	.panel-note,
	.population-heading span {
		min-width: 0;
		color: var(--ac-ink-muted);
		font-size: 0.76rem;
	}

	.entities-header p {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.entities-header strong {
		color: var(--ac-ink);
		font-weight: 500;
	}

	.invalid {
		color: #ff9c8f;
	}
</style>
