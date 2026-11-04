# Holtburger scripting

The player-facing scripting guide lives on the website:

- [Write your first script](https://merklejerk.github.io/holtburger/scripting/)
- [Runtime and persistence](https://merklejerk.github.io/holtburger/scripting/runtime/)
- [API reference](https://merklejerk.github.io/holtburger/scripting/reference/)
- [HTTP integrations](https://merklejerk.github.io/holtburger/scripting/integrations/)
- [Run scripts in the TUI](https://merklejerk.github.io/holtburger/tui/running-scripts/)

For local authoring, use [holtburger.d.ts](holtburger.d.ts) as the API contract.
The website copies that file for download and checks its runnable examples against
it. Keep declarations aligned with the Rust event/action types and the `HB` host
bindings when changing the runtime.

Runnable JavaScript examples live in `site/examples/`. Their source is embedded in
the website guides and copied for download at build time; do not maintain separate
copies in this crate. Run `npm run check:examples` from `site/` to type-check them.

The shipped scripts live in [assets/scripts](../../assets/scripts/README.md).
The [mage source package](../../assets/scripts/src/mage/README.md) documents its
TypeScript build and data generation.
