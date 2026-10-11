import { tick } from "svelte";
import type { ClientLifecycleSession } from "../../client/client-lifecycle-session";
import {
	contractsUpdatedSchema,
	type ContractRow,
	type ContractsSnapshot,
} from "../../client/client-contracts-contract";
import { CLIENT_TUNING } from "../../client/client-tuning";
import fixturePayload from "./fixtures/contracts.json";
import membershipFixture from "./fixtures/contract-membership.json";
import { ClientContractNotifications } from "../../client/client-contract-notifications";
import {
	ClientToastCenter,
	CLIENT_TOAST_DURATION_MS,
	type ClientToast,
} from "../../client/client-toast-center";

/** Exercise session decoding, the production dock/window, dialogs, and authority updates. */
export async function probeContracts(options: {
	readonly session: ClientLifecycleSession;
	readonly emit: (event: string, payload: unknown) => void;
	readonly baseline: (player: number, contracts?: ContractsSnapshot) => void;
	readonly inputAllowed: () => boolean;
	readonly onToast: (toast: ClientToast | null) => void;
	readonly commands: readonly {
		readonly command: string;
		readonly args: Record<string, unknown> | undefined;
	}[];
}) {
	const { session, emit, commands, baseline, inputAllowed } = options;
	const owner = session.contracts;
	const scheduler = {
		cancel: (handle: number) => globalThis.clearTimeout(handle),
		schedule: (callback: () => void, delay: number) =>
			globalThis.setTimeout(callback, delay),
	};
	const center = new ClientToastCenter({
		durationMs: CLIENT_TOAST_DURATION_MS,
		scheduler,
	});
	const notifications = new ClientContractNotifications({
		publish: (message) => center.publish({ message, tone: "status" }),
		scheduler,
		batchMs: CLIENT_TUNING.journal.membershipToastBatchMs,
	});
	const unsubscribeToasts = center.subscribe(options.onToast);
	const unsubscribeActivity = session.subscribe((event) =>
		notifications.receive(event),
	);
	const fixture = contractsUpdatedSchema.parse(fixturePayload).contracts;
	if (fixture === null) throw new Error("Missing contracts fixture");
	const rows: ContractRow[] = [
		...fixture.rows,
		...Array.from({ length: 30 }, (_, index): ContractRow => ({
			kind: "unresolved",
			id: 100 + index,
		})),
	];
	const require = (condition: unknown, message: string): void => {
		if (!condition) throw new Error(message);
	};
	const settle = async (): Promise<void> => {
		await tick();
		await new Promise((resolve) => setTimeout(resolve, 0));
		await tick();
	};
	const refresh = async (): Promise<void> => {
		await new Promise((resolve) =>
			setTimeout(resolve, CLIENT_TUNING.journal.displayIntervalMs + 50),
		);
		await settle();
	};
	function get<T extends HTMLElement>(selector: string): T {
		const element = document.querySelector<T>(selector);
		if (element === null)
			throw new Error(`Missing journal element: ${selector}`);
		return element;
	}
	const windowSelector = 'section.hud-window[aria-label="Journal"]';
	const window = (): HTMLElement => get(windowSelector);
	const list = (): HTMLElement => get(`${windowSelector} .journal-list`);
	const entries = (): HTMLDetailsElement[] =>
		Array.from(window().querySelectorAll("details"));
	const named = (name: string): HTMLDetailsElement => {
		const row = entries().find(
			(entry) => entry.querySelector(".contract-name")?.textContent === name,
		);
		if (row === undefined) throw new Error(`Missing contract: ${name}`);
		return row;
	};
	const launch = (): void =>
		get<HTMLButtonElement>(
			'nav[aria-label="Game shortcuts"] button[aria-label="Journal"]',
		).click();
	const search = (value: string): void => {
		const input = get<HTMLInputElement>(
			`${windowSelector} input[type="search"]`,
		);
		input.value = value;
		input.dispatchEvent(new Event("input", { bubbles: true }));
	};
	const filter = (value: string): void => {
		get<HTMLButtonElement>(
			value === "all"
				? `${windowSelector} button[aria-label="All statuses"]`
				: `${windowSelector} button[data-status="${value}"]`,
		).click();
	};
	const start = commands.length;
	const renderedToastIncludes = (message: string): boolean =>
		Array.from(document.querySelectorAll(".client-toast")).some((element) =>
			element.textContent?.includes(message),
		);
	const originalRead = owner.read.bind(owner);
	let reads = 0;
	owner.read = () => {
		reads++;
		return originalRead();
	};
	try {
		emit("client-contracts-updated", { contracts: { rows } });
		const flushNotifications = async () => {
			await new Promise((resolve) =>
				setTimeout(resolve, CLIENT_TUNING.journal.membershipToastBatchMs + 50),
			);
			await settle();
		};
		await flushNotifications();
		require(center.snapshot() ===
			null, "Snapshot hydration produced a membership toast");
		emit("client-contract-membership-changed", membershipFixture[0]);
		await flushNotifications();
		require(renderedToastIncludes(
			"Added to journal: Same quest",
		), "Added membership did not reach the production toast overlay while Journal was closed");
		emit("client-contract-membership-changed", membershipFixture[1]);
		await flushNotifications();
		require(center.snapshot()?.message ===
			"Removed from journal: Contract #99" &&
			renderedToastIncludes(
				"Removed from journal: Contract #99",
			), "Removed membership lost its unresolved identity");
		for (const id of [1, 2])
			emit("client-contract-membership-changed", {
				kind: "removed",
				id,
				name: "Same quest",
			});
		await flushNotifications();
		require(center.snapshot()?.message === "2 contracts removed from journal" &&
			renderedToastIncludes(
				"2 contracts removed from journal",
			), "Bulk removal failed to summarize its notifications");
		const priorToast = center.snapshot();
		emit("client-contract-membership-changed", membershipFixture[0]);
		baseline(1, { rows });
		await flushNotifications();
		require(center.snapshot() ===
			priorToast, "Recovery replayed or leaked pending membership activity");
		launch();
		await settle();
		require(!window()
			.hidden, "Journal dock did not open the production window");
		require(entries().length === rows.length, "Journal dropped identities");
		require(entries().filter((row) => row.textContent?.includes("Same quest"))
			.length === 2, "Duplicate names were merged");
		for (const label of [
			"Available",
			"In progress",
			"Completed",
			"Waiting to repeat",
			"Definition unavailable",
		]) {
			require(window().querySelector(
				`[role="img"][aria-label="${label}"] svg`,
			), `Missing accessible status icon: ${label}`);
		}
		const counter = entries().find((row) =>
			row.textContent?.includes("7 Wins"),
		);
		require(counter, "Open-ended authored counter missing");
		get<HTMLElement>(`${windowSelector} details summary`).click();
		await settle();
		require(owner.read().expanded.size ===
			1, "Disclosure click did not update the owner");
		search("Same quest");
		await settle();
		require(entries().length === 2, "Search lost duplicate identities");
		search("athrd same");
		await settle();
		require(entries().length ===
			2, "Abbreviated name/description search failed");
		search("");
		filter("completed");
		await settle();
		require(entries().length === 1, "Status filter failed");
		filter("inProgress");
		await settle();
		require(entries().length === 3 &&
			owner.read().filters.length ===
				2, "Status pills did not union selected statuses");
		filter("completed");
		await settle();
		require(entries().length === 2 &&
			owner.read().filters[0] ===
				"inProgress", "Status pill did not deselect independently");
		filter("all");
		await settle();
		require(owner.read().expanded.size === 1, "Filtering cleared expansion");
		get<HTMLInputElement>(`${windowSelector} input[type="search"]`).focus();
		await settle();
		require(!inputAllowed(), "Search focus did not acquire editor input ownership");
		const retainedList = list();
		retainedList.scrollTop = 180;
		require(retainedList.scrollTop >
			0, "Journal list did not provide scrolling");
		const scroll = retainedList.scrollTop;
		get<HTMLButtonElement>('button[aria-label="Close Journal"]').click();
		await settle();
		require(window().hidden &&
			!window().contains(
				document.activeElement,
			), "Hidden journal retained focus");
		const hiddenReads = reads;
		await refresh();
		require(reads === hiddenReads, "Hidden journal kept polling display facts");
		launch();
		await settle();
		require(list() === retainedList &&
			list().scrollTop ===
				scroll, "Reopening replaced the list or lost scroll");
		require(owner.read().expanded.size === 1, "Reopening cleared expansion");
		const unresolved = named("Contract #99");
		unresolved.querySelector<HTMLElement>("summary")?.click();
		await settle();
		unresolved.querySelector<HTMLButtonElement>("button")?.click();
		await settle();
		require(document
			.querySelector(".client-message-dialog")
			?.textContent?.includes(
				"Quest progress is retained",
			), "Removal did not use the existing dialog owner");
		const accept = Array.from(
			document.querySelectorAll<HTMLButtonElement>(
				".client-message-dialog button",
			),
		).find((button) => button.textContent === "Accept");
		if (accept === undefined)
			throw new Error("Missing removal acceptance button");
		accept.click();
		await settle();
		require(commands
			.slice(start)
			.some(
				(command) =>
					command.command === "submit_client_contracts" &&
					JSON.stringify(command.args?.action) ===
						JSON.stringify({ kind: "remove", id: 99 }),
			), "Removal did not reach the host transport");
		require(owner.read().journal?.total === rows.length &&
			named("Contract #99"), "Dispatch optimistically removed the row");
		unresolved.querySelector<HTMLButtonElement>("button")?.click();
		await settle();
		const stale = owner.question();
		if (stale === null) throw new Error("Missing second removal question");
		emit("client-contracts-updated", {
			contracts: { rows: rows.filter((row) => row.id !== 99) },
		});
		await settle();
		require(owner.question() === null &&
			document.querySelector(".client-message-dialog") ===
				null, "Deletion left a stale confirmation");
		const commandCount = commands.length;
		owner.respond(stale.requestId, true);
		require(commands.length ===
			commandCount, "Stale acceptance dispatched removal");
		await refresh();
		require(!entries().some((row) =>
			row.textContent?.includes("Contract #99"),
		), "Authoritative deletion did not remove markup");
		const timed = fixture.rows.map((row): ContractRow =>
			row.kind === "resolved" && row.id === 4
				? {
						...row,
						status: {
							kind: "waitingToRepeat",
							remainingSeconds: CLIENT_TUNING.journal.displayIntervalMs / 2000,
						},
						deadline: {
							kind: "running",
							remainingSeconds: CLIENT_TUNING.journal.displayIntervalMs / 2000,
						},
					}
				: row,
		);
		emit("client-contracts-updated", { contracts: { rows: timed } });
		filter("waitingToRepeat");
		await settle();
		require(entries().length ===
			1, "Waiting filter did not initially include timed row");
		await refresh();
		require(entries().length ===
			0, "Repeat expiry did not update the status filter");
		filter("available");
		await settle();
		require(entries().length === 2, "Repeat expiry did not become Available");
		const expired = owner.read().journal?.rows.find((row) => row.id === 4);
		require(expired?.kind === "resolved" &&
			expired.status.kind === "available" &&
			expired.deadline?.kind ===
				"finished", "Deadline/repeat expiry outcomes were not independent");
		filter("all");
		const recoveryRemaining =
			(CLIENT_TUNING.journal.displayIntervalMs / 1000) * 3;
		const recovered = fixture.rows.map((row): ContractRow =>
			row.kind === "resolved" && row.id === 4
				? {
						...row,
						status: {
							kind: "waitingToRepeat",
							remainingSeconds: recoveryRemaining,
						},
					}
				: row,
		);
		baseline(1, { rows: recovered });
		await refresh();
		const recoveredRow = owner.read().journal?.rows.find((row) => row.id === 4);
		require(recoveredRow?.kind === "resolved" &&
			recoveredRow.status.kind === "waitingToRepeat" &&
			recoveredRow.status.remainingSeconds > 0 &&
			recoveredRow.status.remainingSeconds <
				recoveryRemaining, "Real snapshot recovery did not replace and age the supplied duration");
		search("Same quest");
		await settle();
		const retainedQuest = entries()[0];
		if (retainedQuest === undefined)
			throw new Error("Missing contract before character replacement");
		retainedQuest.querySelector<HTMLElement>("summary")?.click();
		await settle();
		retainedQuest.querySelector<HTMLButtonElement>("button")?.click();
		await settle();
		require(owner.question() !== null &&
			owner.read().expanded.size >
				0, "Character retirement fixture did not establish local state");
		baseline(2, { rows });
		await settle();
		require(owner.question() === null &&
			document.querySelector(".client-message-dialog") ===
				null, "Character replacement retained confirmation");
		await refresh();
		require(owner.read().character === 2 &&
			owner.read().search === "" &&
			owner.read().expanded.size ===
				0, "Character replacement retained local controls");
		require(list() !== retainedList &&
			list().scrollTop === 0, "Character replacement retained list scroll");
		return {
			passed: true,
			membershipToasts: true,
			bulkSummary: true,
			recoverySilent: true,
			rows: rows.length,
			retainedWindow: true,
			hiddenPollingStopped: true,
			authoritativeDeletion: true,
			timerExpiry: true,
			snapshotRecovery: true,
			characterReset: true,
		};
	} finally {
		unsubscribeActivity();
		unsubscribeToasts();
		notifications.reset();
		center.destroy();
		options.onToast(null);
		owner.read = originalRead;
	}
}
