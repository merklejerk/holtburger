<script lang="ts">
	import type { DynamicEntityView } from "../lib/game/runtime/dynamic-entity-feed";
	import type { HostKinematicBoomStatus } from "../lib/game/camera/host-kinematic-boom-session";
	import {
		explorerEntityOperationTargets,
		explorerEntitySelection,
		type ExplorerEntityOperation,
		type ExplorerEntityOperationFailure,
		type ExplorerEntitySelection,
	} from "./explorer-entity-panel-state";
	import {
		MOTION_STYLE,
		type ExplorerPossessionControls,
		type ExplorerPossession,
		type MotionStyleName,
		type PossessionMotionProbe,
	} from "./explorer-entity-possession";

	/** Debug telemetry is intentionally human-cadence and sampled only while visible. */
	const DIAGNOSTIC_SAMPLE_INTERVAL_MS = 500;
	type DiagnosticEntityState =
		| { readonly kind: "panel-snapshot" }
		| { readonly kind: "sampled"; readonly entity: DynamicEntityView };

	interface Props {
		readonly runtimeReady: boolean;
		readonly selected: DynamicEntityView;
		readonly wearer: DynamicEntityView | null;
		readonly pending: ExplorerEntityOperation | null;
		readonly failure: ExplorerEntityOperationFailure | null;
		readonly possession: ExplorerPossession | null;
		readonly readExplorerEntity: (
			selection: ExplorerEntitySelection,
		) => DynamicEntityView | null;
		readonly readBoomCameraStatus: () => HostKinematicBoomStatus | null;
		readonly readPossessionMotionProbe: () => Promise<PossessionMotionProbe | null>;
		readonly select: (selection: ExplorerEntitySelection) => void;
		readonly despawn: (entity: DynamicEntityView) => Promise<void>;
		readonly possess: (
			entity: DynamicEntityView,
			guid: number | null,
		) => Promise<void>;
		readonly setStance: (
			entity: DynamicEntityView,
			style: number,
		) => Promise<void>;
		readonly setRunRate: (value: number) => Promise<void>;
		readonly possessionControls: ExplorerPossessionControls | null;
	}

	let {
		runtimeReady,
		selected,
		wearer,
		pending,
		failure,
		possession,
		readExplorerEntity,
		readBoomCameraStatus,
		readPossessionMotionProbe,
		select,
		despawn,
		possess,
		setStance,
		setRunRate,
		possessionControls,
	}: Props = $props();
	const selectedIsPossessed = $derived(
		selected.placement.kind === "world" &&
			possession !== null &&
			possession.guid !== null &&
			selected.identity.guid === possession.guid &&
			selected.generation === possession.entityGeneration,
	);
	const possessedCapability = $derived(
		selectedIsPossessed && possession !== null && possession.guid !== null
			? (possession.stances.find(
					(capability) => capability.style === possessionControls?.stance,
				) ?? null)
			: null,
	);
	const applicableFailure = $derived.by(() => {
		if (failure === null || failure.operation.kind === "spawn") return null;
		return explorerEntityOperationTargets(
			failure.operation,
			explorerEntitySelection(selected),
		)
			? failure.message
			: null;
	});
	const selectedOperationPending = $derived(
		pending !== null &&
			explorerEntityOperationTargets(
				pending,
				explorerEntitySelection(selected),
			),
	);
	let diagnosticsOpen = $state(false);
	let diagnosticEntityState = $state<DiagnosticEntityState>({
		kind: "panel-snapshot",
	});
	let sampledBoomCameraStatus = $state<HostKinematicBoomStatus | null>(null);
	let sampledPossessionMotionProbe = $state<PossessionMotionProbe | null>(null);
	let sampledPossessionProbeError = $state<string | null>(null);
	const diagnosticSelected = $derived.by(() =>
		diagnosticEntityState.kind === "sampled"
			? diagnosticEntityState.entity
			: selected,
	);

	$effect(() => {
		if (!diagnosticsOpen) {
			diagnosticEntityState = { kind: "panel-snapshot" };
			sampledBoomCameraStatus = null;
			sampledPossessionMotionProbe = null;
			sampledPossessionProbeError = null;
			return;
		}
		const selection = explorerEntitySelection(selected);
		const sample = (): void => {
			const current = readExplorerEntity(selection);
			if (current !== null)
				diagnosticEntityState = { kind: "sampled", entity: current };
			sampledBoomCameraStatus = selectedIsPossessed
				? readBoomCameraStatus()
				: null;
			if (!selectedIsPossessed) {
				sampledPossessionMotionProbe = null;
				sampledPossessionProbeError = null;
				return;
			}
			void readPossessionMotionProbe()
				.then((probe) => {
					if (!diagnosticsOpen) return;
					if (
						probe === null ||
						probe.guid !== selected.identity.guid ||
						probe.entityGeneration !== selected.generation
					) {
						sampledPossessionMotionProbe = null;
					} else {
						sampledPossessionMotionProbe = probe;
					}
					sampledPossessionProbeError = null;
				})
				.catch((error: unknown) => {
					if (!diagnosticsOpen) return;
					sampledPossessionMotionProbe = null;
					sampledPossessionProbeError =
						error instanceof Error ? error.message : String(error);
				});
		};
		sample();
		const timer = window.setInterval(sample, DIAGNOSTIC_SAMPLE_INTERVAL_MS);
		return () => window.clearInterval(timer);
	});

	function formatGuid(guid: number): string {
		return `0x${guid.toString(16).padStart(8, "0")}`;
	}

	function formatBoomStatus(status: HostKinematicBoomStatus): string {
		if (status.kind === "stopped") return "stopped";
		if (status.kind === "awaiting-registration") return "registering with host";
		if (status.kind === "awaiting-first-path") {
			return `generation ${status.identity.boomGeneration}; awaiting first path`;
		}
		const placementOutcome =
			status.placementOutcome === null
				? ""
				: `; ${status.placementOutcome.kind} ${status.placementOutcome.reason}`;
		const clearance =
			status.clearance === null
				? "clearance awaiting initial proof"
				: `projection ${status.clearance.projectionRevision}; radius ${status.clearance.radius.toFixed(2)}m`;
		return `generation ${status.identity.boomGeneration}; path ${status.sequence}; ${status.targetSphereRole}; reach ${status.renderedReach.toFixed(2)}/${status.desiredReach.toFixed(2)}m; ${clearance}; dropped ${status.droppedPaths}${placementOutcome}`;
	}

	function motionStyleName(style: number): MotionStyleName | null {
		return (
			(Object.keys(MOTION_STYLE) as MotionStyleName[]).find(
				(name) => MOTION_STYLE[name] === style,
			) ?? null
		);
	}

	function formatPossessionRate(rate: number): string {
		return `${rate.toFixed(2)}x`;
	}
</script>

<section class="entity-inspector" aria-labelledby="selected-entity-heading">
	<p class="ac-section-label">Selected</p>
	<div class="selected-heading">
		<h3 id="selected-entity-heading">{selected.identity.name}</h3>
		<span>WCID {selected.identity.wcid}</span>
	</div>
	<p class="selected-identity">
		{formatGuid(selected.identity.guid)} · generation {selected.generation}
	</p>

	{#if selected.placement.kind === "world"}
		<div class="selected-actions">
			{#if selected.presentation.content.motionTableDid !== null}
				<button
					type="button"
					class="explorer-action"
					disabled={!runtimeReady || pending !== null}
					onclick={() =>
						possess(
							selected,
							selectedIsPossessed ? null : selected.identity.guid,
						)}
				>
					{pending?.kind === "possession" && selectedOperationPending
						? "Working…"
						: selectedIsPossessed
							? "Release"
							: "Possess"}
				</button>
			{/if}
			<button
				type="button"
				class="explorer-action"
				disabled={!runtimeReady || pending !== null}
				onclick={() => despawn(selected)}
			>
				{pending?.kind === "despawn" && selectedOperationPending
					? "Despawning…"
					: "Despawn"}
			</button>
		</div>
	{:else}
		<div class="wearer-context">
			<span
				>Held by {wearer?.identity.name ??
					formatGuid(selected.placement.parent)}</span
			>
			{#if wearer !== null}
				<button
					type="button"
					class="explorer-action"
					onclick={() => select(explorerEntitySelection(wearer))}
				>
					Select wearer
				</button>
			{/if}
		</div>
	{/if}

	{#if applicableFailure !== null}
		<p class="inspector-error" role="alert">{applicableFailure}</p>
	{/if}

	<div class="entity-facts">
		<div><span>Placement</span><strong>{selected.placement.kind}</strong></div>
		<div>
			<span>Physical</span><strong>{selected.physics.participation}</strong>
		</div>
	</div>

	{#if selectedIsPossessed && possession !== null && possession.guid !== null && possessionControls !== null}
		<label class="explorer-form-field">
			<span>Stance</span>
			<select
				class="explorer-control explorer-control--select"
				value={possessionControls.stance}
				disabled={pending !== null}
				onchange={(event) =>
					setStance(selected, Number(event.currentTarget.value))}
			>
				{#each possession.stances as capability (capability.style)}
					<option value={capability.style}>
						{motionStyleName(capability.style) ?? `Style ${capability.style}`}
					</option>
				{/each}
			</select>
		</label>
		<label class="explorer-form-field">
			<span>
				Run rate
				<output>{possessionControls.runRateScalar.toFixed(2)}x</output>
			</span>
			<input
				class="explorer-control"
				type="range"
				min={possession.runRateCapability.minimum}
				max={possession.runRateCapability.maximum}
				step="0.25"
				value={possessionControls.runRateScalar}
				disabled={pending !== null}
				aria-label="Run rate"
				aria-valuetext={`${possessionControls.runRateScalar.toFixed(2)}x`}
				oninput={(event) => setRunRate(Number(event.currentTarget.value))}
			/>
		</label>
	{/if}

	<details
		class="inspector-disclosure"
		ontoggle={(event) => (diagnosticsOpen = event.currentTarget.open)}
	>
		<summary>Diagnostics</summary>
		<div class="diagnostics">
			<div><span>Generation</span><code>{selected.generation}</code></div>
			{#if diagnosticSelected.placement.kind === "world"}
				<div>
					<span>Contact</span><code>{diagnosticSelected.placement.contact}</code
					>
				</div>
				<div>
					<span>Sampling</span><code
						>{diagnosticSelected.placement.sampleMode}</code
					>
				</div>
			{:else}
				<div>
					<span>Holding pose</span><code
						>{diagnosticSelected.placement.placement}</code
					>
				</div>
			{/if}
			{#if selectedIsPossessed && possession !== null && possession.guid !== null && possessionControls !== null}
				<div>
					<span>Motion table</span><code>{possession.motionTableId}</code>
				</div>
				<div>
					<span>Requested rate</span><code
						>{formatPossessionRate(possessionControls.runRateScalar)}</code
					>
				</div>
				{#if sampledPossessionMotionProbe !== null}
					<div>
						<span>Applied rate</span><code
							>{formatPossessionRate(
								sampledPossessionMotionProbe.requestedRunRate,
							)}</code
						>
					</div>
					<div>
						<span>Physical tick</span><code
							>{sampledPossessionMotionProbe.physicalStatus ?? "pending"}</code
						>
					</div>
					{#if sampledPossessionMotionProbe.effectivePlanarSpeed !== null}
						<div>
							<span>Achieved speed</span><code
								>{sampledPossessionMotionProbe.effectivePlanarSpeed.toFixed(2)} m/s</code
							>
						</div>
					{/if}
				{:else if sampledPossessionProbeError !== null}
					<div>
						<span>Motion probe</span><code>{sampledPossessionProbeError}</code>
					</div>
				{/if}
				<div>
					<span>Control sources</span>
					<code>
						{#if possessedCapability === null}
							unmodelled stance
						{:else}
							walk {possessedCapability.walk} · run {possessedCapability.run} · side
							{possessedCapability.sidestep} · turn {possessedCapability.turn}
						{/if}
					</code>
				</div>
				{#if sampledBoomCameraStatus !== null}
					<div>
						<span>Boom camera</span><code
							>{formatBoomStatus(sampledBoomCameraStatus)}</code
						>
					</div>
				{/if}
			{/if}
		</div>
	</details>
</section>

<style>
	.entity-inspector {
		display: grid;
		gap: 8px;
		min-width: 0;
		padding-top: 2px;
		border-top: 1px solid rgb(200 148 42 / 36%);
	}

	.entity-inspector .ac-section-label,
	.selected-identity,
	.inspector-error {
		margin: 0;
	}

	.selected-heading {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 8px;
		align-items: baseline;
	}

	.selected-heading h3 {
		min-width: 0;
		margin: 0;
		overflow: hidden;
		color: var(--ac-ink);
		font-size: 0.95rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.selected-heading span,
	.selected-identity,
	.wearer-context,
	.inspector-error {
		color: var(--ac-ink-muted);
		font-size: 0.75rem;
	}

	.selected-actions,
	.wearer-context {
		display: flex;
		gap: 8px;
		align-items: center;
		justify-content: space-between;
	}

	.selected-actions .explorer-action {
		flex: 1 1 0;
	}

	.inspector-error {
		color: #ff9c8f;
	}

	.entity-facts {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 5px;
	}

	.entity-facts div,
	.diagnostics div {
		display: grid;
		min-width: 0;
	}

	.entity-facts div {
		gap: 2px;
		padding: 6px;
		border: 1px solid rgb(162 117 33 / 35%);
		background: rgb(37 28 12 / 50%);
	}

	.entity-facts span,
	.diagnostics span {
		color: var(--ac-ink-muted);
		font-size: 0.69rem;
	}

	.entity-facts strong {
		overflow: hidden;
		color: var(--ac-ink);
		font-size: 0.75rem;
		font-weight: 400;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.inspector-disclosure {
		border-top: 1px solid rgb(162 117 33 / 28%);
		padding-top: 6px;
	}

	.inspector-disclosure summary {
		color: var(--ac-ink);
		cursor: pointer;
		font-size: 0.76rem;
	}

	.inspector-disclosure > :not(summary) {
		margin-top: 7px;
	}

	.diagnostics {
		display: grid;
		gap: 6px;
	}

	.diagnostics div {
		grid-template-columns: minmax(6rem, 0.35fr) minmax(0, 1fr);
		gap: 8px;
	}

	.diagnostics code {
		overflow-wrap: anywhere;
		color: var(--ac-ink);
		font-family: inherit;
		font-size: 0.72rem;
	}

	@media (max-width: 370px) {
		.entity-facts {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
