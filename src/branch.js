import { execFile as nodeExecFile } from 'node:child_process';

function isDefinitiveNoBranch(error) {
  return error?.code === 128 && /not a git repository|does not have any commits yet|unknown revision|ambiguous argument 'HEAD'/i.test(error.stderr || '');
}

export class BranchResolver {
  constructor(onChange, { execFile = nodeExecFile, timers = globalThis } = {}) {
    this.onChange = onChange;
    this.execFile = execFile;
    this.timers = timers;
    this.cwd = undefined;
    this.privateWorkspace = false;
    this.branch = undefined;
    this.active = false;
    this.inFlight = false;
    this.timer = undefined;
    this.generation = 0;
  }

  update({ cwd, privateWorkspace, active }) {
    const changed = cwd !== this.cwd || privateWorkspace !== this.privateWorkspace;
    this.cwd = cwd;
    this.privateWorkspace = privateWorkspace;
    this.active = active && Boolean(cwd) && !privateWorkspace;
    if (changed) {
      this.generation += 1;
      this.branch = undefined;
      if (!privateWorkspace) this.onChange();
    }
    this.schedule();
    if (this.active && changed && !this.inFlight) this.check();
  }

  schedule() {
    this.timers.clearTimeout(this.timer);
    this.timer = undefined;
    if (this.active) this.timer = this.timers.setTimeout(() => this.check(), 5000);
  }

  check() {
    if (!this.active || this.inFlight) return;
    const generation = this.generation;
    const cwd = this.cwd;
    this.inFlight = true;
    this.run(['symbolic-ref', '--short', 'HEAD'], cwd).catch(() => '')
      .then((name) => name || this.run(['rev-parse', '--short', 'HEAD'], cwd)
        .then((hash) => hash ? { branch: `@${hash}` } : { branch: '', definitive: true })
        .catch((error) => isDefinitiveNoBranch(error) ? { branch: '', definitive: true } : Promise.reject(error)))
      .then((result) => {
        const { branch, definitive } = typeof result === 'string' ? { branch: result } : result;
        if (generation !== this.generation || cwd !== this.cwd || !this.active) return;
        if (branch && branch !== this.branch) { this.branch = branch; this.onChange(); }
        if (definitive && this.branch !== undefined) { this.branch = undefined; this.onChange(); }
      })
      .catch(() => {})
      .finally(() => {
        this.inFlight = false;
        if (generation !== this.generation && this.active) this.check(); else this.schedule();
      });
  }

  run(args, cwd) {
    return new Promise((resolve, reject) => {
      this.execFile('git', args, { cwd, timeout: 1000 }, (error, stdout, stderr) => {
        if (error) { error.stderr = stderr; reject(error); } else resolve(stdout.trim());
      });
    });
  }

  stop() { this.timers.clearTimeout(this.timer); this.timer = undefined; }
}

export class VersionResolver {
  constructor(onChange, { execFile = nodeExecFile } = {}) {
    this.onChange = onChange;
    this.execFile = execFile;
    this.value = undefined;
    this.requested = false;
  }

  get(version) {
    if (version) return `v${version}`;
    if (!this.requested) {
      this.requested = true;
      this.execFile('herdr', ['--version'], { timeout: 1000 }, (error, stdout) => {
        const output = stdout?.trim().replace(/^herdr\s+/i, '');
        if (!error && output) { this.value = `v${output}`; this.onChange(); }
      });
    }
    return this.value || '';
  }
}
