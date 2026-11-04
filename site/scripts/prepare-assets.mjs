import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Existing checked-in media is reused at build time; generated copies stay ignored.
const destination = new URL('../static/assets/', import.meta.url);
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
for (const directory of ['branding', 'screenshots']) {
	await cp(
		new URL(`../../assets/${directory}/`, import.meta.url),
		new URL(`${directory}/`, destination),
		{ recursive: true }
	);
}
for (const family of ['gelasio', 'arimo']) {
	await cp(
		new URL(
			`../../apps/holtburger-3d/public/fonts/${family}/`,
			import.meta.url
		),
		new URL(`fonts/${family}/`, destination),
		{ recursive: true }
	);
}
// Reuse the client's authored materials without coupling site behavior to app styles.
await mkdir(new URL('theme/', destination), { recursive: true });
for (const name of ['frame', 'leather']) {
	const file = `travelers-kit-${name}.svg`;
	await cp(
		new URL(
			`../../apps/holtburger-3d/src/assets/icons/${file}`,
			import.meta.url
		),
		new URL(`theme/${file}`, destination)
	);
}
console.log(`Prepared existing site assets in ${fileURLToPath(destination)}`);
