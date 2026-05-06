import * as yaml from '@std/yaml';
import {
  CommandsConfig,
  CommandSpec,
  CommunityBackend,
  communityBackends,
  CommunityOS,
  communityOses,
  CommunityStep,
  CommunityTask,
  DefaultsConfig,
  EffectiveCommandSpec,
  ExpandedCommand,
  MatrixConfig,
  MatrixExclude,
  OverrideConfig,
  RepoConfig,
  ReposConfig,
  ReposConfigSchema,
} from './community_types.ts';

type NormalizedMatrix = {
  os: CommunityOS[];
  backends: CommunityBackend[];
  exclude: MatrixExclude[];
};

type NormalizedCommands = Record<CommunityStep, CommandSpec>;

export interface ExpandReposConfigOptions {
  includeExcluded?: boolean;
}

export interface CommandTemplateContext {
  backend: CommunityBackend;
  os: CommunityOS;
  repo: string;
  branch: string;
  module: string;
  working_directory: string;
}

export function normalizeGitHubLink(link: string): string {
  let normalized = link.trim();
  normalized = normalized.replace(/\/+$/, '');
  normalized = normalized.endsWith('.git') ? normalized.slice(0, -4) : normalized;
  return normalized;
}

function normalizeRelativePath(path: string | undefined): string {
  const normalized = (path ?? '.').trim().replaceAll('\\', '/').replace(/\/+$/, '');
  return normalized.length === 0 ? '.' : normalized;
}

export function getCurrentCommunityOS(): CommunityOS {
  if (Deno.build.os === 'linux' && Deno.build.arch === 'x86_64') return 'linux-x64';
  if (Deno.build.os === 'windows' && Deno.build.arch === 'x86_64') return 'windows-x64';
  if (Deno.build.os === 'darwin' && Deno.build.arch === 'aarch64') return 'macos-arm64';

  throw new Error(`Unsupported community health OS/arch: ${Deno.build.os}/${Deno.build.arch}`);
}

function mergeMatrix(base: NormalizedMatrix, override?: MatrixConfig): NormalizedMatrix {
  return {
    os: override?.os ? [...override.os] : [...base.os],
    backends: override?.backends ? [...override.backends] : [...base.backends],
    exclude: [...base.exclude, ...(override?.exclude ?? [])],
  };
}

function normalizeMatrix(config: MatrixConfig): NormalizedMatrix {
  return {
    os: config.os ? [...config.os] : [...communityOses],
    backends: config.backends ? [...config.backends] : [...communityBackends],
    exclude: [...(config.exclude ?? [])],
  };
}

function cloneCommandSpec(spec: CommandSpec): CommandSpec {
  return {
    ...spec,
    argv: spec.argv ? [...spec.argv] : undefined,
    env: spec.env ? { ...spec.env } : undefined,
  };
}

function mergeCommandSpec(base: CommandSpec, override?: CommandSpec): CommandSpec {
  if (!override) return cloneCommandSpec(base);

  const merged: CommandSpec = {
    ...cloneCommandSpec(base),
    ...cloneCommandSpec(override),
    env: {
      ...(base.env ?? {}),
      ...(override.env ?? {}),
    },
  };

  if (Object.keys(merged.env ?? {}).length === 0) {
    delete merged.env;
  }

  if (override.skip === true) {
    delete merged.argv;
    delete merged.shell;
  } else if (override.argv !== undefined) {
    delete merged.shell;
    delete merged.skip;
  } else if (override.shell !== undefined) {
    delete merged.argv;
    delete merged.skip;
  } else if (override.skip === false) {
    delete merged.skip;
  }

  return merged;
}

function mergeCommands(base: NormalizedCommands, override?: CommandsConfig): NormalizedCommands {
  return {
    check: mergeCommandSpec(base.check, override?.check),
    test: mergeCommandSpec(base.test, override?.test),
  };
}

function normalizeCommands(defaults: DefaultsConfig): NormalizedCommands {
  return {
    check: cloneCommandSpec(defaults.commands.check),
    test: cloneCommandSpec(defaults.commands.test),
  };
}

function isExcluded(os: CommunityOS, backend: CommunityBackend, excludes: MatrixExclude[]): boolean {
  return excludes.some((exclude) => {
    const osMatches = exclude.os === undefined || exclude.os === os;
    const backendMatches = exclude.backend === undefined || exclude.backend === backend;
    return osMatches && backendMatches;
  });
}

function matchesOverride(override: OverrideConfig, os: CommunityOS, backend: CommunityBackend): boolean {
  const osMatches = override.match.os === undefined || override.match.os.includes(os);
  const backendMatches = override.match.backends === undefined || override.match.backends.includes(backend);
  return osMatches && backendMatches;
}

function materializeCommand(
  spec: CommandSpec,
  step: CommunityStep,
  defaultWorkingDirectory: string,
  overrideEnv: Record<string, string>,
): EffectiveCommandSpec {
  const forms = [spec.argv !== undefined, spec.shell !== undefined, spec.skip === true].filter(Boolean).length;
  if (forms !== 1) {
    throw new Error(`Effective ${step} command must set exactly one of argv, shell, or skip: true.`);
  }

  if (spec.argv && spec.argv.length === 0) {
    throw new Error(`Effective ${step} command argv must not be empty.`);
  }

  return {
    argv: spec.argv ? [...spec.argv] : undefined,
    shell: spec.shell,
    skip: spec.skip,
    reason: spec.reason,
    timeout_seconds: spec.timeout_seconds,
    env: {
      ...overrideEnv,
      ...(spec.env ?? {}),
    },
    working_directory: normalizeRelativePath(spec.working_directory ?? defaultWorkingDirectory),
    run_after: spec.run_after,
  };
}

export function expandTemplate(value: string, context: CommandTemplateContext): string {
  return value.replaceAll(
    /\{(backend|os|repo|branch|module|working_directory)\}/g,
    (_match, key: keyof CommandTemplateContext) => context[key],
  );
}

export function expandCommand(
  command: EffectiveCommandSpec,
  context: CommandTemplateContext,
): ExpandedCommand | undefined {
  if (command.skip) return undefined;
  if (command.argv) return command.argv.map((arg) => expandTemplate(arg, context));
  if (command.shell) return expandTemplate(command.shell, context);
  return undefined;
}

export function expandReposConfig(
  config: ReposConfig,
  targetOs?: CommunityOS,
  options: ExpandReposConfigOptions = {},
): CommunityTask[] {
  const defaultsMatrix = normalizeMatrix(config.defaults.matrix);
  const defaultsCommands = normalizeCommands(config.defaults);
  const tasks: CommunityTask[] = [];

  for (const [rawRepo, repoConfig] of Object.entries(config.repos)) {
    const repo = normalizeGitHubLink(rawRepo);
    const repoMatrix = mergeMatrix(defaultsMatrix, repoConfig.matrix);
    const repoCommands = mergeCommands(defaultsCommands, repoConfig.commands);
    const moduleConfigs = getModuleConfigs(repoConfig);

    for (const moduleConfig of moduleConfigs) {
      const modulePath = normalizeRelativePath(moduleConfig.path);
      const matrix = mergeMatrix(repoMatrix, moduleConfig.matrix);
      const moduleCommands = mergeCommands(repoCommands, moduleConfig.commands);
      const overrides = [...(repoConfig.overrides ?? []), ...(moduleConfig.overrides ?? [])];

      for (const os of matrix.os) {
        if (targetOs !== undefined && os !== targetOs) continue;

        for (const backend of matrix.backends) {
          const excluded = isExcluded(os, backend, matrix.exclude);
          if (excluded && !options.includeExcluded) continue;

          let commands = mergeCommands(moduleCommands);
          let defaultWorkingDirectory = modulePath;
          const overrideEnv: Record<string, string> = {};

          for (const override of overrides) {
            if (!matchesOverride(override, os, backend)) continue;

            if (override.working_directory !== undefined) {
              defaultWorkingDirectory = normalizeRelativePath(override.working_directory);
            }
            Object.assign(overrideEnv, override.env ?? {});
            commands = mergeCommands(commands, override.commands);
          }

          tasks.push({
            repo,
            branch: repoConfig.branch,
            module_path: modulePath,
            os,
            backend,
            excluded: excluded ? true : undefined,
            commands: {
              check: materializeCommand(commands.check, 'check', defaultWorkingDirectory, overrideEnv),
              test: materializeCommand(commands.test, 'test', defaultWorkingDirectory, overrideEnv),
            },
          });
        }
      }
    }
  }

  return tasks;
}

function getModuleConfigs(
  repoConfig: RepoConfig,
): Array<{ path: string; matrix?: MatrixConfig; commands?: CommandsConfig; overrides?: OverrideConfig[] }> {
  if (repoConfig.modules && repoConfig.modules.length > 0) {
    return repoConfig.modules;
  }

  return [{
    path: normalizeRelativePath(repoConfig.working_directory),
  }];
}

export async function loadReposConfig(filePath: string): Promise<ReposConfig> {
  const content = await Deno.readTextFile(filePath);
  const parsed = ReposConfigSchema.parse(yaml.parse(content));
  const repos: Record<string, RepoConfig> = {};

  for (const [link, repo] of Object.entries(parsed.repos)) {
    const normalized = normalizeGitHubLink(link);
    if (repos[normalized]) {
      throw new Error(`Duplicate repository after normalization: ${normalized}`);
    }
    repos[normalized] = repo;
  }

  return { ...parsed, repos };
}
