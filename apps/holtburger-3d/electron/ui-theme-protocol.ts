import { protocol, type Session } from "electron";
import { UI_THEME_SCHEME } from "../src/app/ui-theme-contract.js";
import type { UiThemeCatalog } from "./ui-theme-catalog.js";

/** Run once before app readiness; standard URL handling preserves relative CSS resources. */
export function registerUiThemeScheme(): void {
	protocol.registerSchemesAsPrivileged([
		{
			scheme: UI_THEME_SCHEME,
			privileges: {
				standard: true,
				secure: true,
				corsEnabled: true,
				supportFetchAPI: true,
			},
		},
	]);
}

/** Install on the window's session before navigating either development or built entries. */
export function installUiThemeProtocol(
	session: Session,
	catalog: UiThemeCatalog,
): void {
	session.protocol.handle(UI_THEME_SCHEME, async (request) => {
		try {
			if (request.method !== "GET")
				return new Response("Method not allowed", { status: 405 });
			const { data, contentType } = await catalog.read(request.url);
			return new Response(Uint8Array.from(data), {
				headers: {
					"Content-Type": contentType,
					"Access-Control-Allow-Origin": "*",
					"Cache-Control": "no-store",
					"X-Content-Type-Options": "nosniff",
				},
			});
		} catch (cause) {
			console.error(
				new Error(`Could not serve theme resource ${request.url}`, { cause }),
			);
			return new Response("Theme resource unavailable", { status: 404 });
		}
	});
}
