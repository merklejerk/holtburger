# Open World Streaming System

This tree owns the replacement `apps/holtburger-3d` materialization pipeline.

Code in this system is organized by owning workflow or domain rather than broad
concept buckets. New contracts should be native to owner-indexed open-world
streaming. Legacy compatibility belongs at explicit adapter or shim boundaries,
and shims must have deletion targets.

## Boundary Rules

- Keep replacement contracts direct and native to this model.
- Reuse legacy transforms through named adapters.
- Do not import legacy orchestration internals from replacement core modules.
- Keep browser, harness, and legacy-shaped compatibility projections outside
  replacement internals.
- Add tests near the behavior they prove.
