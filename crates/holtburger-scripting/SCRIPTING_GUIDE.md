# Holtburger scripting

The player-facing [scripting guide](https://merklejerk.github.io/holtburger/tui/scripting/)
covers writing and running scripts, the API, persistence, HTTP integrations and
bundled examples.

For local authoring, use [holtburger.d.ts](holtburger.d.ts) as the API contract.
The website copies that file for download and checks its runnable examples against
it. Keep declarations aligned with the Rust event/action types and the `HB` host
bindings when changing the runtime.

Runnable JavaScript examples live in `site/examples/`. Their source is embedded in
the website guides and copied for download at build time; do not maintain separate
copies in this crate. Run `npm run check:examples` from `site/` to type-check them.

The shipped scripts live in [apps/holtburger-cli/scripts](../../apps/holtburger-cli/scripts/README.md).
The [mage source package](../../apps/holtburger-cli/scripts/src/mage/README.md) documents its
TypeScript build and data generation.
