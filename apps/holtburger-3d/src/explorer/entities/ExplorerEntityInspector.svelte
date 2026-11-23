<script lang="ts">
	import type {
		DynamicEntityPhysicsFlags,
		DynamicEntityView,
	} from "../../lib/game/runtime/dynamic-entity-feed";
	import type { HostKinematicBoomStatus } from "../../lib/game/camera/host-kinematic-boom-session";
	import type { ExplorerSelectionStatus } from "./entity-commands";
	import {
		explorerEntityOperationTargets,
		explorerEntitySelection,
		type ExplorerEntityOperation,
		type ExplorerEntitySelection,
	} from "./entity-panel-state";
	import {
		MOTION_STYLE,
		type ExplorerPossessionControls,
		type ExplorerPossession,
		type MotionStyleName,
		type PossessionMotionProbe,
	} from "./entity-possession";

	/** Debug telemetry is intentionally human-cadence and sampled only while visible. */
	const DIAGNOSTIC_SAMPLE_INTERVAL_MS = 500;
	type DiagnosticEntityState =
		| { readonly kind: "panel-snapshot" }
		| { readonly kind: "sampled"; readonly entity: DynamicEntityView };

	interface Props {
		readonly visible: boolean;
		readonly runtimeReady: boolean;
		readonly selected: DynamicEntityView;
		readonly wearer: DynamicEntityView | null;
		readonly pending: ExplorerEntityOperation | null;
		readonly selectionStatus: ExplorerSelectionStatus;
		readonly possession: ExplorerPossession | null;
		readonly readExplorerEntity: (
			selection: ExplorerEntitySelection,
		) => DynamicEntityView | null;
		readonly readBoomCameraStatus: () => HostKinematicBoomStatus | null;
		readonly readPossessionMotionProbe: () => Promise<PossessionMotionProbe | null>;
		readonly select: (selection: ExplorerEntitySelection) => void;
		readonly despawn: (entity: DynamicEntityView) => Promise<void>;
		readonly relocate: (entity: DynamicEntityView) => Promise<void>;
		readonly launch: (entity: DynamicEntityView) => Promise<void>;
		readonly replacePhysicsState: (
			entity: DynamicEntityView,
			flags: DynamicEntityPhysicsFlags,
			physicalMode: "pose-only" | "integrated",
		) => Promise<void>;
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
		visible,
		runtimeReady,
		selected,
		wearer,
		pending,
		selectionStatus,
		possession,
		readExplorerEntity,
		readBoomCameraStatus,
		readPossessionMotionProbe,
		select,
		despawn,
		relocate,
		launch,
		replacePhysicsState,
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
	const selectedOperationPending = $derived(
		pending !== null &&
			explorerEntityOperationTargets(
				pending,
				explorerEntitySelection(selected),
			),
	);
	let diagnosticsOpen = $state(false);
	const currentPhysicalMode = $derived<"pose-only" | "integrated">(
		selected.physics.participation === "pose-only" ? "pose-only" : "integrated",
	);

	const PHYSICS_FLAG_FIELDS: readonly {
		readonly key: keyof DynamicEntityPhysicsFlags;
		readonly label: string;
	}[] = [
		{ key: "gravity", label: "Gravity" },
		{ key: "ethereal", label: "Ethereal" },
		{ key: "reportCollisions", label: "Report collisions" },
		{ key: "ignoreCollisions", label: "Ignore collisions" },
		{ key: "missile", label: "Missile" },
		{ key: "inelastic", label: "Inelastic" },
		{ key: "edgeSlide", label: "Edge slide" },
		{ key: "frozen", label: "Frozen" },
	];
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
		if (!visible || !diagnosticsOpen) {
			diagnosticEntityState = { kind: "panel-snapshot" };
			sampledBoomCameraStatus = null;
			sampledPossessionMotionProbe = null;
			sampledPossessionProbeError = null;
			return;
		}
		let cancelled = false;
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
					if (cancelled) return;
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
					if (cancelled) return;
					sampledPossessionMotionProbe = null;
					sampledPossessionProbeError =
						error instanceof Error ? error.message : String(error);
				});
		};
		sample();
		const timer = window.setInterval(sample, DIAGNOSTIC_SAMPLE_INTERVAL_MS);
		return () => {
			cancelled = true;
			window.clearInterval(timer);
		};
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
	<div class="selected-heading">
		<h3 id="selected-entity-heading">{selected.display.name}</h3>
		<span>WCID {selected.identity.wcid}</span>
	</div>
	<p class="selected-identity">
		{formatGuid(selected.identity.guid)} · gen {selected.generation} · {selected
			.physics.participation} · {selected.placement.kind}
	</p>
	{#if selected.placement.kind === "world" && !selectedIsPossessed && selectionStatus.suspended}
		<p class="selection-status-note">
			{#if selectionStatus.launchQueued}
				Physics paused while selected · Launch queued (deselect to fire)
			{:else}
				Physics paused while selected · Drag gizmo to move or rotate (hold Shift
				to snap)
			{/if}
		</p>
	{/if}

	{#if selected.placement.kind === "world"}
		<div class="selected-actions">
			{#if selected.presentation.content.motionTableDid !== null}
				<button
					type="button"
					class="explorer-action ui-button"
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
				class="explorer-action ui-button"
				disabled={!runtimeReady || pending !== null}
				onclick={() => relocate(selected)}
			>
				{pending?.kind === "relocate" && selectedOperationPending
					? "Moving…"
					: "Move here"}
			</button>
			<button
				type="button"
				class="explorer-action ui-button"
				disabled={!runtimeReady || pending !== null}
				onclick={() => launch(selected)}
			>
				{pending?.kind === "launch" && selectedOperationPending
					? "Launching…"
					: !selectedIsPossessed && selectionStatus.launchQueued
						? "Launch queued"
						: "Launch"}
			</button>
			<button
				type="button"
				class="explorer-action ui-button"
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
				>Held by {wearer?.display.name ??
					formatGuid(selected.placement.parent)}</span
			>
			{#if wearer !== null}
				<button
					type="button"
					class="explorer-action ui-button"
					onclick={() => select(explorerEntitySelection(wearer))}
				>
					Select wearer
				</button>
			{/if}
		</div>
	{/if}

	{#if selectedIsPossessed && possession !== null && possession.guid !== null && possessionControls !== null}
		<label class="ui-label">
			<span>Stance</span>
			<select
				class="ui-input"
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
		<label class="ui-label">
			<span>
				Run rate
				<output>{possessionControls.runRateScalar.toFixed(2)}x</output>
			</span>
			<input
				class="ui-input"
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

	{#if selected.placement.kind === "world"}
		<details class="ui-disclosure ui-disclosure-section">
			<summary>Physics state</summary>
			<div class="diagnostics ui-disclosure-body">
				<label class="ui-label">
					<span>Realization mode</span>
					<select
						class="ui-input"
						value={currentPhysicalMode}
						disabled={!runtimeReady || pending !== null}
						onchange={(event) => {
							const nextMode =
								event.currentTarget.value === "pose-only"
									? "pose-only"
									: "integrated";
							void replacePhysicsState(
								selected,
								selected.physics.flags,
								nextMode,
							);
						}}
					>
						<option value="integrated">Integrated</option>
						<option value="pose-only">Pose-only</option>
					</select>
				</label>
				{#each PHYSICS_FLAG_FIELDS as flag (flag.key)}
					<label class="ui-checkbox">
						<input
							type="checkbox"
							checked={selected.physics.flags[flag.key]}
							disabled={!runtimeReady || pending !== null}
							onchange={(event) => {
								void replacePhysicsState(
									selected,
									{
										...selected.physics.flags,
										[flag.key]: event.currentTarget.checked,
									},
									currentPhysicalMode,
								);
							}}
						/>
						{flag.label}
					</label>
				{/each}
			</div>
		</details>
	{/if}

	<details
		class="ui-disclosure ui-disclosure-section"
		ontoggle={(event) => (diagnosticsOpen = event.currentTarget.open)}
	>
		<summary>Diagnostics</summary>
		<div class="diagnostics ui-disclosure-body">
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
	@layer components {
		.entity-inspector {
			display: grid;
			gap: 8px;
			min-width: 0;
		}

		.selected-identity {
			margin: 0;
		}

		.selection-status-note {
			margin: 0;
			color: var(--ui-color-accent, var(--ui-color-muted));
			font-size: calc(var(--ui-font-size-caption) * var(--ui-text-scale));
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
			color: var(--ui-color-text);
			font-size: calc(var(--ui-font-size-heading-2) * var(--ui-text-scale));
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.selected-heading span,
		.selected-identity,
		.wearer-context {
			color: var(--ui-color-muted);
			font-size: calc(var(--ui-font-size-caption) * var(--ui-text-scale));
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
			white-space: nowrap;
		}

		.diagnostics {
			display: grid;
			gap: 6px;
		}

		.diagnostics div {
			display: grid;
			min-width: 0;
			grid-template-columns: minmax(6rem, 0.35fr) minmax(0, 1fr);
			gap: 8px;
		}

		.diagnostics span {
			color: var(--ui-color-muted);
			font-size: calc(var(--ui-font-size-micro) * var(--ui-text-scale));
		}

		.diagnostics code {
			overflow-wrap: anywhere;
			color: var(--ui-color-text);
			font-family: inherit;
			font-size: calc(var(--ui-font-size-caption) * var(--ui-text-scale));
		}
	}
</style>
