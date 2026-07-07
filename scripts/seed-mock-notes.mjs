#!/usr/bin/env node
/**
 * Seed the NOAT store (~/.noat or $NOAT_HOME) with a rich mock history:
 * notes across several repo scopes and global, exercising every block type
 * the editor supports, committed to git with backdated timestamps so the
 * store looks like it has weeks of real usage.
 *
 * Usage: npm run seed
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const NOAT_HOME = process.env.NOAT_HOME || path.join(os.homedir(), '.noat');
const NOTES = path.join(NOAT_HOME, 'notes');

// ---------------------------------------------------------------------------
// Block builders (BlockNote partial-block format)
// ---------------------------------------------------------------------------

const baseProps = { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' };

/** Inline text run. t('hi', { bold: true }) */
const t = (text, styles = {}) => ({ type: 'text', text, styles });
const link = (href, text) => ({ type: 'link', href, content: [t(text)] });

const inline = (content) =>
  typeof content === 'string' ? [t(content)] : Array.isArray(content) ? content : [content];

const block = (type, props, content, children = []) => ({
  id: randomUUID(),
  type,
  props: { ...baseProps, ...props },
  content,
  children,
});

// Each block type only accepts its schema's props — extras break converters.
const bareBlock = (type, props, content, children = []) => ({
  id: randomUUID(),
  type,
  props,
  content,
  children,
});

const p = (content, children) => block('paragraph', {}, inline(content), children);
const h = (level, content) => block('heading', { level }, inline(content));
const bullet = (content, children) => block('bulletListItem', {}, inline(content), children);
const num = (content, children) => block('numberedListItem', {}, inline(content), children);
const check = (checked, content, children) =>
  block('checkListItem', { checked }, inline(content), children);
const quote = (content) =>
  bareBlock('quote', { textColor: 'default', backgroundColor: 'default' }, inline(content));
const code = (language, text) =>
  bareBlock('codeBlock', { language }, [{ type: 'text', text, styles: {} }]);
const table = (rows) =>
  bareBlock(
    'table',
    { textColor: 'default' },
    {
      type: 'tableContent',
      rows: rows.map((cells) => ({ cells: cells.map((cell) => inline(cell)) })),
    }
  );

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function git(args, date) {
  const iso = date.toISOString();
  execFileSync('git', args, {
    cwd: NOAT_HOME,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'NOAT',
      GIT_AUTHOR_EMAIL: 'noat@localhost',
      GIT_COMMITTER_NAME: 'NOAT',
      GIT_COMMITTER_EMAIL: 'noat@localhost',
      GIT_AUTHOR_DATE: iso,
      GIT_COMMITTER_DATE: iso,
    },
    stdio: 'pipe',
  });
}

function commit(message, date) {
  git(['add', '-A'], date);
  try {
    git(['commit', '-m', message], date);
  } catch {
    // Clean tree (rerun) — nothing to commit.
  }
}

// ---------------------------------------------------------------------------
// Note writing
// ---------------------------------------------------------------------------

const daysAgo = (days, hour = 10, minute = 0) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, minute, Math.floor(Math.random() * 60), 0);
  return date;
};

function writeNote({ dir, title, blocks, created, updated = created }) {
  const target = path.join(NOTES, dir);
  fs.mkdirSync(target, { recursive: true });
  const envelope = {
    version: 1,
    id: randomUUID(),
    title,
    createdAt: created.toISOString(),
    updatedAt: updated.toISOString(),
    blocks,
  };
  const filePath = path.join(target, `${title}.noat.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(envelope, null, 2)}\n`);
  return filePath;
}

function appendToNote(filePath, extraBlocks, updated) {
  const envelope = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  envelope.blocks.push(...extraBlocks);
  envelope.updatedAt = updated.toISOString();
  fs.writeFileSync(filePath, `${JSON.stringify(envelope, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// Store init
// ---------------------------------------------------------------------------

fs.mkdirSync(path.join(NOTES, 'global'), { recursive: true });
fs.mkdirSync(path.join(NOTES, 'repos'), { recursive: true });
const gitignore = path.join(NOAT_HOME, '.gitignore');
if (!fs.existsSync(gitignore)) fs.writeFileSync(gitignore, '.cache/\n.index/\n.DS_Store\n');
if (!fs.existsSync(path.join(NOAT_HOME, '.git'))) {
  execFileSync('git', ['init', '-b', 'main'], { cwd: NOAT_HOME, stdio: 'pipe' });
}

const actions = [];

// ---------------------------------------------------------------------------
// Repo: pintchom/noat (this project — shows under "This repo" while developing)
// ---------------------------------------------------------------------------

const noatRepo = 'repos/github.com--pintchom--noat';

actions.push({
  date: daysAgo(45),
  message: 'create: NOAT Architecture',
  run: () =>
    writeNote({
      dir: noatRepo,
      title: 'NOAT Architecture',
      created: daysAgo(45),
      blocks: [
        h(1, 'System overview'),
        p([
          t('Four cooperating pieces: the '),
          t('extension host', { bold: true }),
          t(', the '),
          t('BlockNote webview', { bold: true }),
          t(', a '),
          t('stdio MCP server', { bold: true }),
          t(', and the git-versioned store at '),
          t('~/.noat', { code: true }),
          t('.'),
        ]),
        quote('Design principle: the store is plain files. Every process reads the same disk.'),
        h(2, 'Component responsibilities'),
        table([
          ['Component', 'Owns', 'Talks to'],
          ['Extension host', 'Tree view, commands, git watcher', 'Store, webview'],
          ['Webview', 'Editing UX (BlockNote)', 'Extension host only'],
          ['MCP server', 'Agent read/write access', 'Store directly'],
          ['Store', 'Truth: notes + git history', '—'],
        ]),
        h(2, 'Message protocol'),
        code(
          'typescript',
          `export type HostToWebviewMessage =
  | { type: 'init'; text: string }
  | { type: 'update'; text: string };

export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'edit'; text: string };`
        ),
        h(2, 'Open questions'),
        check(true, 'CustomTextEditor vs webview panel? -> custom editor, native save/dirty'),
        check(true, 'JSON vs markdown storage? -> BlockNote JSON, MCP explains schema'),
        check(false, 'Should title edits rename the file?'),
        check(false, 'Conflict story when MCP writes while editor is open'),
      ],
    }),
});

actions.push({
  date: daysAgo(38, 15),
  message: 'create: Editor sync bug hunt',
  run: () =>
    writeNote({
      dir: noatRepo,
      title: 'Editor sync bug hunt',
      created: daysAgo(38, 15),
      blocks: [
        h(1, 'The echo loop'),
        p([
          t('Symptom: typing stutters, cursor jumps to end. Cause: our own '),
          t('applyEdit', { code: true }),
          t(' triggers '),
          t('onDidChangeTextDocument', { code: true }),
          t(', which posts an update back into the webview. '),
          t('Classic custom-editor pitfall.', { italic: true }),
        ]),
        h(2, 'Fix'),
        num('Remember the exact text we applied on behalf of the webview'),
        num('When the change event fires, compare document text against it'),
        num('Match -> swallow the event. No match -> real external change, forward it'),
        code(
          'typescript',
          `if (text === lastWebviewText) return; // echo of our own edit
post({ type: 'update', text });`
        ),
        quote('Rule of thumb: any bidirectional sync needs an identity tag or an equality guard.'),
      ],
    }),
});

// ---------------------------------------------------------------------------
// Repo: acme/payments-api
// ---------------------------------------------------------------------------

const payments = 'repos/github.com--acme--payments-api';

actions.push({
  date: daysAgo(60),
  message: 'create: Stripe webhook flow',
  run: () =>
    writeNote({
      dir: payments,
      title: 'Stripe webhook flow',
      created: daysAgo(60),
      blocks: [
        h(1, 'Webhook processing'),
        p([
          t('All webhooks land on '),
          t('POST /webhooks/stripe', { code: true }),
          t(' and are verified with the signing secret '),
          t('before', { bold: true, underline: true }),
          t(' any parsing. See '),
          link('https://docs.stripe.com/webhooks', 'Stripe webhook docs'),
          t('.'),
        ]),
        h(2, 'Events we handle'),
        table([
          ['Event', 'Handler', 'Idempotent?'],
          ['payment_intent.succeeded', 'fulfillOrder()', 'yes - order id key'],
          ['payment_intent.failed', 'notifyCustomer()', 'yes'],
          ['charge.dispute.created', 'freezeAccount()', 'NO - fix this'],
          ['invoice.paid', 'extendSubscription()', 'yes'],
        ]),
        h(2, 'Verification snippet'),
        code(
          'typescript',
          `const event = stripe.webhooks.constructEvent(
  request.rawBody,
  request.headers['stripe-signature'],
  process.env.STRIPE_WEBHOOK_SECRET
);`
        ),
        h(2, 'Gotchas'),
        bullet([t('Webhooks arrive '), t('out of order', { bold: true }), t(' under load')]),
        bullet('Stripe retries for 3 days - handlers MUST be idempotent'),
        bullet([
          t('Raw body required for signature check - '),
          t('no JSON middleware', { backgroundColor: 'red' }),
          t(' on this route'),
        ]),
      ],
    }),
});

actions.push({
  date: daysAgo(52, 14),
  message: 'create: Incident 2026-05-16 double charges',
  run: () =>
    writeNote({
      dir: payments,
      title: 'Incident 2026-05-16 double charges',
      created: daysAgo(52, 14),
      blocks: [
        h(1, 'Double-charge incident'),
        p([
          t('Severity: ', { bold: true }),
          t('SEV-1', { textColor: 'red', bold: true }),
          t('  Duration: 43 minutes  Affected: 112 customers'),
        ]),
        h(2, 'Timeline'),
        num('14:02 - deploy 4f2a91c ships retry wrapper around charge call'),
        num('14:09 - support tickets about duplicate charges'),
        num('14:31 - root cause found: retry on timeout, but charge succeeded server-side'),
        num('14:45 - rollback complete, refund script running'),
        h(2, 'Root cause'),
        quote('A timeout is not a failure. The request may have succeeded.'),
        code(
          'typescript',
          `// BAD: blind retry
await retry(() => stripe.charges.create(params), { attempts: 3 });

// GOOD: idempotency key makes retries safe
await stripe.charges.create(params, { idempotencyKey: order.id });`
        ),
        h(2, 'Action items'),
        check(true, 'Refund affected customers'),
        check(true, 'Add idempotency keys to every mutating Stripe call'),
        check(false, 'Chaos test: inject timeouts in staging'),
        check(false, 'Alert on duplicate charge fingerprints'),
      ],
    }),
});

actions.push({
  date: daysAgo(20, 11),
  message: 'create: Ledger migration plan',
  run: () =>
    writeNote({
      dir: payments,
      title: 'Ledger migration plan',
      created: daysAgo(20, 11),
      blocks: [
        h(1, 'Single-entry to double-entry ledger'),
        p([
          t('Moving from ad-hoc balance columns to a proper '),
          t('double-entry ledger', { bold: true }),
          t('. Every money movement becomes two postings that must sum to zero.'),
        ]),
        h(2, 'Phases'),
        check(true, 'Phase 0: shadow writes - ledger written alongside old columns', [
          check(true, 'Backfill 24 months of history'),
          check(true, 'Reconciliation job comparing both systems nightly'),
        ]),
        check(false, 'Phase 1: reads switch to ledger', [
          check(false, 'Balance endpoint behind feature flag'),
          check(false, 'Diff dashboards for a week before flipping'),
        ]),
        check(false, 'Phase 2: drop old columns'),
        h(2, 'Schema'),
        code(
          'sql',
          `CREATE TABLE ledger_postings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL,
  account_id  UUID NOT NULL REFERENCES accounts(id),
  amount_cents BIGINT NOT NULL,  -- signed
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- invariant: SUM(amount_cents) per transfer_id == 0`
        ),
      ],
    }),
});

// ---------------------------------------------------------------------------
// Repo: acme/web-dashboard
// ---------------------------------------------------------------------------

const dashboard = 'repos/github.com--acme--web-dashboard';

actions.push({
  date: daysAgo(33, 9),
  message: 'create: Performance audit',
  run: () =>
    writeNote({
      dir: dashboard,
      title: 'Performance audit',
      created: daysAgo(33, 9),
      blocks: [
        h(1, 'Dashboard performance audit'),
        p([
          t('Baseline LCP: '),
          t('4.8s', { textColor: 'red', bold: true }),
          t('  Target: '),
          t('< 2.0s', { textColor: 'green', bold: true }),
        ]),
        h(2, 'Findings'),
        table([
          ['Issue', 'Cost', 'Fix'],
          ['Recharts bundle on first paint', '1.9s', 'lazy load below fold'],
          ['No memo on OrgTable rows', '600ms re-renders', 'React.memo + stable keys'],
          ['Avatar images unsized', 'CLS 0.31', 'width/height attrs'],
          ['Waterfall API calls', '1.2s', 'parallel fetch in loader'],
        ]),
        h(2, 'Quick wins shipped'),
        check(true, [
          t('Lazy-load charts: '),
          t('React.lazy(() => import("./Charts"))', { code: true }),
        ]),
        check(true, 'Parallel loader fetches'),
        check(false, 'Virtualize OrgTable (10k rows)'),
        h(2, 'After first pass'),
        p([
          t('LCP now '),
          t('2.6s', { textColor: 'orange', bold: true }),
          t(' - virtualization should get us under 2.'),
        ]),
      ],
    }),
});

actions.push({
  date: daysAgo(15, 16),
  message: 'create: Design system notes',
  run: () =>
    writeNote({
      dir: dashboard,
      title: 'Design system notes',
      created: daysAgo(15, 16),
      blocks: [
        h(1, 'Component conventions'),
        bullet([t('Components in '), t('/components', { code: true }), t(', organized by domain')]),
        bullet([t('Hooks in '), t('/lib/hooks', { code: true })]),
        bullet('Context for dependency injection, not global state'),
        h(2, 'Button variants'),
        table([
          ['Variant', 'Use for'],
          ['primary', 'The one main action on a screen'],
          ['secondary', 'Everything else'],
          ['destructive', 'Deletes, with confirm modal'],
          ['ghost', 'Toolbars and dense UI'],
        ]),
        quote('If a screen has two primary buttons, one of them is lying.'),
      ],
    }),
});

// ---------------------------------------------------------------------------
// Repo: local scratch project (no remote — path-hash key)
// ---------------------------------------------------------------------------

actions.push({
  date: daysAgo(9, 21),
  message: 'create: Raycast clone experiment',
  run: () =>
    writeNote({
      dir: 'repos/local--launcher-experiment--3f9a2c1b',
      title: 'Raycast clone experiment',
      created: daysAgo(9, 21),
      blocks: [
        h(1, 'Weekend hack: launcher'),
        p([
          t('Tauri + fuzzy matcher. Window summon under '),
          t('80ms', { bold: true }),
          t(' or it feels broken.'),
        ]),
        bullet('fzf-style scoring: bonus for camelCase boundaries and path separators'),
        bullet([
          t('Preload the window, just toggle visibility - '),
          t('never', { italic: true }),
          t(' cold-start on hotkey'),
        ]),
        code(
          'rust',
          `fn score(query: &str, candidate: &str) -> i64 {
    // gap penalty + boundary bonus, same shape as fzf v2
    matcher.fuzzy_match(candidate, query).unwrap_or(i64::MIN)
}`
        ),
      ],
    }),
});

// ---------------------------------------------------------------------------
// Global notes
// ---------------------------------------------------------------------------

actions.push({
  date: daysAgo(58),
  message: 'create: Reading list',
  run: () =>
    writeNote({
      dir: 'global',
      title: 'Reading list',
      created: daysAgo(58),
      blocks: [
        h(1, 'To read'),
        check(true, [
          link(
            'https://www.hillelwayne.com/post/are-we-really-engineers/',
            'Are We Really Engineers?'
          ),
          t(' - Hillel Wayne'),
        ]),
        check(true, [
          link('https://jvns.ca/blog/2024/01/01/git-commits/', 'How git commits work'),
          t(' - Julia Evans'),
        ]),
        check(false, [
          link('https://www.prosemirror.net/docs/guide/', 'ProseMirror guide'),
          t(' - for NOAT block internals'),
        ]),
        check(false, [
          link('https://modelcontextprotocol.io/docs', 'MCP spec'),
          t(' - resources vs tools split'),
        ]),
        h(2, 'Notes on finished reads'),
        quote(
          'Wayne: "crossover projects" - software people underestimate how much other engineering disciplines also improvise.'
        ),
      ],
    }),
});

actions.push({
  date: daysAgo(41, 13),
  message: 'create: Snippets',
  run: () =>
    writeNote({
      dir: 'global/reference',
      title: 'Snippets',
      created: daysAgo(41, 13),
      blocks: [
        h(1, 'Snippets I keep re-googling'),
        h(3, 'git: undo last commit, keep changes'),
        code('bash', 'git reset --soft HEAD~1'),
        h(3, 'jq: group and count'),
        code('bash', `jq 'group_by(.type) | map({type: .[0].type, n: length})' events.json`),
        h(3, 'TypeScript: exhaustive switch'),
        code(
          'typescript',
          `function assertNever(value: never): never {
  throw new Error(\`Unhandled case: \${JSON.stringify(value)}\`);
}`
        ),
        h(3, 'psql: kill a stuck query'),
        code(
          'sql',
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'active' AND query_start < now() - interval '5 minutes';"
        ),
      ],
    }),
});

actions.push({
  date: daysAgo(30, 19),
  message: 'create: Ideas',
  run: () =>
    writeNote({
      dir: 'global',
      title: 'Ideas',
      created: daysAgo(30, 19),
      blocks: [
        h(1, 'Idea backlog'),
        num([
          t('NOAT', { bold: true }),
          t(' - notes in the IDE, MCP-accessible, git-versioned '),
          t('(building it!)', { textColor: 'green' }),
        ]),
        num('CLI that turns a failing test into a minimal repro repo', [
          bullet('Bisect imports until the failure disappears'),
        ]),
        num('Slack bot that summarizes deploy channels into a weekly digest'),
        num([
          t('Personal Google', { italic: true }),
          t(" - agents write learnings to notes, semantic search over everything (Michael's idea)"),
        ]),
      ],
    }),
});

// Journal entries — daily grind, lots of history volume.
const journalEntries = [
  [12, 'Paired on the ledger backfill. Postgres COPY is 40x faster than inserts.'],
  [11, 'Editor sync echo bug finally dead. Wrote it up in the NOAT repo notes.'],
  [10, 'Interviews all afternoon. One great candidate, strong systems instincts.'],
  [9, 'Launcher experiment: got window summon to 62ms. Tauri is impressive.'],
  [8, 'Reviewed the dispute-freeze handler. Found the missing idempotency key.'],
  [7, 'Read the ProseMirror guide. Decorations vs node views finally clicked.'],
  [6, 'Slow day. Cleaned up dotfiles, upgraded neovim, regretted nothing.'],
  [5, 'Dashboard virtualization PR up. 10k rows scroll at 60fps now.'],
  [4, 'Sketched the NOAT MCP tool surface with detailed schema instructions.'],
  [3, 'Ledger phase 1 flag flipped for internal orgs. Reconciliation clean.'],
  [2, 'Long design review on webhook ordering. Outcome: sequence numbers, not timestamps.'],
  [1, 'Started the semantic search spike. MiniSearch for keywords feels right.'],
];

for (const [days, text] of journalEntries) {
  const date = daysAgo(days, 22);
  const dayName = date.toISOString().slice(0, 10);
  actions.push({
    date,
    message: `create: Journal ${dayName}`,
    run: () =>
      writeNote({
        dir: 'global/journal',
        title: `Journal ${dayName}`,
        created: date,
        blocks: [h(2, dayName), p(text)],
      }),
  });
}

// ---------------------------------------------------------------------------
// Follow-up edits — so notes have multi-commit histories, not just creation.
// ---------------------------------------------------------------------------

const edits = [
  {
    date: daysAgo(18, 12),
    message: 'edit: Stripe webhook flow',
    dir: payments,
    title: 'Stripe webhook flow',
    blocks: [
      h(2, 'Update: ordering fix shipped'),
      p([
        t('We now attach a '),
        t('sequence number', { bold: true }),
        t(' per payment intent and drop stale events. Dispute handler got its idempotency key in '),
        t('a91c3f0', { code: true }),
        t('.'),
      ]),
    ],
  },
  {
    date: daysAgo(6, 10),
    message: 'edit: Ledger migration plan',
    dir: payments,
    title: 'Ledger migration plan',
    blocks: [
      h(2, 'Phase 1 progress'),
      p([
        t('Internal orgs on ledger reads since Monday. Nightly reconciliation: '),
        t('0 diffs, 6 nights straight', { textColor: 'green', bold: true }),
        t('.'),
      ]),
    ],
  },
  {
    date: daysAgo(2, 17),
    message: 'edit: NOAT Architecture',
    dir: noatRepo,
    title: 'NOAT Architecture',
    blocks: [
      h(2, 'Decision log'),
      table([
        ['Date', 'Decision', 'Why'],
        ['Stage 1', 'Shell out to git, no libgit2', 'git is always present; zero native deps'],
        ['Stage 2', 'Remount editor on external change', 'simpler than merging ProseMirror states'],
      ]),
    ],
  },
];

for (const edit of edits) {
  actions.push({
    date: edit.date,
    message: edit.message,
    run: () => {
      const filePath = path.join(NOTES, edit.dir, `${edit.title}.noat.json`);
      if (fs.existsSync(filePath)) appendToNote(filePath, edit.blocks, edit.date);
    },
  });
}

// ---------------------------------------------------------------------------
// Run everything in chronological order, one commit per action.
// ---------------------------------------------------------------------------

actions.sort((a, b) => a.date - b.date);

let count = 0;
for (const action of actions) {
  action.run();
  commit(action.message, action.date);
  count += 1;
}

const log = execFileSync('git', ['log', '--oneline'], { cwd: NOAT_HOME }).toString();
console.log(`Seeded ${count} actions into ${NOAT_HOME}`);
console.log(`Git history now has ${log.trim().split('\n').length} commits.`);
console.log('\nRecent history:');
console.log(
  log
    .split('\n')
    .slice(0, 10)
    .map((line) => `  ${line}`)
    .join('\n')
);
