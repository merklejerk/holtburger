/** Keep unrelated HUD surfaces from covering a pointer-driven scenario; each caller owns restoration. */
export async function isolateHudProbe(read, surfaceSelector) {
	const id = await read(`(() => {
		const style = document.createElement('style');
		style.id = 'hud-probe-' + crypto.randomUUID();
		style.textContent = ${JSON.stringify(`.hud-panel:not(:has(${surfaceSelector})) { visibility: hidden !important; }`)};
		document.head.append(style);
		return style.id;
	})()`);
	return () => read(`document.getElementById(${JSON.stringify(id)}).remove()`);
}
