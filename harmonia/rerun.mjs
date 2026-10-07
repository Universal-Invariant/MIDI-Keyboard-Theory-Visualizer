#!/usr/bin/env node
// Looping dev runner: starts `vite`, and when the `b` shortcut (see
// vite.config.ts) writes the action marker, runs git pull + npm build and
// restarts the dev server. Ctrl-C stops everything.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const projectHash = Buffer.from(process.cwd()).toString("base64url");
const ACTION_FILE = path.join(os.tmpdir(), `vite_action_${projectHash}.tmp`);

const run = (cmd, args) =>
  spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });

for (;;) {
  fs.rmSync(ACTION_FILE, { force: true });
  console.log("\n=== starting vite dev server (press b to rebuild & restart) ===");
  run("npx", ["vite"]);
  const action = (() => {
    try {
      return fs.readFileSync(ACTION_FILE, "utf-8").trim();
    } catch {
      return "";
    }
  })();
  if (action !== "rebuild") break; // normal exit (Ctrl-C) — stop looping
  console.log("=== rebuild requested: git pull → build → restart ===");
  const pull = run("git", ["pull", "--ff-only"]);
  if (pull.status !== 0) console.warn("(git pull failed or nothing to pull — continuing)");
  const build = run("npm", ["run", "build"]);
  if (build.status !== 0) console.error("!! build failed — fixing errors then press b again");
}
