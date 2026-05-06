import { useEffect, useMemo, useState } from 'npm:preact@10.27.2/hooks';
import { html, render } from 'npm:htm@3.1.1/preact';
import { TextLineStream } from '@std/streams/text-line-stream';
import { JsonParseStream } from '@std/json/parse-stream';
import type { CommunityMetadata, CommunityResultRecord, CommunityStatus } from './lib/community_types.ts';

const OSES = ['linux-x64', 'macos-arm64', 'windows-x64'] as const;
const BACKENDS = ['wasm', 'wasm-gc', 'js', 'native'] as const;
const STEPS = ['check', 'test'] as const;

type OS = (typeof OSES)[number];
type Backend = (typeof BACKENDS)[number];
type Step = (typeof STEPS)[number];
type Filter = 'all' | 'error' | 'warning' | 'skipped' | 'pass';
type CellStatus = 'pass' | 'warning' | 'error' | 'skipped' | 'missing';

type DataMap = Record<OS, {
  metadata: CommunityMetadata | null;
  results: CommunityResultRecord[];
}>;

type RowData = {
  key: string;
  repo: string;
  module_path: string;
  branch: string;
  commit_sha?: string;
  cells: Map<string, CommunityResultRecord>;
  status: CellStatus;
  passCount: number;
  warningCount: number;
  errorCount: number;
  skippedCount: number;
  missingCount: number;
};

const STATUS_COLORS: Record<CellStatus, string> = {
  pass: '#15803d',
  warning: '#facc15',
  error: '#dc2626',
  skipped: '#64748b',
  missing: '#94a3b8',
};

const STATUS_TEXT_COLORS: Record<CellStatus, string> = {
  pass: '#ffffff',
  warning: '#422006',
  error: '#ffffff',
  skipped: '#ffffff',
  missing: '#ffffff',
};

const STATUS_LABELS: Record<CellStatus, string> = {
  pass: 'P',
  warning: 'PA',
  error: 'E',
  skipped: 'S',
  missing: '-',
};

const STATUS_PRIORITY: Record<CellStatus, number> = {
  error: 0,
  warning: 1,
  skipped: 2,
  missing: 3,
  pass: 4,
};

function emptyData(): DataMap {
  return {
    'linux-x64': { metadata: null, results: [] },
    'macos-arm64': { metadata: null, results: [] },
    'windows-x64': { metadata: null, results: [] },
  };
}

function cellKey(os: OS, backend: Backend, step: Step): string {
  return `${os}/${backend}/${step}`;
}

function rowKey(record: CommunityResultRecord): string {
  return `${record.repo}\0${record.module_path}`;
}

function toCellStatus(status: CommunityStatus | undefined): CellStatus {
  if (status === 'Pass') return 'pass';
  if (status === 'Passed with Warning') return 'warning';
  if (status === 'Error') return 'error';
  if (status === 'Skipped') return 'skipped';
  return 'missing';
}

function computeRowStatus(row: RowData): CellStatus {
  if (row.errorCount > 0) return 'error';
  if (row.warningCount > 0) return 'warning';
  if (row.skippedCount > 0) return 'skipped';
  if (row.missingCount > 0) return 'missing';
  return row.passCount > 0 ? 'pass' : 'missing';
}

function buildRows(data: DataMap): RowData[] {
  const rows = new Map<string, RowData>();

  for (const os of OSES) {
    for (const record of data[os].results) {
      const key = rowKey(record);
      const existing = rows.get(key) ?? {
        key,
        repo: record.repo,
        module_path: record.module_path,
        branch: record.branch,
        commit_sha: record.commit_sha,
        cells: new Map<string, CommunityResultRecord>(),
        status: 'missing' as CellStatus,
        passCount: 0,
        warningCount: 0,
        errorCount: 0,
        skippedCount: 0,
        missingCount: 0,
      };
      existing.commit_sha = existing.commit_sha ?? record.commit_sha;
      existing.cells.set(cellKey(record.os as OS, record.backend as Backend, record.step as Step), record);
      rows.set(key, existing);
    }
  }

  const result = Array.from(rows.values());
  for (const row of result) {
    let passCount = 0;
    let warningCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    let missingCount = 0;

    for (const os of OSES) {
      for (const backend of BACKENDS) {
        for (const step of STEPS) {
          const status = toCellStatus(row.cells.get(cellKey(os, backend, step))?.status);
          if (status === 'pass') passCount += 1;
          if (status === 'warning') warningCount += 1;
          if (status === 'error') errorCount += 1;
          if (status === 'skipped') skippedCount += 1;
          if (status === 'missing') missingCount += 1;
        }
      }
    }

    row.passCount = passCount;
    row.warningCount = warningCount;
    row.errorCount = errorCount;
    row.skippedCount = skippedCount;
    row.missingCount = missingCount;
    row.status = computeRowStatus(row);
  }

  result.sort((a, b) => {
    const priority = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
    if (priority !== 0) return priority;
    return a.repo.localeCompare(b.repo) || a.module_path.localeCompare(b.module_path);
  });
  return result;
}

function filterRows(rows: RowData[], filter: Filter, search: string): RowData[] {
  const keyword = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter !== 'all' && row.status !== filter) return false;
    if (keyword && !`${row.repo} ${row.module_path} ${row.branch}`.toLowerCase().includes(keyword)) return false;
    return true;
  });
}

function countRows(rows: RowData[]): Record<Filter, number> {
  return {
    all: rows.length,
    error: rows.filter((row) => row.status === 'error').length,
    warning: rows.filter((row) => row.status === 'warning').length,
    skipped: rows.filter((row) => row.status === 'skipped').length,
    pass: rows.filter((row) => row.status === 'pass').length,
  };
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

function formatGeneratedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.length >= 16 ? value.slice(0, 16).replace('T', ' ') : value;
  }

  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${
    pad2(date.getMinutes())
  }`;
}

function formatToolchainVersion(version: string[] | undefined): string {
  return version?.join('\n').trim() || '-';
}

function osSummary(row: RowData, os: OS): { status: CellStatus; label: string } {
  let pass = 0;
  let warning = 0;
  let error = 0;
  let skipped = 0;
  let missing = 0;

  for (const backend of BACKENDS) {
    for (const step of STEPS) {
      const status = toCellStatus(row.cells.get(cellKey(os, backend, step))?.status);
      if (status === 'pass') pass += 1;
      if (status === 'warning') warning += 1;
      if (status === 'error') error += 1;
      if (status === 'skipped') skipped += 1;
      if (status === 'missing') missing += 1;
    }
  }

  const status = error > 0
    ? 'error'
    : warning > 0
    ? 'warning'
    : skipped > 0
    ? 'skipped'
    : missing > 0
    ? 'missing'
    : 'pass';
  const warningLabel = warning ? ` ${warning}PA` : '';
  return { status, label: `${error}E${warningLabel} ${skipped}S ${pass}P${missing ? ` ${missing}-` : ''}` };
}

async function readJsonl(
  response: Response,
): Promise<{ metadata: CommunityMetadata | null; results: CommunityResultRecord[] }> {
  if (!response.ok || !response.body) {
    return { metadata: null, results: [] };
  }

  const reader = response.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TextLineStream())
    .pipeThrough(new JsonParseStream())
    .getReader();
  const first = await reader.read();
  const metadata = first.done ? null : first.value as unknown as CommunityMetadata;
  const results: CommunityResultRecord[] = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    results.push(value as unknown as CommunityResultRecord);
  }

  return { metadata, results };
}

async function openLogs(record: CommunityResultRecord | undefined) {
  let content = '';
  if (!record) {
    content = 'No result record.';
  } else {
    content += `${record.repo}\n`;
    content += `module: ${record.module_path}\n`;
    content += `branch: ${record.branch}\n`;
    content += `commit: ${record.commit_sha ?? '-'}\n`;
    content += `os/backend/step: ${record.os}/${record.backend}/${record.step}\n`;
    content += `status: ${record.status}\n`;
    content += `working_directory: ${record.working_directory}\n`;
    if (record.expanded_command) {
      content += `command: ${
        Array.isArray(record.expanded_command) ? record.expanded_command.join(' ') : record.expanded_command
      }\n`;
    }
    if (record.exit_code !== undefined) content += `exit_code: ${record.exit_code}\n`;
    if (record.elapsed !== undefined) content += `elapsed: ${record.elapsed}s\n`;
    if (record.reason) content += `reason: ${record.reason}\n`;
    content += '\n';

    if (record.stderr_path || record.stdout_path) {
      try {
        if (record.stderr_path) {
          const stderr = await fetch(record.stderr_path);
          content += `STDERR:\n${stderr.ok ? await stderr.text() : `Failed to fetch ${record.stderr_path}`}\n\n`;
        }
        if (record.stdout_path) {
          const stdout = await fetch(record.stdout_path);
          content += `STDOUT:\n${stdout.ok ? await stdout.text() : `Failed to fetch ${record.stdout_path}`}\n`;
        }
      } catch (error) {
        content += `Failed to fetch logs: ${error instanceof Error ? error.message : String(error)}\n`;
      }
    }
  }

  const blob = new Blob([content], { type: 'text/plain;charset=utf8' });
  const url = URL.createObjectURL(blob);
  const tab = globalThis.open(url, '_blank');
  if (tab) setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function StatusCell({ status, label, title, record }: {
  status: CellStatus;
  label: string;
  title: string;
  record?: CommunityResultRecord;
}) {
  return html`
    <td
      title="${title}"
      onClick="${() => openLogs(record)}"
      style="border: 1px solid #cbd5e1; padding: 5px 6px; text-align: center; background: ${STATUS_COLORS[
        status
      ]}; color: ${STATUS_TEXT_COLORS[
        status
      ]}; font-size: 11px; font-weight: 700; cursor: pointer; white-space: nowrap;"
    >
      ${label}
    </td>
  `;
}

function ExpandedRows({ row }: { row: RowData }) {
  return html`
    <div style="padding: 10px 12px; background: #f8fafc; border-top: 1px solid #e2e8f0;">
      <table style="width: 100%; border-collapse: collapse; font-size: 11px; table-layout: fixed;">
        <thead>
          <tr style="background: #334155; color: white;">
            <th style="padding: 6px; border: 1px solid #cbd5e1; text-align: left; width: 130px;">OS</th>
            <th style="padding: 6px; border: 1px solid #cbd5e1; text-align: left; width: 90px;">Backend</th>
            <th style="padding: 6px; border: 1px solid #cbd5e1;">Check</th>
            <th style="padding: 6px; border: 1px solid #cbd5e1;">Test</th>
            <th style="padding: 6px; border: 1px solid #cbd5e1; text-align: left;">Working Directory</th>
            <th style="padding: 6px; border: 1px solid #cbd5e1; text-align: left;">Reason</th>
          </tr>
        </thead>
        <tbody>
          ${OSES.flatMap((os) =>
            BACKENDS.map((backend) => {
              const check = row.cells.get(cellKey(os, backend, 'check'));
              const test = row.cells.get(cellKey(os, backend, 'test'));
              const checkStatus = toCellStatus(check?.status);
              const testStatus = toCellStatus(test?.status);
              const reason = check?.reason ?? test?.reason ?? '';
              const workingDirectory = check?.working_directory ?? test?.working_directory ?? row.module_path;

              return html`
                <tr>
                  <td style="padding: 6px; border: 1px solid #cbd5e1; font-family: monospace;">${os}</td>
                  <td style="padding: 6px; border: 1px solid #cbd5e1; font-family: monospace;">${backend}</td>
                  <${StatusCell}
                    status="${checkStatus}"
                    label="${STATUS_LABELS[checkStatus]}"
                    title="${os}/${backend}/check"
                    record="${check}"
                  />
                  <${StatusCell}
                    status="${testStatus}"
                    label="${STATUS_LABELS[testStatus]}"
                    title="${os}/${backend}/test"
                    record="${test}"
                  />
                  <td style="padding: 6px; border: 1px solid #cbd5e1; font-family: monospace;">${workingDirectory}</td>
                  <td style="padding: 6px; border: 1px solid #cbd5e1; color: #334155;">${reason}</td>
                </tr>
              `;
            })
          )}
        </tbody>
      </table>
    </div>
  `;
}

function App() {
  const [data, setData] = useState<DataMap>(emptyData());
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    async function fetchAll() {
      const next = emptyData();
      await Promise.all(
        OSES.map(async (os) => {
          try {
            next[os] = await readJsonl(await fetch(`data/community/${os}/data.jsonl`));
          } catch (error) {
            console.error(`Failed to fetch community data for ${os}:`, error);
          }
        }),
      );
      setData(next);
      setLoading(false);
    }

    fetchAll();
  }, []);

  const rows = useMemo(() => buildRows(data), [data]);
  const filteredRows = useMemo(() => filterRows(rows, filter, search), [
    rows,
    filter,
    search,
  ]);
  const counts = useMemo(() => countRows(rows), [rows]);
  const generatedAtRaw = OSES.map((os) => data[os].metadata?.generated_at).filter((value): value is string =>
    Boolean(value)
  ).sort().at(-1);
  const generatedAt = generatedAtRaw ? formatGeneratedAt(generatedAtRaw) : '-';
  const toolchainVersion = OSES.map((os) => data[os].metadata?.toolchainVersion).find((
    version,
  ): version is string[] => Array.isArray(version) && version.length > 0);
  const toolchain = formatToolchainVersion(toolchainVersion);

  if (loading) {
    return html`
      <div style="padding: 20px; font-family: ui-sans-serif, system-ui;">Loading...</div>
    `;
  }

  return html`
    <div
      style="padding: 20px; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #0f172a;"
    >
      <div style="margin-bottom: 10px;">
        <h1 style="margin: 0; font-size: 26px;">Community Cakes Dashboard</h1>
        <div style="margin-top: 3px; color: #475569; font-size: 13px;">MoonBit nightly repository health</div>
      </div>

      <div style="display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 14px; align-items: stretch;">
        ${([
          ['error', 'Errors', counts.error],
          ['warning', 'Warnings', counts.warning],
          ['skipped', 'Skipped', counts.skipped],
          ['pass', 'Passing', counts.pass],
          ['all', 'Total', counts.all],
        ] as const).map(([key, label, value]) =>
          html`
            <button
              onClick="${() => setFilter(key)}"
              style="min-width: 104px; border: 1px solid ${filter === key
                ? '#0f172a'
                : '#cbd5e1'}; border-radius: 6px; background: ${filter === key
                ? '#0f172a'
                : '#ffffff'}; color: ${filter === key
                ? '#ffffff'
                : '#0f172a'}; padding: 8px 10px; cursor: pointer; text-align: left;"
            >
              <div style="font-size: 11px; font-weight: 700;">${label}</div>
              <div style="font-size: 20px; font-weight: 800; line-height: 1.1;">${value}</div>
            </button>
          `
        )}

        <div
          style="min-width: 320px; max-width: 680px; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; background: #f8fafc; font-size: 12px; margin-left: auto;"
        >
          <div><strong>Generated</strong> <time title="${generatedAtRaw ?? ''}">${generatedAt}</time></div>
          <div style="margin-top: 4px;">
            <strong>Toolchain</strong>
            <pre
              style="margin: 4px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace; font-size: 11px; line-height: 1.35;"
            >${toolchain}</pre>
          </div>
        </div>
      </div>

      <div style="display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 10px;">
        <input
          type="text"
          placeholder="Search repo, module, branch"
          value="${search}"
          onInput="${(event: Event) => setSearch((event.target as HTMLInputElement).value)}"
          style="margin-left: auto; min-width: 260px; border: 1px solid #cbd5e1; border-radius: 6px; padding: 7px 9px;"
        />
      </div>

      <div style="margin-bottom: 8px; font-size: 12px; color: #475569;">
        Showing ${filteredRows.length} of ${rows.length} modules
      </div>

      <table style="width: 100%; border-collapse: collapse; font-size: 12px; table-layout: fixed;">
        <thead>
          <tr style="background: #1e293b; color: white;">
            <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: left; width: 320px;">Repository</th>
            <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: left; width: 160px;">Module</th>
            <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: left; width: 120px;">Branch</th>
            ${OSES.map((os) =>
              html`
                <th style="padding: 8px; border: 1px solid #cbd5e1;">${os}</th>
              `
            )}
            <th style="padding: 8px; border: 1px solid #cbd5e1; width: 82px;">Overall</th>
            <th style="padding: 8px; border: 1px solid #cbd5e1; width: 84px;">Details</th>
          </tr>
        </thead>
        <tbody>
          ${filteredRows.map((row, index) => {
            const isExpanded = !!expanded[row.key];
            return html`
              <tr style="background: ${index % 2 === 0 ? '#ffffff' : '#f8fafc'};">
                <td
                  title="${row.repo}"
                  style="padding: 7px; border: 1px solid #cbd5e1; font-family: monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"
                >
                  ${row.repo}
                </td>
                <td style="padding: 7px; border: 1px solid #cbd5e1; font-family: monospace;">${row.module_path}</td>
                <td
                  style="padding: 7px; border: 1px solid #cbd5e1; font-family: monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"
                  title="${row.commit_sha ?? ''}"
                >
                  ${row.branch}
                </td>
                ${OSES.map((os) => {
                  const summary = osSummary(row, os);
                  return html`
                    <${StatusCell}
                      status="${summary.status}"
                      label="${summary.label}"
                      title="${os}"
                    />
                  `;
                })}
                <${StatusCell}
                  status="${row.status}"
                  label="${STATUS_LABELS[row.status]}"
                  title="overall"
                />
                <td style="padding: 7px; border: 1px solid #cbd5e1; text-align: center;">
                  <button
                    onClick="${() => setExpanded((prev) => ({ ...prev, [row.key]: !prev[row.key] }))}"
                    style="border: 1px solid #cbd5e1; border-radius: 6px; background: white; cursor: pointer; font-size: 11px; padding: 4px 8px;"
                  >
                    ${isExpanded ? 'Hide' : 'Show'}
                  </button>
                </td>
              </tr>
              ${isExpanded
                ? html`
                  <tr>
                    <td colspan="8" style="padding: 0; border: 1px solid #cbd5e1; border-top: 0;">
                      <${ExpandedRows} row="${row}" />
                    </td>
                  </tr>
                `
                : ''}
            `;
          })}
        </tbody>
      </table>
    </div>
  `;
}

render(
  html`
    <${App} />
  `,
  document.body,
);
