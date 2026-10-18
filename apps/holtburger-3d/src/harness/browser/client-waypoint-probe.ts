import { tick } from "svelte";
import type { MinimapFrame } from "../../app/minimap-frame";
import type {
	ClientChatMessage,
	ClientLifecycle,
} from "../../client/client-host-contract";
import { CLIENT_WAYPOINT_NEAR_RADIUS_METERS } from "../../client/client-tuning";

/** Synthetic placement controls for production navigation intent and real map components. */
export interface WaypointProbeControls {
	readonly enable: () => void;
	readonly chat: (message: string) => void;
	readonly player: (
		x: number,
		z: number,
		heading: number,
		camera: number,
		indoor: boolean,
		available: boolean,
	) => void;
	readonly character: (guid: number | null) => void;
	readonly lifecycle: (lifecycle: ClientLifecycle) => void;
	readonly placeAtBottom: () => void;
	readonly read: () => {
		readonly frame: MinimapFrame;
		readonly messages: readonly ClientChatMessage[];
		/** Status notifications let selection checks detect accidental activation. */
		readonly notices: readonly string[];
		readonly sent: readonly string[];
		readonly gameActive: boolean;
		/** Actual UI sent history; content links must leave it untouched. */
		readonly history: readonly string[];
	};
}

/** Assert browser behavior and geometry; appearance remains subject to user acceptance. */
export async function probeClientWaypoint(controls: WaypointProbeControls) {
	let assertions = 0;
	const assert = (condition: boolean, message: string) => {
		assertions++;
		if (!condition) throw new Error(message);
	};
	const node = <T extends Element>(selector: string): T => {
		const value = document.querySelector<T>(selector);
		if (value === null) throw new Error(`Waypoint probe missing ${selector}`);
		return value;
	};
	const settle = async () => {
		await tick();
		await new Promise((resolve) => setTimeout(resolve, 100));
	};
	const visible = (selector: string) =>
		getComputedStyle(node(selector)).display !== "none";
	const pointer = () =>
		node(".minimap-waypoint-pointer").getAttribute("transform");
	const row = () => node<HTMLButtonElement>(".minimap-waypoint-row");
	const marker = () => node<SVGGElement>(".world-waypoint-target");
	const click = async (selector: string) => {
		node<HTMLButtonElement>(selector).click();
		await settle();
	};
	const move = async (
		dx: number,
		dz: number,
		heading = 0,
		camera = 0,
		indoor = false,
		available = true,
	) => {
		const display = controls.read().frame.waypoint;
		if (display === null) throw new Error("Waypoint fixture requires a target");
		controls.player(
			display.target.position.x + dx,
			display.target.position.z + dz,
			heading,
			camera,
			indoor,
			available,
		);
		await settle();
	};
	const submit = async (message: string) => {
		const input = node<HTMLInputElement>('[aria-label="Chat message"]');
		input.value = message;
		input.dispatchEvent(new Event("input", { bubbles: true }));
		input.form?.requestSubmit();
		await settle();
	};
	controls.enable();
	await submit("@wp 42.0N, 33.5E");
	assert(
		controls.read().frame.waypoint !== null,
		"Chat did not set navigation intent",
	);
	await move(-500, 0);
	assert(
		!row().hidden &&
			row().textContent?.includes("500 m") === true &&
			row().textContent?.includes("42.0N, 33.5E") === true,
		"Minimap destination coordinates or distance missing",
	);
	const coordinates = node<HTMLElement>(
		".minimap-coordinates",
	).getBoundingClientRect();
	const environment = node<HTMLElement>(
		".minimap-environment",
	).getBoundingClientRect();
	assert(
		Math.abs(
			(coordinates.top + coordinates.bottom) / 2 -
				(environment.top + environment.bottom) / 2,
		) <= 1 && coordinates.right <= environment.left + 1,
		"Coordinates and environment did not share one horizontal readout",
	);
	assert(visible(".minimap-waypoint-pointer"), "Distant pointer hidden");
	const initial = pointer();
	await move(-500, 0, 0, Math.PI);
	assert(pointer() === initial, "Camera orbit changed waypoint bearing");
	await move(-500, 0, Math.PI / 2);
	assert(
		pointer() !== initial,
		"Player heading failed to rotate waypoint bearing",
	);
	await move(-500, 0);
	const disc = node<HTMLCanvasElement>(".minimap-overlay-canvas");
	disc.dispatchEvent(
		new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true }),
	);
	await settle();
	assert(pointer() === initial, "Minimap zoom changed waypoint bearing");
	// Cross the viewport boundary without changing player position or near-waypoint status.
	for (
		let step = 0;
		step < 24 && !visible(".minimap-waypoint-marker");
		step++
	) {
		disc.dispatchEvent(
			new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true }),
		);
		await settle();
	}
	assert(
		controls.read().frame.waypoint?.kind === "guiding" &&
			visible(".minimap-waypoint-marker") &&
			!visible(".minimap-waypoint-pointer"),
		"Visible destination retained a redundant edge pointer",
	);
	for (let step = 0; step < 24 && visible(".minimap-waypoint-marker"); step++) {
		disc.dispatchEvent(
			new WheelEvent("wheel", {
				deltaY: -100,
				bubbles: true,
				cancelable: true,
			}),
		);
		await settle();
	}
	assert(
		!visible(".minimap-waypoint-marker") &&
			visible(".minimap-waypoint-pointer") &&
			pointer() === initial,
		"Off-map destination did not restore its player-relative pointer",
	);
	await move(-CLIENT_WAYPOINT_NEAR_RADIUS_METERS / 2, 0);
	assert(
		row().querySelector("span")?.textContent === "42.0N, 33.5E" &&
			!visible(".minimap-waypoint-pointer"),
		"Near waypoint did not retain compact coordinates and suppress pointer",
	);
	assert(
		visible(".minimap-waypoint-marker"),
		"Nearby geographic destination missing",
	);
	await move(-500, 0, 0, 0, true);
	assert(
		row().querySelector("span")?.textContent === "42.0N, 33.5E" &&
			!visible(".minimap-waypoint-marker") &&
			!visible(".minimap-waypoint-pointer"),
		"Indoor waypoint was not paused",
	);
	await click('button[aria-label="World"]');
	assert(
		visible(".world-waypoint-target"),
		"World destination disappeared indoors",
	);
	await move(-500, 0, 0, 0, false, false);
	assert(
		row().querySelector("span")?.textContent === "42.0N, 33.5E" &&
			!visible(".minimap-waypoint-pointer") &&
			visible(".world-waypoint-target"),
		"Unavailable player lost target or retained guidance",
	);
	controls.lifecycle({
		kind: "portal-space",
		worldGeneration: 2,
		cause: "teleport",
	});
	controls.lifecycle({ kind: "in-world" });
	await move(-500, 0);
	assert(
		visible(".minimap-waypoint-pointer"),
		"Portal return failed to resume guidance",
	);
	const originalMarker = marker();
	const oldTransform = originalMarker.getAttribute("transform");
	controls.chat("@waypoint 0.00S, 0.00W");
	await settle();
	assert(
		marker() === originalMarker &&
			marker().getAttribute("transform") !== oldTransform,
		"Stationary World marker did not update in place",
	);
	// Hover at the new marker, then replace it without moving the pointer.
	const svgPoint = marker().transform.baseVal.consolidate()?.matrix;
	if (svgPoint === undefined || svgPoint === null)
		throw new Error("World waypoint lacks placement");
	const canvas = node<HTMLCanvasElement>(
		'canvas[aria-label="World terrain map"]',
	);
	const bounds = canvas.getBoundingClientRect();
	canvas.dispatchEvent(
		new PointerEvent("pointermove", {
			clientX: bounds.left + svgPoint.e,
			clientY: bounds.top + svgPoint.f,
			bubbles: true,
		}),
	);
	assert(
		node(".world-map-tooltip").textContent?.includes(
			"Waypoint · 0.00S, 0.00W",
		) === true,
		"World waypoint hover missing precision",
	);
	controls.chat("@waypoint 30N 30E");
	await settle();
	assert(
		node(".world-map-tooltip").textContent?.includes("Waypoint") === false,
		"Stationary hover retained old waypoint",
	);
	// Close the retained panel, mutate intent, and reopen the same DOM.
	await click('section[aria-label="World"] button[aria-label="Close World"]');
	controls.chat("@wp clear");
	await click('button[aria-label="World"]');
	assert(
		marker() === originalMarker && !visible(".world-waypoint-target"),
		"Reopened World restored cleared intent",
	);
	controls.chat("@waypoint 0N 0E");
	await settle();
	await click('[role="tab"][aria-controls$="-housing"]');
	controls.chat("@waypoint 10N 10E");
	await click('[role="tab"][aria-controls$="-world"]');
	assert(
		visible(".world-waypoint-target") && marker() === originalMarker,
		"Tab return lost the current waypoint",
	);
	controls.placeAtBottom();
	await settle();
	const footer = node<HTMLDivElement>(".minimap-footer");
	footer.style.fontSize = "24px";
	await settle();
	assert(
		footer.getBoundingClientRect().bottom <= innerHeight + 1,
		"Expanded waypoint footer escaped viewport",
	);
	footer.style.removeProperty("font-size");
	await click('button[aria-label="Clear waypoint"]');
	assert(
		row().hidden && !visible(".world-waypoint-target"),
		"Clear button failed to remove both markers",
	);
	assert(
		controls.read().gameActive,
		"Waypoint clear stole game keyboard ownership",
	);
	controls.chat("hello");
	controls.chat("@waypoint 0N 0E");
	let rejected = false;
	try {
		controls.chat("@waypoint invalid");
	} catch {
		rejected = true;
	}
	assert(
		rejected && controls.read().frame.waypoint !== null,
		"Invalid command did not retain target",
	);
	assert(
		JSON.stringify(controls.read().sent) === JSON.stringify(["hello"]),
		"Local command escaped to server chat",
	);
	controls.character(null);
	await settle();
	assert(
		row().hidden && !visible(".world-waypoint-target"),
		"Character retirement retained navigation UI",
	);
	return {
		passed: true,
		assertions,
		messages: controls.read().messages.length,
	};
}
