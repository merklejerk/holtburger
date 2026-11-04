---
title: 'A client with its own direction'
description: 'The same game and content. Room for a different client experience.'
section: 'About Holtburger'
---

## Built from the protocol up

Holtburger began as a terminal client built against ACE. That established the shared Rust protocol, networking, world-state, and gameplay systems that now power both frontends.

The architecture and interfaces were independently designed. Retail research later provided targeted corrections where asset formats, presentation, or physics required alignment.

## Active play in 3D

Holtburger 3D integrates quality of life improvements around playing the game yourself: finding targets, preparing equipment, navigating spells, and arranging useful information.

Its controls and UX follow their own direction. Rendering and physics also differ from retail. Compatibility with the game does not mean reproducing every retail interaction or visual detail.

## Automation in a terminal

The TUI provides gameplay and scripting without running a full 3D interface. It is the preferred form factor for automation and bots.

These priorities describe the clients, not how people ought to play. h3d has no plugin system today; plugins and scripting are planned, without a promised release date.

## Still evolving

Both clients are in active development against ACE. Feature coverage differs; the terminal client uses simplified movement and physics. GDLE compatibility is unverified.
