/** Exercise retained settings tabs and native keyboard navigation. */
export async function probeClientSettingsTabs(
	client,
	evaluateExpression,
	delay,
) {
	await evaluateExpression(
		client,
		`document.querySelector('button[aria-label="Settings"]').click()`,
	);
	await delay(50);
	return await evaluateExpression(
		client,
		`(async () => {
			const window = document.querySelector('.hud-window[aria-label="Settings"]');
			if (!window) throw new Error('Settings shortcut did not open its HUD window');
			const tabs = [...window.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent.trim());
			if (tabs.join(',') !== 'Graphics,Audio,UI,Input,Gameplay') throw new Error('Settings tabs are incomplete');
			const ambientLabel = [...window.querySelectorAll('#settings-section-graphics label')]
				.find((label) => label.textContent.includes('Dungeon ambient light'));
			const ambientSlider = ambientLabel?.querySelector('input[type="range"]');
			if (!ambientSlider) throw new Error('Dungeon ambient slider is missing');
			const originalAmbient = ambientSlider.value;
			ambientSlider.value = ambientSlider.max;
			ambientSlider.dispatchEvent(new Event('input', { bubbles: true }));
			await new Promise((resolve) => requestAnimationFrame(resolve));
			if (!ambientLabel.textContent.includes(Math.round(Number(ambientSlider.max) * 100) + '%')) throw new Error('Dungeon ambient slider did not publish its value');
			window.querySelector('#settings-tab-audio').click();
			window.querySelector('#settings-tab-graphics').click();
			await new Promise((resolve) => requestAnimationFrame(resolve));
			if (ambientSlider.value !== ambientSlider.max) throw new Error('Dungeon ambient preference was lost across tabs');
			const resetGraphics = [...window.querySelectorAll('#settings-section-graphics button')]
				.find((button) => button.textContent.trim() === 'Reset graphics');
			if (!resetGraphics) throw new Error('Graphics reset button is missing');
			resetGraphics.click();
			await new Promise((resolve) => requestAnimationFrame(resolve));
			if (ambientSlider.value !== originalAmbient) throw new Error('Graphics reset did not restore default dungeon ambient');
			window.querySelector('#settings-tab-input').click();
			await new Promise((resolve) => requestAnimationFrame(resolve));
			const inputPanel = window.querySelector('#settings-section-input');
			const mouseSection = [...inputPanel.querySelectorAll('details')]
				.find((section) => section.querySelector('summary')?.textContent === 'Mouse');
			if (!mouseSection) throw new Error('Input mouse section is missing');
			mouseSection.open = false;
			inputPanel.scrollTop = inputPanel.scrollHeight;
			await new Promise((resolve) => requestAnimationFrame(resolve));
			const inputScroll = inputPanel.scrollTop;
			if (inputScroll <= 0) throw new Error('Input settings must scroll within their tab panel');
			window.querySelector('#settings-tab-graphics').click();
			await new Promise((resolve) => requestAnimationFrame(resolve));
			if (!inputPanel.hidden || !inputPanel.inert) throw new Error('Inactive settings remain visible or interactive');
			window.querySelector('#settings-tab-input').click();
			await new Promise((resolve) => requestAnimationFrame(resolve));
			if (window.querySelector('#settings-section-input') !== inputPanel ||
				Math.abs(inputPanel.scrollTop - inputScroll) > 1 || mouseSection.open)
				throw new Error('Settings lost scroll or disclosure state across tabs');
			mouseSection.open = true;
			inputPanel.scrollTop = 0;

			window.querySelector('#settings-tab-gameplay').click();
			await new Promise((resolve) => requestAnimationFrame(resolve));
			const gameplay = window.querySelector('#settings-section-gameplay');
			const labels = [...gameplay.querySelectorAll('label')];
			const craft = labels.find((label) => label.textContent.includes('Confirm crafting attempts'))?.querySelector('input');
			const rare = labels.find((label) => label.textContent.includes('Confirm rare gem use'))?.querySelector('input');
			if (!craft || !rare || craft.disabled || rare.disabled) throw new Error('Gameplay confirmation controls are unavailable');

            const defense = labels.find((label) => label.textContent.includes('Hide self evasions/resists'))?.querySelector('input');
            const incantations = labels.find((label) => label.textContent.includes('Hide spell incantations'))?.querySelector('input');
            if (!defense?.checked || !incantations?.checked) throw new Error('Chat suppression must default on');
            const chat = globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.chat;
            const count = () => chat.read().retainedMessages.length;
            const start = count();
            const evade = { kind: 'combat', message: "You evaded Chat Probe's attack.", emphasized: false, selfEvasion: true };
            const resist = { kind: 'server', category: 'magic', message: 'You resist the spell cast by Chat Probe' };
            const words = { kind: 'speech', category: 'spellcasting', sender: 'Chat Probe', speakerKind: 'player', message: 'Probe incantation' };
            for (const message of [evade, resist, words]) chat.receive(message);
            await new Promise((resolve) => requestAnimationFrame(resolve));
            if (count() !== start) throw new Error('Suppressed messages entered retained history');
            defense.click();
            await new Promise((resolve) => requestAnimationFrame(resolve));
            if (count() !== start) throw new Error('Disabling suppression restored discarded messages');
            for (const message of [evade, resist, words]) chat.receive(message);
            await new Promise((resolve) => requestAnimationFrame(resolve));
            if (count() !== start + 2) throw new Error('Self defense suppression is not independent');
            incantations.click();
            await new Promise((resolve) => requestAnimationFrame(resolve));
            if (count() !== start + 2) throw new Error('Disabling incantation suppression restored history');
            chat.receive(words);
            await new Promise((resolve) => requestAnimationFrame(resolve));
            if (count() !== start + 3) throw new Error('Disabled incantation suppression still dropped chat');
            defense.click();
            incantations.click();
            await new Promise((resolve) => requestAnimationFrame(resolve));
            if (count() !== start + 3) throw new Error('Suppression settings changed existing history');
			const original = craft.checked;
			const originalRare = rare.checked;
			globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.deferNextGameplayUpdate();
			craft.click();
			await new Promise((resolve) => requestAnimationFrame(resolve));
			if (craft.checked !== original) throw new Error('Craft toggle changed before mirrored option delivery');
			globalThis.__HOLTBURGER_3D_CLIENT_HUD_HARNESS__.flushGameplayUpdate();
			await new Promise((resolve) => requestAnimationFrame(resolve));
			if (craft.checked !== !original) throw new Error('Craft confirmation preference was not applied');
			if (rare.checked !== originalRare) throw new Error('Craft preference changed rare confirmation');
			window.querySelector('#settings-tab-ui').click();
			await new Promise((resolve) => requestAnimationFrame(resolve));
			window.querySelector('#settings-tab-gameplay').click();
			await new Promise((resolve) => requestAnimationFrame(resolve));
			const restored = [...window.querySelectorAll('#settings-section-gameplay label')].find((label) => label.textContent.includes('Confirm crafting attempts'))?.querySelector('input');
			if (restored?.checked !== !original) throw new Error('Gameplay preference was lost across tabs');
			restored.click();
			window.querySelector('#settings-tab-graphics').click();
			await new Promise((resolve) => requestAnimationFrame(resolve));
			const graphicsTab = window.querySelector('#settings-tab-graphics');
			graphicsTab.focus();
			const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true, cancelable: true });
			graphicsTab.dispatchEvent(tabEvent);
			if (tabEvent.defaultPrevented) throw new Error('Settings intercepted native Tab traversal');
			const nextEvent = new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true, cancelable: true });
			graphicsTab.dispatchEvent(nextEvent);
			await new Promise((resolve) => requestAnimationFrame(resolve));
			const selectedAfterArrow = window.querySelector('[role="tab"][aria-selected="true"]')?.textContent.trim();
			if (selectedAfterArrow !== 'Audio') throw new Error('Settings tabs ignored keyboard navigation');
			for (const [key, expected] of [['End', 'gameplay'], ['ArrowRight', 'graphics'], ['ArrowLeft', 'gameplay'], ['Home', 'graphics']]) {
				const current = window.querySelector('[role="tab"][aria-selected="true"]');
				current.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true }));
				await new Promise((resolve) => requestAnimationFrame(resolve));
				const destination = window.querySelector('#settings-tab-' + expected);
				if (destination.getAttribute('aria-selected') !== 'true' || document.activeElement !== destination)
					throw new Error('Settings tabs failed selection/focus for ' + key);
			}
			window.querySelector('#settings-tab-ui').click();
			await new Promise((resolve) => requestAnimationFrame(resolve));
			const fpsToggle = [...window.querySelectorAll('#settings-section-ui label')]
				.find((label) => label.textContent.trim() === 'Show FPS')
				?.querySelector('input[type="checkbox"]');
			if (!fpsToggle || fpsToggle.checked || document.querySelector('.client-fps-counter'))
				throw new Error('FPS HUD must start hidden with its setting unchecked');
			fpsToggle.click();
			await new Promise((resolve) => requestAnimationFrame(resolve));
			if (!fpsToggle.checked || !document.querySelector('.client-fps-counter'))
				throw new Error('Show FPS did not mount the FPS HUD');
			fpsToggle.click();
			await new Promise((resolve) => requestAnimationFrame(resolve));
			if (fpsToggle.checked || document.querySelector('.client-fps-counter'))
				throw new Error('Show FPS did not unmount the FPS HUD');
			const nameplateToggle = () => [...window.querySelectorAll('#settings-section-ui label')]
				.find((label) => label.textContent.trim() === 'Always show entity nameplates')
				?.querySelector('input[type="checkbox"]');
			const initialNameplates = nameplateToggle()?.checked;
			if (initialNameplates === undefined) throw new Error('UI nameplate toggle is missing');
			nameplateToggle().click();
			await new Promise((resolve) => requestAnimationFrame(resolve));
			window.querySelector('#settings-tab-graphics').click();
			await new Promise((resolve) => requestAnimationFrame(resolve));
			window.querySelector('#settings-tab-ui').click();
			await new Promise((resolve) => requestAnimationFrame(resolve));
			if (nameplateToggle()?.checked !== !initialNameplates)
				throw new Error('Nameplate toggle did not retain its accepted value');
			nameplateToggle().click();
			await new Promise((resolve) => requestAnimationFrame(resolve));
			if (nameplateToggle()?.checked !== initialNameplates)
				throw new Error('Nameplate toggle did not restore its initial value');
			window.querySelector('#settings-tab-graphics').click();
			await new Promise((resolve) => requestAnimationFrame(resolve));
			graphicsTab.focus();
			return { tabs, dungeonAmbientSlider: true, retainedScrollAndDisclosures: true, selected: window.querySelector('[role="tab"][aria-selected="true"]')?.textContent.trim(), selectedAfterArrow };
		})()`,
	);
}
