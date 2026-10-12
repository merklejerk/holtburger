import { mount, tick, unmount } from "svelte";
import ClientSocialPanel from "../../client/ClientSocialPanel.svelte";
import { ClientPartyState } from "../../client/client-party-state";
import type { ClientLifecycleSession } from "../../client/client-lifecycle-session";

/** Synthetic facts through real session decoding, components, focus, and transport callbacks. */
export async function probeFriends(options: {
	readonly session: ClientLifecycleSession;
	readonly context: Map<unknown, unknown>;
	readonly emit: (event: string, payload: unknown) => void;
	readonly commands: readonly {
		readonly command: string;
		readonly args: Record<string, unknown> | undefined;
	}[];
}) {
	const { session, emit, commands, context } = options;
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
	const baseline = {
		members: [
			{ guid: 10, name: "Amy", online: false },
			{ guid: 11, name: "Ben", online: true },
		],
	};
	const require = (condition: unknown, message: string) => {
		if (!condition) throw new Error(message);
	};
	const settle = async () => {
		await tick();
		await new Promise((resolve) => setTimeout(resolve, 0));
		await tick();
	};
	function button(label: string): HTMLButtonElement {
		const element = target.querySelector<HTMLButtonElement>(
			`button[aria-label="${label}"]`,
		);
		if (element === null) throw new Error(`Missing button: ${label}`);
		return element;
	}
	function input(label: string): HTMLInputElement {
		const element = target.querySelector<HTMLInputElement>(
			`input[aria-label="${label}"]`,
		);
		if (element === null) throw new Error(`Missing input: ${label}`);
		return element;
	}
	const type = (label: string, value: string) => {
		const element = input(label);
		element.value = value;
		element.dispatchEvent(new Event("input", { bubbles: true }));
	};
	const start = commands.length;
	let component: ReturnType<typeof mount> | null = null;
	try {
		emit("client-friends-updated", { friends: baseline });
		emit("client-character-preferences-updated", {
			appearance: { showHelmet: true, showCloak: true },
			party: { shareXp: true, shareLoot: false, ignoreRequests: false },
			friends: { appearOffline: false },
			allegiance: { showLogons: false },
		});
		for (let pass = 0; pass < 2; pass++) {
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
			const tab = target.querySelector<HTMLButtonElement>(
				"#social-friends-tab",
			);
			if (tab === null) throw new Error("Missing Friends tab");
			tab.click();
			await settle();
			const rows = Array.from(
				target.querySelectorAll('[aria-label="Friends"] li'),
			);
			require(rows[0]?.textContent?.includes(
				"Ben",
			), "Friends were not online-first after mounting");
			if (pass === 1) {
				require(!target.textContent?.includes(
					"Adding…",
				), "Confirmed admin friend retained pending markup");
				break;
			}
			type("Friend name", "Cara");
			target
				.querySelector<HTMLFormElement>(".add-friend")
				?.dispatchEvent(
					new Event("submit", { bubbles: true, cancelable: true }),
				);
			await settle();
			require(session.friends.read().pending?.kind ===
				"add", "Queue acceptance falsely settled friend add");
			await unmount(component);
			component = null;
			emit("client-friends-updated", {
				friends: {
					members: [
						...baseline.members,
						{ guid: 12, name: "+Cara", online: false },
					],
				},
			});
			require(session.friends.read().pending ===
				null, "Unmount lost add settlement");
		}
		type("Search friends", "amy");
		await settle();
		require(target.querySelectorAll('[aria-label="Friends"] li').length ===
			1, "Search did not filter roster");
		require(button("Tell Amy").disabled, "Deferred Tell action was enabled");
		type("Search friends", "");
		await settle();
		require(target.querySelector(
			'[role="img"][aria-label="Online"] svg',
		), "Online presence icon missing");
		require(target.querySelector(
			'[role="img"][aria-label="Offline"] svg',
		), "Offline presence icon missing");
		button("Remove Amy from friends").click();
		await settle();
		require(target.textContent?.includes(
			"Removing",
		), "Removal erased facts before server evidence");
		emit("client-friends-updated", {
			friends: { members: [baseline.members[1]] },
		});
		await settle();
		require(!target.querySelector(
			'[aria-label="Tell Amy"]',
		), "Removal update did not reconcile roster");
		return {
			passed: true,
			remounts: 2,
			commandCount: commands.slice(start).length,
			presenceIcons: true,
		};
	} finally {
		if (component !== null) await unmount(component);
		party.destroy();
		target.remove();
	}
}
