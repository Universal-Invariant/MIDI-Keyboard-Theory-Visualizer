import { defineConfig, type Plugin } from "vite";
import fs from "fs";
import path from "path";
import os from "os";

const REBUILD_EXIT_CODE = 42;
void REBUILD_EXIT_CODE; // available if you re-enable process.exit() below
// Unique per project so multiple vite instances don't fight over the same file.
const projectHash = Buffer.from(__dirname).toString("base64url");
const ACTION_FILE = path.join(os.tmpdir(), `vite_action_${projectHash}.tmp`);

/**
 * CLI shortcut: press `b` in the terminal running `npm run dev` to write a
 * "rebuild" marker and shut down the dev server. Pair with the `rerun` script
 * (`npm run dev:loop`) which sees the marker, rebuilds, and restarts vite.
 */
function rebuildShortcut(): Plugin {
  return {
    name: "rebuild-shortcut",
    apply: "serve",
    configureServer(server) {
      const bind = server.bindCLIShortcuts.bind(server);
      server.bindCLIShortcuts = (opts) =>
        bind({
          ...opts,
          customShortcuts: [
            ...(opts?.customShortcuts ?? []),
            {
              key: "b",
              description: "fetch, pull, rebuild and restart",
              async action(server) {
                fs.writeFileSync(ACTION_FILE, "rebuild", "utf-8");
                await server.close();
                //process.exit(REBUILD_EXIT_CODE);
              },
            },
          ],
        });
    },
  };
}

export default defineConfig({
  plugins: [rebuildShortcut()],
  server: {
    host: true, // or use '127.0.0.1' or 'localhost'
    port: 5173, // ensures it stays on your expected port
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
