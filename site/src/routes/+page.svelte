<script lang="ts">
	import { asset, resolve } from '$app/paths';
	import MediaCarousel from '#lib/components/MediaCarousel.svelte';
	const guide = (slug: string) => resolve('/[...slug]', { slug });
</script>

<svelte:head>
	<title>Holtburger · The Asheron's Call client, reengineered.</title>
	<meta
		name="description"
		content="The Asheron's Call client, reengineered. A Rust core, a 3D interface, and a scriptable terminal client."
	/>
</svelte:head>

<main id="main" class="home-document" data-pagefind-body>
	<header class="home-hero">
		<img
			class="hero-scene"
			src={asset('assets/screenshots/3d-holtburg.webp')}
			alt="A character in Holtburg, with nearby players and the world map"
			width="1740"
			height="1189"
			fetchpriority="high"
		/>
		<div class="hero-copy">
			<h1>The Asheron's Call client,<br /><em>reengineered.</em></h1>
			<p>
				Built from the protocol up: a Rust core, a 3D interface, and a
				scriptable terminal client.
			</p>
			<div class="hero-actions">
				<a class="button" href={guide('start')}>Download Holtburger</a><a
					href={guide('coming-from-retail')}>Coming from retail?</a
				>
			</div>
		</div>
		<a class="hero-caption" href={asset('assets/screenshots/3d-holtburg.webp')}
			>Holtburg · View screenshot</a
		>
	</header>
	<div class="home-spread">
		<div class="home-body">
			<section class="field-entry">
				<h2>Keep Dereth. Rethink the client.</h2>
				<p>
					You know the world. The interface should help you play it. Holtburger
					brings a fresh client to the existing game, with room to question the
					layouts, controls and workarounds you have lived with for years.
				</p>
				<MediaCarousel
					label="Holtburger 3D screenshots"
					images={[
						'outdoors',
						'combat',
						'jump',
						'map',
						'characters',
						'holtburg'
					]}
				/>
			</section>

			<section class="field-entry">
				<h2>Built for the player at the keyboard</h2>
				<p>
					A long-running game accumulates friction. Plugins fill the gaps,
					windows crowd the view, and familiar workarounds become muscle memory.
					A new client is a chance to make those everyday interactions work
					together.
				</p>
				<p>
					h3d puts active play first: less time arranging the interface or
					digging through it, more attention on the fight, the route and the
					people beside you. Its compact HUD and integrated tools are designed
					around that goal.
				</p>
			</section>

			<section class="field-entry">
				<h2>Reengineered, from the protocol up</h2>
				<p>
					Holtburger began with a Rust client core built against ACE. Its
					interface, renderer and physics were designed from the ground up, with
					retail research used to align behavior where compatibility requires
					it.
				</p>
				<p>
					That leaves room for the client to evolve with today’s tools. A
					browser-based desktop interface makes expressive themes possible; a
					shared core supports different ways to play the same game.
				</p>
			</section>

			<section class="field-entry terminal-entry">
				<h2>A lighter form for a different job</h2>
				<p>
					Automation does not need a rendered world. The terminal client uses
					the same core in a form suited to scripts and bots, with JavaScript
					access to game state and actions.
				</p>
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
				<p>
					h3d’s focus on active play is a design direction. Plugins and
					scripting are planned there too; the TUI already gives automation its
					own home.
				</p>
				<p><a href={guide('tui')}>Explore the terminal client →</a></p>
			</section>
		</div>
	</div>
</main>
