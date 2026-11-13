<script lang="ts">
	import { asset, resolve } from '$app/paths';
	import MediaCarousel from '#lib/components/MediaCarousel.svelte';
	import DecorativeArt from '#lib/components/DecorativeArt.svelte';
	import { downloads } from '#lib/downloads.svelte.ts';
	const guide = (slug: string) => resolve('/[...slug]', { slug });
</script>

<svelte:head>
	<title>Holtburger · The Asheron's Call client, reengineered.</title>
	<meta
		name="description"
		content="An independently built, open-source Asheron's Call client. A fresh approach to movement, combat, visuals, and everyday play."
	/>
</svelte:head>

<main id="main" class="home-document" data-pagefind-body>
	<header class="home-cover">
		<div class="cover-copy">
			<h1>The Asheron's Call client,<br />reengineered.</h1>
			<p class="cover-deck">
				An independently built, open-source client for Asheron’s Call, with a
				fresh approach to movement, combat, visuals, and everyday play.
			</p>
			<div class="hero-actions">
				<a class="button" href={guide('start')}
					>Download Holtburger{downloads.release === null
						? ''
						: ` ${downloads.release.version}`}
					<span class="download-platforms"
						>Available for Windows, Linux, and Mac</span
					>
				</a>
				<a href={guide('coming-from-retail')}>Coming from retail?</a>
			</div>
			<DecorativeArt name="olthoi" class="cover-vignette" loading="eager" />
			<DecorativeArt
				name="lifestone"
				class="cover-vignette cover-vignette-right"
				loading="eager"
			/>
		</div>
	</header>

	<MediaCarousel
		label="Holtburger 3D screenshots"
		images={[
			'outdoors',
			'combat',
			'combat-phalanx',
			'jump',
			'map',
			'characters',
			'holtburg'
		]}
	/>

	<div class="home-editorial">
		<section class="opening-argument">
			<h2>Keep Dereth.<br />Rethink the client.</h2>
			<p>
				You know the world, its challenges, and the people who keep you coming
				back. Holtburger brings a fresh client to that existing game. Its own
				rendering, movement, and physics leave room to reconsider how you
				experience Dereth, right down to the controls and everyday tools.
			</p>
		</section>
		<section class="player-argument">
			<h2>Built for the player at the keyboard</h2>
			<DecorativeArt name="lugian" class="creature-vignette" />
			<p>
				Keep moving while casting or healing, using your normal movement
				controls. Plan a jump with a visible trajectory. Follow a fight through
				enemy health bars and floating damage numbers, and recognize equipment
				cantrip tiers at a glance.
			</p>
			<p>
				h3d brings those decisions together with combined inventory views, saved
				gear swaps, and maps that connect your quests and destinations. The goal
				is less routine management and more attention on the fight, the route,
				and the people beside you.
			</p>
		</section>
	</div>

	<section class="foundation-spread">
		<DecorativeArt name="black-hills" class="editorial-vignette" />
		<div>
			<h2>Open source.<br />Yours to inspect.</h2>
			<p>
				A client is software you trust with your game account. Holtburger’s
				source is available for anyone to inspect, from how it connects to the
				server to how it handles your actions in the world.
			</p>
			<p>
				You can study how it works, modify it, and build it yourself. That same
				openness gives the project a future others can carry forward.
			</p>
			<p>
				<a href={guide('3d')}>Explore the 3D client →</a>
				·
				<a href="https://github.com/merklejerk/holtburger"
					>Browse the source →</a
				>
			</p>
		</div>
	</section>

	<section class="terminal-spread">
		<div>
			<h2>A lighter form<br />for a different job</h2>
			<p>
				Holtburger began as a terminal client built against ACE. That client
				gives scripts and bots a home without rendering a 3D world, with access
				to game state and actions and bundled combat scripts to study and adapt.
			</p>
			<p>
				h3d’s focus on active play is a design direction. Plugins and scripting
				are planned there too; the TUI already gives automation its own home.
			</p>
			<p><a href={guide('tui')}>Explore the terminal client →</a></p>
		</div>
		<figure class="terminal-plate">
			<a
				href={asset('assets/screenshots/tui.webp')}
				aria-label="View the terminal screenshot at full size"
				><img
					src={asset('assets/screenshots/tui.webp')}
					alt="Terminal gameplay showing nearby creatures, item appraisal, and combat feedback"
					width="1055"
					height="818"
					loading="lazy"
				/></a
			>
			<figcaption>The terminal client.</figcaption>
		</figure>
	</section>
</main>
