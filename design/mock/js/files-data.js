// The files the Files tab shows. In LGTM Studio the service asks the machine that holds the
// worktree for one folder at a time and for one file at a time, and passes the answer on.
// Here the listing and the text are held in memory.

// Each entry is a path and a size in bytes. A size over the text limit, or a binary file,
// is shown as a row with a download, not as text.
export const TEXT_LIMIT = 1024 * 1024;
const LISTS = {
  lgtm: [
    ['.nvmrc', 3], ['README.md', 4180], ['package.json', 1260], ['pnpm-lock.yaml', 1_934_112], ['pnpm-workspace.yaml', 412],
    ['docs/features.md', 48_920], ['docs/issues.md', 61_340], ['docs/specs/agent-console.md', 6_210],
    ['design/lgtm.fig', 2_516_582], ['design/DESIGN.md', 22_480],
    ['packages/engine/src/projects.ts', 9_840], ['packages/engine/test/projects.test.ts', 7_120],
    ['packages/web/public/icon.svg', 640],
    ['packages/web/src/App.tsx', 3_310], ['packages/web/src/routes.ts', 1_980],
    ['packages/web/src/shell/Bell.tsx', 2_460], ['packages/web/src/shell/Bell.test.tsx', 1_890], ['packages/web/src/shell/NavRail.tsx', 2_970],
    ['packages/web/src/shell/ProjectTree.tsx', 4_120], ['packages/web/src/shell/Sidebar.tsx', 5_640], ['packages/web/src/shell/sidebar.css', 2_210],
    ['packages/web/src/thread/ThreadView.tsx', 6_830],
    ['packages/web/test/journey.test.ts', 8_450], ['packages/web/test/reconnect.test.ts', 2_870],
    ['test-results/trace-round-2.zip', 14_889_011],
  ],
  'atlas-docs': [['README.md', 1_240], ['openapi.yaml', 38_400], ['package.json', 640], ['docs/api/invoices.md', 9_120], ['docs/api/customers.md', 8_010], ['scripts/build-reference.ts', 3_120]],
  'billing-api': [['README.md', 2_010], ['package.json', 1_020], ['src/exports/csv.ts', 3_450], ['src/exports/pdf.ts', 5_870], ['src/invoices.ts', 7_400], ['test/exports.test.ts', 4_310]],
};
const BINARY = /\.(fig|zip|png|jpe?g|gif|pdf|woff2?)$/i;
const IMAGE = /\.(svg|png|jpe?g|gif)$/i;

export function listFiles(repo, extra = []) {
  const seen = new Map((LISTS[repo] || [['README.md', 1_200]]).map(([p, n]) => [p, n]));
  for (const p of extra) if (!seen.has(p)) seen.set(p, 1_400 + (p.length * 37) % 3_000);
  return [...seen].map(([path, size]) => ({ path, size, binary: BINARY.test(path), image: IMAGE.test(path) }));
}

// ---- file text ----------------------------------------------------------------------
const TEXT = {
  '.nvmrc': '26\n',
  'README.md': `# LGTM Studio

LGTM Studio runs teams of coding agents: an orchestrator, team
leads, and workers. It connects them through a strict message
board, and it exposes everything through an authenticated client
API for web, desktop and mobile apps.

## Start it

\`\`\`sh
nvm use
pnpm install
./bin/lgtm serve --detach
\`\`\`

Set \`LGTM_WEB_PASSWORD\` on the service to enable the web page.

## How agents are run

Every harness has two run modes, chosen per harness in its settings:

- **ACP mode** runs the agent as a child process and drives it through the
  Agent Client Protocol.
- **Interactive mode** opens the harness's normal terminal program in a Herdr
  pane through the optional plugin.
`,
  'package.json': `{
  "name": "lgtm",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.2.0",
  "engines": { "node": ">=26" },
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "live-check": "node scripts/live-check.mjs",
    "lint": "biome check ."
  },
  "devDependencies": {
    "@biomejs/biome": "2.4.1",
    "typescript": "6.1.2",
    "vitest": "4.2.0"
  }
}
`,
  'packages/web/src/shell/Bell.tsx': `import { useMemo } from "react";
import { useAttention } from "../attention/useAttention";
import { Icon } from "../ui/Icon";
import { readStored, writeStored } from "./storage";

// The bell counts what waits for the owner across every project.
// It opens Home with the Type filter set to the newest kind.
export function Bell() {
  const { open, newest } = useAttention();
  const seen = readStored("bell:seen", 0);
  const unseen = useMemo(() => open.filter((r) => r.createdAt > seen).length, [open, seen]);

  const onOpen = () => {
    writeStored("bell:seen", Date.now());
    location.hash = newest ? \`/home?type=\${newest.kind}\` : "/home";
  };

  return (
    <button type="button" className="icon-btn" aria-label={\`\${open.length} waiting\`} onClick={onOpen}>
      <Icon name="bell" size={16} />
      {unseen > 0 && <span className="pip">{unseen > 9 ? "9+" : unseen}</span>}
    </button>
  );
}
`,
  'packages/web/src/shell/storage.ts': `// Small wrappers around localStorage. Private windows and blocked site data
// make the storage throw, so every call is guarded and falls back.
export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(\`lgtm:\${key}\`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(\`lgtm:\${key}\`, JSON.stringify(value));
  } catch {
    // The value is only a convenience. Losing it is fine.
  }
}
`,
  'packages/web/src/shell/sidebar.css': `/* The sidebar: repositories, then projects, then teams and agents. */
.sidebar {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  width: var(--sidebar-width, 264px);
  background: var(--color-sidebar);
  border-right: 1px solid var(--color-line);
}

.sidebar .row {
  height: var(--row);
  padding: 0 var(--inset);
  border-radius: var(--radius-sm);
}

.sidebar .row[aria-current="page"] {
  background: var(--color-selected);
  font-weight: 500;
}

@media (max-width: 860px) {
  .sidebar { position: fixed; inset: 0 auto 0 0; z-index: 40; }
}
`,
  'packages/web/test/reconnect.test.ts': `import { describe, expect, it, vi } from "vitest";
import { connect } from "../src/client/connect";

describe("reconnect", () => {
  it("waits for the service before it retries", async () => {
    vi.useFakeTimers();
    const socket = connect({ url: "ws://127.0.0.1:8787", retryAfterMs: 500 });
    socket.simulateClose();

    expect(socket.state).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(499);
    expect(socket.attempts).toBe(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(socket.attempts).toBe(1);
  });

  it("keeps the owner's draft while it is offline", async () => {
    const socket = connect({ url: "ws://127.0.0.1:8787" });
    socket.simulateClose();
    socket.setDraft("thread:console-lead", "Is the shell team done?");
    expect(socket.draft("thread:console-lead")).toBe("Is the shell team done?");
  });
});
`,
  'packages/web/public/icon.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#1f6b4a"/>
  <path d="M18 18v28h14" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M46 24a10 10 0 1 0 0 16h-6" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`,
};

// A file the list has but the text above lacks gets a short body that fits its kind.
const stem = (p) => p.split('/').pop().replace(/\.[^.]+$/, '').replace(/\.test$/, '');
const camel = (x) => x.replace(/(^|[-_.])(\w)/g, (_, a, b) => b.toUpperCase());
function bodyFor(path) {
  const name = stem(path); const Name = camel(name);
  if (/\.test\.tsx?$/.test(path)) return `import { describe, expect, it } from "vitest";
import { ${Name} } from "../src/${name}";

describe("${name}", () => {
  it("renders with no data", () => {
    expect(${Name}).toBeTypeOf("function");
  });
});
`;
  if (/\.tsx$/.test(path)) return `import { useState } from "react";

export function ${Name}() {
  const [open, setOpen] = useState(false);
  return (
    <section className="${name.toLowerCase()}">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        ${name}
      </button>
    </section>
  );
}
`;
  if (/\.ts$/.test(path)) return `// ${name}
export interface ${Name}Options {
  readonly limit?: number;
}

export function ${name.replace(/^\w/, (c) => c.toLowerCase()).replace(/[-.](\w)/g, (_, c) => c.toUpperCase())}(options: ${Name}Options = {}) {
  const limit = options.limit ?? 50;
  return { limit };
}
`;
  if (/\.ya?ml$/.test(path)) return `packages:\n  - "packages/*"\n  - "third_party/*"\n`;
  if (/\.md$/.test(path)) return `# ${name.replace(/[-_]/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}\n\nThis page is kept with the code it describes.\n`;
  return `${name}\n`;
}
export function fileText(path) { return TEXT[path] ?? bodyFor(path); }
export function svgUrl(path) { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(fileText(path)); }

// ---- a small highlighter ----------------------------------------------------------------
// It marks comments, strings, keywords, numbers and tags well enough to read. The product
// uses a real highlighter; see docs/features.md, "A file explorer in the Git view".
const KW = /^(import|from|export|default|function|return|const|let|var|if|else|for|of|in|new|async|await|type|interface|readonly|extends|try|catch|throw|class|true|false|null|undefined)$/;
export function tokens(line, ext) {
  const out = []; let i = 0;
  const push = (cls, text) => { if (text) out.push([cls, text]); };
  if (ext === 'md') {
    if (/^#{1,6} /.test(line)) return [['kw', line]];
    if (/^```/.test(line)) return [['cm', line]];
    return line.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((t) => [t.startsWith('`') ? 'str' : t.startsWith('**') ? 'tag' : '', t]);
  }
  const re = ext === 'css'
    ? /(\/\*.*?\*\/|\/\*.*$)|("[^"]*"|'[^']*')|(--[\w-]+|#[0-9a-f]{3,8}\b)|(\b\d+(?:\.\d+)?(?:px|%|vh|vw|ms)?\b)|(@[\w-]+|[.#][\w-]+(?=[^{}]*\{))/gi
    : /(\/\/.*$|\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b[A-Za-z_]\w*\b)|(\b\d[\d_]*(?:\.\d+)?\b)|(<\/?[A-Za-z][\w.]*|\/?>)/g;
  let m;
  while ((m = re.exec(line))) {
    push('', line.slice(i, m.index)); i = m.index + m[0].length;
    if (m[1]) push('cm', m[0]);
    else if (m[2]) push('str', m[0]);
    else if (m[3]) push(ext === 'css' ? 'tag' : KW.test(m[0]) ? 'kw' : /^[A-Z]/.test(m[0]) ? 'ty' : '', m[0]);
    else if (m[4]) push('num', m[0]);
    else if (m[5]) push(ext === 'css' ? 'kw' : 'tag', m[0]);
  }
  push('', line.slice(i));
  return out;
}
