import { mount, tick, unmount } from "svelte";
import ClientMessageDialog from "../../client/ClientMessageDialog.svelte";
import ClientPartyHud from "../../client/ClientPartyHud.svelte";
import ExplorerEntityList from "../../explorer/ExplorerEntityList.svelte";
import ExplorerEntitySpawnComposer from "../../explorer/ExplorerEntitySpawnComposer.svelte";
import "../../explorer/explorer.css";
import IconScalingProbe from "./IconScalingProbe.svelte";
import {
	CLIENT_ICON_SCALE,
	CLIENT_TEXT_SCALE,
} from "../../client/client-settings-values";
import { uiThemes } from "../../app/mount";
import steelUrl from "./themes/steel.css?url&no-inline";

/** Exercise live settings, CSS inheritance, top-layer dialogs and measured HUD geometry. */
export async function probeTextScaling(context: Map<unknown, unknown>) {
	function element<ElementType extends HTMLElement = HTMLElement>(
		selector: string,
	) {
		const node = document.querySelector<ElementType>(selector);
		if (node === null)
			throw new Error(`Missing text-scale consumer: ${selector}`);
		return node;
	}
	function require(condition: boolean, message: string) {
		if (!condition) throw new Error(message);
	}
	const scope = element(".harness-appearance");
	const canvas = element(".client-canvas");
	const fixture = document.createElement("section");
	fixture.style.cssText = "position:fixed;left:-2000px;top:0;width:220px";
	fixture.innerHTML = `<div class="ui-theme" data-scale-body>
		<h1>Heading</h1><h2>Subheading</h2><h3>Section</h3>
		<input class="ui-input" value="Editor">
		<span class="ui-tooltip">Caption</span>
		<div class="ui-theme"><span data-scale-nested>Nested root</span></div>
		<span style="font-size:75%" data-scale-relative>Relative caption</span>
		<div class="ui-body">Panel inset</div><label class="ui-label">Editor label<input></label>
	</div>`;
	scope.append(fixture);
	const independent = document.createElement("div");
	independent.className = "ui-theme";
	independent.textContent = "Independent frontend root";
	document.body.append(independent);
	const fontSize = (node: Element) =>
		Number.parseFloat(getComputedStyle(node).fontSize);
	const consumers = [
		element("[data-scale-body]"),
		element("[data-scale-body] h1"),
		element("[data-scale-body] h2"),
		element("[data-scale-body] h3"),
		element("[data-scale-body] .ui-input"),
		element("[data-scale-body] .ui-tooltip"),
		element("[data-scale-nested]"),
		element("[data-scale-relative]"),
		element(".minimap-coordinates"),
		element(".hud-window-title"),
	];
	const independentSize = fontSize(independent);
	const rootSize = fontSize(document.documentElement);
	const excluded = [
		...document.querySelectorAll(
			".ui-shortcut-hint, .item-count-overlay, .minimap-cardinal, .spell-tab-hint",
		),
	];
	const excludedSizes = excluded.map(fontSize);
	const slider = () =>
		element<HTMLInputElement>('input[aria-label="Text scaling"]');
	const settle = async () => {
		await tick();
		await new Promise<void>((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
		);
	};
	const edit = async (value: number) => {
		slider().value = String(value);
		slider().dispatchEvent(new Event("input", { bubbles: true }));
		await settle();
	};
	const iconFixture = mount(IconScalingProbe, { target: fixture, context });
	const party = mount(ClientPartyHud, {
		target: fixture,
		context,
		props: {
			preview: true,
			readPartyHudDisplay: () => null,
			onSelectEntity: () => {},
			placement: {
				horizontal: { alignment: "start", offset: 0 },
				vertical: { alignment: "start", offset: 0 },
				preferredWidth: 240,
				preferredHeight: 240,
			},
			viewport: { width: window.innerWidth, height: window.innerHeight },
			editable: false,
			resizable: true,
			onPlacementChange: () => {},
		},
	});
	const explorerList = mount(ExplorerEntityList, {
		target: independent,
		props: { entities: [], selected: null, possessed: null, select: () => {} },
	});
	const explorerComposer = mount(ExplorerEntitySpawnComposer, {
		target: independent,
		context,
		props: {
			enabled: true,
			busy: false,
			spawning: false,
			operationError: "Catalog fixture",
			search: async () => [],
			spawn: async () => {},
		},
	});
	try {
		await edit(CLIENT_TEXT_SCALE.initial);
		await settle();
		const explorerCaption = element(".entity-note");
		const explorerEditor = element(".spawn-composer input");
		const explorerSizes = [fontSize(explorerCaption), fontSize(explorerEditor)];
		const baseline = consumers.map(fontSize);
		const characterHeight = element(
			'[aria-label="Character HUD"]',
		).getBoundingClientRect().height;
		const partyName = element(".party-member__name");
		const partyFont = fontSize(partyName);
		const evidence = [];
		for (const scale of [
			CLIENT_TEXT_SCALE.minimum,
			1.5,
			CLIENT_TEXT_SCALE.maximum,
		]) {
			await edit(scale);
			require(fontSize(explorerCaption) === explorerSizes[0] &&
				fontSize(explorerEditor) ===
					explorerSizes[1], "Client scale changed production Explorer controls");
			consumers.forEach((node, index) => {
				require(Math.abs(fontSize(node) - baseline[index] * scale) <
					0.02, `${node.className || node.tagName} did not scale exactly once at ${scale}`);
			});
			require(fontSize(independent) === independentSize &&
				fontSize(document.documentElement) ===
					rootSize, "Client preference changed independent roots or document geometry");
			excluded.forEach((node, index) =>
				require(fontSize(node) ===
					excludedSizes[index], "Geometry-bound text inherited UI scaling"),
			);
			require(Math.abs(fontSize(partyName) - partyFont * scale) <
				0.02, "Party names ignored text scaling");
			require(partyName.getBoundingClientRect().height >=
				fontSize(partyName), "Party name row clipped scaled text");
			const close = element('[aria-label="Close Settings"]');
			const scroll = element('.settings-panel [role="tabpanel"]:not([hidden])');
			require(scroll.scrollWidth <=
				scroll.clientWidth + 1, "Scaled settings overflowed horizontally");
			slider().scrollIntoView({ block: "nearest" });
			const sliderBounds = slider().getBoundingClientRect();
			require(sliderBounds.top >= 0 &&
				sliderBounds.bottom <=
					window.innerHeight, "Text-scale slider cannot be reached within the viewport");
			const vital = element('.character-hud .vital[data-focused="true"]');
			const quantity = vital.querySelector("strong");
			require(quantity !== null &&
				quantity.getBoundingClientRect().height <=
					vital.getBoundingClientRect().height +
						0.1, "Focused vital row clipped its scaled quantity");
			require(close.getBoundingClientRect().height >=
				fontSize(close), "Window close control clipped its label");
			evidence.push({
				scale,
				body: fontSize(consumers[0]),
				partyRow: partyName.getBoundingClientRect().height,
			});
		}
		// Resolve dimensions through real shared cells, bars and trays; font and artwork axes stay independent.
		const iconSlider = () =>
			element<HTMLInputElement>('input[aria-label="Icon scaling"]');
		const editIcon = async (value: number) => {
			iconSlider().value = String(value);
			iconSlider().dispatchEvent(new Event("input", { bubbles: true }));
			await settle();
			await settle(); // ResizeObserver publishes cold bar/tray geometry after the CSS update.
		};
		await edit(CLIENT_TEXT_SCALE.initial);
		await editIcon(CLIENT_ICON_SCALE.initial);
		const dimensions = [
			element("[data-scale-icons] .item-grid-cell"),
			element("[data-scale-icons] .item-cell-art"),
			element("[data-scale-icons] .item-cell-meter"),
			element("[data-scale-icons] .currency-icon"),
			element(".action-grid .ui-item-cell"),
			element(".spell-bar-metrics"),
			element(".shortcut-dock button"),
			element(".shortcut-dock button svg"),
			element("[data-scale-icons] .ui-icon"),
		];
		const widths = dimensions.map((node) => node.getBoundingClientRect().width);
		const badges = [
			element("[data-scale-icons] .item-count-overlay"),
			element("[data-scale-icons] .item-equipped"),
			element(".ui-shortcut-hint"),
		];
		const badgeSizes = badges.map(fontSize);
		const iconEvidence = [];
		for (const scale of [
			CLIENT_ICON_SCALE.minimum,
			1.05,
			1.1,
			1.15,
			1.35,
			1.5,
			CLIENT_ICON_SCALE.maximum,
		]) {
			await editIcon(scale);
			const leader = element(".party-member__leader");
			const leaderRow = element(
				".party-member__name:has(.party-member__leader)",
			);
			require(leader.getBoundingClientRect().height <=
				leaderRow.getBoundingClientRect().height +
					0.1, "Scaled party leader icon escapes its name row");

			const dockButtons = [
				...scope.querySelectorAll<HTMLElement>(".shortcut-dock > button"),
			];
			const dockBounds = () =>
				dockButtons.map((node) => {
					const { x, y, width, height } = node.getBoundingClientRect();
					return { x, y, width, height };
				});
			const lockedBounds = JSON.stringify(dockBounds());
			element<HTMLButtonElement>(".client-ui-lock").click();
			await settle();
			require(JSON.stringify(dockBounds()) ===
				lockedBounds, "Unlocking layout moved or shrank shortcut buttons");
			element<HTMLButtonElement>(".client-ui-lock").click();
			await settle();
			require(JSON.stringify(dockBounds()) ===
				lockedBounds, "Relocking layout moved or resized shortcut buttons");

			const testTray = element(
				'section[aria-label="Scale tray fixture"] .tray-scroll',
			);
			const content = testTray.firstElementChild;
			const constrainedTray = element(
				'section[aria-label="Constrained scale tray fixture"] .tray-scroll',
			);
			require(constrainedTray.classList.contains("constrained") &&
				constrainedTray.scrollWidth >
					constrainedTray.clientWidth, "A genuinely constrained tray lost scrolling");

			for (const area of scope.querySelectorAll<HTMLElement>(".tray-scroll")) {
				const natural = area.firstElementChild?.getBoundingClientRect();
				const fitted = area.getBoundingClientRect();
				if (
					natural !== undefined &&
					natural.width <= fitted.width + 0.1 &&
					natural.height <= fitted.height + 0.1
				)
					require(!area.classList.contains(
						"constrained",
					), `Fitting tray scrolled at ${scale}: ${JSON.stringify({ natural: natural.toJSON(), fitted: fitted.toJSON() })}`);
			}

			require(!testTray.classList.contains(
				"constrained",
			), `Unconstrained tray scrolled at ${scale}: ${JSON.stringify({ available: testTray.getBoundingClientRect().toJSON(), content: content?.getBoundingClientRect().toJSON() })}`);

			dimensions.forEach((node, index) =>
				require(Math.abs(
					node.getBoundingClientRect().width - widths[index] * scale,
				) <
					0.15, `${node.className} did not scale its hit geometry once at ${scale}: ${node.getBoundingClientRect().width} vs ${widths[index] * scale}`),
			);
			badges.forEach((node, index) =>
				require(Math.abs(fontSize(node) - badgeSizes[index] * scale) <
					0.02, "Icon badge did not follow artwork scale"),
			);
			require(Math.abs(fontSize(consumers[0]) - baseline[0]) <
				0.02, "Icon scaling changed ordinary text");
			const bounds = element(
				"[data-scale-icons] .item-grid-cell",
			).getBoundingClientRect();
			const art = element(
				"[data-scale-icons] .item-cell-art",
			).getBoundingClientRect();
			require(art.left >= bounds.left &&
				art.right <= bounds.right &&
				art.bottom <= bounds.bottom, "Artwork escaped its hit target");
			await edit(CLIENT_TEXT_SCALE.maximum);
			dimensions.forEach((node, index) =>
				require(Math.abs(
					node.getBoundingClientRect().width - widths[index] * scale,
				) < 0.15, "Text scaling changed fixed icon geometry"),
			);
			badges.forEach((node, index) =>
				require(Math.abs(fontSize(node) - badgeSizes[index] * scale) <
					0.02, "Mixed scales multiplied badges twice"),
			);
			await edit(CLIENT_TEXT_SCALE.initial);
			iconSlider().scrollIntoView({ block: "nearest" });
			const sliderBounds = iconSlider().getBoundingClientRect();
			require(sliderBounds.top >= 0 &&
				sliderBounds.bottom <=
					window.innerHeight, "Icon-scale slider cannot be reached");
			iconEvidence.push({
				scale,
				cell: dimensions[0].getBoundingClientRect().width,
				badge: fontSize(badges[0]),
			});
		}
		fixture.style.setProperty("--ui-item-cell-min-size", "40px");
		fixture.style.setProperty("--ui-item-count-font-size", "18px");
		fixture.style.setProperty("--ui-inventory-currency-icon-size", "11px");
		await settle();
		require(Math.abs(
			dimensions[0].getBoundingClientRect().width -
				40 * CLIENT_ICON_SCALE.maximum,
		) < 0.1, "Scoped icon dimensions did not compose with scaling");
		require(Math.abs(fontSize(badges[0]) - 18 * CLIENT_ICON_SCALE.maximum) <
			0.02, "Scoped count font did not compose with scaling");
		require(Math.abs(
			dimensions[3].getBoundingClientRect().width -
				11 * CLIENT_ICON_SCALE.maximum,
		) < 0.1, "Scoped currency art did not compose with scaling");
		fixture.style.removeProperty("--ui-item-cell-min-size");
		fixture.style.removeProperty("--ui-item-count-font-size");
		fixture.style.removeProperty("--ui-inventory-currency-icon-size");

		await editIcon(CLIENT_ICON_SCALE.initial);
		await edit(CLIENT_TEXT_SCALE.maximum);

		const node = element("[data-scale-body]");
		node.style.setProperty("--ui-font-size-body", "17px");
		node.style.setProperty("--ui-font-size-caption", "9px");
		node.style.setProperty("--ui-body-padding", "19px");
		node.style.setProperty("--ui-label-gap", "7px");
		await uiThemes.replace(steelUrl, null);
		await settle();
		independent.style.setProperty("--ui-font-size-caption", "15px");
		require(fontSize(explorerCaption) === 15 &&
			fontSize(element(".spawn-composer .picker-message")) ===
				15, "Explorer controls ignored scoped theme typography");
		require(Math.abs(fontSize(node) - 17 * CLIENT_TEXT_SCALE.maximum) <
			0.02, "Scoped theme body length did not compose with user scale");
		require(Math.abs(
			fontSize(element("[data-scale-body] .ui-tooltip")) -
				9 * CLIENT_TEXT_SCALE.maximum,
		) < 0.02, "Scoped caption override ignored scale");
		require(getComputedStyle(element("[data-scale-body] .ui-body"))
			.paddingTop === "19px", "Panel body ignored shared spacing hook");
		require(getComputedStyle(element("[data-scale-body] .ui-label")).rowGap ===
			"7px", "Label ignored shared spacing hook");
		const dialog = mount(ClientMessageDialog, {
			target: fixture,
			context,
			props: {
				presentation: { kind: "popup", id: 1, text: "Scaled dialog" },
				onDismiss: () => {},
				onRespond: () => {},
			},
		});
		try {
			await settle();
			const modal = element<HTMLDialogElement>("dialog.client-message-dialog");
			require(modal.open &&
				modal.matches(
					":modal",
				), "Text probe did not exercise the native top layer");
			require(Math.abs(
				fontSize(element("#client-message-text")) -
					baseline[0] * CLIENT_TEXT_SCALE.maximum,
			) < 0.02, "Top-layer dialog lost client text scale");
		} finally {
			await unmount(dialog);
		}
		await editIcon(CLIENT_ICON_SCALE.maximum);
		// Settings currently remounts on close; user preferences must survive without recreating the viewport.
		element('[aria-label="Close Settings"]').click();
		await settle();
		element('button[aria-label="Settings"]').click();
		await settle();
		require(canvas ===
			element(".client-canvas"), "Text edits recreated viewport presentation");
		element("#settings-tab-ui").click();
		await settle();
		require(Number(slider().value) ===
			CLIENT_TEXT_SCALE.maximum, "Reopened settings lost text scale");
		require(Number(iconSlider().value) ===
			CLIENT_ICON_SCALE.maximum, "Reopened settings lost icon scale");
		await editIcon(CLIENT_ICON_SCALE.initial);
		dimensions.forEach((node, index) =>
			require(Math.abs(node.getBoundingClientRect().width - widths[index]) <
				0.15, "Neutral icon scale did not restore authored geometry"),
		);
		await edit(CLIENT_TEXT_SCALE.initial);
		require(Number(slider().value) ===
			CLIENT_TEXT_SCALE.initial, "Slider did not restore neutral text scale");
		require(Math.abs(fontSize(element(".client-world")) - baseline[0]) <
			0.02, "Neutral slider value did not restore UI text size");
		require(Math.abs(
			element('[aria-label="Character HUD"]').getBoundingClientRect().height -
				characterHeight,
		) < 0.1, "Character HUD minimum did not shrink with text scale");
		return {
			samples: evidence,
			iconSamples: iconEvidence,
			characterHeightRestored: true,
			nestedRoots: true,
			themeOverrides: true,
			topLayer: true,
			reopened: true,
			explorerNeutral: true,
		};
	} finally {
		await unmount(explorerComposer);
		await unmount(explorerList);
		await unmount(party);
		await unmount(iconFixture);
		fixture.remove();
		independent.remove();
		await uiThemes.replace(null, null);
		await edit(CLIENT_TEXT_SCALE.initial);
		const iconControl = element<HTMLInputElement>(
			'input[aria-label="Icon scaling"]',
		);
		iconControl.value = String(CLIENT_ICON_SCALE.initial);
		iconControl.dispatchEvent(new Event("input", { bubbles: true }));
		await settle();
	}
}
