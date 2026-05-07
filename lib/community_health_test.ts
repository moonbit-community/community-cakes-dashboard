import { hasWarningDiagnostic, shouldDisableGitAutocrlf } from './community_health.ts';

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Assertion failed:\nactual: ${JSON.stringify(actual)}\nexpected: ${JSON.stringify(expected)}`);
  }
}

Deno.test('hasWarningDiagnostic detects warning lines with four digit codes', () => {
  assertEquals(hasWarningDiagnostic('ok\nWarning: [1234], unused variable\n'), true);
  assertEquals(hasWarningDiagnostic('Warning: [0000] something\n'), true);
});

Deno.test('hasWarningDiagnostic ignores non-leading or malformed warning codes', () => {
  assertEquals(hasWarningDiagnostic('note: Warning: [1234], nested text\n'), false);
  assertEquals(hasWarningDiagnostic('Warning: [123], too short\n'), false);
  assertEquals(hasWarningDiagnostic('Warning: [12345], too long\n'), false);
});

Deno.test('shouldDisableGitAutocrlf only enables the git setting on Windows', () => {
  assertEquals(shouldDisableGitAutocrlf('windows'), true);
  assertEquals(shouldDisableGitAutocrlf('linux'), false);
  assertEquals(shouldDisableGitAutocrlf('darwin'), false);
});
