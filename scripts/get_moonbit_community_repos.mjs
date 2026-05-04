#!/usr/bin/env node

import https from 'node:https';

/**
 * 拉取 moonbit-community 下的活跃公开仓库，并输出 CSV：
 *
 * link,branch
 *
 * 其中 link 为 GitHub 仓库页面地址，branch 为默认分支。
 *
 * 用法：
 *
 *   GITHUB_TOKEN=<token> node get_moonbit_community_repos.mjs > repos.csv
 *
 * `GITHUB_TOKEN` 可选；未设置时仍可访问公开仓库接口，只是限流额度更低。
 */

/**
 * 需要拉取仓库列表的 GitHub 组织名。
 *
 * @type {string}
 */
const ORG = 'moonbit-community';

/**
 * 始终从结果中排除的仓库短名称。
 *
 * @type {string[]}
 */
const excludeList = [
  // 不是MoonBit项目
  '.github',
  'moonrun',
  'benchmark-202404',
  'Community-Tasks',
  'moonpad-blog-examples',
  'Wasmnizer-ts',
  'moonbit-js-debug-demo',
  'build-matrix',
  'moonbit.helix',
  'shell-completion',
  'silver-waffle',
  'core-stress-testing',
  'highlightjs-mbt',
  'benchmark-fft',
  'sax',
  'OJ-Contest-Special',
  'WFC.mbt',
  'kodama',
  'setup-moonbit',
  'tonyfettes-moon-clib-packages',
  'Token2Tensor',
  'moonbit.nvim',
  'moonbit-workflow',
  'astexplorer',
  'BuildYourOwnMoonBit',
  'cmark-frontend-example',
  'moonbit-mode',
  'moonbit-overlay',
  // 手动更新
  'casefold',
  'charclass',
  'webidl.mbt',
  'moonlint',
  'postgres.mbt',
  'octorab',
  'octorab_test',
  'verified',
  'rabbita',
  'pomegranate',
  'selene',
  'mgstudio',
  'isomorphic',
  'moongrep-guide',
  'moongrep',
  'bashcheck',
  'tracing.mbt',
  'opentelemetry.mbt',
  'moondiff',
  'piediff',
  'tsparser',
  'sys.mbt',
  'dom_sanitizer',
  'deno.mbt',
  'smallgit',
  'debug',
  'qpainter.mbt',
  'Artemia',
  'tonyfettes-memory.mbt',
  'tonyfettes-pcre2',
  'tonyfettes-os',
  'tonyfettes-co',
  'tonyfettes-raylib-android-games',
  'tonyfettes-android-raylib-battle-city',
  'tonyfettes-android-raylib-minesweeper',
  'fastcc',
  'moonbit-arduino',
  'moonbit-esp32',
  'moonbit-esp32-example',
  'Community-Blog',
  'examples',
  'moonbit-native-benchmark1',
  'moonbit-native-benchmark2',
  'mocket',
];

/**
 * 用于快速判断仓库是否在固定排除列表中。
 *
 * @type {Set<string>}
 */
const excludedRepos = new Set(excludeList);

/**
 * GitHub 仓库接口中本脚本会读取的字段。
 *
 * @typedef {object} GitHubRepo
 * @property {string} name - 仓库短名称。
 * @property {string} html_url - 仓库网页地址。
 * @property {boolean} archived - 仓库是否已归档。
 * @property {string} default_branch - 默认分支名。
 */

/**
 * 解析命令行参数。
 *
 * @param {string[]} argv - 去掉 `node` 和脚本路径后的命令行参数。
 * @throws {Error} 当遇到未知选项或多余参数时抛出错误。
 */
function parseArgs(argv) {
  for (const arg of argv) {
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }
}

/**
 * 请求 GitHub API 并解析 JSON 响应。
 *
 * @param {string} url - GitHub API 请求地址。
 * @param {string|undefined} token - 可选的 GitHub Token，用于提高 API 限流额度。
 * @returns {Promise<{data: GitHubRepo[], headers: import("http").IncomingHttpHeaders}>} 解析后的 JSON 数据和响应头。
 * @throws {Error} 当请求失败、状态码非 2xx 或响应不是合法 JSON 时抛出错误。
 */
function requestJson(url, token) {
  return new Promise((resolve, reject) => {
    const headers = {
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'moonbit-community-repo-list-script',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    // Token 不是必须的；未设置时仍可访问公开仓库接口，只是限流额度更低。
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    https
      .get(url, { headers }, (response) => {
        let body = '';

        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });

        response.on('end', () => {
          const { statusCode = 0, headers: responseHeaders } = response;

          if (statusCode < 200 || statusCode >= 300) {
            let message = `GitHub API request failed with status ${statusCode}`;

            try {
              const parsed = JSON.parse(body);
              if (parsed.message) {
                message += `: ${parsed.message}`;
              }
            } catch {
              if (body.trim()) {
                message += `: ${body.trim()}`;
              }
            }

            reject(new Error(message));
            return;
          }

          try {
            resolve({
              data: JSON.parse(body),
              headers: responseHeaders,
            });
          } catch (error) {
            reject(new Error(`Failed to parse GitHub API response: ${error.message}`));
          }
        });
      })
      .on('error', reject);
  });
}

/**
 * 从 GitHub Link 响应头中提取下一页 URL。
 *
 * @param {string|string[]|undefined} linkHeader - GitHub API 返回的 Link 响应头。
 * @returns {string|null} 下一页 URL；不存在下一页时返回 `null`。
 */
function getNextPageUrl(linkHeader) {
  if (!linkHeader) {
    return null;
  }

  // GitHub 分页使用 RFC 5988 风格的 Link 头：<url>; rel="next"。
  const parts = (Array.isArray(linkHeader) ? linkHeader.join(',') : linkHeader).split(',');
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match && match[2] === 'next') {
      return match[1];
    }
  }

  return null;
}

/**
 * 获取组织下所有公开仓库。
 *
 * @param {string|undefined} token - 可选的 GitHub Token。
 * @returns {Promise<GitHubRepo[]>} 按仓库完整名称升序排列的公开仓库列表。
 */
async function fetchAllPublicRepos(token) {
  const repos = [];
  let url = `https://api.github.com/orgs/${
    encodeURIComponent(ORG)
  }/repos?type=public&per_page=100&sort=full_name&direction=asc`;

  // 按 GitHub API 的 Link 头逐页拉取，直到没有下一页。
  while (url) {
    const { data, headers } = await requestJson(url, token);
    repos.push(...data);
    url = getNextPageUrl(headers.link);
  }

  return repos;
}

/**
 * 判断仓库是否应该从输出中排除。
 *
 * @param {GitHubRepo} repo - GitHub 仓库对象。
 * @returns {boolean} `true` 表示该仓库应被排除。
 */
function shouldExcludeRepo(repo) {
  // 归档仓库默认不再作为活跃社区仓库展示。
  if (repo.archived) {
    return true;
  }

  return excludedRepos.has(repo.name);
}

/**
 * 过滤掉不应展示的仓库。
 *
 * @param {GitHubRepo[]} repos - 原始仓库列表。
 * @returns {GitHubRepo[]} 过滤后的仓库列表。
 */
function filterRepos(repos) {
  return repos.filter((repo) => !shouldExcludeRepo(repo));
}

/**
 * 转义 CSV 单元格。
 *
 * @param {string} value - 原始单元格内容。
 * @returns {string} 可安全写入 CSV 的单元格内容。
 */
function toCsvCell(value) {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }

  return value;
}

/**
 * 将一个仓库转换成 repos.csv 的一行。
 *
 * @param {GitHubRepo} repo - 要输出的仓库。
 * @returns {string} CSV 行，列顺序为 link,branch。
 */
function toCsvRow(repo) {
  return [
    repo.html_url,
    repo.default_branch,
  ].map(toCsvCell).join(',');
}

/**
 * 以 CSV 格式输出仓库列表。
 *
 * @param {GitHubRepo[]} repos - 要输出的仓库列表。
 * @returns {void}
 */
function printReposAsCsv(repos) {
  console.log('link,branch');
  for (const repo of repos) {
    console.log(toCsvRow(repo));
  }
}

/**
 * 脚本入口。
 *
 * @returns {Promise<void>}
 */
async function main() {
  try {
    parseArgs(process.argv.slice(2));
    const token = process.env.GITHUB_TOKEN;
    const repos = filterRepos(await fetchAllPublicRepos(token));
    printReposAsCsv(repos);
  } catch (error) {
    console.error(error.message);
    console.error('\nUsage: node get_moonbit_community_repos.mjs > repos.csv');
    process.exitCode = 1;
  }
}

main();
