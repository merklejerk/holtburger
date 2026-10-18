import { tick } from "svelte";
import type { ClientLifecycleSession } from "../../client/client-lifecycle-session";
import {
	contractsUpdatedSchema,
	type ContractRow,
	type ContractsSnapshot,
} from "../../client/client-contracts-contract";
import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../../lib/game/landblocks";
import { CLIENT_TUNING } from "../../client/client-tuning";
import fixturePayload from "./fixtures/contracts.json";

/** Production World composition with actual session decoding and authoritative replacements. */
export async function probeContractMap(options: {
	readonly session: ClientLifecycleSession;
	readonly emit: (event: string, payload: unknown) => void;
	readonly baseline: (player: number, contracts?: ContractsSnapshot) => void;
	readonly commands: readonly {
		readonly command: string;
		readonly args: Record<string, unknown> | undefined;
	}[];
}) {
	const { session, emit, baseline, commands } = options;
	const owner = session.contracts;
	const fixture = contractsUpdatedSchema.parse(fixturePayload).contracts;
	if (fixture === null) throw new Error("Contract map fixture is unavailable");
	const first = fixture.rows[0],
		second = fixture.rows[1];
	if (
		first?.kind !== "resolved" ||
		first.contact?.location.kind !== "outdoor" ||
		second?.kind !== "resolved"
	)
		throw new Error("Expected fixture outdoor destinations");
	const location = first.contact.location;
	const rows: ContractRow[] = [
		first,
		{
			...second,
			contact: {
				role: "end",
				name: "Bob",
				location: {
					...location,
					position: { ...location.position, landblockId: 0x50500001 },
				},
			},
			deadline: { kind: "finished" },
		},
		{ ...first, id: 3, status: { kind: "completed" } },
	];
	const rootSelector = 'section.hud-window[aria-label="World"]';
	function get<T extends Element>(selector: string): T {
		const element = document.querySelector<T>(selector);
		if (element === null)
			throw new Error(`Missing contract map element: ${selector}`);
		return element;
	}
	const require = (condition: unknown, message: string) => {
		if (!condition) throw new Error(message);
	};
	const settle = async () => {
		await tick();
		await new Promise((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(resolve)),
		);
		await tick();
	};
	const waitTimer = async () => {
		await new Promise((resolve) =>
			setTimeout(resolve, CLIENT_TUNING.journal.displayIntervalMs + 80),
		);
		await settle();
	};
	const visibilityChoice = async (label: string) => {
		if (!document.querySelector('[role="menu"][aria-label="Map visibility"]')) {
			get<HTMLButtonElement>(
				`${rootSelector} button[aria-label="Map visibility"]`,
			).click();
			await settle();
		}
		const row = [
			...document.querySelectorAll<HTMLButtonElement>(
				'[aria-label="Map visibility"] [role="menuitemcheckbox"]',
			),
		].find((row) => row.textContent?.replace("✓", "").trim() === label);
		if (!row) throw new Error(`Missing visibility choice ${label}`);
		return row;
	};
	const toggle = () => visibilityChoice("Contracts");
	const markers = () => [
		...document.querySelectorAll<SVGGElement>(
			`${rootSelector} [data-contract-marker]`,
		),
	];
	const tooltip = () => get<HTMLElement>(`${rootSelector} .world-map-tooltip`);
	const launch = () =>
		get<HTMLButtonElement>(
			'nav[aria-label="Game shortcuts"] button[aria-label="World"]',
		).click();
	const close = () =>
		get<HTMLButtonElement>(
			`${rootSelector} button[aria-label="Close World"]`,
		).click();
	const replace = (next: ContractRow[]) =>
		emit("client-contracts-updated", { contracts: { rows: next } });
	const hover = (marker: SVGGElement) => {
		const matrix = marker.transform.baseVal.consolidate()?.matrix;
		if (matrix === undefined) throw new Error("Expected projected marker");
		const canvas = get<HTMLCanvasElement>(`${rootSelector} canvas`);
		const rect = canvas.getBoundingClientRect();
		canvas.dispatchEvent(
			new PointerEvent("pointermove", {
				clientX: rect.left + matrix.e,
				clientY: rect.top + matrix.f,
				bubbles: true,
			}),
		);
	};
	let reads = 0;
	const original = owner.readFacts.bind(owner);
	owner.readFacts = () => {
		reads++;
		return original();
	};
	try {
		baseline(1, { rows });
		require(!document.querySelector(
			'section.hud-window[aria-label="Journal"] details',
		), "Probe unexpectedly opened the Journal");
		launch();
		await settle();
		for (
			let attempt = 0;
			attempt < 30 &&
			get<HTMLElement>(rootSelector).querySelector('[role="status"]');
			attempt++
		)
			await settle();
		await settle();
		require((await toggle()).getAttribute("aria-checked") === "true" &&
			markers().length === 3, "Contract layer was not default on");
		const retainedMarkers = markers();
		const waypointToggle = await visibilityChoice("Waypoints");
		waypointToggle.click();
		await settle();
		require(markers().length === retainedMarkers.length &&
			markers().every(
				(node, index) => node === retainedMarkers[index],
			), "Waypoint visibility rebuilt contract geometry");
		waypointToggle.click();
		await settle();
		require(markers().every(
			(node, index) => node === retainedMarkers[index],
		), "Restoring waypoint visibility rebuilt contract geometry");

		(await toggle()).click();
		await settle();
		close();
		await settle();
		launch();
		await settle();
		require((await toggle()).getAttribute("aria-checked") === "false" &&
			markers().length === 0, "Map reopen lost the disabled contract choice");
		(await toggle()).click();
		await settle();
		require(markers().length ===
			3, "Contact/area projection or coincident grouping failed");
		require(markers().filter((node) => node.dataset.contractRole === "contact")
			.length === 1, "Contact role icon missing");
		require(markers().filter((node) => node.dataset.contractRole === "quest")
			.length === 2, "Quest/combined role icons missing");
		require(markers().every(
			(node) => !node.querySelector("text"),
		), "Map has persistent contract labels");
		const area = markers().find((node) =>
			node.dataset.contractMarker?.endsWith(
				"," + -(128 * OUTDOOR_LANDBLOCK_WORLD_SIZE + 42),
			),
		);
		if (area === undefined)
			throw new Error("Missing source-offset area marker");
		hover(area);
		await settle();
		require(tooltip().textContent?.includes("Quest area") &&
			tooltip().textContent?.includes("Start contact: Fred") &&
			tooltip().textContent?.includes(
				"Completed",
			), "Overlapping tooltip lost contract roles/status");
		require(tooltip().textContent?.includes("N") &&
			tooltip().textContent?.includes("E"), "Tooltip coordinates missing");
		const end = markers().find(
			(node) => node.dataset.contractRole === "contact",
		);
		if (end === undefined) throw new Error("Missing end-contact marker");
		hover(end);
		await settle();
		require(tooltip().textContent?.includes("End contact: Bob") &&
			tooltip().textContent?.includes(
				"In progress",
			), "End-contact tooltip missing");
		const beforeQuery = reads;
		owner.setSearch("absent");
		owner.setFilters(["completed"]);
		await settle();
		require(reads === beforeQuery &&
			markers().length ===
				3, "Journal query changes rebuilt or filtered map facts");
		const width = end.querySelector("svg")?.getAttribute("width");
		const beforeZoom = end.getAttribute("transform");
		const zoomCanvas = get<HTMLCanvasElement>(`${rootSelector} canvas`);
		const zoomBounds = zoomCanvas.getBoundingClientRect();
		zoomCanvas.dispatchEvent(
			new WheelEvent("wheel", {
				clientX: zoomBounds.left + zoomBounds.width / 2,
				clientY: zoomBounds.top + zoomBounds.height / 2,
				deltaY: -120,
				bubbles: true,
				cancelable: true,
			}),
		);
		await settle();
		require(end.getAttribute("transform") !==
			beforeZoom, "Zoom did not reproject markers");
		require(end.querySelector("svg")?.getAttribute("width") ===
			width, "Marker pixel size changed on zoom");
		const surface = get<HTMLElement>(`${rootSelector} .world-map-surface`);
		const beforeResize = end.getAttribute("transform");
		surface.style.width = "80%";
		await settle();
		await settle();
		require(end.getAttribute("transform") !==
			beforeResize, "Resize did not reproject markers");
		surface.style.width = "";
		await settle();
		close();
		await settle();
		const hiddenReads = reads;
		replace(rows);
		await waitTimer();
		require(reads ===
			hiddenReads, "Hidden map kept sampling contract display facts");
		launch();
		await settle();
		require((await toggle()).getAttribute("aria-checked") === "true" &&
			markers().length === 3, "Map reopen lost toggle or hidden updates");
		const tab = (name: string) => {
			const button = [
				...get<HTMLElement>(rootSelector).querySelectorAll<HTMLButtonElement>(
					'[role="tab"]',
				),
			].find((node) => node.textContent?.trim() === name);
			if (button === undefined) throw new Error(`Missing map tab ${name}`);
			button.click();
		};
		tab("Housing");
		await settle();
		const tabReads = reads;
		await waitTimer();
		require(reads === tabReads, "Hidden World tab retained contract sampling");
		tab("World");
		await settle();
		require((await toggle()).getAttribute("aria-checked") === "true" &&
			markers().length === 3, "World tab switch lost toggle/facts");
		baseline(1, { rows });
		await settle();
		require(markers().length === 3, "Snapshot recovery lost markers");
		emit("client-lifecycle-changed", {
			kind: "portal-space",
			cause: "teleport",
			worldGeneration: 2,
		});
		await settle();
		require((await toggle()).getAttribute("aria-checked") === "true" &&
			markers().length ===
				3, "Portal travel retired contract markers or toggle");
		emit("client-lifecycle-changed", { kind: "in-world" });
		await settle();
		const completed = rows.map((row): ContractRow =>
			row.id === 2 && row.kind === "resolved"
				? { ...row, status: { kind: "completed" } }
				: row,
		);
		replace(completed);
		await settle();
		require(owner.readFacts()?.rows.length === rows.length &&
			markers().length ===
				2, "Completion removed the contract or retained its quest area");
		const completedContact = markers().find(
			(node) => node.dataset.contractRole === "contact",
		);
		if (completedContact === undefined)
			throw new Error("Completion lost selected contact");
		hover(completedContact);
		await settle();
		require(tooltip().textContent?.includes("End contact: Bob") &&
			tooltip().textContent?.includes(
				"Completed",
			), "Completion reinterpreted the supplied contact role or retained stale status");
		replace(rows);
		await settle();
		owner.requestRemove(2, (message) => {
			throw new Error(message);
		});
		const question = owner.question();
		if (question === null)
			throw new Error("Missing map removal fixture question");
		owner.respond(question.requestId, true);
		await settle();
		require(commands.some(
			(entry) => entry.command === "submit_client_contracts",
		) && markers().length === 3, "Dispatch optimistically deleted markers");
		const remaining = rows.filter((row) => row.id !== 2);
		replace(remaining);
		await settle();
		require(markers().length ===
			1, "Server deletion failed to remove all contract roles");
		const repeat: ContractRow[] = remaining.map((row) =>
			row.id === 1 && row.kind === "resolved"
				? {
						...row,
						status: {
							kind: "waitingToRepeat",
							remainingSeconds: CLIENT_TUNING.journal.displayIntervalMs / 2000,
						},
					}
				: row,
		);
		replace(repeat);
		await settle();
		const retained = markers()[0];
		if (retained === undefined) throw new Error("Missing repeat marker");
		hover(retained);
		await settle();
		require(tooltip().textContent?.includes(
			"Waiting to repeat",
		), "Waiting tooltip status missing");
		await waitTimer();
		require(markers()[0] === retained &&
			tooltip().textContent?.includes(
				"Available",
			), "Expiry rebuilt geometry or left stale tooltip status");
		const crowded: ContractRow[] = Array.from({ length: 40 }, (_, index) => ({
			...first,
			id: index + 10,
			name: `Contract ${index}`,
		}));
		replace(crowded);
		await settle();
		const combined = markers()[0];
		if (combined === undefined) throw new Error("Missing crowded marker");
		hover(combined);
		await settle();
		require(markers().length === 1 &&
			tooltip().textContent?.includes(
				"Contract 39",
			), "Crowded point lost contracts");
		require(tooltip().scrollHeight >
			tooltip()
				.clientHeight, "Long tooltip was not constrained with scrolling");
		tooltip().scrollTop = tooltip().scrollHeight;
		require(tooltip().scrollTop > 0, "Long tooltip cannot reveal all entries");
		get<HTMLCanvasElement>(`${rootSelector} canvas`).dispatchEvent(
			new PointerEvent("pointerleave", { relatedTarget: tooltip() }),
		);
		require(!tooltip()
			.hidden, "Entering the tooltip dismissed its scrollable content");
		const tooltipBounds = tooltip().getBoundingClientRect();
		const mapBounds = get<HTMLElement>(
			`${rootSelector} .world-map-surface`,
		).getBoundingClientRect();
		require(tooltipBounds.left >= mapBounds.left &&
			tooltipBounds.top >= mapBounds.top &&
			tooltipBounds.right <= mapBounds.right &&
			tooltipBounds.bottom <=
				mapBounds.bottom, "Long tooltip escaped map bounds");
		replace(remaining);
		await settle();
		(await toggle()).click();
		await settle();
		const offReads = reads;
		await waitTimer();
		require(markers().length === 0 &&
			reads === offReads, "Disabled layer retained work or markers");
		baseline(2, { rows: remaining });
		await settle();
		require((await toggle()).getAttribute("aria-checked") === "true" &&
			markers().length === 1 &&
			tooltip()
				.hidden, "Character replacement failed to restore the default or retire stale hover");
		return {
			markers: 3,
			defaultOn: true,
			independentJournal: true,
			independentWaypointLayer: true,
			roleTooltips: true,
			overlappingHits: true,
			fixedSize: true,
			zoomResize: true,
			hiddenPollingStopped: true,
			retainedToggle: true,
			authoritativeDeletion: true,
			snapshotRecovery: true,
			portalRetention: true,
			completionRetainsContact: true,
			expiryWithoutGeometryRebuild: true,
			crowdedTooltipScroll: true,
			characterReset: true,
		};
	} finally {
		owner.readFacts = original;
		owner.setSearch("");
		owner.setFilters([]);
		baseline(1);
		await settle();
		const root = document.querySelector<HTMLElement>(rootSelector);
		if (root !== null && !root.hidden) close();
	}
}
