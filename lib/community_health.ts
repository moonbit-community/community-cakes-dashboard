import { join } from '@std/path/join';
import { dirname } from '@std/path/dirname';
import { JsonStringifyStream } from '@std/json';
import { expandCommand, expandReposConfig, getCurrentCommunityOS, loadReposConfig } from './community_config.ts';
import {
  CommunityMetadata,
  CommunityOS,
  CommunityResultRecord,
  CommunityStep,
  CommunityTask,
  EffectiveCommandSpec,
  ExpandedCommand,
} from './community_types.ts';
import { getMoonVersion } from './moon.ts';
import { executeWithConcurrency } from './utils.ts';
import { sha256Hex } from './log.ts';

const DEFAULT_MAX_CONCURRENT_REPOS = 2;
const MOON_ENV = {
  MOON_IGNORE_PREBUILD: '1',
  MOON_NO_WORKSPACE: '1',
} as const;
const WARNING_LINE_PATTERN = /^Warning: \[[0-9]{4}\]/m;

export interface CommunityStatOptions {
  config?: string;
  outDir?: string;
  os?: CommunityOS;
  maxConcurrentRepos?: number;
}

interface ProcessResult {
  success: boolean;
  exit_code?: number;
  elapsed: number;
  reason?: string;
}

export function hasWarningDiagnostic(output: string): boolean {
  return WARNING_LINE_PATTERN.test(output);
}

async function commandOutputHasWarning(paths: { stdout_path: string; stderr_path: string }): Promise<boolean> {
  const [stdout, stderr] = await Promise.all([
    Deno.readTextFile(paths.stdout_path).catch(() => ''),
    Deno.readTextFile(paths.stderr_path).catch(() => ''),
  ]);
  return hasWarningDiagnostic(stdout) || hasWarningDiagnostic(stderr);
}

function groupTasks(tasks: CommunityTask[]): CommunityTask[][] {
  const groups = new Map<string, CommunityTask[]>();
  for (const task of tasks) {
    const key = `${task.repo}\0${task.branch}`;
    const group = groups.get(key) ?? [];
    group.push(task);
    groups.set(key, group);
  }
  return Array.from(groups.values());
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const process = new Deno.Command('git', {
    args,
    cwd,
    stdout: 'piped',
    stderr: 'piped',
  });
  const { code, stdout, stderr } = await process.output();
  const stdoutText = new TextDecoder().decode(stdout).trim();
  if (code !== 0) {
    const stderrText = new TextDecoder().decode(stderr).trim();
    throw new Error(`git ${args.join(' ')} failed with exit code ${code}${stderrText ? `: ${stderrText}` : ''}`);
  }
  return stdoutText;
}

async function cloneRepo(task: CommunityTask, repoDir: string, workdir: string): Promise<string> {
  await runGit(['clone', '--depth', '1', '-b', task.branch, task.repo, repoDir], workdir);
  return await runGit(['rev-parse', 'HEAD'], repoDir);
}

async function makeLogPaths(
  dataDir: string,
  task: CommunityTask,
  step: CommunityStep,
): Promise<{ stdout_path: string; stderr_path: string }> {
  await Deno.mkdir(join(dataDir, 'logs'), { recursive: true });
  const hash = await sha256Hex([
    task.repo,
    task.branch,
    task.module_path,
    task.os,
    task.backend,
    step,
  ].join('|'));
  const prefix = hash.slice(0, 16);
  return {
    stdout_path: join(dataDir, 'logs', `${prefix}-${step}.stdout.log`),
    stderr_path: join(dataDir, 'logs', `${prefix}-${step}.stderr.log`),
  };
}

function commandContext(task: CommunityTask, command: EffectiveCommandSpec) {
  return {
    backend: task.backend,
    os: task.os,
    repo: task.repo,
    branch: task.branch,
    module: task.module_path,
    working_directory: command.working_directory,
  };
}

function baseRecord(
  task: CommunityTask,
  step: CommunityStep,
  command: EffectiveCommandSpec,
  commitSha: string | undefined,
  expandedCommand: ExpandedCommand | undefined,
): Omit<CommunityResultRecord, 'status'> {
  return {
    repo: task.repo,
    branch: task.branch,
    commit_sha: commitSha,
    module_path: task.module_path,
    os: task.os,
    backend: task.backend,
    step,
    working_directory: command.working_directory,
    expanded_command: expandedCommand,
  };
}

async function writeFailureLog(
  dataDir: string,
  task: CommunityTask,
  step: CommunityStep,
  message: string,
): Promise<{ stdout_path: string; stderr_path: string }> {
  const paths = await makeLogPaths(dataDir, task, step);
  await Deno.writeTextFile(paths.stdout_path, '');
  await Deno.writeTextFile(paths.stderr_path, message);
  return paths;
}

function shellCommandArgs(shell: string): { command: string; args: string[] } {
  if (Deno.build.os === 'windows') {
    return { command: 'cmd', args: ['/d', '/s', '/c', shell] };
  }

  return { command: 'sh', args: ['-c', shell] };
}

async function runExpandedCommand(
  expandedCommand: ExpandedCommand,
  cwd: string,
  env: Record<string, string>,
  timeoutSeconds: number,
  stdoutPath: string,
  stderrPath: string,
): Promise<ProcessResult> {
  const started = performance.now();
  const signal = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    signal.abort();
  }, timeoutSeconds * 1000);

  const command = Array.isArray(expandedCommand)
    ? { command: expandedCommand[0], args: expandedCommand.slice(1) }
    : shellCommandArgs(expandedCommand);

  try {
    using stdoutFile = await Deno.open(stdoutPath, { create: true, write: true, truncate: true });
    using stderrFile = await Deno.open(stderrPath, { create: true, write: true, truncate: true });
    const process = new Deno.Command(command.command, {
      args: command.args,
      cwd,
      env: { ...MOON_ENV, ...env },
      signal: signal.signal,
      stdout: 'piped',
      stderr: 'piped',
    });
    const child = process.spawn();
    const stdoutTask = child.stdout.pipeTo(stdoutFile.writable);
    const stderrTask = child.stderr.pipeTo(stderrFile.writable);

    try {
      const status = await child.status;
      await Promise.all([stdoutTask, stderrTask]);
      return {
        success: status.success,
        exit_code: status.code,
        elapsed: Math.round((performance.now() - started) / 10) / 100,
      };
    } catch (error) {
      await Promise.allSettled([stdoutTask, stderrTask]);
      return {
        success: false,
        elapsed: Math.round((performance.now() - started) / 10) / 100,
        reason: timedOut ? `Command timed out after ${timeoutSeconds} seconds.` : String(error),
      };
    }
  } catch (error) {
    await Deno.writeTextFile(stderrPath, error instanceof Error ? error.message : String(error)).catch(() => {});
    return {
      success: false,
      elapsed: Math.round((performance.now() - started) / 10) / 100,
      reason: timedOut ? `Command timed out after ${timeoutSeconds} seconds.` : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function executeStep(
  repoDir: string,
  dataDir: string,
  task: CommunityTask,
  step: CommunityStep,
  commitSha: string | undefined,
): Promise<CommunityResultRecord> {
  const command = task.commands[step];
  const expandedCommand = expandCommand(command, commandContext(task, command));
  const record = baseRecord(task, step, command, commitSha, expandedCommand);

  if (command.skip) {
    return {
      ...record,
      status: 'Skipped',
      reason: command.reason ?? `${step} skipped by configuration.`,
    };
  }

  if (!expandedCommand) {
    return {
      ...record,
      status: 'Error',
      reason: `No executable command was resolved for ${step}.`,
    };
  }

  const paths = await makeLogPaths(dataDir, task, step);
  const startTime = new Date().toISOString();
  const result = await runExpandedCommand(
    expandedCommand,
    join(repoDir, command.working_directory),
    command.env,
    command.timeout_seconds ?? (step === 'check' ? 600 : 1200),
    paths.stdout_path,
    paths.stderr_path,
  );

  const hasWarnings = result.success && step === 'check' && await commandOutputHasWarning(paths);
  const status: CommunityResultRecord['status'] = !result.success
    ? 'Error'
    : hasWarnings
    ? 'Passed with Warning'
    : 'Pass';

  return {
    ...record,
    status,
    start_time: startTime,
    elapsed: result.elapsed,
    exit_code: result.exit_code,
    stdout_path: paths.stdout_path,
    stderr_path: paths.stderr_path,
    reason: result.reason,
  };
}

function skippedAfterCheck(task: CommunityTask, commitSha: string | undefined, reason: string): CommunityResultRecord {
  const command = task.commands.test;
  const expandedCommand = expandCommand(command, commandContext(task, command));
  return {
    ...baseRecord(task, 'test', command, commitSha, expandedCommand),
    status: 'Skipped',
    reason,
  };
}

async function cloneFailureRecords(
  dataDir: string,
  tasks: CommunityTask[],
  error: unknown,
): Promise<CommunityResultRecord[]> {
  const message = error instanceof Error ? error.message : String(error);
  const records: CommunityResultRecord[] = [];

  for (const task of tasks) {
    const checkCommand = task.commands.check;
    const checkExpanded = expandCommand(checkCommand, commandContext(task, checkCommand));
    const paths = await writeFailureLog(dataDir, task, 'check', message);
    records.push({
      ...baseRecord(task, 'check', checkCommand, undefined, checkExpanded),
      status: 'Error',
      stdout_path: paths.stdout_path,
      stderr_path: paths.stderr_path,
      reason: `Failed to clone repository: ${message}`,
    });
    records.push(skippedAfterCheck(task, undefined, 'Skipped because repository checkout failed.'));
  }

  return records;
}

async function executeRepoGroup(dataDir: string, tasks: CommunityTask[]): Promise<CommunityResultRecord[]> {
  if (tasks.length === 0) return [];

  const tmp = await Deno.makeTempDir();
  const repoDir = join(tmp, 'repo');

  try {
    let commitSha: string;
    try {
      commitSha = await cloneRepo(tasks[0], repoDir, tmp);
    } catch (error) {
      return await cloneFailureRecords(dataDir, tasks, error);
    }

    const records: CommunityResultRecord[] = [];
    for (const task of tasks) {
      const check = await executeStep(repoDir, dataDir, task, 'check', commitSha);
      records.push(check);

      if (check.status === 'Pass' || check.status === 'Passed with Warning') {
        records.push(await executeStep(repoDir, dataDir, task, 'test', commitSha));
      } else {
        records.push(skippedAfterCheck(task, commitSha, `Skipped because check was ${check.status}.`));
      }
    }
    return records;
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
}

export async function communityStat(
  options: CommunityStatOptions,
): Promise<{ metadata: CommunityMetadata; result: CommunityResultRecord[]; os: CommunityOS; outDir: string }> {
  const os = options.os ?? getCurrentCommunityOS();
  const outDir = options.outDir ?? `data/community/${os}`;
  const config = await loadReposConfig(options.config ?? 'resources/repos.yaml');
  const tasks = expandReposConfig(config, os);
  const groups = groupTasks(tasks);
  const maxConcurrentRepos = options.maxConcurrentRepos ??
    parseInt(Deno.env.get('MAX_CONCURRENT_REPOS') ?? String(DEFAULT_MAX_CONCURRENT_REPOS), 10);

  const groupedResults = await executeWithConcurrency(
    groups.map((group) => () => executeRepoGroup(outDir, group)),
    maxConcurrentRepos,
  );

  return {
    os,
    outDir,
    metadata: {
      runId: Deno.env.get('GITHUB_ACTION_RUN_ID') || '0',
      runNumber: Deno.env.get('GITHUB_ACTION_RUN_NUMBER') || '0',
      generated_at: new Date().toISOString(),
      toolchainVersion: await getMoonVersion(),
    },
    result: groupedResults.flat(),
  };
}

export async function writeCommunityJsonl(
  path: string,
  metadata: CommunityMetadata,
  records: CommunityResultRecord[],
): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  using file = await Deno.open(path, {
    create: true,
    write: true,
    truncate: true,
  });
  await ReadableStream.from([metadata, ...records])
    .pipeThrough(new JsonStringifyStream())
    .pipeThrough(new TextEncoderStream())
    .pipeTo(file.writable);
}
