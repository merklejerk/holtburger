import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
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
	for (const [path, name] of [
		['', 'home'],
		['gallery/', 'gallery'],
		['start/3d/linux/', 'installation'],
		['start/characters/', 'characters'],
		['3d/jumping/', 'jumping'],
		['reference/3d-chat-commands/', 'commands'],
		['tui/basics/', 'terminal'],
		['scripting/integrations/', 'scripting'],
		['3d/selection-interaction/', 'guide']
	]) {
		const response = await page.goto(new URL(path, origin).href);
		assert.equal(response?.status(), 200);
		await page.evaluate(() => document.fonts.ready);
		assert.equal(await page.locator('h1').count(), 1);
		if (name === 'gallery') {
			assert.equal(await page.locator('.gallery-grid img').count(), 7);
			assert.equal(await page.locator('.media-placeholder').count(), 4);
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
			path: `${captures}/${name}-dark.png`,
			fullPage: true
		});
		await page.getByRole('button', { name: 'Use light theme' }).click();
		await page.screenshot({
			path: `${captures}/${name}-light.png`,
			fullPage: true
		});
		await page.reload();
		assert.equal(
			await page.locator('html').getAttribute('data-theme'),
			'light'
		);
		await page.getByRole('button', { name: 'Use dark theme' }).click();
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
	for (const anchor of await page
		.locator('.on-this-page a')
		.evaluateAll((links) => links.map((link) => link.getAttribute('href')))) {
		if (anchor === null) throw new Error('Missing heading link');
		assert.equal(
			await page.locator(anchor).count(),
			1,
			`Missing heading ${anchor}`
		);
	}
	await page.locator('pagefind-modal-trigger').click();
	const search = page.getByRole('searchbox');
	await search.fill('Smart Tab');
	await page
		.getByRole('link', { name: /Selection & interaction/ })
		.last()
		.waitFor();
	await search.press('Escape');
	await page.setViewportSize({ width: 390, height: 844 });
	for (const entry of catalog) {
		const response = await page.goto(new URL(`${entry.slug}/`, origin).href);
		assert.equal(response?.status(), 200, `Route ${entry.slug}`);
		assert.equal(await page.locator('h1').textContent(), entry.title);
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
		assert.equal(await reader.locator('.gallery-grid img').count(), 7);
		await reader.goto(new URL('3d/selection-interaction/', origin).href);
		await reader
			.getByRole('heading', { name: 'Start with Smart Tab', exact: true })
			.waitFor();
		await reader
			.getByRole('cell', { name: 'Interact with selection', exact: true })
			.waitFor();
		await reader
			.locator('summary')
			.filter({ hasText: 'Items & equipment' })
			.click();
		await reader
			.getByRole('link', { name: 'Equipment loadouts', exact: true })
			.click();
		await reader
			.getByRole('heading', { name: 'Equipment loadouts', level: 1 })
			.waitFor();
	} finally {
		await plain.close();
	}
	assert.deepEqual(failures, []);
	console.log(`Browser checks passed; review captures: ${captures}`);
} finally {
	await browser.close();
}
