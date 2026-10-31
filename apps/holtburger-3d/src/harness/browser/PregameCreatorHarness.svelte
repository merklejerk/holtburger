<script module lang="ts">
	/** Machine acceptance of the production creator with static content and synthetic server results. */
	export interface CreatorWorkflowProof {
		readonly raceChoicesPreserved: boolean;
		readonly genderRandomizationPreserved: boolean;
		readonly appearanceStepControlsVerified: boolean;
		readonly raceLoreAndAttributeHelpVerified: boolean;
		readonly raceBudgetReconciliationVerified: boolean;
		readonly startingStatsVerified: boolean;
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
	import startingStatsFixture from "../../../../../crates/holtburger-core/tests/fixtures/character_creation_starting_stats.json";
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
		resolveCharacterCreationStats,
		type CharacterCreationStats,
		type CharacterCreationStatsRequest,
		type CharacterCreationDraft,
		type CharacterCreationCatalog,
		type CharacterCreationAppearanceRequest,
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
		rejection: null,
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
	let catalog: CharacterCreationCatalog | null = null;
	let lastResolvedAppearance: CharacterCreationAppearanceRequest | null = null;
	let successfulAppearances = 0;
	let latestStats: {
		request: CharacterCreationStatsRequest;
		result: CharacterCreationStats;
	} | null = null;
	let statsQueries = 0;
	let holdNextStats = false;
	let releaseStats: (() => void) | null = null;
	function creationCatalog(): CharacterCreationCatalog {
		if (catalog === null) throw new Error("Creator catalog is not loaded");
		return catalog;
	}
	const services: CharacterCreationServices = {
		resolveStats: async (request) => {
			statsQueries++;
			if (holdNextStats) {
				holdNextStats = false;
				await new Promise<void>((resolve) => {
					releaseStats = resolve;
				});
			}
			const result = await resolveCharacterCreationStats(transport, request);
			latestStats = { request, result };
			return result;
		},
		loadCatalog: async () => {
			catalog = await loadCharacterCreationCatalog(transport);
			return catalog;
		},
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
			const result = await resolveCharacterCreationAppearance(
				transport,
				request,
			);
			lastResolvedAppearance = structuredClone(request);
			successfulAppearances++;
			return result;
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
	async function statsReady(): Promise<void> {
		await until(
			() =>
				latestStats !== null &&
				latestStats.request.heritage === Number(control("Race").value) &&
				(latestStats.result.kind === "olthoi" ||
					root.querySelector('[data-vital="Health"]')?.textContent?.trim() ===
						String(latestStats.result.vitals[0])) &&
				!root.querySelector(
					'[aria-label="Starting vitals"] [aria-busy="true"]',
				),
			"current starting stats",
		);
		await tick();
	}
	async function verifyStartingStats(
		appearanceEdit: (edit: () => Promise<void>) => Promise<void>,
	): Promise<void> {
		await statsReady();
		const fixture = startingStatsFixture;
		if (Number(control("Race").value) !== fixture.heritage)
			await appearanceEdit(() => change("Race", fixture.heritage));
		await click("Skills & Stats");
		for (const name of [
			"Strength",
			"Endurance",
			"Coordination",
			"Quickness",
			"Focus",
			"Self",
		])
			await change(name, creationCatalog().minimumAttribute);
		for (const [index, name] of [
			"Strength",
			"Endurance",
			"Coordination",
			"Quickness",
			"Focus",
			"Self",
		].entries())
			await change(name, fixture.attributes[index]);
		await statsReady();
		const normalHeritage = creationCatalog().heritages.find(
			(race) => race.id === fixture.heritage,
		);
		if (normalHeritage === undefined)
			throw new Error("Starting stats fixture heritage is missing");
		const authored = normalHeritage.skills.find(
			(skill) => skill.id === fixture.skill.id,
		);
		if (
			JSON.stringify(authored?.formula) !==
			JSON.stringify({
				first: fixture.skill.first,
				second: fixture.skill.second,
				divisor: fixture.skill.divisor,
			})
		)
			throw new Error(
				"Starting stats fixture differs from authored Melee Defense formula",
			);
		for (const [tier, expected] of [
			[1, fixture.skill.untrained],
			[2, fixture.skill.trained],
			[3, fixture.skill.specialized],
		]) {
			while (
				latestStats !== null &&
				latestStats.request.skills[fixture.skill.id] !== tier
			) {
				const current = latestStats.request.skills[fixture.skill.id];
				const direction = current < tier ? "up" : "down";
				const row = root
					.querySelector(`[data-starting-skill="${fixture.skill.id}"]`)
					?.closest(".creation-skill-row");
				const action = row?.querySelector<HTMLButtonElement>(
					`button[data-direction="${direction}"]`,
				);
				if (action === null || action === undefined || action.disabled)
					throw new Error("Cannot exercise starting skill tier");
				action.click();
				await tick();
				await statsReady();
			}
			const shown = root
				.querySelector(`[data-starting-skill="${fixture.skill.id}"]`)
				?.textContent?.trim();
			if (shown !== String(expected))
				throw new Error(
					`Wrong starting skill value for tier ${tier}: ${shown}`,
				);
			const pools = [
				...root.querySelectorAll("#creation-skills-stats [data-vital]"),
			].map((node) => Number(node.textContent));
			if (JSON.stringify(pools) !== JSON.stringify(fixture.vitals))
				throw new Error("Wrong starting vital pools");
		}
		const level = root.querySelector(
			`[data-starting-skill="${fixture.skill.id}"]`,
		);
		const summary = level?.closest("summary");
		const name = summary?.querySelector(".creation-skill-name");
		const arrows = summary
			?.closest(".creation-skill-row")
			?.querySelector(".pregame-expandable-actions");
		if (
			level === null ||
			summary === null ||
			name === null ||
			name === undefined ||
			arrows === null ||
			arrows === undefined
		)
			throw new Error("Skill level is not grouped with its name");
		const levelBounds = level.getBoundingClientRect();
		const nameBounds = name.getBoundingClientRect();
		const arrowBounds = arrows.getBoundingClientRect();
		if (
			levelBounds.left < nameBounds.right ||
			levelBounds.left - nameBounds.right >=
				arrowBounds.left - levelBounds.right
		)
			throw new Error("Skill level is not closer to its name than the arrows");
		if (getComputedStyle(level).color === getComputedStyle(name).color)
			throw new Error("Skill level color is indistinguishable from its name");
		const visibleNumbers = () =>
			[...root.querySelectorAll("[data-vital], [data-starting-skill]")].map(
				(node) => node.textContent?.trim(),
			);
		const beforeUpdate = visibleNumbers();
		holdNextStats = true;
		await change("Endurance", fixture.attributes[1] - 1);
		await until(() => releaseStats !== null, "held stat recalculation");
		if (JSON.stringify(visibleNumbers()) !== JSON.stringify(beforeUpdate))
			throw new Error(
				"Starting values flickered or disappeared during a same-race edit",
			);
		const release = releaseStats;
		if (release === null) throw new Error("Missing held stat recalculation");
		releaseStats = null;
		release();
		await statsReady();
		if (JSON.stringify(visibleNumbers()) === JSON.stringify(beforeUpdate))
			throw new Error("Starting values did not refresh after recalculation");
		await change("Endurance", fixture.attributes[1]);
		await statsReady();
		const count = statsQueries;
		await click("Review");
		await change("Character name", "Stats Probe");
		const town = normalHeritage.startAreaIds[0];
		if (town === undefined)
			throw new Error("Starting stats fixture has no town");
		await change("Starting town", town);
		await tick();
		if (statsQueries !== count)
			throw new Error(
				"Identity/town/Review changes recalculated starting stats",
			);
		if (
			root
				.querySelector(
					`#creation-review [data-starting-skill="${fixture.skill.id}"]`,
				)
				?.textContent?.trim() !== String(fixture.skill.specialized)
		)
			throw new Error("Review starting skill disagrees with allocation");
		const pools = [
			...root.querySelectorAll("#creation-review [data-vital]"),
		].map((node) => Number(node.textContent));
		if (JSON.stringify(pools) !== JSON.stringify(fixture.vitals))
			throw new Error("Review starting vitals disagree with allocation");
		await click("Race");
		await appearanceEdit(() =>
			change("Race", fixture.heritageWithoutSkillBonus),
		);
		await statsReady();
		if (
			root
				.querySelector(`[data-starting-skill="${fixture.skill.id}"]`)
				?.textContent?.trim() !==
			String(fixture.skill.specialized - fixture.skill.racialBonus)
		)
			throw new Error("Race change retained obsolete innate skill bonus");
		await appearanceEdit(() => change("Race", fixture.heritage));
		await statsReady();
		await click("Skills & Stats");
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
		if (appearanceRequests !== beforeBuild)
			throw new Error("Stat edits rebuilt appearance");
		await until(
			() => successfulAppearances === appearanceRequests - 1,
			"all appearance work settled",
		);
		const appearanceEdit = async (action: () => Promise<void>) => {
			const before = successfulAppearances;
			await action();
			await until(
				() => successfulAppearances > before,
				"appearance edit resolved",
			);
		};
		const genderButton = (name: string) => {
			const control = root.querySelector(`button[aria-label="${name}"]`);
			if (!(control instanceof HTMLButtonElement))
				throw new Error(`Missing gender toggle ${name}`);
			return control;
		};
		const genderAppearance = (name: string) => {
			const button = genderButton(name);
			const icon = button.querySelector("svg");
			if (icon === null) throw new Error(`Missing gender icon ${name}`);
			const buttonBounds = button.getBoundingClientRect();
			const iconBounds = icon.getBoundingClientRect();
			const style = getComputedStyle(icon);
			return {
				buttonWidth: buttonBounds.width,
				buttonHeight: buttonBounds.height,
				centerX: buttonBounds.x + buttonBounds.width / 2,
				centerY: buttonBounds.y + buttonBounds.height / 2,
				iconWidth: iconBounds.width,
				iconHeight: iconBounds.height,
				color: style.stroke,
				strokeWidth: style.strokeWidth,
				radius: getComputedStyle(button).borderRadius,
			};
		};
		const beforeGenderChange = {
			Male: genderAppearance("Male"),
			Female: genderAppearance("Female"),
		};
		await appearanceEdit(async () => {
			genderButton("Female").click();
			await tick();
		});
		await click("Appearance");
		await appearanceEdit(() => click("Randomize appearance"));
		if (genderButton("Female").getAttribute("aria-pressed") !== "true")
			throw new Error("Missing gender selection state");
		const afterGenderChange = {
			Male: genderAppearance("Male"),
			Female: genderAppearance("Female"),
		};
		if (
			beforeGenderChange.Male.buttonWidth <=
				beforeGenderChange.Female.buttonWidth ||
			afterGenderChange.Female.buttonWidth <= afterGenderChange.Male.buttonWidth
		)
			throw new Error("Selected gender must have the larger button");
		for (const name of ["Male", "Female"] as const) {
			const before = beforeGenderChange[name];
			const after = afterGenderChange[name];
			if (after.radius !== "50%" || after.buttonWidth !== after.buttonHeight)
				throw new Error("Gender button is not circular");
			const scale = after.buttonWidth / before.buttonWidth;
			// DOM geometry may contain fractional CSS pixels after scaling.
			if (
				Math.abs(after.iconWidth - before.iconWidth * scale) > 0.01 ||
				Math.abs(after.iconHeight - before.iconHeight * scale) > 0.01
			)
				throw new Error(
					"Gender glyph did not scale proportionally with its button",
				);
			if (before.color !== after.color)
				throw new Error("Gender selection changed the icon color");
			if (before.strokeWidth !== after.strokeWidth)
				throw new Error("Gender selection changed the authored stroke styling");
			if (before.centerX !== after.centerX || before.centerY !== after.centerY)
				throw new Error("Gender selection moved the control's center");
		}
		const nameBounds = control("Character name").getBoundingClientRect();
		const genderGroup = genderButton("Female").parentElement;
		if (
			genderGroup === null ||
			genderGroup.getBoundingClientRect().top - nameBounds.bottom <
				nameBounds.height / 2
		)
			throw new Error("Gender controls are too close to the name input");
		const resolvedAppearance = () => {
			if (lastResolvedAppearance === null)
				throw new Error("Missing resolved appearance");
			return lastResolvedAppearance;
		};
		if (resolvedAppearance().gender !== 2)
			throw new Error("Randomization changed gender");
		const stepButton = root.querySelector('button[aria-label="Next Eyes"]');
		const eyeSlider = root.querySelector<HTMLInputElement>(
			'input[aria-labelledby="creation-appearance-eyes"]',
		);
		if (!(stepButton instanceof HTMLButtonElement) || eyeSlider === null)
			throw new Error("Missing appearance step controls");
		const previous = root.querySelector('button[aria-label="Previous Eyes"]');
		if (!(previous instanceof HTMLButtonElement))
			throw new Error("Missing decrement control");
		for (const row of root.querySelectorAll(".ordinal-range")) {
			const buttons = row.querySelectorAll("button");
			const slider = row.querySelector('input[type="range"]');
			const [left, right] = buttons;
			if (
				buttons.length !== 2 ||
				left === undefined ||
				right === undefined ||
				slider === null
			)
				throw new Error("Appearance slider does not have two step controls");
			const leftBounds = left.getBoundingClientRect();
			const rangeBounds = slider.getBoundingClientRect();
			const rightBounds = right.getBoundingClientRect();
			if (
				rangeBounds.width <= 0 ||
				leftBounds.right > rangeBounds.left ||
				rangeBounds.right > rightBounds.left
			)
				throw new Error("Appearance buttons do not flank the slider");
			for (const button of buttons) {
				const bounds = button.getBoundingClientRect();
				if (
					bounds.width !== bounds.height ||
					getComputedStyle(button).borderRadius !== "50%" ||
					bounds.height >= nameBounds.height
				)
					throw new Error(
						"Appearance step controls are not compact circular buttons",
					);
				// Allow fractional pixel alignment when the grid is laid out at non-integral widths.
				if (
					Math.abs(
						bounds.y +
							bounds.height / 2 -
							(rangeBounds.y + rangeBounds.height / 2),
					) > 1
				)
					throw new Error(
						"Appearance step controls are not aligned with the slider",
					);
			}
		}
		// Drive to both bounds through the actual slider before exercising one step.
		eyeSlider.value = eyeSlider.min;
		await appearanceEdit(async () => {
			eyeSlider.dispatchEvent(new Event("input", { bubbles: true }));
			await tick();
		});
		if (!previous.disabled)
			throw new Error("Decrement remains enabled at the lower bound");
		await appearanceEdit(async () => {
			stepButton.click();
			await tick();
		});
		if (
			Number(eyeSlider.value) !==
			Number(eyeSlider.min) + Number(eyeSlider.step)
		)
			throw new Error("Increment did not follow slider step");
		eyeSlider.value = eyeSlider.max;
		await appearanceEdit(async () => {
			eyeSlider.dispatchEvent(new Event("input", { bubbles: true }));
			await tick();
		});
		if (!stepButton.disabled)
			throw new Error("Increment remains enabled at the upper bound");
		const rememberedAppearance = structuredClone(
			resolvedAppearance().appearance,
		);
		await click("Skills & Stats");
		await verifyStartingStats(appearanceEdit);
		const training = [
			...root.querySelectorAll<HTMLButtonElement>(
				".pregame-expandable-actions button",
			),
		].find(
			(button) =>
				!button.disabled &&
				button.getAttribute("aria-label")?.includes(": Train."),
		);
		if (training === undefined)
			throw new Error("No affordable optional training in production catalog");
		training.click();
		await tick();
		const skillSelections = () =>
			JSON.stringify(
				[...root.querySelectorAll(".creation-skill-groups section")].map(
					(section) => ({
						tier: section.querySelector("h4")?.textContent?.trim(),
						skills: [...section.querySelectorAll(".creation-skill-name")].map(
							(summary) => summary.textContent?.trim(),
						),
					}),
				),
			);
		const skillChoices = skillSelections();
		const attributeChoices = () =>
			[
				"Strength",
				"Endurance",
				"Coordination",
				"Quickness",
				"Focus",
				"Self",
			].map((name) => control(name).value);
		const allocations = attributeChoices();
		const disclosure = root.querySelector(".creation-attribute-row details");
		if (!(disclosure instanceof HTMLDetailsElement))
			throw new Error("Missing attribute disclosure");
		disclosure.open = true;
		if (
			!disclosure.textContent?.includes(
				creationCatalog().attributeDescriptions[0],
			)
		)
			throw new Error("Attribute help differs from catalog");
		await click("Race");
		const originalRace = Number(control("Race").value);
		const alternate = creationCatalog().heritages.find(
			(heritage) =>
				heritage.id !== originalRace &&
				heritage.attributeCredits ===
					creationCatalog().heritages[0].attributeCredits,
		);
		if (alternate === undefined)
			throw new Error("Missing compatible alternate race");
		await appearanceEdit(() => change("Race", alternate.id));
		if (resolvedAppearance().gender !== 2)
			throw new Error("Race change reset gender");
		if (
			JSON.stringify(attributeChoices()) !== JSON.stringify(allocations) ||
			skillSelections() !== skillChoices
		)
			throw new Error("Compatible race change reset the build");
		for (const group of alternate.benefits.skillGroups) {
			const section = root.querySelector(`[aria-label="${group.label}"]`);
			const listed = [...(section?.querySelectorAll("li") ?? [])].map(
				(item) => item.textContent,
			);
			if (JSON.stringify(listed) !== JSON.stringify(group.skills))
				throw new Error("Starting skills are not itemized by training group");
		}
		const lore = root.querySelector(`[aria-label="${alternate.name} lore"]`);
		if (
			!alternate.lore.every((paragraph) =>
				lore?.textContent?.includes(paragraph),
			)
		)
			throw new Error("Race lore is missing or stale");
		if (
			control("Race").closest('[role="tabpanel"]')?.querySelector("select") !==
			control("Race")
		)
			throw new Error("Missing race selector");
		await appearanceEdit(() => change("Race", originalRace));
		if (
			JSON.stringify(resolvedAppearance().appearance) !==
			JSON.stringify(rememberedAppearance)
		)
			throw new Error("Race return lost remembered appearance");
		const lowerBudget = creationCatalog().heritages.find(
			(heritage) =>
				heritage.attributeCredits <
				allocations.reduce((sum, value) => sum + Number(value), 0),
		);
		if (lowerBudget === undefined)
			throw new Error("Missing lower-budget production race");
		await appearanceEdit(() => change("Race", lowerBudget.id));
		if (
			attributeChoices().reduce((sum, value) => sum + Number(value), 0) !==
			lowerBudget.attributeCredits
		)
			throw new Error("Lower race budget was not reconciled");
		for (const olthoi of creationCatalog().heritages.filter(
			(heritage) => heritage.id === 12 || heritage.id === 13,
		)) {
			if (olthoi.id !== Number(control("Race").value))
				await appearanceEdit(() => change("Race", olthoi.id));
			await statsReady();
			if (
				root.querySelector('[aria-label="Starting vitals"]') !== null ||
				root.querySelector("[data-starting-skill]") !== null
			)
				throw new Error("Olthoi displayed normal starting-stat previews");
			if (
				root.querySelector('[role="group"][aria-label="Gender"]') !== null ||
				resolvedAppearance().gender !== 2
			)
				throw new Error(
					"Olthoi gender visibility or stored choice is incorrect",
				);
		}
		await appearanceEdit(() => change("Race", originalRace));
		if (genderButton("Female").getAttribute("aria-pressed") !== "true")
			throw new Error("Returning from Olthoi lost the selected gender");
		await click("Review");
		if (!button("Create character").disabled)
			throw new Error("Unspent attribute budget allowed submission");
		const town = control("Starting town");
		if (town.closest('[role="tabpanel"]')?.id !== "creation-review")
			throw new Error("Starting town is outside Review");
		await click("Skills & Stats");
		for (const [index, name] of [
			"Strength",
			"Endurance",
			"Coordination",
			"Quickness",
			"Focus",
			"Self",
		].entries())
			await change(name, allocations[index]);
		const beforeReview = appearanceRequests;
		await click("Review");
		await change("Character name", "Pregame Probe");
		if (appearanceRequests !== beforeReview)
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
			raceChoicesPreserved: true,
			genderRandomizationPreserved: true,
			appearanceStepControlsVerified: true,
			raceLoreAndAttributeHelpVerified: true,
			raceBudgetReconciliationVerified: true,
			startingStatsVerified: true,
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
