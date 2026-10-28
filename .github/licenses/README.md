# Alpha native notices

These are original notice files from the exact native dependency revisions recorded in
`../native-notices.json`. Preserve the original bytes, including the Windows-1252 encoding
of V8's test262-harness notice. The generator checks their digests and decodes them explicitly
when producing the escaped HTML appendix. Do not replace them with generic license templates.

The inventory covers V8's source notices and native submodules pinned by rusty_v8 130.0.7:
ICU, Abseil, fast_float, FP16, libc++, libc++abi, and libunwind. The data in
deno_core_icudata 0.74.0 matches the same ICU revision's `common/icudtl.dat` Git blob recorded
in the descriptor. Rust crate notice resolution, including the packaged combined AWS-LC
notices, is owned by `../about.toml` and cargo-about.

When either named package changes, inspect its pinned source tree/submodules, retrieve their
original notices, and update the descriptor's versions, source URLs, encoding, and hashes.
The generated HTML and its freshness record are checked in and shared across both products; regenerate them locally when notice inputs change. CI reviews freshness without generation.
