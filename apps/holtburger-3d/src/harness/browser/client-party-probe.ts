import { INPUT_DEFAULTS } from "../../lib/input/input-defaults";
import { mount, tick, unmount } from "svelte";
import { probeDialogBackdrops } from "./client-dialog-backdrop-probe";
import ClientSelectedEntityHud from "../../client/ClientSelectedEntityHud.svelte";
import { EMPTY_CLIENT_SELECTED_DISPLAY } from "../../client/client-selected-entity-tracking";
import { CLIENT_TUNING } from "../../client/client-tuning";
import ClientSocialPanel from "../../client/ClientSocialPanel.svelte";
import type { PartySnapshot } from "../../client/client-party-contract";
import { CLIENT_UI_DEFAULTS } from "../../client/client-ui-defaults";
import {
	ClientPartyState,
	PARTY_DISPLAY_INTERVAL_MS,
} from "../../client/client-party-state";
import type { ClientLifecycleSession } from "../../client/client-lifecycle-session";

/** Full-roster browser scenario; production capacity is owned by world. */
const SCENARIO_MEMBER_COUNT = 9;

/** Real browser component lifetime and strict session events with synthetic server facts. */
export async function probeParty(options: {
	readonly session: ClientLifecycleSession;
	/** Exercise the same target selection owner as the application. */
	readonly onSelectEntity: (guid: number) => void;
	/** Observe the accepted target after clicks settle through the production owner. */
	readonly selectedGuid: () => number | null;
	/** Production input policy inherited by explicitly mounted probe components. */
	readonly context: Map<unknown, unknown>;
	readonly emit: (event: string, payload: unknown) => void;
	readonly commands: readonly {
		readonly command: string;
		readonly args: Record<string, unknown> | undefined;
	}[];
}) {
	const { session, emit, commands } = options;
	const failures: string[] = [];
	const notices: string[] = [];
	const owner = new ClientPartyState(
		session,
		(message) => failures.push(message),
		(message) => notices.push(message),
	);
	const target = document.createElement("div");
	target.className = "ui-theme";
	// Match the constrained, clipping window body rather than an unconstrained document mount.
	target.style.width = `${CLIENT_UI_DEFAULTS.social.minSize.width}px`;
	target.style.height = `${CLIENT_UI_DEFAULTS.social.minSize.height}px`;
	target.style.overflow = "hidden";
	document.body.append(target);
	const start = commands.length;
	const party: PartySnapshot = {
		name: "Browser Raid",
		leader: 1,
		shareXp: true,
		evenShare: true,
		open: false,
		locked: false,
		capabilities: {
			isLeader: true,
			canRecruit: false,
			canChangeOpenness: true,
		},
		members: Array.from(
			{ length: SCENARIO_MEMBER_COUNT },
			(_, index) => index + 1,
		)
			.reverse()
			.map((guid) => ({
				guid,
				name: `Player ${guid}`,
				level: 15,
				canManage: guid !== 1,
				vitals: [10, 11, 12, 20, 21, 22],
			})),
	};
	// Explicit host outputs let the browser verify consumption without replicating game rules.
	const memberParty: PartySnapshot = {
		...party,
		leader: 2,
		capabilities: {
			isLeader: false,
			canRecruit: false,
			canChangeOpenness: false,
		},
		members: party.members.map((member) => ({ ...member, canManage: false })),
	};
	const require = (condition: boolean, message: string) => {
		if (!condition) throw new Error(message);
	};
	const settle = async () => {
		await tick();
		await new Promise((resolve) =>
			setTimeout(
				resolve,
				Math.max(
					PARTY_DISPLAY_INTERVAL_MS,
					CLIENT_TUNING.selectedEntityHud.displayIntervalMs,
				) * 2,
			),
		);
	};
	const hudTarget = document.createElement("div");
	hudTarget.className = "ui-theme";
	document.body.append(hudTarget);
	const hud = mount(ClientSelectedEntityHud, {
		target: hudTarget,
		context: options.context,
		props: {
			input: INPUT_DEFAULTS,
			displayPlatform: "unknown",
			selectedGuid: 10,
			readSelectedDisplay: () => ({
				...EMPTY_CLIENT_SELECTED_DISPLAY,
				name: "Invite target",
				interactionLabel: "Trade",
				canInteract: true,
			}),
			readCanSalvage: () => false,
			onSalvage: () => {},
			readCanSplit: () => false,
			readCanCorpsePermission: () => false,
			onCorpsePermission: () => {},
			readCanSwear: () => false,
			onSwear: () => {},
			readCanInvite: () => owner.canInvite(10),
			readCanAddFriend: () => false,
			readCanIgnoreAccount: () => false,
			onAddFriend: () => {},
			onIgnoreAccount: () => {},
			onInvite: () => {
				if (owner.canInvite(10)) owner.request({ kind: "invite", target: 10 });
			},
			onInteract: () => {},
			onExamine: () => {},
			examinePending: false,
			onSplit: () => {},
		},
	});
	const inviteButton = async () => {
		const menu = hudTarget.querySelector<HTMLButtonElement>(
			'[aria-label="Selected entity actions"][aria-haspopup="menu"]',
		);
		if (menu !== null && menu.getAttribute("aria-expanded") !== "true") {
			menu.click();
			await tick();
		}
		return (
			hudTarget.querySelector<HTMLButtonElement>(
				'[aria-label="Invite to party"]',
			) ??
			[
				...hudTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
			].find((button) => button.textContent?.trim() === "Invite to party") ??
			null
		);
	};

	let component: ReturnType<typeof mount> | null = null;
	try {
		emit("client-party-updated", { party });
		emit("client-character-preferences-updated", {
			appearance: { showHelmet: true, showCloak: true },
			party: { shareXp: true, shareLoot: false, ignoreRequests: false },
			friends: { appearOffline: false },
			allegiance: { showLogons: false },
		});
		for (let attempt = 0; attempt < 2; attempt++) {
			component = mount(ClientSocialPanel, {
				context: options.context,
				target,
				props: {
					owner,
					onSelectEntity: options.onSelectEntity,
					friends: session.friends,
					squelch: session.squelch,
					allegiance: session.allegiance,
				},
			});
			await settle();
			require(target.textContent?.includes("Browser Raid") ===
				true, "Remount did not recover retained party");
			require(target.querySelector('dl[aria-label="Party summary"] dt')
				?.textContent === "Party name", "Missing labeled party summary");
			require(target.querySelector("details summary")?.textContent ===
				"Roster", "Missing roster subsection");
			require(target.querySelector(".party-roster li strong")?.textContent ===
				"Player 1 (you)", "Roster was not sorted by name");
			require(hudTarget.querySelector('[aria-label="Trade"] svg') !== null &&
				hudTarget.querySelector('[aria-label="Trade"]')?.textContent?.trim() ===
					"", "Trade was not an icon button");

			const selectMember = (guid: number) => {
				const button = target.querySelector<HTMLButtonElement>(
					`[aria-label="Select Player ${guid}"]`,
				);
				if (button === null) throw new Error("Missing roster selection button");
				button.click();
			};
			selectMember(7);
			await settle();
			require(options.selectedGuid() ===
				7, "Roster click did not select a known teammate");
			selectMember(2);
			await settle();
			require(options.selectedGuid() ===
				7, "Unknown roster target displaced the known selection");
			selectMember(1);
			await settle();
			require(options.selectedGuid() === 1, "Roster click did not select self");

			const readOpenness = () => {
				const input = [...target.querySelectorAll("label")]
					.find((label) =>
						label.textContent?.includes("Allow members to invite"),
					)
					?.querySelector("input");
				if (input === null || input === undefined)
					throw new Error("Missing openness control");
				return input;
			};
			if (attempt === 0) {
				const leave = [
					...target.querySelectorAll<HTMLButtonElement>("button"),
				].find((button) => button.textContent?.trim() === "Leave party");
				if (leave === undefined) throw new Error("Missing leave button");
				leave.click();
				await tick();
				const handoffDialog =
					document.querySelector<HTMLDialogElement>("dialog[open]");
				require(handoffDialog?.querySelector("select") ===
					document.activeElement, "Handoff did not focus successor choice");
				require(owner.question() ===
					null, "Leave opened an extra confirmation");
				const cancelHandoff = [
					...(handoffDialog?.querySelectorAll<HTMLButtonElement>("button") ??
						[]),
				].find((button) => button.textContent === "Cancel");
				if (cancelHandoff === undefined)
					throw new Error("Missing handoff cancellation");
				cancelHandoff.click();
				await tick();

				const beforeStaleHandoff = commands.length;
				leave.click();
				await tick();
				emit("client-party-updated", { party: memberParty });
				await settle();
				require(document.querySelector("dialog[open]") ===
					null, "Changed leadership retained the handoff draft");
				require(commands
					.slice(beforeStaleHandoff)
					.every(
						(call) => call.command !== "submit_client_party",
					), "Retiring the handoff sent commands");
				emit("client-party-updated", { party });
				await settle();

				const panel = target.querySelector<HTMLDivElement>(
					"#social-party-panel",
				);
				const tabs = target.querySelector<HTMLDivElement>('[role="tablist"]');
				const invitations = target.querySelector<HTMLInputElement>(
					'[aria-label="Invitation preferences"] input',
				);
				if (panel === null || tabs === null || invitations === null)
					throw new Error("Missing tab scroll fixture");
				require(panel.scrollHeight > panel.clientHeight &&
					getComputedStyle(panel).overflowY ===
						"auto", "Small Social window clipped its tab content instead of scrolling");
				const tabsTop = tabs.getBoundingClientRect().top;
				panel.scrollTop = panel.scrollHeight;
				await tick();
				const viewport = panel.getBoundingClientRect();
				const preference = invitations.getBoundingClientRect();
				require(panel.scrollTop > 0 &&
					preference.top >= viewport.top &&
					preference.bottom <=
						viewport.bottom, "Scrolling did not bring Invitations into the tab viewport");
				require(tabs.getBoundingClientRect().top ===
					tabsTop, "Content scrolling moved the Social tabs");
				panel.scrollTop = 0;
				require((await inviteButton()) ===
					null, "Full party retained HUD recruitment");
				const roster = target.querySelector<HTMLUListElement>(
					'[aria-label="Party members"]',
				);
				if (roster === null) throw new Error("Missing party roster");
				require(roster.scrollHeight > roster.clientHeight &&
					getComputedStyle(roster).overflowY ===
						"auto", "Full party roster did not scroll within its height cap");
				const promote = roster.querySelector<HTMLButtonElement>(
					'[aria-label="Make Player 2 party leader"]',
				);
				const dismiss = roster.querySelector<HTMLButtonElement>(
					'[aria-label="Dismiss Player 2 from party"]',
				);
				if (promote === null || dismiss === null)
					throw new Error("Missing member action icons");
				dismiss.click();
				const question = owner.question();
				if (question === null)
					throw new Error("Row dismissal skipped confirmation");
				require(question.text.includes(
					"Player 2",
				), "Row dismissal targeted another member");
				owner.respond(question.requestId, false);
				promote.click();
				await settle();
				require(options.selectedGuid() ===
					1, "Roster management changed target selection");
				const promotion = commands.findLast(
					(call) => call.command === "submit_client_party",
				);
				require(JSON.stringify(promotion?.args?.action) ===
					JSON.stringify({
						kind: "promote",
						target: 2,
					}), "Row leadership action targeted another member");
				require(owner.read()
					.pending, "Promotion queue acceptance claimed authority");
				require(promote.isConnected &&
					promote.disabled, "Pending promotion lost its temporarily disabled action");
				require(roster
					.querySelector('[aria-label="Party leader"]')
					?.closest("li")
					?.querySelector("strong")
					?.textContent?.trim() ===
					"Player 1 (you)", "Pending promotion moved the leader marker before authority");
				emit("client-party-updated", { party: memberParty });
				await settle();
				require(roster
					.querySelector('[aria-label="Party leader"]')
					?.closest("li")
					?.querySelector("strong")
					?.textContent?.trim() ===
					"Player 2", "Leader marker did not follow authoritative promotion");
				require(roster.querySelector(".ui-icon-actions button") ===
					null, "Nonleader retained roster management actions");
				require(!target.textContent?.includes("Disband") &&
					!target.textContent?.includes("Allow members to invite") &&
					(await inviteButton()) ===
						null, "Closed-party member retained unauthorized management controls");
				require(target.textContent?.includes("Leave party") ===
					true, "Member lost the permitted leave action");
				emit("client-party-updated", {
					party: {
						...memberParty,
						open: true,
						capabilities: { ...memberParty.capabilities, canRecruit: true },
						members: memberParty.members.filter(
							(member) => member.guid !== SCENARIO_MEMBER_COUNT,
						),
					},
				});
				await settle();
				require((await inviteButton()) !==
					null, "Open-party member lost HUD recruitment");
				emit("client-party-updated", {
					party: {
						...party,
						locked: true,
						capabilities: {
							isLeader: true,
							canRecruit: true,
							canChangeOpenness: false,
						},
						members: party.members.filter(
							(member) => member.guid !== SCENARIO_MEMBER_COUNT,
						),
					},
				});
				await settle();
				require(!target.textContent?.includes(
					"Allow members to invite",
				), "Locked party exposed a forbidden openness change");
				require((await inviteButton()) !==
					null, "Locked party lost the server-controlled HUD rejoin path");
				emit("client-party-updated", {
					party: { ...memberParty, leader: null },
				});
				await settle();
				require(roster.querySelector(".ui-icon-actions button") === null &&
					!target.textContent?.includes("Disband") &&
					!target.textContent?.includes(
						"Allow members to invite",
					), "Unknown leadership exposed leader-only management");
				emit("client-party-updated", { party });
				await settle();
				const openness = readOpenness();
				openness.checked = true;
				openness.dispatchEvent(new Event("change", { bubbles: true }));
				await tick();
				require(owner.read()
					.pending, "Queue acceptance incorrectly settled openness");
				await unmount(component);
				component = null;
				emit("client-party-updated", { party: { ...party, open: true } });
				require(!owner.read().pending, "Unmount lost authoritative settlement");
			} else {
				require(readOpenness()
					.checked, "Reopened markup did not recover updated openness");
				await unmount(component);
				component = null;
			}
		}
		emit("client-party-updated", { party: null });
		component = mount(ClientSocialPanel, {
			target,
			context: options.context,
			props: {
				owner,
				onSelectEntity: options.onSelectEntity,
				friends: session.friends,
				squelch: session.squelch,
				allegiance: session.allegiance,
			},
		});
		await settle();
		const create = [
			...target.querySelectorAll<HTMLButtonElement>("button"),
		].find((button) => button.textContent?.trim() === "Create Party");
		if (create === undefined)
			throw new Error("Missing Create Party entry button");
		require(target.querySelector(
			'#social-party-panel input:not([type="checkbox"])',
		) === null, "Empty party leaked inline creation settings");
		require(target
			.querySelector('[role="tab"][aria-selected="true"]')
			?.classList.contains("ui-tab") ===
			true, "Social did not reuse shared tab styling");
		require(target.textContent?.includes("Ignore party invitations") ===
			true, "Empty party hid the character invitation preference");
		const partyTab =
			target.querySelector<HTMLButtonElement>("#social-party-tab");
		if (partyTab === null) throw new Error("Missing Party tab");
		partyTab.focus();
		create.click();
		await tick();
		const dialog = document.querySelector<HTMLDialogElement>(
			".client-party-create-dialog",
		);
		if (dialog === null) throw new Error("Creation modal did not open");
		require(dialog.matches(
			":modal",
		), "Creation did not acquire native modality");
		require(dialog.querySelector<HTMLButtonElement>('button[type="submit"]')
			?.disabled === true, "Blank creation name accepted");
		const beforeCancel = commands.length;
		dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
		await tick();
		require(document.querySelector(".client-party-create-dialog") ===
			null, "Cancel did not retire modal");
		require(commands.length === beforeCancel, "Cancel mutated party settings");
		create.click();
		await tick();
		const form = document.querySelector<HTMLFormElement>(
			".client-party-create-dialog form",
		);
		if (form === null) throw new Error("Missing creation form");
		const name = form.querySelector<HTMLInputElement>(
			'input:not([type="checkbox"])',
		);
		if (name === null) throw new Error("Missing party name input");
		require(document.activeElement ===
			name, "Creation did not focus the name input");
		name.value = "New Browser Raid";
		name.dispatchEvent(new Event("input", { bubbles: true }));
		const sharing = [
			...form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
		];
		require(sharing.length === 2, "Creation must expose XP and loot settings");
		for (const checkbox of sharing) {
			checkbox.checked = !checkbox.checked;
			checkbox.dispatchEvent(new Event("change", { bubbles: true }));
		}
		await tick();
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await settle();
		const creation = commands
			.slice(beforeCancel)
			.filter((call) => call.command === "submit_client_party")
			.map((call) => call.args?.action);
		require(JSON.stringify(creation) ===
			JSON.stringify([
				{ kind: "shareXp", enabled: false },
				{ kind: "shareLoot", enabled: true },
				{ kind: "create", name: "New Browser Raid" },
			]), "Creation settings were not queued before create");
		require(owner.read()
			.pending, "Create queue acceptance incorrectly claimed membership");
		emit("client-party-updated", {
			party: { ...party, name: "New Browser Raid", shareXp: false },
		});
		await settle();
		require(!owner.read()
			.pending, "Created roster did not settle pending presentation");
		require(!target.textContent?.includes(
			"Share XP and luminance",
		), "Active tab leaked creation-only preferences");
		const leaveButton = [
			...target.querySelectorAll<HTMLButtonElement>("button"),
		].find((button) => button.textContent?.trim() === "Leave party");
		if (leaveButton === undefined) throw new Error("Missing leader exit");
		leaveButton.click();
		await tick();
		const handoffDialog =
			document.querySelector<HTMLDialogElement>("dialog[open]");
		const successor = handoffDialog?.querySelector("select");
		const handoffForm = handoffDialog?.querySelector("form");
		if (
			successor === null ||
			successor === undefined ||
			handoffForm === null ||
			handoffForm === undefined
		)
			throw new Error("Missing successor form");
		successor.value = "2";
		successor.dispatchEvent(new Event("change", { bubbles: true }));
		await tick();
		const beforeHandoff = commands.length;
		handoffForm.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
		await settle();
		require(JSON.stringify(
			commands
				.slice(beforeHandoff)
				.filter((call) => call.command === "submit_client_party")
				.map((call) => call.args?.action),
		) ===
			JSON.stringify([
				{ kind: "promote", target: 2 },
				{ kind: "leave" },
			]), "Handoff did not queue promotion then leave");
		emit("client-party-updated", { party: null });
		await settle();
		emit("client-party-updated", {
			party: {
				...memberParty,
				open: true,
				capabilities: { ...memberParty.capabilities, canRecruit: true },
				members: memberParty.members.filter(
					(member) => member.guid !== SCENARIO_MEMBER_COUNT,
				),
			},
		});
		await settle();
		const memberLeave = [
			...target.querySelectorAll<HTMLButtonElement>("button"),
		].find((button) => button.textContent?.trim() === "Leave party");
		if (memberLeave === undefined) throw new Error("Missing member exit");
		memberLeave.click();
		await settle();
		require(document.querySelector("dialog[open]") === null &&
			owner.question() === null, "Member exit required confirmation");
		emit("client-party-updated", { party: null });
		await settle();
		emit("client-party-updated", {
			party: {
				...party,
				open: true,
				capabilities: { ...party.capabilities, canRecruit: true },
				members: party.members.filter(
					(member) => member.guid !== SCENARIO_MEMBER_COUNT,
				),
			},
		});
		await settle();

		const closeStart = commands.length;
		await unmount(component);
		component = null;
		await settle();
		require(!commands
			.slice(closeStart)
			.some(
				(call) =>
					call.command === "set_client_party_updates" &&
					call.args?.enabled === false,
			), "Closing Social disabled the active combat HUD subscription");
		const hudInvite = await inviteButton();
		if (hudInvite === null)
			throw new Error("HUD lost invitation when Social closed");
		hudInvite.click();
		await settle();
		require(JSON.stringify(notices) ===
			JSON.stringify([
				"Party invitation sent.",
			]), "HUD invitation did not report submission exactly once");

		emit("client-party-updated", { party: null });
		await settle();
		const calls = commands.slice(start);
		require(calls.filter((call) => call.command === "submit_client_party")
			.length === 9, "DOM actions did not dispatch exactly once");
		const demand = calls
			.filter((call) => call.command === "set_client_party_updates")
			.map((call) => call.args?.enabled);
		require(demand.includes(true) &&
			demand.at(-1) ===
				false, "Party updates did not retire after both HUD and Social released demand");
		require(failures.length === 0, `Party failures: ${failures.join(", ")}`);
		return {
			passed: true,
			demand,
			actionCount: 9,
			remounts: 3,
			creationModal: true,
			invitationNotice: notices[0],
			modalBackdrops: await probeDialogBackdrops(options.context),
		};
	} finally {
		if (component !== null) await unmount(component);
		await unmount(hud);
		hudTarget.remove();
		owner.destroy();
		target.remove();
	}
}
