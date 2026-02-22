# SPM — Simpler Process Manager

[![npm version](https://img.shields.io/npm/v/@hackmd/spm.svg)](https://www.npmjs.com/package/@hackmd/spm)
[![npm downloads](https://img.shields.io/npm/dm/@hackmd/spm.svg)](https://www.npmjs.com/package/@hackmd/spm)
[![npm license](https://img.shields.io/npm/l/@hackmd/spm.svg)](https://www.npmjs.com/package/@hackmd/spm)

A minimal process manager implementing a lean subset of [pm2](https://pm2.keymetrics.io/) features, with some extensions, designed for better development script setup. Lightweight, zero daemon, and PM2-inspired ecosystem config support.

## Features

- **Start / Stop / Restart** — Manage multiple services from a single config
- **Multi-instance** — Run multiple instances with port/env auto-increment
- **Log management** — Tail, filter, flush, and rotate logs
- **JSON output** — `jlist` for machine-readable status (CI/scripting)
- **Log rotation** — Size-based rotation and retention with optional background watcher

## Installation

```bash
npm install -g @hackmd/spm
```

Or with Bun:

```bash
bun add -g @hackmd/spm
```

## Quick Start

1. Create an ecosystem config file (e.g. `ecosystem.config.js`) in your project:

```javascript
export default {
  apps: [
    {
      name: 'api',
      script: 'node',
      args: 'server.js',
      instances: 2,
      env: { PORT: '3000' },
      increment_vars: ['PORT'],
    },
    {
      name: 'worker',
      script: 'node',
      args: 'worker.js',
    },
  ],
}
```

2. Run SPM:

```bash
spm start          # Start all services
spm start api      # Start specific service
spm list           # List services and PIDs
spm stop           # Stop all
spm restart api    # Restart specific service
spm logs api -t    # Tail logs
```

## Configuration

| Option | Description |
|--------|-------------|
| `name` | Service identifier |
| `script` | Command to run (e.g. `node`, `bun`, `python`) |
| `args` | Arguments passed to the script |
| `instances` | Number of instances (default: 1) |
| `env` | Environment variables |
| `increment_vars` | Env vars to increment per instance (e.g. `PORT`) |
| `increment_var` | Legacy alias for increment vars (comma-separated string, e.g. `PORT,WS_PORT`) |

### Ecosystem File Field Support

SPM supports PM2-inspired ecosystem files and deeper app objects without failing on extra fields.

- SPM **actively uses**: `name`, `script`, `args`, `instances`, `env`, `increment_vars`, `increment_var`
- SPM **ignores unsupported fields safely** so you can keep partially shared configs across tools
- `increment_vars` is the preferred form; `increment_var` is kept as a compatibility alias in SPM

Config file is resolved from `./ecosystem.custom.config.js` by default. Override with `--config`:

```bash
spm --config ./my-ecosystem.config.js start
```

## PM2 Differences

SPM intentionally implements a lean subset of PM2 behavior.

- No daemon mode: processes are started detached and tracked with pid files under `~/.spm2/pids/`
- No PM2 process metadata store: runtime state comes from pid files + OS process checks
- `increment_vars` is supported directly; `increment_var` is also accepted and split by comma
- Extra PM2 ecosystem fields are allowed in config objects but not interpreted unless listed in SPM supported fields

Example for split increment vars:

```javascript
export default {
  apps: [
    {
      name: 'api',
      script: 'node',
      args: 'server.js',
      instances: 2,
      env: { PORT: '3000', WS_PORT: '4000' },
      increment_var: 'PORT,WS_PORT',
    },
  ],
}
```

## Commands

| Command | Description |
|---------|-------------|
| `spm start [service]` | Start all or a specific service |
| `spm stop [service]` | Stop processes (alias: `kill`) |
| `spm restart [service]` | Restart processes |
| `spm list` | List services and running PIDs |
| `spm jlist` | JSON output of service status |
| `spm logs [service]` | View logs (`-t` tail, `-n` lines, `-f` filter) |
| `spm flush [service]` | Clear log files |
| `spm rotate start` | Start log rotation watcher |
| `spm rotate stop` | Stop rotation watcher |

## Log Rotation

Logs are stored in `~/.spm2/logs/`. Rotation:

- Rotates when a log exceeds 10MB
- Removes logs older than 3 days
- Run `spm rotate start` for a background watcher

## Shell Integration

Completions require [jq](https://jqlang.github.io/jq/). App selector also requires [fzf](https://github.com/junegunn/fzf).

### Bash

**Completions** — Source the script (requires [bash-completion](https://github.com/scop/bash-completion); on macOS: `brew install bash-completion@2`):

```bash
# After npm install -g @hackmd/spm:
source $(npm root -g)/@hackmd/spm/completions/bash/spm.bash
# Or add to ~/.bashrc:
# source /path/to/spm/completions/bash/spm.bash
```

**App selector** — Source the script:

```bash
source $(npm root -g)/@hackmd/spm/completions/bash/spm_app_selector.sh
# Then:
spm_app_selector start
spm_app_selector --appName=api restart
```

### Zsh

**Completions** — Add the completion dir to `fpath` and ensure compinit runs:

```bash
# After npm install -g @hackmd/spm:
fpath=($(npm root -g)/@hackmd/spm/completions/zsh $fpath)
compinit
# Or copy to a dir in $fpath:
mkdir -p ~/.zsh/completions
cp $(npm root -g)/@hackmd/spm/completions/zsh/_spm ~/.zsh/completions/
# Add to ~/.zshrc: fpath=(~/.zsh/completions $fpath)
```

**App selector** — Source the script:

```bash
source $(npm root -g)/@hackmd/spm/completions/zsh/spm_app_selector.zsh
spm_app_selector start
```

### Fish

**Completions** — Copy to your Fish config:

```bash
mkdir -p ~/.config/fish/completions
cp $(npm root -g)/@hackmd/spm/completions/fish/spm.fish ~/.config/fish/completions/
```

**App selector** — Copy the function:

```bash
mkdir -p ~/.config/fish/functions
cp $(npm root -g)/@hackmd/spm/completions/fish/functions/spm_app_selector.fish ~/.config/fish/functions/
```

Usage:

```fish
spm_app_selector start
spm_app_selector --appName=api restart
spm_app_selector --config=ecosystem.config.js logs
```

## License

MIT
