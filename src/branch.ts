import { execFile as nodeExecFile } from 'node:child_process';
import type { TimerApi } from '#src/debounce';

type ExecError = Error & { code?: number; stderr?: string };
type ExecFile = (
  file: string,
  args: string[],
  options: { cwd?: string; timeout: number },
  callback: (error: ExecError | null, stdout: string, stderr: string) => void,
) => unknown;
type BranchResult = { branch: string; definitive?: boolean };

function isDefinitiveNoBranch(error: ExecError) {
  return (
    error?.code === 128 &&
    /not a git repository|does not have any commits yet|unknown revision|ambiguous argument 'HEAD'/i.test(
      error.stderr || '',
    )
  );
}

export class BranchResolver {
  readonly onChange: () => void;
  execFile: ExecFile;
  readonly timers: TimerApi;
  cwd: string | undefined;
  privateWorkspace = false;
  branch: string | undefined;
  active = false;
  inFlight = false;
  timer: unknown;
  generation = 0;

  constructor(
    onChange: () => void,
    {
      execFile = nodeExecFile as unknown as ExecFile,
      timers = globalThis,
    }: { execFile?: ExecFile; timers?: TimerApi } = {},
  ) {
    this.onChange = onChange;
    this.execFile = execFile;
    this.timers = timers;
  }

  update({
    cwd,
    privateWorkspace,
    active,
  }: {
    cwd?: string;
    privateWorkspace: boolean;
    active: boolean;
  }) {
    const changed =
      cwd !== this.cwd || privateWorkspace !== this.privateWorkspace;
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
    if (this.active)
      this.timer = this.timers.setTimeout(() => this.check(), 5000);
  }

  check() {
    if (!this.active || this.inFlight) return;
    const generation = this.generation;
    const cwd = this.cwd;
    this.inFlight = true;
    const request = this.run(['symbolic-ref', '--short', 'HEAD'], cwd)
      .catch(() => '')
      .then(
        (name) =>
          name ||
          this.run(['rev-parse', '--short', 'HEAD'], cwd)
            .then((hash) =>
              hash ? { branch: `@${hash}` } : { branch: '', definitive: true },
            )
            .catch((error: ExecError) =>
              isDefinitiveNoBranch(error)
                ? { branch: '', definitive: true }
                : Promise.reject(error),
            ),
      ) as Promise<string | BranchResult>;
    request
      .then((result) => {
        const { branch, definitive } =
          typeof result === 'string' ? { branch: result } : result;
        if (generation !== this.generation || cwd !== this.cwd || !this.active)
          return;
        if (branch && branch !== this.branch) {
          this.branch = branch;
          this.onChange();
        }
        if (definitive && this.branch !== undefined) {
          this.branch = undefined;
          this.onChange();
        }
      })
      .catch(() => {})
      .finally(() => {
        this.inFlight = false;
        if (generation !== this.generation && this.active) this.check();
        else this.schedule();
      });
  }

  run(args: string[], cwd?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.execFile(
        'git',
        args,
        { cwd, timeout: 1000 },
        (error, stdout, stderr) => {
          if (error) {
            error.stderr = stderr;
            reject(error);
          } else resolve(stdout.trim());
        },
      );
    });
  }

  stop() {
    this.timers.clearTimeout(this.timer);
    this.timer = undefined;
  }
}

export class VersionResolver {
  readonly onChange: () => void;
  readonly execFile: ExecFile;
  value: string | undefined;
  requested = false;

  constructor(
    onChange: () => void,
    {
      execFile = nodeExecFile as unknown as ExecFile,
    }: { execFile?: ExecFile } = {},
  ) {
    this.onChange = onChange;
    this.execFile = execFile;
  }

  get(version?: string) {
    if (version) return `v${version}`;
    if (!this.requested) {
      this.requested = true;
      this.execFile(
        'herdr',
        ['--version'],
        { timeout: 1000 },
        (error, stdout) => {
          const output = stdout?.trim().replace(/^herdr\s+/i, '');
          if (!error && output) {
            this.value = `v${output}`;
            this.onChange();
          }
        },
      );
    }
    return this.value || '';
  }
}
