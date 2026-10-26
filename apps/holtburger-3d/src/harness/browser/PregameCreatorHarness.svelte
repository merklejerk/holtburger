<script module lang="ts">
	/** Machine acceptance of the production creator with static content and synthetic server results. */
	export interface CreatorWorkflowProof {
		readonly submissions: number;
		readonly appearanceRequests: number;
		readonly obsoleteResolutionIgnored: boolean;
		readonly nameAndBuildEditsDidNotResolve: boolean;
		readonly rejectedDraftRetained: boolean;
		readonly confirmedGuidSelected: number;
		readonly automaticEntries: number;
		readonly remainingLocalSurfaces: number;
		readonly cachedPickerEquipment: number;
		readonly stalePickerReadIgnored: boolean;
		readonly explicitEntryRequests: number;
		readonly disconnectRetiredPendingCreator: boolean;
	}
</script>

<script lang="ts">
	import { onMount, tick, untrack } from "svelte";
	import ClientCharacterSelect from "../../client/ClientCharacterSelect.svelte";
	import {
		ClientPregameCharacterService,
		type PregameCharacterPresentation,
		type PregameCharacterSource,
		type PregameCharacterStatus,
	} from "../../client/client-pregame-character";
	import {
		loadCharacterCreationCatalog,
		resolveCharacterCreationAppearance,
		type CharacterCreationDraft,
	} from "../../client/client-character-creation-contract";
	import type { CharacterCreationServices } from "../../client/client-character-creation";
	import type { CharacterManagementState } from "../../client/client-host-contract";
	import type { ClientAppPhase } from "../../client/client-app-lifecycle";

	import {
		playerVisualCaptureSchema,
		type ObjectPreviewSource as CapturedSource,
	} from "../../client/client-object-preview-contract";
	import type { ClientVisualCacheTransport } from "../../client/client-visual-cache-transport";
	import type { CharacterVisualRead } from "../../client/client-visual-cache-contract";
	import type { HostTransport } from "../../lib/host/host-transport";

	interface Props {
		readonly transport: HostTransport;
		readonly contentUrl: string;
		readonly savedVisual: CapturedSource;
		readonly onComplete: (proof: CreatorWorkflowProof) => void;
		readonly onFailure: (error: unknown) => void;
	}
	const { transport, contentUrl, savedVisual, onComplete, onFailure }: Props =
		$props();
	let root: HTMLDivElement;
	let selection = $state.raw<
		Extract<ClientAppPhase, { kind: "character-selection" }>
	>({
		kind: "character-selection",
		maxSlots: 10,
		characters: [],
		selectedGuid: null,
	});
	let management = $state.raw<CharacterManagementState>({ kind: "idle" });
	let connected = $state(true);
	let entryPending = $state(false);
	const cachedGuid = 0x50000043;
	const slowGuid = 0x50000044;
	const unavailableGuid = 0x50000045;
	const cacheReads: number[] = [];
	let finishSlow: (value: CharacterVisualRead) => void = () => {
		throw new Error("Slow read not started");
	};
	// One immutable probe fixture belongs to this mounted workflow.
	const cachedCapture = untrack(() =>
		playerVisualCaptureSchema.parse({
			guid: cachedGuid,
			source: savedVisual,
		}),
	);
	const visualCache: ClientVisualCacheTransport = {
		read: async (guid) => {
			cacheReads.push(guid);
			if (guid === slowGuid)
				return new Promise((resolve) => {
					finishSlow = resolve;
				});
			if (guid === unavailableGuid)
				return {
					kind: "unavailable",
					message: "Synthetic unreadable appearance.",
				};
			return guid === cachedGuid
				? { kind: "ready", capture: cachedCapture }
				: { kind: "missing" };
		},
		stage: async () => {
			throw new Error("Picker must not write captures");
		},
		listenFailures: () => () => undefined,
	};
	let appearanceRequests = 0;
	const appearanceCount = (): number => appearanceRequests;
	let holdNextResolution = false;
	let rejectHeldResolution: (() => void) | null = null;
	let submissions = 0;
	let automaticEntries = 0;
	let lastDraft: CharacterCreationDraft | null = null;
	let releaseInitial: () => void = () => {
		throw new Error("Initial resolution has not started.");
	};
	let confirmCreation: () => void = () => {
		throw new Error("No creation is awaiting confirmation.");
	};
	// This workflow proves UI/cache authority; world/GPU behavior is verified by the scene probes.
	let currentSource: PregameCharacterSource | null = null;
	let localSurfaces = 0;
	let surfaceOpenCount = 0;
	const surfaceCount = () => localSurfaces;
	let publishStatus: ((status: PregameCharacterStatus) => void) | null = null;
	const characters = new ClientPregameCharacterService();
	characters.connect({
		setSource: (source) => {
			currentSource = source;
			publishStatus?.(
				source === null
					? { kind: "empty" }
					: { kind: "ready", replacement: { kind: "settled" } },
			);
		},
		setView: () => {},
		subscribe: (listener) => {
			publishStatus = listener;
			listener({ kind: "empty" });
			return () => {
				publishStatus = null;
			};
		},
	});
	const scene: PregameCharacterPresentation = {
		canvas: document.createElement("canvas"),
		characters: {
			open: (publish, revoke) => {
				localSurfaces++;
				surfaceOpenCount++;
				return characters.open(publish, () => {
					localSurfaces--;
					revoke();
				});
			},
		},
	};
	const hasSource = (): boolean => currentSource !== null;
	const services: CharacterCreationServices = {
		loadCatalog: async () => loadCharacterCreationCatalog(transport),
		resolveAppearance: async (request) => {
			appearanceRequests++;
			if (holdNextResolution) {
				holdNextResolution = false;
				await new Promise<never>((_resolve, reject) => {
					rejectHeldResolution = () =>
						reject(new Error("Synthetic retired creator resolution"));
				});
			}
			if (appearanceRequests === 1)
				await new Promise<never>((_resolve, reject) => {
					releaseInitial = () =>
						reject(new Error("Synthetic obsolete resolution."));
				});
			return resolveCharacterCreationAppearance(transport, request);
		},
		submit: async (draft) => {
			submissions++;
			lastDraft = structuredClone(draft);
			// Exercise the production host builder without a network client or real creation.
			const response = await fetch(
				new URL("/character-creation-build", contentUrl),
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(draft),
				},
			);
			if (!response.ok) throw new Error(await response.text());
			management = { kind: "creating", name: draft.name };
			confirmCreation = () => {
				const guid = 0x50000042;
				selection = {
					...selection,
					characters: [{ guid, name: draft.name, slot: 0, deleteTime: 0 }],
				};
				management = { kind: "created", guid, name: draft.name };
			};
		},
	};

	function submittedName(): string | null {
		return lastDraft === null ? null : lastDraft.name;
	}

	function button(text: string): HTMLButtonElement {
		const control = [...root.querySelectorAll("button")].find(
			(entry) => entry.textContent?.trim() === text,
		);
		if (control === undefined)
			throw new Error(`Creator probe cannot find button ${text}.`);
		return control;
	}
	function control(text: string): HTMLInputElement | HTMLSelectElement {
		const label = [...root.querySelectorAll("label")].find(
			(entry) => entry.childNodes[0]?.textContent?.trim() === text,
		);
		const input = label?.querySelector("input, select");
		if (!(
			input instanceof HTMLInputElement || input instanceof HTMLSelectElement
		))
			throw new Error(`Creator probe cannot find field ${text}.`);
		return input;
	}
	async function change(text: string, value: number | string): Promise<void> {
		const input = control(text);
		input.value = String(value);
		input.dispatchEvent(
			new Event(input instanceof HTMLSelectElement ? "change" : "input", {
				bubbles: true,
			}),
		);
		await tick();
	}
	async function click(text: string): Promise<void> {
		button(text).click();
		await tick();
	}
	/** Exercise the current palette UI, including its top-layer menu, rather than a retired slider. */
	async function changeSkinColor(): Promise<void> {
		const trigger = root.querySelector('button[aria-label^="Skin color:"]');
		if (!(trigger instanceof HTMLButtonElement))
			throw new Error("Creator probe cannot find Skin color palette.");
		trigger.click();
		await tick();
		const choice = [
			...document.querySelectorAll(
				'[role="menu"][aria-label="Skin color"] button',
			),
		].find((entry) => !entry.textContent?.includes("(selected)"));
		if (!(choice instanceof HTMLButtonElement))
			throw new Error("Creator probe requires an alternative skin color.");
		choice.click();
		await tick();
	}
	async function until(
		predicate: () => boolean,
		description: string,
	): Promise<void> {
		const deadline = performance.now() + 20_000;
		while (!predicate()) {
			if (performance.now() > deadline)
				throw new Error(
					`Creator probe timed out: ${description}. ${root.textContent}`,
				);
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => resolve()),
			);
		}
	}
	async function run(): Promise<CreatorWorkflowProof> {
		await click("Create character");
		await until(() => appearanceRequests === 1, "initial appearance query");
		await click("Appearance");
		await changeSkinColor();
		await changeSkinColor();
		await changeSkinColor();
		if (appearanceRequests !== 1)
			throw new Error(
				"Palette burst dispatched concurrent appearance queries.",
			);
		releaseInitial();
		await until(() => hasSource(), "latest appearance draw");
		if (
			appearanceCount() !== 2 ||
			root.textContent?.includes("Synthetic obsolete resolution")
		)
			throw new Error("Obsolete resolution escaped coalescing/currentness.");
		await click("Face");
		await click("Body");
		const beforeRandomize = appearanceCount();
		await click("Randomize clothes");
		await until(
			() => appearanceCount() > beforeRandomize,
			"randomized clothing resolution",
		);
		const beforeBuild = appearanceRequests;
		await click("Skills & Stats");
		// Allocate a custom build using the actual attribute controls.
		for (const [name, value] of [
			["Strength", 100],
			["Endurance", 10],
			["Coordination", 100],
			["Quickness", 100],
			["Focus", 10],
			["Self", 10],
		] as const)
			await change(name, value);
		await click("Review");
		await change("Character name", "Pregame Probe");
		if (appearanceRequests !== beforeBuild)
			throw new Error("Name/stat edits rebuilt appearance.");
		await click("Create character");
		await until(
			() => management.kind === "creating",
			"first validated build admission",
		);
		const count = submissions;
		root
			.querySelector("form")
			?.dispatchEvent(
				new SubmitEvent("submit", { bubbles: true, cancelable: true }),
			);
		await tick();
		if (submissions !== count || !button("Back").disabled)
			throw new Error(
				"Pending creation admitted duplicate submission/cancellation.",
			);
		management = {
			kind: "rejected",
			operation: "create",
			message: "Synthetic name unavailable.",
		};
		await tick();
		if (control("Character name").value !== "Pregame Probe")
			throw new Error("Rejection discarded the draft.");
		await change("Character name", "Pregame Retry");
		await click("Create character");
		await until(() => management.kind === "creating", "retry admission");
		confirmCreation();
		await until(
			() =>
				root.querySelector('button[name="character"][aria-pressed="true"]') !==
				null,
			"confirmed selection",
		);
		if (selection.selectedGuid !== 0x50000042 || automaticEntries !== 0)
			throw new Error(
				"Creation did not select the confirmed GUID without entering.",
			);
		const confirmedGuidSelected = selection.selectedGuid;
		if (submittedName() !== "Pregame Retry")
			throw new Error("Retry did not preserve the edited draft.");
		selection = {
			...selection,
			characters: [
				...selection.characters,
				{ guid: cachedGuid, name: "Cached equipment", slot: 3, deleteTime: 0 },
				{ guid: slowGuid, name: "Delayed capture", slot: 5, deleteTime: 0 },
				{
					guid: unavailableGuid,
					name: "Unavailable capture",
					slot: 7,
					deleteTime: 0,
				},
			],
		};
		async function choose(guid: number): Promise<void> {
			const row = root.querySelector<HTMLButtonElement>(
				`button[name="character"][value="${guid}"]`,
			);
			if (row === null) throw new Error("Picker probe missing roster entry");
			row.click();
			await tick();
		}
		await tick();
		await choose(cachedGuid);
		await until(() => hasSource(), "cached equipment draw");
		const pickerSurfaceCount = surfaceOpenCount;
		const cachedPickerEquipment = savedVisual.attachments.length;
		if (cachedPickerEquipment !== 2)
			throw new Error("Picker probe requires captured sword and shield");
		const selectedReads = cacheReads.length;
		selection = {
			...selection,
			characters: [...selection.characters].reverse(),
		};
		await tick();
		if (
			cacheReads.length !== selectedReads ||
			selection.selectedGuid !== cachedGuid
		)
			throw new Error("Roster refresh reread/reselected the cached character");
		await choose(slowGuid);
		if (hasSource())
			throw new Error(
				"Previous character remained drawable during a different subject read",
			);
		await choose(unavailableGuid);
		await until(
			() =>
				root.textContent?.includes("Synthetic unreadable appearance") === true,
			"local cache diagnostic",
		);
		finishSlow({
			kind: "ready",
			capture: { ...cachedCapture, guid: slowGuid },
		});
		await tick();
		if (hasSource())
			throw new Error("Stale cache completion restored an obsolete subject");
		if (button("Enter World").disabled)
			throw new Error("Unavailable capture prevented entry");
		await choose(cachedGuid);
		await until(() => hasSource(), "cached subject restored");
		if (surfaceOpenCount !== pickerSurfaceCount || surfaceCount() !== 1)
			throw new Error(
				"Picker selection rebuilt or duplicated its scene surface.",
			);
		const originalRoster = selection.characters;
		selection = {
			...selection,
			characters: selection.characters.filter(
				(entry) => entry.guid !== cachedGuid,
			),
		};
		await tick();
		if (hasSource())
			throw new Error("Removed roster character kept its cached model");
		selection = { ...selection, characters: originalRoster };
		await until(() => hasSource(), "restored roster character");
		await click("Create character");
		await until(
			() => root.querySelector('input[type="range"]') !== null,
			"reopened creator",
		);
		await click("Back");
		if (
			root.querySelector('button[name="character"][aria-pressed="true"]') ===
			null
		)
			throw new Error("Returning to the roster lost selection.");
		await until(() => hasSource(), "picker returned from creator");
		const automaticEntriesBeforeExplicit = automaticEntries;
		await click("Enter World");
		if (!button("Entering…").disabled || hasSource())
			throw new Error(
				"Pending entry retained the preview or admitted a repeated entry",
			);
		entryPending = false;
		await tick();
		await click("Create character");
		await until(
			() => hasSource() && root.querySelector('input[type="range"]') !== null,
			"creator before disconnect",
		);
		holdNextResolution = true;
		await click("Appearance");
		await changeSkinColor();
		await until(
			() => rejectHeldResolution !== null,
			"held preparation before disconnect",
		);
		// Core/session tests prove the terminal operation; this checks UI teardown with both
		// a pending submitted operation and a late static-content failure still in flight.
		management = { kind: "creating", name: "Synthetic pending exit" };
		await tick();
		if (!button("Back").disabled)
			throw new Error("Pending creator allowed returning to the roster");
		// Authority can end the session while creation is pending; the creator owns no disconnect action.
		connected = false;
		await tick();
		const rejectRetired = (): void => {
			if (rejectHeldResolution === null)
				throw new Error("Missing held creator resolution");
			rejectHeldResolution();
		};
		rejectRetired();
		await tick();
		characters.destroy();
		const remainingLocalSurfaces = surfaceCount();
		if (remainingLocalSurfaces !== 0)
			throw new Error("Creator navigation retained a scene surface.");
		return {
			submissions,
			appearanceRequests,
			obsoleteResolutionIgnored: true,
			nameAndBuildEditsDidNotResolve: true,
			rejectedDraftRetained: true,
			confirmedGuidSelected,
			automaticEntries: automaticEntriesBeforeExplicit,
			cachedPickerEquipment,
			stalePickerReadIgnored: true,
			explicitEntryRequests: automaticEntries - automaticEntriesBeforeExplicit,
			disconnectRetiredPendingCreator: true,
			remainingLocalSurfaces,
		};
	}
	onMount(() => {
		let current = true;
		void run().then(
			(proof) => {
				if (current) onComplete(proof);
			},
			(error: unknown) => {
				if (current) onFailure(error);
			},
		);
		return () => {
			current = false;
			characters.destroy();
		};
	});
</script>

<div
	bind:this={root}
	class="ui-theme ui-panel"
	style="width: 1000px; padding: 20px;"
>
	{#if connected}
		<ClientCharacterSelect
			{visualCache}
			state={selection}
			{entryPending}
			{management}
			creation={services}
			{scene}
			onChoose={(guid) => (selection = { ...selection, selectedGuid: guid })}
			onEnter={() => {
				automaticEntries++;
				entryPending = true;
			}}
			onDisconnect={() => {
				connected = false;
			}}
		/>
	{/if}
</div>
