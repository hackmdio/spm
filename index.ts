#!/usr/bin/env node
import fs from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync, openSync, unlinkSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { Command } from 'commander';
import { fileURLToPath } from 'node:url';

// Types
interface App {
  name: string;
  script: string;
  args?: string;
  instances?: number;
  env?: Record<string, string>;
  increment_vars?: string[];
  increment_var?: string;
}

interface Config {
  apps: App[];
}

// Global state
let config: Config;
let configPath: string;
let cwd: string;

// Constants
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
const LOG_RETENTION_DAYS = 3;
const LOG_RETENTION_MS = LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;

// Directory setup
const homeDir = path.join(os.homedir(), '.spm2');
const LOG_DIR = path.join(homeDir, 'logs');
const PID_DIR = path.join(homeDir, 'pids');

// Ensure directories exist
if (!existsSync(homeDir)) {
  try {
    fs.mkdir(homeDir, { recursive: true });
  } catch (error) {
    console.error(`Failed to create directory ${homeDir}: ${error}`);
  }
}
if (!existsSync(LOG_DIR)) {
  try {
    fs.mkdir(LOG_DIR, { recursive: true });
  } catch (error) {
    console.error(`Failed to create directory ${LOG_DIR}: ${error}`);
  }
}
if (!existsSync(PID_DIR)) {
  try {
    fs.mkdir(PID_DIR, { recursive: true });
  } catch (error) {
    console.error(`Failed to create directory ${PID_DIR}: ${error}`);
  }
}

/**
 * Rotates log files that exceed size limit and removes old logs
 */
async function rotateLogFiles(): Promise<void> {
  try {
    // Rotate log files exceeding size limit
    const files = await fs.readdir(LOG_DIR);
    for (const file of files) {
      if (file.endsWith('.log')) {
        const filePath = path.join(LOG_DIR, file);
        const stats = await fs.stat(filePath);
        if (stats.size >= MAX_LOG_SIZE) {
          const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '');
          const newName = `${filePath}.${timestamp}.bak`;
          await fs.rename(filePath, newName);
          await fs.writeFile(filePath, '');
          console.log(`Rotated ${file} to ${path.basename(newName)}`);
        }
      }
    }

    // Remove log files older than retention period
    const now = Date.now();
    for (const file of files) {
      const filePath = path.join(LOG_DIR, file);
      const stats = await fs.stat(filePath);
      if (now - stats.mtimeMs > LOG_RETENTION_MS) {
        await fs.unlink(filePath);
        console.log(`Removed old log file: ${file}`);
      }
    }
  } catch (error) {
    console.error(`Error rotating log files: ${error}`);
  }
}

/**
 * Parses command arguments string into array
 */
function parseArgs(args: string): string[] {
  return args.split(' ').filter((a: string) => a.length > 0);
}

/**
 * Adjusts environment variables for multiple instances
 */
function adjustEnv(env: Record<string, string>, incVars: string[], index: number): Record<string, string> {
  const newEnv = Object.assign({}, process.env, env);

  for (const key of incVars) {
    if (newEnv[key]) {
      const val = newEnv[key];
      const match = val.match(/^(\D*?)(\d+)$/);

      if (match) {
        // Handle case like "port3000" -> "port3001"
        const base = match[1];
        const num = Number.parseInt(match[2], 10);
        newEnv[key] = `${base}${num + index}`;
      } else {
        // Handle numeric case like "3000" -> "3001"
        const num = Number.parseInt(val, 10);
        if (!Number.isNaN(num)) {
          newEnv[key] = (num + index).toString();
        }
      }
    }
  }

  return newEnv;
}

/**
 * Starts an application with specified configuration
 */
async function startApp(app: App): Promise<void> {
  try {
    const appName = app.name;
    const script = app.script;
    const argsArr = app.args ? parseArgs(app.args) : [];
    const instances = app.instances || 1;

    // Handle increment variables
    let incVars: string[] = [];
    if (app.increment_vars) {
      incVars = app.increment_vars;
    } else if (app.increment_var) {
      incVars = app.increment_var.split(',').map(s => s.trim());
    }

    for (let i = 0; i < instances; i++) {
      const env = adjustEnv(app.env || {}, incVars, i);
      const logFile = path.join(LOG_DIR, `${appName}_${i}.log`);
      const pidFile = path.join(PID_DIR, `${appName}_${i}.pid`);

      console.log(`Starting ${appName} instance ${i}...`);

      try {
        const out = openSync(logFile, 'a');
        const err = out;

        const proc = spawn(script, argsArr, {
          env,
          cwd,
          detached: true,
          stdio: ['ignore', out, err],
        });

        if (!proc.pid) {
          throw new Error(`Failed to get PID for ${appName} instance ${i}`);
        }

        writeFileSync(pidFile, proc.pid.toString(), 'utf8');
        proc.unref();

        console.log(`Started ${appName} instance ${i} with PID ${proc.pid}`);
      } catch (error) {
        console.error(`Failed to start ${appName} instance ${i}: ${error}`);
      }
    }
  } catch (error) {
    console.error(`Error starting app ${app.name}: ${error}`);
  }
}

/**
 * Lists all configured applications and their running status
 */
async function listApps(): Promise<void> {
  console.log('Available apps:');

  for (const app of config.apps) {
    process.stdout.write(`- ${app.name}: `);

    try {
      const pidFiles = readdirSync(PID_DIR).filter((file) => {
        return file.startsWith(`${app.name}_`) && file.endsWith('.pid');
      });

      const running: number[] = [];

      for (const file of pidFiles) {
        const pidPath = path.join(PID_DIR, file);
        try {
          const pid = Number.parseInt(readFileSync(pidPath, 'utf8'), 10);

          try {
            // Check if process is running
            process.kill(pid, 0);
            running.push(pid);
          } catch (e) {
            // Process not running, clean up stale PID file
            await fs.unlink(pidPath).catch(() => {});
          }
        } catch (error) {
          console.error(`Error reading PID file ${file}: ${error}`);
        }
      }

      if (running.length > 0) {
        console.log(`Running PIDs: ${running.join(', ')}`);
      } else {
        console.log('Not running');
      }
    } catch (error) {
      console.error(`Error listing app ${app.name}: ${error}`);
    }
  }
}

const program = new Command()

program
  .version('1.0.0')
  .option('--config <file>', 'Specify a custom ecosystem configuration file', './ecosystem.custom.config.js')
  .option('-v, --verbose', 'Enable verbose output')

program
  .command('start [service]')
  .description('Start service instance(s)')
  .action(async (service) => {
    try {
      let target = service || '';

      // If no specific service requested and nothing is running, start all
      if (!target && !(await hasRunningProcesses())) {
        console.log("No running process found. Starting all services...");
        target = 'all';
      }

      let found = false;
      for (const app of config.apps) {
        const isTarget = app.name === target;
        const shouldRun = target === 'all';

        if (isTarget) {
          found = true;
        }

        if (isTarget || shouldRun) {
          await startApp(app);
        }
      }

      if (!found && target !== 'all') {
        console.log(`Service "${target}" not found. Listing available services:`);
        await listApps();
      }
    } catch (error) {
      console.error(`Error in start command: ${error}`);
    }
  })

program
  .command('stop [service]')
  .alias('kill')
  .description('Stop service instance(s)')
  .option('-s, --signal <signal>', 'Signal to send to the process', 'SIGTERM')
  .action(async (service, options) => {
    try {
      const target = service || '';
      const signal = options.signal;
      let killed = false;

      const files = readdirSync(PID_DIR);
      for (const file of files) {
        if (file.endsWith('.pid')) {
          const baseApp = file.split('_')[0];

          if (!target || target === 'all' || target === baseApp) {
            const pidPath = path.join(PID_DIR, file);

            try {
              const pid = Number.parseInt(readFileSync(pidPath, 'utf8'), 10);
              console.log(`Stopping process ${pid} (${file}) with signal ${signal}...`);

              try {
                process.kill(pid, signal);
                killed = true;
                console.log(`Successfully sent ${signal} to process ${pid}`);
              } catch (e) {
                if (e && (e as NodeJS.ErrnoException).code === 'ESRCH') {
                  console.log(`Process ${pid} not found, may have already exited`);
                } else {
                  console.error(`Failed to kill process ${pid}: ${e}`);
                }
              }

              // Remove PID file regardless of kill success
              await fs.unlink(pidPath).catch(err =>
                console.error(`Failed to remove PID file ${pidPath}: ${err}`)
              );
            } catch (error) {
              console.error(`Error processing PID file ${file}: ${error}`);
            }
          }
        }
      }

      if (!killed && target !== 'all') {
        console.log(`No process found for service "${target}". Listing available services:`);
        await listApps();
      }
    } catch (error) {
      console.error(`Error in stop command: ${error}`);
    }
  });

program
  .command('logs [service]')
  .option('-t, --tail', 'Tail log files in real time')
  .option('-n, --lines <number>', 'Number of lines to show', '100')
  .option('-f, --filter <pattern>', 'Filter logs by pattern')
  .description('Display logs for service instance(s)')
  .action(async (service, options) => {
    try {
      const logTarget = service || '';
      const follow = options.tail;
      const lines = options.lines;
      const filter = options.filter;

      const logFiles = readdirSync(LOG_DIR).filter((file) => {
        return (!logTarget || file.startsWith(`${logTarget}_`)) && file.endsWith('.log');
      });

      if (logFiles.length === 0) {
        console.log('No log files found');
        return;
      }

      if (follow) {
        const logPaths = logFiles.map(file => path.join(LOG_DIR, file));
        // Follow by file name so tail continues after log rotation.
        const tailArgs = ['-F'];

        if (lines) {
          tailArgs.push('-n', lines);
        }

        // Add all log files to tail command
        tailArgs.push(...logPaths);

        // If filter is provided, pipe through grep
        if (filter) {
          console.log(`Tailing logs and filtering for: ${filter}`);
          const tail = spawn('tail', tailArgs);
          const grep = spawn('grep', [filter], { stdio: ['pipe', 'inherit', 'inherit'] });

          tail.stdout.pipe(grep.stdin);

          tail.on('error', (err) => console.error(`Tail error: ${err}`));
          grep.on('error', (err) => console.error(`Grep error: ${err}`));

          // Handle process exit
          process.on('SIGINT', () => {
            tail.kill();
            grep.kill();
            process.exit(0);
          });
        } else {
          console.log(`Tailing logs: ${logPaths.join(', ')}`);
          const tail = spawn('tail', tailArgs, { stdio: 'inherit' });

          tail.on('error', (err) => console.error(`Tail error: ${err}`));

          // Handle process exit
          process.on('SIGINT', () => {
            tail.kill();
            process.exit(0);
          });
        }
      } else {
        // Display logs without following
        for (const file of logFiles) {
          try {
            const filePath = path.join(LOG_DIR, file);
            let content: string;

            if (lines && lines !== 'all') {
              // Use tail to get last N lines
              const tailProcess = spawn('tail', ['-n', lines, filePath], { stdio: ['ignore', 'pipe', 'pipe'] });
              const output = await new Promise<Buffer>((resolve, reject) => {
                const chunks: Buffer[] = [];
                tailProcess.stdout.on('data', (chunk) => chunks.push(chunk));
                tailProcess.stdout.on('end', () => resolve(Buffer.concat(chunks)));
                tailProcess.on('error', reject);
              });
              content = output.toString('utf8');
            } else {
              content = await fs.readFile(filePath, 'utf8');
            }

            // Apply filter if provided
            if (filter) {
              const lines = content.split('\n');
              const filteredLines = lines.filter(line => line.includes(filter));
              content = filteredLines.join('\n');
            }

            console.log(`====== Contents of ${file} ======\n${content}\n`);
          } catch (error) {
            console.error(`Error reading log file ${file}: ${error}`);
          }
        }
      }
    } catch (error) {
      console.error(`Error in logs command: ${error}`);
    }
  });

program
  .command('flush [service]')
  .description('Clear log file contents without deleting files')
  .action(async (service) => {
    try {
      const target = service || '';
      let flushedCount = 0;

      const logFiles = readdirSync(LOG_DIR).filter((file) => {
        return (!target || file.startsWith(`${target}_`)) && file.endsWith('.log');
      });

      if (logFiles.length === 0) {
        console.log('No log files found to flush.');
        return;
      }

      for (const file of logFiles) {
        const filePath = path.join(LOG_DIR, file);
        try {
          const stats = await fs.stat(filePath);
          const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
          await fs.writeFile(filePath, '');
          flushedCount++;
          console.log(`Flushed: ${file} (cleared ${sizeMB} MB)`);
        } catch (error) {
          console.error(`Failed to flush ${file}: ${error}`);
        }
      }

      if (flushedCount > 0) {
        console.log(`\nTotal: Flushed ${flushedCount} log file(s)`);
      }
    } catch (error) {
      console.error(`Error in flush command: ${error}`);
    }
  });

const rotateCmd = new Command('rotate')
  .description('Manage log rotation');

program
  .command('list')
  .alias('ls')
  .description('List services with their running PIDs')
  .action(() => {
    listApps()
  })

program
  .command('jlist')
  .description('List services in JSON format with their running PIDs')
  .action(() => {
    const apps = config.apps.map(app => {
      const pidFiles = readdirSync(PID_DIR).filter(file => file.startsWith(`${app.name}_`) && file.endsWith('.pid'))
      const running: number[] = [];
      for (const file of pidFiles) {
        const pidPath = path.join(PID_DIR, file);
        const pid = Number.parseInt(readFileSync(pidPath, 'utf8').trim(), 10);
        try {
          process.kill(pid, 0);
          running.push(pid);
        } catch (e) {
          // ignore error if process does not exist
        }
      }
      return { name: app.name, running }
    })
    console.log(JSON.stringify(apps, null, 2))
  })

program
  .command('restart [service]')
  .description('Restart service instance(s)')
  .action(async (service) => {
    const target = service || ''
    let restarted = false
    if (!target || target === 'all') {
      for (const file of readdirSync(PID_DIR)) {
        if (file.endsWith('.pid')) {
          const pidPath = path.join(PID_DIR, file);
          const pid = Number.parseInt(readFileSync(pidPath, 'utf8'), 10);
          console.log(`Restart: Killing process ${pid} (${file})...`);
          try {
            process.kill(pid);
            restarted = true;
          } catch (e) {
            console.error(`Failed to kill process ${pid}: ${e}`);
          }
          unlinkSync(pidPath);
        }
      }
      for (const app of config.apps) {
        await startApp(app)
      }
    } else {
      for (const file of readdirSync(PID_DIR)) {
        if (file.endsWith('.pid')) {
          const baseApp = file.split('_')[0];
          if (baseApp === target) {
            const pidPath = path.join(PID_DIR, file);
            const pid = Number.parseInt(readFileSync(pidPath, 'utf8'), 10);
            console.log(`Restart: Killing process ${pid} (${file})...`);
            try {
              process.kill(pid);
              restarted = true;
            } catch (e) {
              console.error(`Failed to kill process ${pid}: ${e}`);
            }
            unlinkSync(pidPath);
          }
        }
      }
      for (const app of config.apps) {
        if (app.name === target) {
          await startApp(app);
          restarted = true;
        }
      }
    }
    if (!restarted && target !== 'all') {
      console.log(`Service "${target}" not found. Listing available services:`)
      await listApps()
    }
  })

rotateCmd
  .command('start')
  .description('Perform log rotation now and spawn a long-running rotate-watch process')
  .option('--cleanup-interval <number>', 'Specify cleanup interval in seconds for rotate-watch process', '5')
  .action(async (options) => {
    await rotateLogFiles();
    // Check if rotate-watch process is already running
    const watchPidPath = path.join(homeDir, 'rotate_watch.pid');
    if (existsSync(watchPidPath)) {
      const existingPid = Number.parseInt(readFileSync(watchPidPath, 'utf8'), 10);
      try {
        process.kill(existingPid, 0);
        console.log(`Rotate-watch process already running with PID ${existingPid}`);
        return;
      } catch (e) {
        // Process not running, proceed to spawn new
      }
    }
    // Spawn the long-running rotate-watch process with cleanup interval
    const watchLogFile = path.join(homeDir, 'rotate_watch.log');
    const out = openSync(watchLogFile, 'a');
    const err = out;
    const __filename = fileURLToPath(import.meta.url);
    const child = spawn(process.argv[0], [__filename, 'rotate', 'watch', '--cleanup-interval', options.cleanupInterval], {
      cwd,
      detached: true,
      stdio: ['ignore', out, err],
    });
    child.unref();
    writeFileSync(watchPidPath, (child.pid || '').toString(), 'utf8');
    console.log(`Spawned long-running rotate-watch process with PID ${child.pid}`);
  });

rotateCmd
  .command('watch')
  .description('Continuously watch and rotate logs')
  .option('--cleanup-interval <number>', 'Specify cleanup interval in seconds', '5')
  .action((options) => {
    const cleanupInterval = Number(options.cleanupInterval) * 1000;
    const watchPidPath = path.join(homeDir, 'rotate_watch.pid');
    writeFileSync(watchPidPath, process.pid.toString(), 'utf8');
    console.log(`Started rotate-watch process with PID ${process.pid}`);
    setInterval(async () => {
      await rotateLogFiles();
      console.log("rotateLogFiles() executed");
    }, cleanupInterval);
  });

rotateCmd
  .command('stop')
  .description('Stop the long-running rotate-watch process')
  .action(async () => {
    const watchPidPath = path.join(homeDir, 'rotate_watch.pid');
    if (existsSync(watchPidPath)) {
      const pid = Number.parseInt(readFileSync(watchPidPath, 'utf8'), 10);
      try {
        process.kill(pid);
        unlinkSync(watchPidPath);
        console.log(`Stopped rotate-watch process with PID ${pid}`);
      } catch (e) {
        if (e && (e as NodeJS.ErrnoException).code === 'ESRCH') {
          unlinkSync(watchPidPath);
          console.log(`Rotate-watch process with PID ${pid} not found. Removed stale pid file.`);
        } else {
          console.error(`Failed to stop rotate-watch process with PID ${pid}: ${e}`);
        }
      }
    } else {
      console.log("No rotate-watch process found.");
    }
  });

program.addCommand(rotateCmd);

/**
 * Load configuration from file
 */
async function loadConfig(configPath: string): Promise<Config> {
  try {
    // Use dynamic import for ES modules compatibility
    const configModule = await import(configPath);
    return configModule.default || configModule;
  } catch (error) {
    console.error(`Failed to load config from ${configPath}: ${error}`);
    process.exit(1);
  }
}

/**
 * Check if any processes are running
 */
async function hasRunningProcesses(): Promise<boolean> {
  try {
    const files = readdirSync(PID_DIR);

    for (const file of files) {
      if (file.endsWith('.pid')) {
        const pidPath = path.join(PID_DIR, file);
        try {
          const pid = Number.parseInt(readFileSync(pidPath, 'utf8').trim(), 10);
          try {
            process.kill(pid, 0);
            return true;
          } catch (e) {
            // Process not running, ignore
          }
        } catch (error) {
          console.error(`Error reading PID file ${file}: ${error}`);
        }
      }
    }

    return false;
  } catch (error) {
    console.error(`Error checking running processes: ${error}`);
    return false;
  }
}

program.hook('preAction', async (thisCommand) => {
  try {
    // Skip config loading for commands that don't need app config
    const isRotateCommand = process.argv.includes('rotate');
    const isFlushCommand = process.argv.includes('flush');
    if (isRotateCommand || isFlushCommand) {
      return;
    }

    const configFile = thisCommand.opts().config;

    // Try to find config file in different locations
    configPath = path.join(process.cwd(), configFile);
    if (!existsSync(configPath)) {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      configPath = path.join(__dirname, configFile);

      if (!existsSync(configPath)) {
        console.error(`Config file not found: ${configFile}`);
        console.error(`Tried locations:\n- ${path.join(process.cwd(), configFile)}\n- ${path.join(__dirname, configFile)}`);
        process.exit(1);
      }
    }

    cwd = path.dirname(configPath);
    config = await loadConfig(configPath);

    if (!config || !config.apps || !Array.isArray(config.apps)) {
      console.error(`Invalid configuration in ${configPath}. Expected { apps: App[] }`);
      process.exit(1);
    }

    if (thisCommand.opts().verbose) {
      console.log(`Loaded configuration from ${configPath} with ${config.apps.length} apps`);
    }
  } catch (error) {
    console.error(`Error in preAction hook: ${error}`);
    process.exit(1);
  }
});

// Start the CLI
program.parse(process.argv);
