# Sloth's Dev CC

A local-first, keyboard-driven cockpit for the projects on your Omarchy machine.

## Run it

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. Repositories are scanned from `~/Work` by default.

To scan another folder:

```bash
PROJECTS_ROOT=/path/to/projects npm run dev
```

Build and run the production version with `npm run build && npm start`, then open
<http://localhost:4174>.

## Current features

- Finds Git repositories up to two folders below the workspace
- Shows branch, working-tree state, and latest commit
- Fast filtering and keyboard navigation
- SQLite-backed project pins
- Opens a terminal in the selected repository via `xdg-terminal-exec`
- Project detail drawer with Git changes, recent commits, and README preview
- Detects and runs scripts declared in each project's `package.json`
- Live, bounded process logs with localhost URL detection
- Managed process status and whole-process-group stopping
