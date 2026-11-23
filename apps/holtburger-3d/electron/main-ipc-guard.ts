import { ipcMain } from "electron";
import type { ApplicationWindow } from "./application-window.js";
import type { ClientRetirement } from "./client-retirement.js";
import type { DocumentAdmission, DocumentRole } from "./document-admission.js";

export type IpcHandleFn = <Args extends unknown[], Result>(
	channel: string,
	role: DocumentRole | readonly DocumentRole[] | undefined,
	listener: (event: Electron.IpcMainInvokeEvent, ...args: Args) => Result,
) => void;

export interface IpcGuardContext {
	readonly getApplicationWindow: () => ApplicationWindow | null;
	readonly documents: DocumentAdmission;
	readonly getDocumentRetirement: () => ClientRetirement | undefined;
	readonly getDesktopCanPlay: () => boolean | undefined;
}

export function requireApplicationFrame(
	event: Electron.IpcMainInvokeEvent,
	window: ApplicationWindow | null,
): void {
	if (window === null) throw new Error("Application window is unavailable");
	const applicationContents = window.webContents;
	if (
		applicationContents.isDestroyed() ||
		event.sender !== applicationContents ||
		event.senderFrame !== applicationContents.mainFrame
	)
		throw new Error("requests are accepted only from the application frame");
}

export function requireCharacterGuid(value: unknown): number {
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < 0 ||
		value > 0xffff_ffff
	)
		throw new Error("character GUID must be an unsigned 32-bit integer");
	return value;
}

/** IPC is registered once; each preload attaches its document identity before feature arguments. */
export function createIpcHandle(context: IpcGuardContext): IpcHandleFn {
	return <Args extends unknown[], Result>(
		channel: string,
		role: DocumentRole | readonly DocumentRole[] | undefined,
		listener: (event: Electron.IpcMainInvokeEvent, ...args: Args) => Result,
	): void => {
		ipcMain.handle(channel, (event, identity: unknown, ...args: Args) => {
			requireApplicationFrame(event, context.getApplicationWindow());
			context.documents.require(identity, role);
			const retirement = context.getDocumentRetirement();
			if (retirement !== undefined && !retirement.acceptsRendererRequests)
				throw new Error("Document retirement has sealed game IPC");
			const canPlay = context.getDesktopCanPlay();
			const pickerOnly = role === "picker";
			if (
				pickerOnly &&
				channel !== "launcher:snapshot" &&
				canPlay !== undefined &&
				!canPlay
			)
				throw new Error(
					"Launcher changes are unavailable during a game attempt or Quit",
				);
			return listener(event, ...args);
		});
	};
}
