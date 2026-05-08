import { z } from 'zod';

export const CommunityOSSchema = z.enum(['windows-x64', 'macos-arm64', 'linux-x64']);
export type CommunityOS = z.infer<typeof CommunityOSSchema>;
export const communityOses = ['windows-x64', 'macos-arm64', 'linux-x64'] as const satisfies readonly CommunityOS[];

export const CommunityBackendSchema = z.enum(['wasm', 'wasm-gc', 'js', 'native']);
export type CommunityBackend = z.infer<typeof CommunityBackendSchema>;
export const communityBackends = ['wasm', 'wasm-gc', 'js', 'native'] as const satisfies readonly CommunityBackend[];

export const CommunityStepSchema = z.enum(['check', 'test']);
export type CommunityStep = z.infer<typeof CommunityStepSchema>;
export const communitySteps = ['check', 'test'] as const satisfies readonly CommunityStep[];

export const CommunityStatusSchema = z.enum(['Pass', 'Passed with Warning', 'Error', 'Skipped', 'Excluded']);
export type CommunityStatus = z.infer<typeof CommunityStatusSchema>;

export const MatrixExcludeSchema = z.object({
  os: CommunityOSSchema.optional(),
  backend: CommunityBackendSchema.optional(),
}).strict();
export type MatrixExclude = z.infer<typeof MatrixExcludeSchema>;

export const MatrixConfigSchema = z.object({
  os: z.array(CommunityOSSchema).optional(),
  backends: z.array(CommunityBackendSchema).optional(),
  exclude: z.array(MatrixExcludeSchema).optional(),
}).strict();
export type MatrixConfig = z.infer<typeof MatrixConfigSchema>;

export const CommandSpecSchema = z.object({
  argv: z.array(z.string()).optional(),
  shell: z.string().optional(),
  skip: z.boolean().optional(),
  reason: z.string().optional(),
  timeout_seconds: z.number().positive().optional(),
  env: z.record(z.string(), z.string()).optional(),
  working_directory: z.string().optional(),
  run_after: z.literal('check_passed').optional(),
}).strict().superRefine((value, ctx) => {
  const forms = [value.argv !== undefined, value.shell !== undefined, value.skip === true].filter(Boolean).length;
  if (forms > 1) {
    ctx.addIssue({
      code: 'custom',
      message: 'CommandSpec must not set more than one of argv, shell, or skip: true.',
    });
  }
});
export type CommandSpec = z.infer<typeof CommandSpecSchema>;

export const CommandsConfigSchema = z.object({
  check: CommandSpecSchema.optional(),
  test: CommandSpecSchema.optional(),
}).strict();
export type CommandsConfig = z.infer<typeof CommandsConfigSchema>;

export const OverrideConfigSchema = z.object({
  match: z.object({
    os: z.array(CommunityOSSchema).optional(),
    backends: z.array(CommunityBackendSchema).optional(),
  }).strict().default({}),
  commands: CommandsConfigSchema.optional(),
  env: z.record(z.string(), z.string()).optional(),
  working_directory: z.string().optional(),
}).strict();
export type OverrideConfig = z.infer<typeof OverrideConfigSchema>;

export const ModuleConfigSchema = z.object({
  path: z.string(),
  matrix: MatrixConfigSchema.optional(),
  commands: CommandsConfigSchema.optional(),
  overrides: z.array(OverrideConfigSchema).optional(),
}).strict();
export type ModuleConfig = z.infer<typeof ModuleConfigSchema>;

export const DefaultsSchema = z.object({
  matrix: MatrixConfigSchema,
  commands: z.object({
    check: CommandSpecSchema,
    test: CommandSpecSchema,
  }).strict(),
}).strict();
export type DefaultsConfig = z.infer<typeof DefaultsSchema>;

export const RepoConfigSchema = z.object({
  branch: z.string(),
  resource_intensive: z.boolean().optional(),
  working_directory: z.string().optional(),
  modules: z.array(ModuleConfigSchema).optional(),
  matrix: MatrixConfigSchema.optional(),
  commands: CommandsConfigSchema.optional(),
  overrides: z.array(OverrideConfigSchema).optional(),
}).strict();
export type RepoConfig = z.infer<typeof RepoConfigSchema>;

export const ReposConfigSchema = z.object({
  schema_version: z.literal(1),
  defaults: DefaultsSchema,
  repos: z.record(z.string(), RepoConfigSchema),
}).strict();
export type ReposConfig = z.infer<typeof ReposConfigSchema>;

export type ExpandedCommand = string[] | string;

export interface EffectiveCommandSpec {
  argv?: string[];
  shell?: string;
  skip?: boolean;
  reason?: string;
  timeout_seconds?: number;
  env: Record<string, string>;
  working_directory: string;
  run_after?: 'check_passed';
}

export interface CommunityTask {
  repo: string;
  branch: string;
  resource_intensive: boolean;
  module_path: string;
  os: CommunityOS;
  backend: CommunityBackend;
  excluded?: boolean;
  commands: Record<CommunityStep, EffectiveCommandSpec>;
}

export interface CommunityMetadata {
  runId: string;
  runNumber: string;
  generated_at: string;
  toolchainVersion: string[];
}

export interface CommunityResultRecord {
  repo: string;
  branch: string;
  commit_sha?: string;
  module_path: string;
  os: CommunityOS;
  backend: CommunityBackend;
  step: CommunityStep;
  status: CommunityStatus;
  start_time?: string;
  elapsed?: number;
  working_directory: string;
  expanded_command?: ExpandedCommand;
  exit_code?: number;
  stdout_path?: string;
  stderr_path?: string;
  reason?: string;
}
