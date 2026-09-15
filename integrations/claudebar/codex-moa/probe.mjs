#!/usr/bin/env node
// Keep the manifest self-contained: module resolution follows this file's real
// location even when the extension directory is installed as a symlink.
await import("../../../scripts/claudebar-probe.mjs");
