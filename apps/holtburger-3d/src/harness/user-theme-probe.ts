import { mount } from "svelte";
import { observeCombatEffectsAppearance } from "../client/client-combat-effects-appearance";
import { UI_THEME_LOAD_TIMEOUT_MS } from "../app/ui-theme-contract";
import "../app/base.css";
import "../app/ui-base.css";
import { createUiThemeLoader } from "../app/ui-theme";

const loader = createUiThemeLoader(document);
const input = document.querySelector("input");

/** Load the registered faces for each Base role; browser fallback alone cannot pass. */
async function baseFonts() {
	const style = getComputedStyle(document.documentElement);
	const faces = new Set<FontFace>();
	const unquote = (family: string) => family.replace(/^["']|["']$/g, "");
	for (const role of ["body", "heading", "mono"]) {
		const stack = style.getPropertyValue(`--ui-font-${role}`).trim();
		const family = stack.split(",")[0]?.trim();
		if (!family) throw new Error(`Missing Base font for ${role}`);
		const registered = [...document.fonts].filter(
			(face) => unquote(face.family) === unquote(family),
		);
		if (registered.length === 0)
			throw new Error(
				`No bundled faces registered for Base ${role}: ${family}`,
			);
		for (const face of registered) {
			await face.load();
			faces.add(face);
		}
	}
	return faces.size;
}

/** Real DOM, font decoding, and image pixels prove resource serving without visual acceptance. */
async function apply(url: string | null) {
	await loader.replace(url, null);
	await document.fonts.load('40px "Theme Probe"', "A");
	const node = document.getElementById("image");
	if (node === null) throw new Error("Missing image fixture");
	const style = getComputedStyle(node);
	const imageUrl = style.backgroundImage.match(/^url\("(.*)"\)$/)?.[1];
	if (imageUrl === undefined)
		throw new Error("Theme did not publish its image URL");
	const image = new Image();
	image.crossOrigin = "anonymous";
	image.src = imageUrl;
	await image.decode();
	const canvas = document.createElement("canvas");
	const context = canvas.getContext("2d");
	if (context === null) throw new Error("Canvas unavailable");
	context.drawImage(image, 0, 0);
	context.font = '40px "Theme Probe"';
	return {
		imageUrl,
		pixel: [...context.getImageData(0, 0, 1, 1).data],
		width: context.measureText("AAAA").width,
		imported: style.getPropertyValue("--probe-import").trim(),
		identity: input === document.querySelector("input"),
		draft: input?.value,
	};
}

/** Cancellation uses a real pending stylesheet element, not a mock DOM. */
async function cancellation(url: string) {
	const controller = new AbortController();
	const pending = loader.replace(url, null, controller.signal);
	await Promise.resolve();
	controller.abort();
	try {
		await pending;
		throw new Error("Aborted selection completed");
	} catch (error) {
		if (!(error instanceof DOMException && error.name === "AbortError"))
			throw error;
	}
	await loader.replace(null, null);
	return (
		document.querySelectorAll('link[media="not all"], link[media="all"]')
			.length === 0
	);
}

/** Keep the existing active sheet while a request stalls, then prove queue recovery. */
async function timeout(url: string, validUrl: string) {
	await loader.replace(validUrl, null);
	const active = document.querySelector('link[media="all"]');
	const started = performance.now();
	let timedOut = false;
	try {
		await loader.replace(url, null);
	} catch (error) {
		timedOut = error instanceof Error && error.message.includes("timed out");
	}
	if (!timedOut || performance.now() - started < UI_THEME_LOAD_TIMEOUT_MS)
		throw new Error("Stalled stylesheet did not time out");
	if (
		document.querySelector('link[media="all"]') !== active ||
		document.querySelector('link[media="not all"]')
	)
		throw new Error(
			"Timeout changed active appearance or retained staged sheets",
		);
	const controller = new AbortController();
	const first = loader.replace(validUrl, null);
	const queued = loader.replace(validUrl, null, controller.signal);
	controller.abort();
	await first;
	try {
		await queued;
		throw new Error("Queued abort was ignored");
	} catch (error) {
		if (!(error instanceof DOMException && error.name === "AbortError"))
			throw error;
	}
	await loader.replace(null, null);
	return true;
}

/** A failed second sheet removes staged resources while preserving the complete active selection. */
async function failedLoad(url: string, validUrl: string) {
	await loader.replace(validUrl, null);
	const active = document.querySelector('link[media="all"]');
	let rejected = false;
	try {
		await loader.replace(validUrl, url);
	} catch (error) {
		rejected = error instanceof Error && error.message.includes(url);
	}
	if (
		!rejected ||
		document.querySelector('link[media="all"]') !== active ||
		document.querySelector('link[media="not all"]')
	)
		throw new Error(
			"Failed stylesheet changed the active selection or retained staged resources",
		);
	await loader.replace(null, null);
	return true;
}

/** Exercise the actual combat font consumer; resource errors must not escape as rejections. */
async function fontFailure(url: string) {
	const target = document.createElement("div");
	target.style.setProperty("--ui-font-body", '"Missing Probe"');
	document.body.append(target);
	const face = new FontFace("Missing Probe", `url("${url}")`, {
		weight: "bold",
	});
	document.fonts.add(face);
	const failures: Error[] = [];
	const unhandled: unknown[] = [];
	const onUnhandled = (event: PromiseRejectionEvent) => {
		unhandled.push(event.reason);
	};
	window.addEventListener("unhandledrejection", onUnhandled);
	const observer = observeCombatEffectsAppearance(
		target,
		() => {},
		() => {},
		(error) => {
			failures.push(error);
		},
	);
	try {
		for (let attempt = 0; attempt < 100 && failures.length === 0; attempt++)
			await new Promise((resolve) => setTimeout(resolve, 20));
		if (failures.length === 0 || unhandled.length)
			throw new Error("Font failure escaped diagnostics or went unreported");
		return failures[0].message;
	} finally {
		observer.destroy();
		document.fonts.delete(face);
		target.remove();
		window.removeEventListener("unhandledrejection", onUnhandled);
	}
}

/** Font completion reaches the existing glyph-atlas invalidation hook; retired observers stay quiet. */
async function fontRefresh(url: string) {
	const target = document.createElement("div");
	target.style.setProperty("--ui-font-body", '"Atlas Probe"');
	document.body.append(target);
	const face = new FontFace("Atlas Probe", `url("${url}")`, { weight: "bold" });
	document.fonts.add(face);
	let refreshes = 0;
	const errors: Error[] = [];
	const observer = observeCombatEffectsAppearance(
		target,
		() => {},
		() => {
			refreshes++;
		},
		(error) => {
			errors.push(error);
		},
	);
	try {
		await document.fonts.load('bold 28px "Atlas Probe"', "A");
		for (let attempt = 0; attempt < 100 && refreshes === 0; attempt++)
			await new Promise((resolve) => setTimeout(resolve, 20));
		if (refreshes === 0 || errors.length)
			throw new Error("Loaded font did not invalidate the glyph atlas");
	} finally {
		observer.destroy();
		document.fonts.delete(face);
		target.remove();
	}
	document.body.append(target);
	const nativeLoad = document.fonts.load;
	let reject: (error: Error) => void = () => {
		throw new Error("Font gate not initialized");
	};
	const pending = new Promise<FontFace[]>((_resolve, fail) => {
		reject = fail;
	});
	document.fonts.load = () => pending;
	try {
		const retired = observeCombatEffectsAppearance(
			target,
			() => {},
			() => {},
			(error) => {
				errors.push(error);
			},
		);
		retired.destroy();
		reject(new Error("Retired font request"));
		await new Promise((resolve) => setTimeout(resolve, 0));
		if (errors.length)
			throw new Error("Retired observer reported a late font failure");
	} finally {
		document.fonts.load = nativeLoad;
		target.remove();
	}
	return refreshes;
}

async function settings() {
	await loader.replace(null, null);
	const { default: Fixture } = await import("./ThemeSettingsProbe.svelte");
	const target = document.createElement("div");
	document.body.append(target);
	mount(Fixture, { target });
	return true;
}

Object.assign(window, {
	__UI_THEME_ASSET_PROBE__: {
		baseFonts,
		apply,
		cancellation,
		timeout,
		failedLoad,
		fontFailure,
		fontRefresh,
		settings,
	},
});
