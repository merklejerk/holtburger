import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { navigation } from '../src/lib/content/navigation.ts';
import {
	media,
	galleryImages,
	galleryClips
} from '../src/lib/media/catalog.ts';
import catalog from '../src/lib/generated/pages.json' with { type: 'json' };

const origin =
	process.env.SITE_PREVIEW_URL ?? 'http://127.0.0.1:4178/holtburger/';
const captures = process.env.SITE_CAPTURE_DIR ?? '/tmp/holtburger-site-review';
await mkdir(captures, { recursive: true });
const browser = await chromium.launch({
	executablePath: process.env.CHROME_PATH ?? '/opt/google/chrome/chrome',
	headless: true,
	args: ['--no-sandbox']
});
try {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 1000 }
	});
	/** @type {string[]} */
	const failures = [];
	page.on('pageerror', (error) => failures.push(error.message));
	// Exercise real clicks with JavaScript enabled, including non-page destinations.
	await page.goto(origin);
	const screenshot = page.locator('.terminal-plate > a');
	const imageHref = await screenshot.getAttribute('href');
	if (imageHref === null) throw new Error('Screenshot has no destination');
	const imageUrl = new URL(imageHref, page.url()).href;
	const imageResponse = page.waitForResponse(
		(response) =>
			response.url() === imageUrl && response.request().isNavigationRequest()
	);
	await screenshot.click();
	assert.equal((await imageResponse).status(), 200);
	assert.match((await imageResponse).headers()['content-type'], /^image\//);
	await page.waitForURL(imageUrl);
	assert.equal(await page.locator('h1').count(), 0);
	await page.goBack();
	await screenshot.waitFor();
	assert.equal(page.url(), origin);
	for (const { slug, label } of [
		{ slug: '3d', label: '3D client' },
		{ slug: 'tui', label: 'TUI client' }
	]) {
		const entry = catalog.find((entry) => entry.slug === slug);
		if (!entry) throw new Error(`Missing guide: ${slug}`);
		await page
			.getByRole('navigation', { name: 'Main navigation' })
			.getByRole('link', { name: label, exact: true })
			.click();
		await page.getByRole('heading', { name: entry.title, level: 1 }).waitFor();
		assert.equal(page.url(), new URL(`${slug}/`, origin).href);
	}
	await page.goBack();
	await page.waitForURL(new URL('3d/', origin).href);
	assert.equal(page.url(), new URL('3d/', origin).href);
	await page.goForward();
	await page.waitForURL(new URL('tui/', origin).href);
	assert.equal(page.url(), new URL('tui/', origin).href);
	for (const [path, name] of [
		['', 'home'],
		['gallery/', 'gallery'],
		['start/3d/linux/', 'installation'],
		['startup/characters/', 'characters'],
		['3d/movement-camera/', 'jumping'],
		['3d/chat-commands/', 'commands'],
		['tui/basics/', 'terminal'],
		['tui/scripting/integrations/', 'scripting'],
		['3d/combat/', 'guide'],
		['3d/controls/', 'reference']
	]) {
		const response = await page.goto(new URL(path, origin).href);
		assert.equal(response?.status(), 200);
		await page.evaluate(() => document.fonts.ready);
		if (name === 'reference') {
			assert.equal(await page.locator('.guide-reference').count(), 1);
			assert.ok((await page.getByRole('table').count()) > 0);
		}
		assert.equal(await page.locator('h1').count(), 1);
		if (name === 'gallery') {
			assert.equal(
				await page.locator('.gallery-grid img').count(),
				galleryImages.filter((id) => media[id].kind === 'image').length
			);
			assert.equal(
				await page.locator('.media-placeholder').count(),
				[...galleryImages, ...galleryClips].filter((id) =>
					media[id].kind.startsWith('planned')
				).length
			);
			assert.equal(await page.locator('iframe').count(), 0);
		}

		await page.locator('img').evaluateAll(async (images) => {
			for (const image of images) {
				if (!(image instanceof HTMLImageElement))
					throw new Error('Expected an image');
				image.loading = 'eager';
				await image.decode();
			}
		});
		await page.screenshot({
			path: `${captures}/${name}-desktop.png`,
			fullPage: true
		});
		await page.setViewportSize({ width: 390, height: 844 });
		assert.equal(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth
			),
			true,
			`${name}: horizontal mobile overflow`
		);
		await page.screenshot({
			path: `${captures}/${name}-mobile.png`,
			fullPage: true
		});
		await page.setViewportSize({ width: 1440, height: 1000 });
	}
	for (const route of ['', '3d/combat/']) {
		await page.goto(new URL(route, origin).href);
		assert.equal(
			await page.locator('pagefind-config').getAttribute('bundle-path'),
			new URL('pagefind/', origin).pathname
		);
		await page.locator('pagefind-modal-trigger').click();
		const search = page.getByRole('searchbox');
		await search.fill('Smart Tab');
		const result = page
			.getByRole('link', { name: /Targeting & fighting/ })
			.last();
		await result.waitFor();
		const href = await result.getAttribute('href');
		if (href === null) throw new Error('Search result has no destination');
		assert.equal(
			new URL(href, page.url()).pathname.replace(/\/$/, ''),
			new URL('3d/combat/', origin).pathname.replace(/\/$/, '')
		);
		await search.press('Escape');
	}
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto(new URL('3d/combat/', origin).href);
	const menuButton = page.getByRole('button', {
		name: 'Open guide navigation'
	});
	const guideMenu = page.getByRole('dialog', { name: 'Browse the guides' });
	await menuButton.click();
	await guideMenu.waitFor();
	assert.equal(
		await page.evaluate(
			() => getComputedStyle(document.documentElement).overflow
		),
		'hidden'
	);
	// Native dialogs may yield focus to browser chrome, but never background controls.
	for (const key of ['Shift+Tab', 'Tab']) {
		await page.keyboard.press(key);
		assert.equal(
			await guideMenu.evaluate(
				(menu) => !document.hasFocus() || menu.contains(document.activeElement)
			),
			true
		);
	}
	await page.keyboard.press('Escape');
	await guideMenu.waitFor({ state: 'hidden' });
	assert.equal(
		await menuButton.evaluate((button) => button === document.activeElement),
		true
	);
	await menuButton.click();
	await page.getByRole('button', { name: 'Close guide navigation' }).click();
	await guideMenu.waitFor({ state: 'hidden' });
	await menuButton.click();
	await page.mouse.click(1, 1);
	await guideMenu.waitFor({ state: 'hidden' });
	await menuButton.click();
	await page.setViewportSize({ width: 1440, height: 1000 });
	await guideMenu.waitFor({ state: 'hidden' });
	await page.getByRole('complementary', { name: 'Guide navigation' }).waitFor();
	assert.notEqual(
		await page.evaluate(
			() => getComputedStyle(document.documentElement).overflow
		),
		'hidden'
	);
	await page.setViewportSize({ width: 390, height: 844 });
	await menuButton.click();
	await guideMenu.locator('summary').filter({ hasText: 'Startup' }).click();
	await guideMenu.getByRole('link', { name: 'Launcher', exact: true }).click();
	await page.getByRole('heading', { name: 'Launcher', level: 1 }).waitFor();
	assert.equal(page.url(), new URL('startup/launcher/', origin).href);
	for (const entry of catalog) {
		const response = await page.goto(new URL(`${entry.slug}/`, origin).href);
		assert.equal(response?.status(), 200, `Route ${entry.slug}`);
		assert.equal(await page.locator('h1').textContent(), entry.title);
		assert.deepEqual(
			await page.locator('.guide-sidebar summary').allTextContents(),
			navigation
				.filter((section) => section.links.length > 1)
				.map((section) => section.title),
			`${entry.slug}: sidebar sections changed`
		);

		assert.equal(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth
			),
			true,
			`${entry.slug}: horizontal mobile overflow`
		);
	}
	const missing = await page.goto(new URL('missing-guide/', origin).href);
	assert.equal(missing?.status(), 404);
	const plain = await browser.newContext({ javaScriptEnabled: false });
	try {
		const reader = await plain.newPage();
		await reader.goto(origin);
		await reader.getByRole('link', { name: 'Gallery', exact: true }).click();
		await reader
			.getByRole('heading', { name: 'Views from Dereth', level: 1 })
			.waitFor();
		assert.equal(
			await reader.locator('.gallery-grid img').count(),
			galleryImages.filter((id) => media[id].kind === 'image').length
		);
		await reader.goto(new URL('3d/combat/', origin).href);
		await reader
			.getByRole('heading', { name: 'Use Smart Tab in combat', exact: true })
			.waitFor();
		await reader
			.locator('.guide-sidebar summary')
			.filter({ hasText: 'Startup' })
			.click();
		await reader
			.getByRole('link', {
				name: 'Launcher',
				exact: true
			})
			.click();
		await reader
			.getByRole('heading', {
				name: 'Launcher',
				level: 1
			})
			.waitFor();
	} finally {
		await plain.close();
	}
	assert.deepEqual(failures, []);
	console.log(`Browser checks passed; review captures: ${captures}`);
} finally {
	await browser.close();
}
