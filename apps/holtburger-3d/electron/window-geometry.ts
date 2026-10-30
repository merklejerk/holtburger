import type { ClientWindowSettings } from "../src/app/window-settings-contract.js";

/** Only native window events and bounds are required; tests can hold writes independently. */
interface GeometryWindow {
	getNormalBounds(): ClientWindowSettings["normalBounds"];
	isMaximized(): boolean;
	on(event: string, listener: () => void): unknown;
	removeListener(event: string, listener: () => void): unknown;
}
const GEOMETRY_EVENTS = ["resize", "maximize", "unmaximize"];
export const WINDOW_GEOMETRY_WRITE_DELAY_MS = 250;
/** Native geometry listeners outlive documents, so surface replacement must explicitly detach them. */
export function observeWindowGeometry(
	window: GeometryWindow,
	save: (value: ClientWindowSettings) => Promise<void>,
	report: (error: unknown) => void,
): () => Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;
	let failureReported = false;
	let tail: Promise<void> = Promise.resolve();
	const write = (): Promise<void> => {
		const { width, height } = window.getNormalBounds();
		const value = {
			normalBounds: { width, height },
			maximized: window.isMaximized(),
		};
		const writing = tail.then(() => save(value));
		tail = writing.then(
			() => {
				failureReported = false;
			},
			(error: unknown) => {
				if (!failureReported) {
					failureReported = true;
					report(error);
				}
			},
		);
		return writing;
	};
	const schedule = () => {
		if (stopped) return;
		clearTimeout(timer);
		timer = setTimeout(() => {
			timer = undefined;
			void write().catch(() => {
				/* The serialized tail already reported this background failure. */
			});
		}, WINDOW_GEOMETRY_WRITE_DELAY_MS);
	};
	for (const event of GEOMETRY_EVENTS) window.on(event, schedule);
	return async () => {
		if (stopped) {
			await tail;
			return;
		}
		stopped = true;
		clearTimeout(timer);
		for (const event of GEOMETRY_EVENTS) window.removeListener(event, schedule);
		await write();
	};
}
