<script lang="ts">
	import { asset, resolve } from '$app/paths';
	import MediaCarousel from '#lib/components/MediaCarousel.svelte';
	import { mediaUrl } from '#lib/media/url.ts';
	import { illustrations } from '#lib/illustrations.ts';
	import { downloads } from '#lib/downloads.svelte.ts';
	const guide = (slug: string) => resolve('/[...slug]', { slug });
</script>

<svelte:head>
	<title>Holtburger · The Asheron's Call client, reengineered.</title>
	<meta
		name="description"
		content="The Asheron's Call client, reengineered. A Rust core, a 3D Electron interface, and a scriptable terminal client."
	/>
</svelte:head>

<main id="main" class="home-document" data-pagefind-body>
	<header class="home-cover">
		<div class="cover-copy">
			<h1>The Asheron's Call client,<br />reengineered.</h1>
			<p class="cover-deck">
				Built from the protocol up: a Rust core, a 3D Electron interface, and a
				scriptable terminal client.
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
			<img
				class="cover-vignette"
				{...illustrations.cottages}
				src={mediaUrl(illustrations.cottages.src)}
				alt=""
				aria-hidden="true"
			/>
		</div>
	</header>

	<MediaCarousel
		label="Holtburger 3D screenshots"
		images={['outdoors', 'combat', 'jump', 'map', 'characters', 'holtburg']}
	/>

	<div class="home-editorial">
		<section class="opening-argument">
			<h2>Keep Dereth.<br />Rethink the client.</h2>
			<p>
				You know the world. The interface should help you play it. Holtburger
				brings a fresh client to the existing game, with room to question the
				layouts, controls and workarounds you have lived with for years.
			</p>
		</section>
		<section class="player-argument">
			<h2>Built for the player at the keyboard</h2>
			<p>
				A long-running game accumulates friction. Plugins fill the gaps, windows
				crowd the view, and familiar workarounds become muscle memory. A new
				client is a chance to make those everyday interactions work together.
			</p>
			<p>
				h3d puts active play first: less time arranging the interface or digging
				through it, more attention on the fight, the route and the people beside
				you. Its compact HUD and integrated tools are designed around that goal.
			</p>
		</section>
	</div>

	<section class="foundation-spread">
		<img
			class="editorial-vignette"
			{...illustrations.countryside}
			src={mediaUrl(illustrations.countryside.src)}
			alt=""
			aria-hidden="true"
			loading="lazy"
		/>
		<div>
			<h2>Reengineered,<br />from the protocol up</h2>
			<p>
				Holtburger began with a Rust client core built against ACE. Its
				interface, renderer and physics were designed from the ground up, with
				retail research used to align behavior where compatibility requires it.
			</p>
			<p>
				That leaves room for the client to evolve with today’s tools. A
				browser-based desktop interface makes expressive themes possible; a
				shared core supports different ways to play the same game.
			</p>
			<p><a href={guide('3d')}>Explore the 3D client →</a></p>
		</div>
	</section>

	<section class="terminal-spread">
		<div>
			<h2>A lighter form<br />for a different job</h2>
			<p>
				Automation does not need a rendered world. The terminal client uses the
				same core in a form suited to scripts and bots, with JavaScript access
				to game state and actions.
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
					alt="Terminal gameplay showing nearby creatures, item appraisal and combat feedback"
					width="1055"
					height="818"
					loading="lazy"
				/></a
			>
			<figcaption>The terminal client.</figcaption>
		</figure>
	</section>
</main>
