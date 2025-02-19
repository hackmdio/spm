#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawn } = require('child_process')
const { Command } = require('commander')

let config;

const homeDir = path.join(os.homedir(), '.spm2')
if (!fs.existsSync(homeDir)) fs.mkdirSync(homeDir)
const LOG_DIR = path.join(homeDir, 'logs')
const PID_DIR = path.join(homeDir, 'pids')

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR)
if (!fs.existsSync(PID_DIR)) fs.mkdirSync(PID_DIR)

function parseArgs (args) {
  return args.split(' ').filter((a) => a.length > 0)
}

function adjustEnv (env, incVars, index) {
  const newEnv = Object.assign({}, process.env, env)
  incVars.forEach((key) => {
    if (newEnv[key]) {
      const val = newEnv[key]
      const match = val.match(/^(\D*?)(\d+)$/)
      if (match) {
        const base = match[1]
        const num = parseInt(match[2], 10)
        newEnv[key] = base + (num + index)
      } else {
        const num = parseInt(val, 10)
        if (!isNaN(num)) {
          newEnv[key] = (num + index).toString()
        }
      }
    }
  })
  return newEnv
}

function startApp (app) {
  const appName = app.name
  const script = app.script
  const argsArr = app.args ? parseArgs(app.args) : []
  const instances = app.instances || 1
  let incVars = []
  if (app.increment_vars) {
    incVars = app.increment_vars
  } else if (app.increment_var) {
    incVars = app.increment_var.split(',').map(s => s.trim())
  }

  for (let i = 0; i < instances; i++) {
    const env = adjustEnv(app.env || {}, incVars, i)
    const logFile = path.join(LOG_DIR, `${appName}_${i}.log`)
    const pidFile = path.join(PID_DIR, `${appName}_${i}.pid`)
    console.log(`Starting ${appName} instance ${i}...`)
    const out = fs.openSync(logFile, 'a')
    const err = out
    const proc = spawn(script, argsArr, {
      env,
      cwd: path.dirname(configPath),
      detached: true,
      stdio: ['ignore', out, err],
    })
    fs.writeFileSync(pidFile, proc.pid.toString(), 'utf8')
    proc.unref()
  }
}

function listApps() {
  console.log('Available apps:')
  config.apps.forEach((app) => {
    process.stdout.write(`- ${app.name}: `)
    const pidFiles = fs.readdirSync(PID_DIR).filter((file) => {
      return file.startsWith(app.name + '_') && file.endsWith('.pid')
    })
    const running = []
    pidFiles.forEach((file) => {
      const pidPath = path.join(PID_DIR, file)
      const pid = parseInt(fs.readFileSync(pidPath, 'utf8'), 10)
      try {
        process.kill(pid, 0)
        running.push(pid)
      } catch (e) {
        // process not running, ignore
      }
    })
    if (running.length > 0) {
      console.log(`Running PIDs: ${running.join(', ')}`)
    } else {
      console.log('Not running')
    }
  })
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
    fs.readdirSync(PID_DIR).forEach((file) => {
      if (file.endsWith('.pid')) {
        const pidPath = path.join(PID_DIR, file)
        const pid = parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10)
        try {
          process.kill(pid, 0)
          hasRunning = true
        } catch (e) {
          // ignore if process is not running
        }
      }
    })
    if (!hasRunning) {
      console.log("No running process found. Starting all services...")
      target = 'all'
    }
    let found = false
    config.apps.forEach((app) => {
      const isCheck = app.name === target
      const shouldRun = target === 'all'
      if (isCheck) {
        found = true
      }
      if (isCheck || shouldRun) {
        startApp(app)
      }
    })
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
    let target = service || ''
    let killed = false
    fs.readdirSync(PID_DIR).forEach((file) => {
      if (file.endsWith('.pid')) {
        const baseApp = file.split('_')[0]
        if (!target || target === 'all' || target === baseApp) {
          const pidPath = path.join(PID_DIR, file)
          const pid = parseInt(fs.readFileSync(pidPath, 'utf8'), 10)
          console.log(`Killing process ${pid} (${file})...`)
          try {
            process.kill(pid)
            killed = true
          } catch (e) {
            console.error(`Failed to kill process ${pid}: ${e}`)
          }
          fs.unlinkSync(pidPath)
        }
      }
    })
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
      return (!logTarget || file.startsWith(logTarget + '_')) && file.endsWith('.log')
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
      logFiles.forEach((file) => {
        const content = fs.readFileSync(path.join(LOG_DIR, file), 'utf8')
        console.log(`====== Contents of ${file} ======\n${content}\n`)
      })
    }
  })

program
  .command('rotate')
  .description('Rotate log files if they exceed a threshold (10MB)')
  .action(() => {
    fs.readdirSync(LOG_DIR).forEach((file) => {
      if (file.endsWith('.log')) {
        const filePath = path.join(LOG_DIR, file)
        const stats = fs.statSync(filePath)
        if (stats.size >= 10485760) {
          // 10 MB
          const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '')
          const newName = `${filePath}.${timestamp}.bak`
          fs.renameSync(filePath, newName)
          fs.writeFileSync(filePath, '')
          console.log(`Rotated ${file} to ${path.basename(newName)}`)
        }
      }
    })
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
      const pidFiles = fs.readdirSync(PID_DIR).filter(file => file.startsWith(app.name + '_') && file.endsWith('.pid'))
      const running = []
      pidFiles.forEach(file => {
        const pidPath = path.join(PID_DIR, file)
        const pid = parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10)
        try {
          process.kill(pid, 0)
          running.push(pid)
        } catch (e) {
          // ignore error if process does not exist
        }
      })
      return { name: app.name, running }
    })
    console.log(JSON.stringify(apps, null, 2))
  })

program
  .command('restart [service]')
  .description('Restart service instance(s)')
  .action((service) => {
    let target = service || ''
    let restarted = false
    if (!target || target === 'all') {
      fs.readdirSync(PID_DIR).forEach((file) => {
        if (file.endsWith('.pid')) {
          const pidPath = path.join(PID_DIR, file)
          const pid = parseInt(fs.readFileSync(pidPath, 'utf8'), 10)
          console.log(`Restart: Killing process ${pid} (${file})...`)
          try {
            process.kill(pid)
            restarted = true
          } catch (e) {
            console.error(`Failed to kill process ${pid}: ${e}`)
          }
          fs.unlinkSync(pidPath)
        }
      })
      config.apps.forEach((app) => {
        startApp(app)
      })
    } else {
      fs.readdirSync(PID_DIR).forEach((file) => {
        if (file.endsWith('.pid')) {
          const baseApp = file.split('_')[0]
          if (baseApp === target) {
            const pidPath = path.join(PID_DIR, file)
            const pid = parseInt(fs.readFileSync(pidPath, 'utf8'), 10)
            console.log(`Restart: Killing process ${pid} (${file})...`)
            try {
              process.kill(pid)
              restarted = true
            } catch (e) {
              console.error(`Failed to kill process ${pid}: ${e}`)
            }
            fs.unlinkSync(pidPath)
          }
        }
      })
      config.apps.forEach((app) => {
        if (app.name === target) {
          startApp(app)
          restarted = true
        }
      })
    }
    if (!restarted && target !== 'all') {
      console.log(`Service "${target}" not found. Listing available services:`)
      listApps()
    }
  })

program.hook('preAction', (thisCommand, actionCommand) => {
  const configFile = thisCommand.opts().config;
  let configPath = path.join(__dirname, configFile);
  if (!fs.existsSync(configPath)) {
    configPath = path.join(process.cwd(), configFile);
  }
  config = require(configPath);
});


program.parse(process.argv)
