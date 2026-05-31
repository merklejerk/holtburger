# Holtburger 3D Portal Depth Copy Postmortem

Date: 2026-05-30

Status: resolved in the active WebGL2 renderer implementation.

Related plan:

- [Holtburger 3D WebGL2 Material, Portal, and Atlas Continuation Plan](./holtburger-3d-webgl2-material-atlas-continuation-plan.md)

## Summary

Outdoor-to-indoor portal compositing in the WebGL2 dual-target renderer showed terrain/base-scene
bands through portal apertures. The artifact looked like terrain under a building footprint was
partially rejecting the aperture mask. That interpretation was plausible for much of the triage,
but it was incomplete.

The final root cause was two-part:

1. Portal composite targets were receiving depth through a fullscreen shader copy:
   `gl_FragDepth = texture(uDepthTexture, vUv).r`.
2. The aperture mask then performed shader-side manual depth comparison against sampled copied
   depth.

Rendering the same aperture as ordinary geometry proved the aperture mesh and base scene depth were
valid. Replacing portal-composite depth transfer with `gl.blitFramebuffer(... DEPTH_BUFFER_BIT ...)`
made copied-target geometry valid as well. Switching normal mask coverage back to fixed-function
`LEQUAL` against the copied composite depth buffer removed the remaining stencil holes.

The normal portal render now uses framebuffer depth blits for portal composite depth transfer and
fixed-function depth testing for aperture mask coverage.

## Symptoms

- With terrain enabled, outdoor-to-indoor portal apertures had horizontal or diagonal missing bands.
- The missing bands exposed the already-rendered exterior/base scene where interior content should
  have appeared.
- The issue was visible in normal rendering and stencil/debug modes.
- Disabling aperture mask depth testing made the holes disappear, but also removed legitimate
  foreground occlusion.
- The artifact varied with camera movement and depth range enough to look like precision or
  terrain-depth poisoning.

## Context

The WebGL2 portal compositor renders scene domains into offscreen color/depth targets, then uses
ping-pong portal composite targets to accumulate portal recursion:

1. Render exterior and interior scene-domain targets.
2. Copy the base scene-domain color/depth into a portal composite target.
3. For each portal depth level:
   - copy current composite target into the alternate composite target;
   - draw aperture masks into stencil;
   - composite the incoming scene-domain target through stencil;
   - swap ping-pong targets.
4. Copy final composite color/depth to the default framebuffer.

The fragile step was the portal-composite color/depth copy. Color still needs the fullscreen shader
copy. Depth should not be copied by sampling a depth texture and writing `gl_FragDepth` when a
matching framebuffer depth blit is available.

## What Misled Us

Several diagnostics made the problem look like terrain occluder-depth ownership:

- `no-mask-depth` removed the holes, proving the aperture mask depth test was involved.
- `depth-delta-color` and `raw-depth-delta-color` showed rejected aperture regions.
- `fixed-mask-depth` initially still showed holes, seeming to agree with the shader compare.
- Disabling terrain changed the artifact, making terrain depth under or near the portal footprint a
  plausible culprit.

Those observations were not false, but they were not sufficient. The key missing distinction was
whether the portal aperture failed against the original scene-domain depth or against copied portal
composite depth.

## Decisive Diagnostics

### `scene-portal-geometry`

This mode draws the portal aperture mesh directly into the base scene-domain framebuffer:

- ordinary magenta geometry;
- fixed-function `LEQUAL`;
- depth writes enabled;
- stencil disabled;
- no portal composite target;
- no portal composite pass.

Result: the aperture rendered solid. This proved the portal mesh, transform, projection, and
original scene-domain depth were not the cause.

### `portal-geometry-depth`

This mode draws the same aperture mesh as ordinary magenta geometry after copying the base scene into
the portal composite target:

- ordinary magenta geometry;
- fixed-function `LEQUAL`;
- depth writes enabled;
- stencil disabled;
- no incoming portal composite.

Before the fix, this mode clipped. That proved the problem appeared after scene-domain depth was
copied into the portal composite target.

### `portal-geometry-depth-blit`

This mode matched `portal-geometry-depth`, except the scene-to-composite depth transfer used
`gl.blitFramebuffer(... DEPTH_BUFFER_BIT ...)`.

Result: the aperture rendered solid. This proved the shader depth-copy path was producing depth that
was not equivalent to framebuffer depth for this compositor use case.

### `flat-stencil-color`

After switching composite depth transfer to blit, `portal-geometry-depth` became solid, but
`flat-stencil-color` still had holes. This proved a second issue: the normal aperture mask still used
shader-side manual depth comparison before writing stencil.

Switching normal aperture masks to fixed-function `LEQUAL` against the copied composite depth fixed
the remaining holes.

## Root Cause

The renderer had mixed two different depth-copy and depth-test models:

- framebuffer depth for ordinary scene rendering and fixed-function depth testing;
- sampled depth texture values copied back through `gl_FragDepth`;
- sampled depth texture values manually linearized and compared in the portal mask shader.

Even with nominally matching depth formats, the shader copy and shader-side comparison were not
equivalent to fixed-function depth behavior in the actual portal compositor.

The final evidence showed:

- original scene-domain depth accepted the portal aperture;
- portal composite depth copied by shader rejected it;
- portal composite depth copied by framebuffer blit accepted it;
- stencil coverage remained holey until the shader-side manual depth compare was removed from the
  normal mask path.

Therefore the issue was not the authored aperture polygon overlapping terrain. It was the portal
compositor's depth transfer and shader-side depth comparison policy.

## Fix

Implemented changes:

- Scene-domain and portal-composite targets use packed `DEPTH24_STENCIL8` depth-stencil textures, so
  depth blits occur between matching depth formats.
- Portal composite copies use:
  - fullscreen shader copy for color;
  - `gl.blitFramebuffer(... DEPTH_BUFFER_BIT ...)` for depth.
- The final copy to the default framebuffer still uses the shader color/depth copy because the
  default framebuffer is not a portable named draw target for this same blit path.
- Normal aperture masks use fixed-function `LEQUAL` against the copied composite depth buffer.
- The temporary shader-side manual depth comparison and visualization modes were removed after the
  fix was validated.

Primary implementation locations:

- `apps/holtburger-3d/src/lib/world-display/webgl2-world-display-renderer-impl.ts`
- `apps/holtburger-3d/src/lib/world-display/webgl2-scene-domain-targets.ts`
- `apps/holtburger-3d/src/lib/world-display/renderer-contract.ts`
- `apps/holtburger-3d/src/app/browser-mode.ts`
- `apps/holtburger-3d/src/pages/BrowserModePanel.svelte`

## Validation

Field validation:

- `scene-portal-geometry` rendered the aperture solid in the base scene target.
- `portal-geometry-depth` clipped before the depth-blit fix.
- `portal-geometry-depth-blit` rendered solid.
- After changing portal composite depth copies to blit, `portal-geometry-depth` rendered solid.
- After changing normal aperture masks to fixed-function depth testing, normal portal rendering no
  longer showed the terrain/base-scene bands.

Automated checks run during the fix:

```text
npm run check
npm run test:ts -- src/app/browser-mode.test.ts src/lib/world-display/webgl2-scene-domain-targets.test.ts
npm run lint:ts
```

## Lessons

- A depth debug mode that samples and linearizes depth does not prove fixed-function depth behavior.
- A shader `gl_FragDepth` copy should not be treated as equivalent to a framebuffer depth blit
  without a focused A/B test.
- Debug modes must distinguish these cases:
  - original scene-domain framebuffer depth;
  - copied portal-composite framebuffer depth;
  - sampled depth texture values;
  - shader-side linearized depth values;
  - fixed-function raw depth tests.
- If a stencil mask has holes, test the same aperture as ordinary geometry in the same framebuffer
  before attributing the issue to scene ownership or geometry overlap.
- Keep depth attachment formats compatible before interpreting blit diagnostics. The first blit A/B
  was noisy because it copied from `DEPTH_COMPONENT24` into `DEPTH24_STENCIL8`.

## Cleanup

- Removed temporary portal triage modes after M4C.2 validation:
  - scene-rendered portal geometry probes;
  - copied-target magenta geometry probes;
  - blit depth-copy A/B mode;
  - raw/sample/depth-delta visualization modes;
  - stencil debug composite mode;
  - terrain rendering and portal near/far override toggles.
- Kept the stable product behavior:
  - framebuffer depth blit for portal composite depth transfer;
  - fixed-function `LEQUAL` for aperture mask depth testing.
- Consider adding a regression-oriented WebGL harness test if the project gains a reliable headless
  WebGL2 test environment. The critical invariant is: rendering an aperture into the source scene
  target and rendering it into a copied portal composite target must agree when the copy uses the
  production depth-transfer path.
