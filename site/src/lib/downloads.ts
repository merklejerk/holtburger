import { z } from 'zod';

const repository = 'https://github.com/merklejerk/holtburger';
/** Public fallback when there is no verified release snapshot. */
export const releasesUrl = `${repository}/releases`;
/** Browser and build boundary for published download metadata. */
export const downloadSnapshotSchema = z
	.object({
		version: z.string().regex(/^0\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/),
		url: z.string().startsWith(`${releasesUrl}/tag/`),
		assets: z.record(
			z.string(),
			z.string().startsWith(`${releasesUrl}/download/`)
		)
	})
	.nullable();

/** Website presentation policy; package names and URLs come from the verified inventory. */
const platforms = [
	{
		id: 'windows',
		title: 'Windows',
		hardware: 'Intel or AMD · 64-bit',
		formats: {
			'3d': [
				{
					suffix: '-x86_64-pc-windows-msvc-setup.exe',
					label: 'Download Setup'
				},
				{ suffix: '-x86_64-pc-windows-msvc.zip', label: 'Portable ZIP' }
			],
			cli: [{ suffix: '-x86_64-pc-windows-msvc.zip', label: 'Download ZIP' }]
		}
	},
	{
		id: 'macos',
		title: 'Mac',
		hardware: 'Apple silicon · M1 or newer',
		formats: {
			'3d': [
				{ suffix: '-aarch64-apple-darwin.dmg', label: 'Download DMG' },
				{ suffix: '-aarch64-apple-darwin.zip', label: 'Portable ZIP' }
			],
			cli: [{ suffix: '-aarch64-apple-darwin.zip', label: 'Download ZIP' }]
		}
	},
	{
		id: 'linux',
		title: 'Linux',
		hardware: 'Intel or AMD · 64-bit',
		formats: {
			'3d': [
				{ suffix: '-x86_64.flatpak', label: 'Download Flatpak' },
				{ suffix: '-x86_64-unknown-linux-gnu.tar.gz', label: 'Portable tar.gz' }
			],
			cli: [
				{ suffix: '-x86_64.flatpak', label: 'Download Flatpak' },
				{ suffix: '-x86_64-unknown-linux-gnu.tar.gz', label: 'Portable tar.gz' }
			]
		}
	}
] as const;

/** Select every required download once, so labels and links refresh as one publication. */
export function readRelease(value: unknown) {
	const release = downloadSnapshotSchema.parse(value);
	if (release === null) return null;
	const groups = (product: '3d' | 'cli') =>
		platforms.map((platform) => ({
			platform: platform.id,
			title: platform.title,
			hardware: platform.hardware,
			files: platform.formats[product].map(({ suffix, label }) => {
				const matches = Object.entries(release.assets).filter(
					([name]) =>
						name.startsWith(`holtburger-${product}-${release.version}-`) &&
						name.endsWith(suffix)
				);
				if (matches.length !== 1)
					throw new Error(
						`Expected one ${product} download for ${platform.id}: ${suffix}`
					);
				const [[, url]] = matches;
				return { url, label };
			})
		}));
	return {
		version: release.version,
		url: release.url,
		products: { '3d': groups('3d'), cli: groups('cli') }
	};
}
