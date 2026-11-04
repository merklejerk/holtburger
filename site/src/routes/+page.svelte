<script lang="ts">
	import { asset, resolve } from '$app/paths';
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
				<a class="button" href={guide('start')}>Download the beta</a><a
					href={guide('coming-from-retail')}>Coming from retail & Decal →</a
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
				<h2>A client for active play</h2>
				<p>
					Holtburger 3D brings its own interface to Dereth, with quality of life
					tools built in. Find targets, prepare equipment, organize spells, and
					keep useful information close at hand.
				</p>
				<dl class="feature-notes">
					<div>
						<dt>
							<a href={guide('3d/combat')}>Smart Tab targeting</a>
						</dt>
						<dd>
							Tap to cycle targets. Hold to acquire an immediate candidate, then
							choose your next action.
						</dd>
					</div>
					<div>
						<dt>Equipment & spells</dt>
						<dd>
							Save selected equipment slots as a loadout. Search your spellbook
							and arrange your bars around the way you play.
						</dd>
					</div>
					<div>
						<dt>Your field of view</dt>
						<dd>
							Move and resize the HUD, scale text independently, and set alerts
							for nearby entities you care about.
						</dd>
					</div>
				</dl>
				<p><a href={guide('3d')}>Explore the 3D client →</a></p>
			</section>

			<section class="field-entry jump-entry">
				<h2>Before you leap</h2>
				<figure class="margin-plate">
					<a
						href={asset('assets/screenshots/3d-precise-jump.webp')}
						aria-label="View the precise jumping screenshot at full size"
						><img
							src={asset('assets/screenshots/3d-precise-jump.webp')}
							alt="A jump trajectory and power preview between forest platforms"
							width="1740"
							height="1189"
							loading="lazy"
						/></a
					>
					<figcaption>Precise jump targeting.</figcaption>
				</figure>
				<p>
					Choose your power and inspect the trajectory before committing to a
					jump. The preview helps you judge the attempt; it doesn't guarantee a
					landing.
				</p>
				<p>
					Manual charged jumping is still available. Holtburger's physics and
					controls have their own feel.
				</p>
			</section>

			<section class="field-entry terminal-entry">
				<h2>Another way into Dereth</h2>
				<p>
					The TUI puts gameplay and automation in a terminal. Run the bundled
					fighter or mage, or write your own JavaScript against structured game
					state and actions.
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
					<figcaption>
						The terminal client, with inventory and combat information.
					</figcaption>
				</figure>
				<p><a href={guide('tui')}>Explore the terminal client →</a></p>
			</section>
		</div>

		<aside class="field-index" aria-label="Begin your journey">
			<h2>Begin here</h2>
			<p>Returning to Dereth?</p>
			<a class="index-link" href={guide('coming-from-retail')}
				>Coming from retail & Decal</a
			>
			<a class="index-link" href={guide('3d/combat')}>Learn the new controls</a>
			<a class="button primary" href={guide('start')}>Download the beta</a>
			<p class="platform-note">
				Windows · macOS · Linux<br />Bring your own game files for 3D.
			</p>
			<h2>In this kit</h2>
			<ol class="chapter-index">
				<li><a href={guide('3d')}>The 3D client</a></li>
				<li><a href={guide('tui')}>The terminal client</a></li>
				<li><a href={guide('gallery')}>Screenshots & clips</a></li>
				<li><a href={guide('reference')}>Controls & reference</a></li>
				<li><a href={guide('support')}>Help on the road</a></li>
			</ol>
			<h2>A work in progress</h2>
			<p>
				Both clients are in active development against ACE. GDLE compatibility
				is unverified.
			</p>
			<p>h3d has no plugin system yet. The TUI provides scripting today.</p>
			<a class="index-link" href={guide('about/design')}
				>Why we built it this way</a
			>
		</aside>
	</div>
</main>
