#!/usr/bin/env node
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const destination = resolve(appRoot, "dist-electron/scripts/entry-paths.mjs");
await mkdir(dirname(destination), { recursive: true });
await copyFile(resolve(appRoot, "scripts/entry-paths.mjs"), destination);
