import { mount, tick, unmount } from "svelte";
import ClientEntityChatTag from "../../client/ClientEntityChatTag.svelte";
import ClientWaypointText from "../../client/ClientWaypointText.svelte";

/** Isolated native-selection surface using the real entity and coordinate link wrappers. */
export async function mountInlineTagFixture() {
	const root = document.createElement("div");
	root.popover = "manual";
	Object.assign(root.style, {
		position: "fixed",
		inset: "80px auto auto 80px",
		margin: "0",
		padding: "24px",
		background: "#111",
		color: "#fff",
		font: "20px monospace",
		userSelect: "text",
	});
	const history = document.querySelector(".chat-buffer");
	if (history === null)
		throw new Error("Inline selection fixture requires the chat input scope");
	history.append(root);
	const counts = { entity: 0, coordinates: 0 };
	const target = (kind: string) => {
		const element = document.createElement("div");
		element.dataset.inlineTagProbe = kind;
		element.style.padding = "12px";
		element.append(document.createTextNode("Link: "));
		root.append(element);
		return element;
	};
	const entity = mount(ClientEntityChatTag, {
		target: target("entity"),
		props: {
			guid: 7,
			text: "Gold Golem",
			interactive: true,
			onSelectEntity: () => {
				counts.entity++;
			},
		},
	});
	const coordinates = mount(ClientWaypointText, {
		target: target("coordinates"),
		props: {
			text: "12.3N, 45.6E",
			interactive: true,
			onSetWaypoint: () => {
				counts.coordinates++;
			},
		},
	});
	await tick();
	root.showPopover();
	return {
		read: () => ({ ...counts }),
		cleanup: async () => {
			await unmount(entity);
			await unmount(coordinates);
			root.remove();
		},
	};
}
