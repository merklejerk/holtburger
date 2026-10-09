import { mount, tick, unmount } from "svelte";
import ClientSocialPanel from "../../client/ClientSocialPanel.svelte";
import { ClientPartyState } from "../../client/client-party-state";
import type { ClientLifecycleSession } from "../../client/client-lifecycle-session";
import type { SquelchSnapshot } from "../../client/client-squelch-contract";

/** Exercise real session decoding, tab remount, controls, and authoritative scope replacement. */
export async function probeSquelch(options: {
	readonly session: ClientLifecycleSession;
	readonly context: Map<unknown, unknown>;
	readonly emit: (event: string, payload: unknown) => void;
	readonly commands: readonly {
		readonly command: string;
		readonly args: Record<string, unknown> | undefined;
	}[];
}) {
	const { session, context, emit, commands } = options;
	const party = new ClientPartyState(
		session,
		(message) => {
			throw new Error(message);
		},
		() => {},
	);
	const target = document.createElement("div");
	target.className = "ui-theme";
	target.style.width = "340px";
	target.style.height = "400px";
	document.body.append(target);
	const amy = {
		guid: 10,
		name: "Amy",
		account: true,
		coverage: "partial",
		removalScope: "account",
	} as const;
	const ben = {
		guid: 11,
		name: "Ben",
		account: false,
		coverage: "all",
		removalScope: "character",
	} as const;
	const baseline: SquelchSnapshot = {
		entries: [ben, amy],
		legacyAccounts: ["legacy"],
		globalCoverage: "partial",
	};
	const require = (condition: unknown, message: string) => {
		if (!condition) throw new Error(message);
	};
	const settle = async () => {
		await tick();
		await new Promise((resolve) => setTimeout(resolve, 0));
		await tick();
	};
	function element<T extends Element>(selector: string): T {
		const node = target.querySelector<T>(selector);
		if (node === null) throw new Error(`Missing ignore control: ${selector}`);
		return node;
	}
	const start = commands.length;
	let component: ReturnType<typeof mount> | null = null;
	try {
		emit("client-squelch-updated", { squelch: baseline });
		for (let pass = 0; pass < 2; pass++) {
			component = mount(ClientSocialPanel, {
				target,
				context,
				props: {
					owner: party,
					friends: session.friends,
					squelch: session.squelch,
					allegiance: session.allegiance,
				},
			});
			await settle();
			element<HTMLButtonElement>("#social-ignores-tab").click();
			await settle();
			const rows = target.querySelectorAll('[aria-label="Ignores"] li');
			require(rows[0]?.textContent?.includes(
				pass === 0 ? "Amy" : "+Cara",
			), "Ignores were not sorted by name");
			require(target.textContent?.includes(
				"Also has character category restrictions",
			), "Merged scope restrictions were hidden");
			require(target.textContent?.includes("Global filtering") &&
				target.textContent.includes(
					"legacy",
				), "Read-only restrictions were not disclosed");
			if (pass === 1) {
				require(!target.textContent?.includes(
					"Adding…",
				), "Confirmed ignore retained pending markup");
				break;
			}
			const input = element<HTMLInputElement>(
				'[aria-label="Ignore character name"]',
			);
			input.value = "Cara";
			input.dispatchEvent(new Event("input", { bubbles: true }));
			await settle();
			element<HTMLFormElement>(".add-ignore").dispatchEvent(
				new Event("submit", { bubbles: true, cancelable: true }),
			);
			await settle();
			require(session.squelch.read().pending?.kind ===
				"add", "Queue acceptance settled ignore without server evidence");
			await unmount(component);
			component = null;
			emit("client-squelch-updated", {
				squelch: {
					...baseline,
					entries: [
						...baseline.entries,
						{
							guid: 12,
							name: "+Cara",
							account: true,
							coverage: "all",
							removalScope: "account",
						},
					],
				},
			});
			require(session.squelch.read().pending ===
				null, "Unmount lost ignore settlement");
		}
		const latest = commands
			.slice(start)
			.find((command) => command.command === "submit_client_squelch");
		require(JSON.stringify(latest?.args) ===
			JSON.stringify({
				action: { kind: "add", name: "Cara", scope: "account" },
			}), "Account add did not reach the host command boundary");
		element<HTMLButtonElement>(
			'[aria-label="Remove account ignore for Amy"]',
		).click();
		await settle();
		require(target.textContent?.includes(
			"Removing…",
		), "Removal hid server facts before replacement");
		const retained = { ...amy, account: false, removalScope: null };
		emit("client-squelch-updated", {
			squelch: { ...baseline, entries: [retained, ben] },
		});
		await settle();
		require(session.squelch.read().pending ===
			null, "Account removal failed to settle while character restrictions remained");
		require(target.textContent?.includes(
			"Some message categories",
		), "Account removal erased retained character restrictions");
		element<HTMLButtonElement>(
			'[aria-label="Remove character ignore for Ben"]',
		).click();
		await settle();
		emit("client-squelch-updated", {
			squelch: { ...baseline, entries: [retained] },
		});
		await settle();
		require(session.squelch.read().entries.length === 1 &&
			session.squelch.read().pending ===
				null, "Character removal did not reconcile");
		const tab = element<HTMLElement>("#social-ignores-panel");
		require(getComputedStyle(tab).overflowY ===
			"auto", "Ignores tab does not use the scrolling panel shell");
		const draft = element<HTMLInputElement>(
			'[aria-label="Ignore character name"]',
		);
		draft.value = "Dana";
		draft.dispatchEvent(new Event("input", { bubbles: true }));
		await settle();
		const characterButton = Array.from(
			target.querySelectorAll<HTMLButtonElement>("button"),
		).find((button) => button.textContent?.trim() === "Ignore character");
		if (characterButton === undefined)
			throw new Error("Missing Ignore character button");
		characterButton.click();
		await settle();
		emit("client-squelch-updated", {
			squelch: {
				...baseline,
				entries: [
					retained,
					{
						guid: 13,
						name: "Dana",
						account: false,
						coverage: "all",
						removalScope: "character",
					},
				],
			},
		});
		await settle();
		require(session.squelch.read().pending ===
			null, "Character add did not settle");
		const actions = commands
			.slice(start)
			.filter((command) => command.command === "submit_client_squelch");
		require(actions.length === 4, "Unexpected ignore mutation count");
		require(JSON.stringify(actions[1]?.args) ===
			JSON.stringify({
				action: { kind: "remove", guid: 10, scope: "account" },
			}), "Account removal scope changed at transport");
		require(JSON.stringify(actions[2]?.args) ===
			JSON.stringify({
				action: { kind: "remove", guid: 11, scope: "character" },
			}), "Character removal scope changed at transport");
		require(JSON.stringify(actions[3]?.args) ===
			JSON.stringify({
				action: { kind: "add", name: "Dana", scope: "character" },
			}), "Character add button chose the wrong scope");
		if (component !== null) {
			await unmount(component);
			component = null;
		}
		const retention = await probeSocialRetention(emit, settle);
		return {
			passed: true,
			remounts: 2,
			mutations: actions.length,
			retainedCharacterRestriction: true,
			retention,
		};
	} finally {
		if (component !== null) await unmount(component);
		party.destroy();
		target.remove();
	}
}

/** Exercise actual WorldView close/reopen composition, including nested scrolling and disclosures. */
async function probeSocialRetention(
	emit: (event: string, payload: unknown) => void,
	settle: () => Promise<void>,
) {
	function element<T extends Element>(selector: string): T {
		const node = document.querySelector<T>(selector);
		if (node === null)
			throw new Error(`Missing Social window control: ${selector}`);
		return node;
	}
	const require = (condition: unknown, message: string) => {
		if (!condition) throw new Error(message);
	};
	emit("client-squelch-updated", {
		squelch: {
			entries: Array.from({ length: 24 }, (_, i) => ({
				guid: 100 + i,
				name: `Player ${String(i).padStart(2, "0")}`,
				account: true,
				coverage: "all",
				removalScope: "account",
			})),
			legacyAccounts: Array.from({ length: 70 }, (_, i) => `Account ${i}`),
			globalCoverage: "partial",
		},
	});
	require(document.querySelector('section[aria-label="Social"]') ===
		null, "Social content mounted before its first opening");
	element<HTMLButtonElement>('[aria-label="Social"]').click();
	await settle();
	element<HTMLButtonElement>("#social-ignores-tab").click();
	await settle();
	const panel = element<HTMLElement>("#social-ignores-panel");
	const list = element<HTMLElement>(
		'#social-ignores-panel [aria-label="Ignores"]',
	);
	const details = element<HTMLDetailsElement>("#social-friends-panel details");
	details.open = false;
	const draft = element<HTMLInputElement>(
		'[aria-label="Ignore character name"]',
	);
	draft.value = "Unsent name";
	draft.dispatchEvent(new Event("input", { bubbles: true }));
	await settle();
	panel.scrollTop = 40;
	list.scrollTop = 60;
	require(panel.scrollTop > 0 &&
		list.scrollTop >
			0, "Retention fixture did not overflow both scroll containers");
	const scroll = { panel: panel.scrollTop, list: list.scrollTop };
	element<HTMLButtonElement>("#social-friends-tab").click();
	await settle();
	element<HTMLButtonElement>("#social-ignores-tab").click();
	await settle();
	require(panel.scrollTop === scroll.panel &&
		list.scrollTop === scroll.list, "Tab switching lost scroll positions");
	element<HTMLButtonElement>('[aria-label="Close Social"]').click();
	await settle();
	require(element<HTMLElement>('section[aria-label="Social"]')
		.hidden, "Closing Social did not hide its retained window");
	element<HTMLButtonElement>('[aria-label="Social"]').click();
	await settle();
	require(element<HTMLButtonElement>("#social-ignores-tab").getAttribute(
		"aria-selected",
	) === "true", "Reopening Social lost the active tab");
	require(element<HTMLElement>("#social-ignores-panel") ===
		panel, "Reopening Social rebuilt the tab DOM");
	require(panel.scrollTop === scroll.panel &&
		list.scrollTop === scroll.list, "Reopening Social lost scroll positions");
	require(element<HTMLInputElement>('[aria-label="Ignore character name"]')
		.value === "Unsent name", "Reopening Social lost the draft");
	element<HTMLButtonElement>("#social-friends-tab").click();
	await settle();
	require(!details.open, "Tab switching lost disclosure state");
	element<HTMLButtonElement>('[aria-label="Close Social"]').click();
	await settle();
	return {
		passed: true,
		lazyMount: true,
		tab: true,
		scroll: true,
		draft: true,
		disclosure: true,
	};
}
