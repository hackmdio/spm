#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { Command } from 'commander';

interface App {
  name: string;
  script: string;
  args?: string;
  instances?: number;
  env?: Record<string, string>;
  increment_vars?: string[];
  increment_var?: string;
}

function rotateLogFiles(): void {
  // Rotate log files exceeding 10MB
  for (const file of fs.readdirSync(LOG_DIR)) {
    if (file.endsWith('.log')) {
      const filePath = path.join(LOG_DIR, file);
      const stats = fs.statSync(filePath);
      if (stats.size >= 10485760) {
        const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '');
        const newName = `${filePath}.${timestamp}.bak`;
        fs.renameSync(filePath, newName);
        fs.writeFileSync(filePath, '');
        console.log(`Rotated ${file} to ${path.basename(newName)}`);
      }
    }
  }
  // Remove log files older than 3 days
  const now = Date.now();
  const threeDays = 3 * 24 * 60 * 60 * 1000;
  for (const file of fs.readdirSync(LOG_DIR)) {
    const filePath = path.join(LOG_DIR, file);
    const stats = fs.statSync(filePath);
    if (now - stats.mtimeMs > threeDays) {
      fs.unlinkSync(filePath);
      console.log(`Removed old log file: ${file}`);
    }
  }
}

interface Config {
  apps: App[];
}

let config: Config;
let configPath: string;
let cwd: string;

const homeDir = path.join(os.homedir(), '.spm2')
if (!fs.existsSync(homeDir)) fs.mkdirSync(homeDir)
const LOG_DIR = path.join(homeDir, 'logs')
const PID_DIR = path.join(homeDir, 'pids')

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR)
if (!fs.existsSync(PID_DIR)) fs.mkdirSync(PID_DIR)

function parseArgs(args: string): string[] {
  return args.split(' ').filter((a: string) => a.length > 0);
}

function adjustEnv(env: Record<string, string>, incVars: string[], index: number): Record<string, string> {
  const newEnv = Object.assign({}, process.env, env);
  for (const key of incVars) {
    if (newEnv[key]) {
      const val = newEnv[key];
      const match = val.match(/^(\D*?)(\d+)$/);
      if (match) {
        const base = match[1];
        const num = Number.parseInt(match[2], 10);
        newEnv[key] = `${base}${num + index}`;
      } else {
        const num = Number.parseInt(val, 10);
        if (!Number.isNaN(num)) {
          newEnv[key] = (num + index).toString();
        }
      }
    }
  }
  return newEnv;
}

function startApp(app: App): void {
  const appName = app.name;
  const script = app.script;
  const argsArr = app.args ? parseArgs(app.args) : [];
  const instances = app.instances || 1;
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
    const out = fs.openSync(logFile, 'a');
    const err = out;
    const proc = spawn(script, argsArr, {
      env,
      cwd,
      detached: true,
      stdio: ['ignore', out, err],
    });
    fs.writeFileSync(pidFile, (proc.pid || '').toString(), 'utf8');
    proc.unref();
  }
}

function listApps(): void {
  console.log('Available apps:');
  for (const app of config.apps) {
    process.stdout.write(`- ${app.name}: `);
    const pidFiles = fs.readdirSync(PID_DIR).filter((file) => {
      return file.startsWith(`${app.name}_`) && file.endsWith('.pid');
    });
    const running: number[] = [];
    for (const file of pidFiles) {
      const pidPath = path.join(PID_DIR, file);
      const pid = Number.parseInt(fs.readFileSync(pidPath, 'utf8'), 10);
      try {
        process.kill(pid, 0);
        running.push(pid);
      } catch (e) {
        // process not running, ignore
      }
    }
    if (running.length > 0) {
      console.log(`Running PIDs: ${running.join(', ')}`);
    } else {
      console.log('Not running');
    }
  };
}

const program = new Command()

program
  .version('1.0.0')
  .option('--config <file>', 'Specify a custom ecosystem configuration file', './ecosystem.custom.config.js')

program
  .command('start [service]')
  .description('Start service instance(s)')
  .action((service) => {
    let target = service || ''
    let hasRunning = false
    for (const file of fs.readdirSync(PID_DIR)) {
      if (file.endsWith('.pid')) {
        const pidPath = path.join(PID_DIR, file);
        const pid = Number.parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10);
        try {
          process.kill(pid, 0);
          hasRunning = true;
        } catch (e) {
          // ignore if process is not running
        }
      }
    }
    if (!hasRunning) {
      console.log("No running process found. Starting all services...")
      target = 'all'
    }
    let found = false;
    for (const app of config.apps) {
      const isCheck = app.name === target;
      const shouldRun = target === 'all';
      if (isCheck) {
        found = true;
      }
      if (isCheck || shouldRun) {
        startApp(app);
      }
    }
    if (!found && target !== 'all') {
      console.log(`Service "${target}" not found. Listing available services:`)
      listApps()
    }
  })

program
  .command('stop [service]')
  .alias('kill')
  .description('Stop service instance(s)')
  .action((service) => {
    const target = service || ''
    let killed = false
    for (const file of fs.readdirSync(PID_DIR)) {
      if (file.endsWith('.pid')) {
        const baseApp = file.split('_')[0];
        if (!target || target === 'all' || target === baseApp) {
          const pidPath = path.join(PID_DIR, file);
          const pid = Number.parseInt(fs.readFileSync(pidPath, 'utf8'), 10);
          console.log(`Killing process ${pid} (${file})...`);
          try {
            process.kill(pid);
            killed = true;
          } catch (e) {
            console.error(`Failed to kill process ${pid}: ${e}`);
          }
          fs.unlinkSync(pidPath);
        }
      }
    }
    if (!killed && target !== 'all') {
      console.log(`No process found for service "${target}". Listing available services:`)
      listApps()
    }
  })

program
  .command('logs [service]')
  .option('-t, --tail', 'Tail log files in real time')
  .description('Display logs for service instance(s)')
  .action((service, options) => {
    const logTarget = service || ''
    const follow = options.tail
    const logFiles = fs.readdirSync(LOG_DIR).filter((file) => {
      return (!logTarget || file.startsWith(`${logTarget}_`)) && file.endsWith('.log')
    })
    if (follow) {
      if (logFiles.length === 0) {
        console.log('No log files found')
        process.exit(0)
      }
      const logPaths = logFiles.map(file => path.join(LOG_DIR, file))
      const tail = spawn('tail', ['-f', ...logPaths], { stdio: 'inherit' })
      tail.on('exit', (code) => process.exit(code))
    } else {
      for (const file of logFiles) {
        const content = fs.readFileSync(path.join(LOG_DIR, file), 'utf8');
        console.log(`====== Contents of ${file} ======\n${content}\n`);
      }
    }
  })

program
  .command('rotate')
  .description('Rotate log files now and spawn a long-running rotate-watch process')
  .action(() => {
    rotateLogFiles();
    // Check if rotate-watch process is already running
    const watchPidPath = path.join(homeDir, 'rotate_watch.pid');
    if (fs.existsSync(watchPidPath)) {
      const existingPid = Number.parseInt(fs.readFileSync(watchPidPath, 'utf8'), 10);
      try {
        process.kill(existingPid, 0);
        console.log(`Rotate-watch process already running with PID ${existingPid}`);
        return;
      } catch (e) {
        // Process not running, proceed to spawn new
      }
    }
    // Spawn the long-running rotate-watch process
    const child = spawn(process.argv[0], [__filename, 'rotate-watch'], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    fs.writeFileSync(watchPidPath, (child.pid || '').toString(), 'utf8');
    console.log(`Spawned long-running rotate-watch process with PID ${child.pid}`);
  })

program
  .command('list')
  .description('List services with their running PIDs')
  .action(() => {
    listApps()
  })

program
  .command('jlist')
  .description('List services in JSON format with their running PIDs')
  .action(() => {
    const apps = config.apps.map(app => {
      const pidFiles = fs.readdirSync(PID_DIR).filter(file => file.startsWith(`${app.name}_`) && file.endsWith('.pid'))
      const running: number[] = [];
      for (const file of pidFiles) {
        const pidPath = path.join(PID_DIR, file);
        const pid = Number.parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10);
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
  .action((service) => {
    const target = service || ''
    let restarted = false
    if (!target || target === 'all') {
      for (const file of fs.readdirSync(PID_DIR)) {
        if (file.endsWith('.pid')) {
          const pidPath = path.join(PID_DIR, file);
          const pid = Number.parseInt(fs.readFileSync(pidPath, 'utf8'), 10);
          console.log(`Restart: Killing process ${pid} (${file})...`);
          try {
            process.kill(pid);
            restarted = true;
          } catch (e) {
            console.error(`Failed to kill process ${pid}: ${e}`);
          }
          fs.unlinkSync(pidPath);
        }
      }
      for (const app of config.apps) {
        startApp(app)
      }
    } else {
      for (const file of fs.readdirSync(PID_DIR)) {
        if (file.endsWith('.pid')) {
          const baseApp = file.split('_')[0];
          if (baseApp === target) {
            const pidPath = path.join(PID_DIR, file);
            const pid = Number.parseInt(fs.readFileSync(pidPath, 'utf8'), 10);
            console.log(`Restart: Killing process ${pid} (${file})...`);
            try {
              process.kill(pid);
              restarted = true;
            } catch (e) {
              console.error(`Failed to kill process ${pid}: ${e}`);
            }
            fs.unlinkSync(pidPath);
          }
        }
      }
      for (const app of config.apps) {
        if (app.name === target) {
          startApp(app);
          restarted = true;
        }
      }
    }
    if (!restarted && target !== 'all') {
      console.log(`Service "${target}" not found. Listing available services:`)
      listApps()
    }
  })

program
  .command('rotate-watch')
  .description('Hidden: continuously watch and rotate logs every 5 minutes')
  .action(() => {
    const watchPidPath = path.join(homeDir, 'rotate_watch.pid');
    fs.writeFileSync(watchPidPath, process.pid.toString(), 'utf8');
    console.log(`Started rotate-watch process with PID ${process.pid}`);
    rotateLogFiles();
    setInterval(rotateLogFiles, 5 * 60 * 1000);
  })

program.hook('preAction', (thisCommand) => {
  const configFile = thisCommand.opts().config;
  configPath = path.join(__dirname, configFile);
  if (!fs.existsSync(configPath)) {
    configPath = path.join(process.cwd(), configFile);
  }
  cwd = path.dirname(configPath);
  config = require(configPath);
});


program.parse(process.argv)
