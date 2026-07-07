# Open World Streaming System

This tree owns the replacement `apps/holtburger-3d` materialization pipeline.

Code in this system is organized by owning workflow or domain rather than broad
concept buckets. Contracts should be native to owner-indexed open-world
streaming. Historical pipeline bridges do not belong in this tree.

## Boundary Rules

- Keep replacement contracts direct and native to this model.
- Reuse durable host, worker, and renderer boundaries through named adapters.
- Do not import retired orchestration internals from replacement core modules.
- Keep browser and harness projections direct to replacement diagnostics.
- Add tests near the behavior they prove.
