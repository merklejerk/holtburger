import { INPUT_DEFAULTS } from "../../lib/input/input-defaults";
import { mount, tick, unmount } from "svelte";
import ClientSocialPanel from "../../client/ClientSocialPanel.svelte";
import ClientSelectedEntityHud from "../../client/ClientSelectedEntityHud.svelte";
import { EMPTY_CLIENT_SELECTED_DISPLAY } from "../../client/client-selected-entity-tracking";
import { ClientPartyState } from "../../client/client-party-state";
import type { ClientLifecycleSession } from "../../client/client-lifecycle-session";
import type {
	AllegianceMember,
	AllegianceSnapshot,
} from "../../client/client-allegiance-contract";

/** Synthetic replies through production session decoding, retained tabs, modals and HUD. */
export async function probeAllegiance(options: {
	readonly session: ClientLifecycleSession;
	readonly context: Map<unknown, unknown>;
	readonly emit: (event: string, payload: unknown) => void;
	readonly commands: readonly {
		readonly command: string;
		readonly args: Record<string, unknown> | undefined;
	}[];
}) {
	const { session, context, emit, commands } = options;
	const player = session.state().playerGuid;
	if (player === null) throw new Error("Missing allegiance fixture player");
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
	target.style.height = "350px";
	document.body.append(target);
	const require = (condition: unknown, message: string) => {
		if (!condition) throw new Error(message);
	};
	const settle = async () => {
		await tick();
		await new Promise((resolve) => setTimeout(resolve, 0));
		await tick();
	};
	const element = <T extends Element>(selector: string): T => {
		const node = target.querySelector<T>(selector);
		if (node === null)
			throw new Error(`Missing allegiance element: ${selector}`);
		return node;
	};
	const click = (label: string) => {
		const button = Array.from(
			target.querySelectorAll<HTMLButtonElement>("button"),
		).find(
			(button) =>
				button.textContent?.trim() === label ||
				button.getAttribute("aria-label") === label,
		);
		if (button === undefined)
			throw new Error(`Missing allegiance button: ${label}`);
		button.click();
	};
	const start = commands.length;
	const actions = () =>
		commands
			.slice(start)
			.filter((command) => command.command === "submit_client_allegiance")
			.map((command) => command.args?.action);
	const preferences = {
		appearance: { showHelmet: true, showCloak: true },
		party: { shareXp: true, shareLoot: false, ignoreRequests: false },
		friends: { appearOffline: false },
		allegiance: { showLogons: false },
	};
	const member = (guid: number, name: string): AllegianceMember => ({
		guid,
		name,
		title: "Yeoman",
		rank: 1,
		level: 10,
		online: true,
		contributedXp: 200,
	});
	const patron = member(10, "Patron");
	const baseline: AllegianceSnapshot = {
		playerGuid: player,
		profile: null,
		refreshing: false,
		canSwear: true,
	};
	const profile = {
		name: "Test allegiance",
		rank: 1,
		totalMembers: 200,
		totalDescendants: 100,
		monarch: patron,
		patron,
		selfMember: member(player, "Player"),
		directVassals: Array.from({ length: 24 }, (_, index) =>
			member(
				index + 100,
				index === 0 ? "Amy" : `Vassal ${index.toString().padStart(2, "0")}`,
			),
		)
			.map((member, index) =>
				index === 1 ? { ...member, title: null } : member,
			)
			.reverse(),
	};
	let component: ReturnType<typeof mount> | null = null;
	let hud: ReturnType<typeof mount> | null = null;
	const open = async () => {
		component = mount(ClientSocialPanel, {
			target,
			context,
			props: {
				owner: party,
				onSelectEntity: () => {},
				friends: session.friends,
				squelch: session.squelch,
				allegiance: session.allegiance,
			},
		});
		await settle();
		element<HTMLButtonElement>("#social-allegiance-tab").click();
		await settle();
	};
	try {
		emit("client-character-preferences-updated", preferences);
		emit("client-allegiance-updated", { allegiance: baseline });
		await open();
		require(JSON.stringify(actions()) ===
			JSON.stringify([
				{ kind: "refresh" },
			]), "Initial tab activation did not send exactly one profile read");
		emit("client-allegiance-updated", {
			allegiance: { ...baseline, refreshing: true },
		});
		await settle();

		emit("client-allegiance-updated", {
			allegiance: { ...baseline, profile, canSwear: false },
		});
		await settle();
		require(element("#social-allegiance-panel").textContent?.includes(
			"Patron / Monarch",
		), "Overlapping monarch/patron roles were not labeled");
		require(target.querySelectorAll(
			'[aria-label="Allegiance relationships"] li[data-relationship="context"], [aria-label="Allegiance relationships"] li[data-relationship="patron"]',
		).length === 2, "Overlapping roles duplicated a member");
		require(element(
			'[aria-label="Allegiance relationships"] li[data-relationship="vassal"]',
		).textContent?.includes("Amy"), "Vassals were not name sorted");
		require(element(
			'[aria-label="Allegiance relationships"] li[data-relationship="vassal"] .ui-list-name',
		).textContent?.trim() ===
			"Yeoman Amy", "Projected rank title was not displayed beside the name");
		require(Array.from(target.querySelectorAll(".ui-list-name")).some(
			(name) => name.textContent?.trim() === "Vassal 01",
		), "Unsupported title did not preserve the plain character name");
		const list = element<HTMLUListElement>(
			'[aria-label="Allegiance relationships"]',
		);
		require(list.scrollHeight >
			list.clientHeight, "Vassal list was not capped and scrollable");
		const assertTreeAlignment = () => {
			for (const row of list.querySelectorAll<HTMLElement>("li")) {
				const icon = row.querySelector<HTMLElement>(".ui-presence");
				if (icon === null)
					throw new Error("Missing relationship presence icon");
				const bounds = row.getBoundingClientRect();
				const iconBounds = icon.getBoundingClientRect();
				const name = row.querySelector<HTMLElement>(".ui-list-name");
				if (name === null) throw new Error("Missing relationship name");
				for (const detail of row.querySelectorAll<HTMLElement>(
					".member-info > .ui-muted",
				))
					require(Math.abs(
						detail.getBoundingClientRect().left -
							name.getBoundingClientRect().left,
					) <
						1, "Relationship details did not align with the name clear of the tree stem");

				if (row.classList.contains("relationship-child")) {
					const branch = getComputedStyle(row, "::after");
					require(Math.abs(
						bounds.top +
							parseFloat(branch.top) -
							(iconBounds.top + iconBounds.height / 2),
					) < 1, "Tree branch did not meet the presence icon vertically");
					require(Math.abs(
						bounds.left +
							parseFloat(branch.left) +
							parseFloat(branch.width) -
							iconBounds.left,
					) < 1, "Tree branch did not meet the presence icon horizontally");
				}
				const stem = row.querySelector<HTMLElement>(".relationship-stem");
				if (stem !== null)
					require(Math.abs(
						stem.getBoundingClientRect().left -
							(iconBounds.left + iconBounds.width / 2),
					) < 1, "Parent stem did not align with the presence icon");
			}
		};
		assertTreeAlignment();
		const tab = element<HTMLElement>("#social-allegiance-panel");
		require(tab.scrollHeight >
			tab.clientHeight, "Allegiance tab did not scroll within the window");
		const assertDepth = (selector: string, depth: number) =>
			require(element<HTMLElement>(selector).style.getPropertyValue(
				"--relationship-depth",
			) === String(depth), `Unexpected relationship depth for ${selector}`);
		assertDepth('li[data-relationship="patron"]', 0);
		assertDepth("li.self", 1);
		assertDepth('li[data-relationship="vassal"]', 2);
		// Exercise independent density changes, rather than only scaling the default tree.
		const density = {
			"--ui-inset-padding": "11px",
			"--ui-list-row-padding-block": "13px",
			"--ui-list-row-gap": "12px",
			"--ui-list-detail-gap": "7px",
			"--ui-list-icon-gap": "9px",
			"--ui-presence-size": "20px",
			"--ui-list-tree-indent": "28px",
			"--ui-icon-action-gap": "10px",
			"--ui-icon-action-size": "34px",
			"--ui-icon-action-padding": "5px",
		};
		for (const [token, value] of Object.entries(density))
			target.style.setProperty(token, value);
		await settle();
		const themedRow = element<HTMLElement>('li[data-relationship="vassal"]');
		require(getComputedStyle(themedRow).paddingTop === "13px" &&
			getComputedStyle(themedRow).columnGap ===
				"12px", "Management row ignored themed density");
		require(getComputedStyle(element(".ui-inset")).paddingTop ===
			"11px", "Management inset ignored themed padding");
		require(getComputedStyle(element(".ui-presence")).width ===
			"20px", "Presence marker ignored themed size");
		require(getComputedStyle(element(".member-info")).rowGap === "7px" &&
			getComputedStyle(element(".member-info")).columnGap ===
				"9px", "Relationship details ignored themed spacing");
		require(getComputedStyle(element(".ui-icon-actions")).columnGap ===
			"10px" &&
			getComputedStyle(element(".ui-icon-actions .ui-icon-button")).width ===
				"34px" &&
			getComputedStyle(element(".ui-icon-actions .ui-icon-button"))
				.paddingTop === "5px", "Management actions ignored themed sizing");
		assertTreeAlignment();
		// Actions can be taller than the member details without shifting the branches.
		target.style.setProperty("--ui-icon-action-size", "64px");
		await settle();
		assertTreeAlignment();
		target.style.setProperty(
			"--ui-icon-action-size",
			density["--ui-icon-action-size"],
		);
		emit("client-allegiance-updated", {
			allegiance: {
				...baseline,
				profile: { ...profile, monarch: member(9, "Monarch") },
				canSwear: false,
			},
		});
		await settle();
		require(target.querySelector(".ancestry-marker") !==
			null, "Undisclosed ancestry was rendered as a direct link");
		assertDepth('li[data-relationship="patron"]', 1);
		assertDepth("li.self", 2);
		assertDepth('li[data-relationship="vassal"]', 3);
		assertTreeAlignment();
		for (const token of Object.keys(density))
			target.style.removeProperty(token);
		await settle();
		assertTreeAlignment();
		emit("client-allegiance-updated", {
			allegiance: {
				...baseline,
				profile: { ...profile, monarch: profile.selfMember, patron: null },
				canSwear: true,
			},
		});
		await settle();
		require(element("li.self").textContent?.includes(
			"You / Monarch",
		), "Self monarch roles were not grouped");
		assertDepth("li.self", 0);
		assertDepth('li[data-relationship="vassal"]', 1);
		emit("client-allegiance-updated", {
			allegiance: { ...baseline, profile, canSwear: false },
		});
		await settle();
		click("Dismiss Amy as vassal");
		await settle();
		require(element<HTMLDialogElement>(".client-allegiance-break-dialog")
			.open, "Vassal review did not use the modal shell");
		const withoutAmy = {
			...profile,
			directVassals: profile.directVassals.filter(
				(member) => member.name !== "Amy",
			),
		};
		emit("client-allegiance-updated", {
			allegiance: { ...baseline, profile: withoutAmy, canSwear: false },
		});
		await settle();
		require(target.querySelector(".client-allegiance-break-dialog") ===
			null, "Stale relationship review survived replacement");
		require(actions().length === 1, "Stale review dispatched a mutation");
		emit("client-allegiance-updated", {
			allegiance: { ...baseline, profile, canSwear: false },
		});
		await settle();
		click("Dismiss Amy as vassal");
		await settle();
		click("Dismiss vassal");
		await settle();
		require(session.allegiance.read().snapshot?.profile?.directVassals
			.length === 24, "Queue acceptance removed authoritative vassal facts");
		click("Break allegiance with Patron");
		await settle();
		click("Break allegiance");
		await settle();
		const toggle = element<HTMLInputElement>(
			'#social-allegiance-panel input[type="checkbox"]',
		);
		toggle.checked = true;
		toggle.dispatchEvent(new Event("change", { bubbles: true }));
		await settle();
		emit("client-character-preferences-updated", {
			...preferences,
			allegiance: { showLogons: true },
		});
		await settle();
		require(toggle.checked, "Presence preference was not mirrored");
		element<HTMLButtonElement>("#social-friends-tab").click();
		await settle();
		element<HTMLButtonElement>("#social-allegiance-tab").click();
		await settle();
		emit("client-allegiance-updated", {
			allegiance: { ...baseline, profile, refreshing: true, canSwear: false },
		});
		await settle();
		require(element('[aria-label="Allegiance summary"]').textContent?.includes(
			"Test allegiance",
		), "Refresh erased the last profile");
		emit("client-allegiance-updated", {
			allegiance: { ...baseline, profile, canSwear: false },
		});
		await settle();
		if (component !== null) await unmount(component);
		component = null;
		const beforeReopen = actions().length;
		await open();
		require(actions().length ===
			beforeReopen + 1, "Reopening did not refresh the retained profile");
		emit("client-allegiance-updated", {
			allegiance: {
				...baseline,
				profile: {
					...profile,
					name: "",
					monarch: null,
					patron: null,
					selfMember: null,
					directVassals: [],
					totalMembers: 0,
					totalDescendants: 0,
				},
			},
		});
		await settle();
		hud = mount(ClientSelectedEntityHud, {
			target,
			context,
			props: {
				input: INPUT_DEFAULTS,
				displayPlatform: "unknown",
				selectedGuid: patron.guid,
				readSelectedDisplay: () => ({
					...EMPTY_CLIENT_SELECTED_DISPLAY,
					name: patron.name,
				}),
				readCanSplit: () => false,
				readCanInvite: () => false,
				readCanAddFriend: () => false,
				readCanIgnoreAccount: () => false,
				onAddFriend: () => {},
				onIgnoreAccount: () => {},
				onInvite: () => {},
				readCanCorpsePermission: () => false,
				onCorpsePermission: () => {},
				readCanSwear: () => session.allegiance.canSwear(patron.guid),
				onSwear: () => {
					void session.allegiance.request({ kind: "swear", guid: patron.guid });
				},
				onInteract: () => {},
				onExamine: () => {},
				examinePending: false,
				onSplit: () => {},
			},
		});
		await settle();
		click("Swear allegiance");
		await settle();
		const expected = [
			{ kind: "refresh" },
			{ kind: "break", guid: 100 },
			{ kind: "break", guid: patron.guid },
			{ kind: "showLogons", enabled: true },
			{ kind: "refresh" },
			{ kind: "refresh" },
			{ kind: "swear", guid: patron.guid },
		];
		require(JSON.stringify(actions()) ===
			JSON.stringify(
				expected,
			), `Allegiance controls dispatched unexpected actions: ${JSON.stringify(actions())}`);
		return {
			passed: true,
			commandCount: actions().length,
			remounts: 2,
			partialRoles: true,
			relationshipTree: true,
			branchAlignment: true,
			themedDensity: true,
			staleReviewRetired: true,
			retainedRefreshFacts: true,
			tabScroll: true,
			cappedVassals: true,
			selectedHudSwear: true,
		};
	} finally {
		if (hud !== null) await unmount(hud);
		if (component !== null) await unmount(component);
		party.destroy();
		target.remove();
	}
}
