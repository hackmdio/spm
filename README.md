# SPM — Simpler Process Manager

A minimal process manager implementing a lean subset of [pm2](https://pm2.keymetrics.io/) features, with some extensions, designed for better development script setup. Lightweight, zero daemon, and ecosystem config compatible.

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

Config file is resolved from `./ecosystem.custom.config.js` by default. Override with `--config`:

```bash
spm --config ./my-ecosystem.config.js start
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

## Shell Completions

See [Yukaii/dotfiles](https://github.com/Yukaii/dotfiles/commit/569b50824c19340cefb308f385168492418f98e7) for shell completion setup.

## License

MIT
