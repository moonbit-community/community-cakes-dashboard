import { expandCommand, expandReposConfig, normalizeGitHubLink, reposConfigFromCsv } from './community_config.ts';
import { ReposConfig } from './community_types.ts';

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Assertion failed:\nactual: ${JSON.stringify(actual)}\nexpected: ${JSON.stringify(expected)}`);
  }
}

function assertThrows(fn: () => unknown, expectedMessage: string) {
  try {
    fn();
  } catch (error) {
    if (error instanceof Error && error.message.includes(expectedMessage)) {
      return;
    }
    throw error;
  }

  throw new Error(`Expected function to throw: ${expectedMessage}`);
}

Deno.test('normalizeGitHubLink removes trailing slash and git suffix', () => {
  assertEquals(normalizeGitHubLink(' https://github.com/example/project.git/ '), 'https://github.com/example/project');
});

Deno.test('reposConfigFromCsv parses quoted CSV and detects duplicates', () => {
  const config = reposConfigFromCsv('link,branch\n"https://github.com/example/a.git",main\n');
  assertEquals(Object.keys(config.repos), ['https://github.com/example/a']);
  assertEquals(config.repos['https://github.com/example/a'].branch, 'main');

  assertThrows(
    () =>
      reposConfigFromCsv(
        'link,branch\nhttps://github.com/example/a,main\nhttps://github.com/example/a.git,main\n',
      ),
    'Duplicate repository',
  );
});

Deno.test('expandReposConfig applies module matrix and ordered overrides', () => {
  const config: ReposConfig = {
    schema_version: 1,
    defaults: {
      matrix: {
        os: ['linux-x64', 'windows-x64'],
        backends: ['wasm', 'native'],
      },
      commands: {
        check: {
          argv: ['moon', 'check', '--target', '{backend}'],
          timeout_seconds: 600,
        },
        test: {
          argv: ['moon', 'test', '--target', '{backend}'],
          timeout_seconds: 1200,
          run_after: 'check_passed',
        },
      },
    },
    repos: {
      'https://github.com/example/project.git': {
        branch: 'main',
        matrix: {
          exclude: [{ os: 'windows-x64', backend: 'native' }],
        },
        modules: [
          {
            path: '.',
          },
          {
            path: 'examples/foo',
            matrix: {
              backends: ['wasm'],
            },
          },
        ],
        overrides: [
          {
            match: { os: ['linux-x64'], backends: ['native'] },
            env: { NATIVE_ONLY: '1' },
            commands: {
              test: {
                shell: './scripts/native-test.sh {backend}',
                timeout_seconds: 42,
              },
            },
          },
        ],
      },
    },
  };

  const tasks = expandReposConfig(config, 'linux-x64');
  assertEquals(tasks.map((task) => `${task.module_path}:${task.backend}`), [
    '.:wasm',
    '.:native',
    'examples/foo:wasm',
  ]);

  const native = tasks.find((task) => task.backend === 'native')!;
  assertEquals(native.repo, 'https://github.com/example/project');
  assertEquals(native.commands.test.shell, './scripts/native-test.sh {backend}');
  assertEquals(native.commands.test.timeout_seconds, 42);
  assertEquals(native.commands.test.env, { NATIVE_ONLY: '1' });

  const expanded = expandCommand(native.commands.test, {
    backend: native.backend,
    os: native.os,
    repo: native.repo,
    branch: native.branch,
    module: native.module_path,
    working_directory: native.commands.test.working_directory,
  });
  assertEquals(expanded, './scripts/native-test.sh native');
});
