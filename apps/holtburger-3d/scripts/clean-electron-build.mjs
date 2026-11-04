#!/usr/bin/env node
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
await rm(resolve(appRoot, "dist-electron"), { recursive: true, force: true });
