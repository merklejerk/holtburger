import { createUiThemeLoader } from "../../app/ui-theme";
import {
	observeSummonLeashColors,
	readSummonLeashColors,
	type ClientSummonLeashColors,
} from "../../client/client-summon-leash-appearance";
import themeUrl from "./themes/combat-indicators.css?url&no-inline";

/** Real stylesheet commits and scoped CSS reach the existing runtime's rendered leash. */
export async function probeSummonLeashAppearance(
	publish: (colors: ClientSummonLeashColors) => void,
	readRenderedColor: () => string,
): Promise<boolean> {
	const target = document.createElement("div");
	target.id = "summon-leash-theme-probe";
	document.body.append(target);
	const loader = createUiThemeLoader(document);
	let publications = 0;
	const observer = observeSummonLeashColors(target, (colors) => {
		publications++;
		publish(colors);
	});
	const settle = () =>
		new Promise<void>((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
		);
	const require = (condition: boolean, message: string) => {
		if (!condition) throw new Error(message);
	};
	try {
		await loader.replace(themeUrl, null);
		await settle();
		const themed = readSummonLeashColors(target);
		require(JSON.stringify(themed) ===
			JSON.stringify({
				own: [1, 0, 0, 64 / 255],
				other: [0, 1, 0, 128 / 255],
			}), "Leash colors or opacity ignored the selected stylesheet");
		require(readRenderedColor() ===
			themed.own.join(","), "Themed leash color did not reach the renderer");
		target.style.color = "rgb(0, 0, 255)";
		target.style.setProperty("--ui-summon-leash-own-color", "currentColor");
		await settle();
		require(readRenderedColor() ===
			"0,0,1,1", "Live inherited leash color did not reach the renderer");
		observer.destroy();
		const stopped = publications;
		target.style.setProperty("--ui-summon-leash-own-color", "not-a-color");
		await loader.replace(null, null);
		await settle();
		require(publications ===
			stopped, "Retired leash theme observer still published");
		let rejected = false;
		try {
			readSummonLeashColors(target);
		} catch (error) {
			rejected =
				error instanceof Error &&
				error.message.includes("--ui-summon-leash-own-color");
		}
		require(rejected, "Invalid leash color was silently accepted");
		return true;
	} finally {
		observer.destroy();
		await loader.dispose();
		target.remove();
	}
}
