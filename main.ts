import { parseArgs } from '@std/cli/parse-args';
import { join } from '@std/path/join';
import z from 'zod';
import { communityStat, writeCommunityJsonl } from './lib/community_health.ts';
import { writeReposConfigFromCsv } from './lib/community_config.ts';
import { type CommunityOS, CommunityOSSchema, ReposConfigSchema } from './lib/community_types.ts';

type Cli =
  | { subcommand: 'stat'; options: { config?: string; outDir?: string; os?: CommunityOS; maxConcurrentRepos?: number } }
  | { subcommand: 'repos-from-csv'; options: { csv: string; out: string } }
  | { subcommand: 'schema' };

function showHelp() {
  console.log(`
Community Cakes Dashboard

USAGE:
    deno run -A main.ts <SUBCOMMAND> [OPTIONS]

SUBCOMMANDS:
    stat             Run MoonBit nightly health checks from resources/repos.yaml
    repos-from-csv   Generate resources/repos.yaml from repos.csv
    schema           Generate resources/repos.schema.json

GLOBAL OPTIONS:
    -h, --help       Show this help message
`);
}

function showStatHelp() {
  console.log(`
Run nightly health checks

USAGE:
    deno run -A main.ts stat [OPTIONS]

OPTIONS:
    --config <PATH>                  Path to repos.yaml [default: resources/repos.yaml]
    --out-dir <PATH>                 Output directory [default: data/community/<os>]
    --os <OS>                        windows-x64, macos-arm64, or linux-x64 [default: auto]
    --max-concurrent-repos <NUMBER>  Maximum concurrent repositories [default: 2]
    -h, --help                       Show this help message
`);
}

function showReposFromCsvHelp() {
  console.log(`
Generate repos.yaml from repos.csv

USAGE:
    deno run -A main.ts repos-from-csv [OPTIONS]

OPTIONS:
    --csv <PATH>                     Input CSV with link,branch columns [default: repos.csv]
    --out <PATH>                     Output repos.yaml path [default: resources/repos.yaml]
    -h, --help                       Show this help message
`);
}

function parseCommunityOs(value: unknown): CommunityOS | undefined {
  if (value === undefined) return undefined;
  const parsed = CommunityOSSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid --os value: ${String(value)}. Expected windows-x64, macos-arm64, or linux-x64.`);
  }
  return parsed.data;
}

function parseStatArgs(args: string[]): Cli {
  const parsed = parseArgs(args, {
    string: ['config', 'out-dir', 'os', 'max-concurrent-repos'],
    boolean: ['help'],
    alias: { h: 'help' },
  });

  if (parsed.help) {
    showStatHelp();
    Deno.exit(0);
  }

  return {
    subcommand: 'stat',
    options: {
      config: parsed.config,
      outDir: parsed['out-dir'],
      os: parseCommunityOs(parsed.os),
      maxConcurrentRepos: parsed['max-concurrent-repos'] ? parseInt(parsed['max-concurrent-repos'], 10) : undefined,
    },
  };
}

function parseReposFromCsvArgs(args: string[]): Cli {
  const parsed = parseArgs(args, {
    string: ['csv', 'out'],
    boolean: ['help'],
    alias: { h: 'help' },
  });

  if (parsed.help) {
    showReposFromCsvHelp();
    Deno.exit(0);
  }

  return {
    subcommand: 'repos-from-csv',
    options: {
      csv: parsed.csv ?? 'repos.csv',
      out: parsed.out ?? 'resources/repos.yaml',
    },
  };
}

function parseCli(args: string[]): Cli {
  const parsed = parseArgs(args, {
    boolean: ['help'],
    alias: { h: 'help' },
    stopEarly: true,
  });

  if (parsed.help) {
    showHelp();
    Deno.exit(0);
  }

  const subcommand = parsed._[0]?.toString();
  const rest = parsed._.slice(1).map(String);
  switch (subcommand) {
    case 'stat':
      return parseStatArgs(rest);
    case 'repos-from-csv':
      return parseReposFromCsvArgs(rest);
    case 'schema':
      return { subcommand: 'schema' };
    default:
      throw new Error(subcommand ? `Unknown subcommand: ${subcommand}` : 'No subcommand specified.');
  }
}

try {
  const cli = parseCli(Deno.args);

  if (cli.subcommand === 'stat') {
    const dashboard = await communityStat(cli.options);
    const path = join(dashboard.outDir, 'data.jsonl');
    await writeCommunityJsonl(path, dashboard.metadata, dashboard.result);
    console.log(`Wrote ${dashboard.result.length} health records to ${path}`);
  } else if (cli.subcommand === 'repos-from-csv') {
    const count = await writeReposConfigFromCsv(cli.options.csv, cli.options.out);
    console.log(`Wrote ${count} repositories to ${cli.options.out}`);
  } else if (cli.subcommand === 'schema') {
    await Deno.mkdir('resources', { recursive: true });
    await Deno.writeTextFile(
      'resources/repos.schema.json',
      `${JSON.stringify(z.toJSONSchema(ReposConfigSchema), null, 2)}\n`,
    );
    console.log('Generated resources/repos.schema.json');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  Deno.exit(1);
}
