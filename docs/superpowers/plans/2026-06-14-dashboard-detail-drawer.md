# Dashboard Detail Drawer + history endpoint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a project card opens a slide-in detail drawer showing the project's resources, demo/code-server URLs, and recent action history, backed by one new read endpoint.

**Architecture:** Backend adds a thin `GET /api/projects/:owner/:name/history` route that wires the already-implemented `HistoryClient.list` and maps records to a clean wire shape. Frontend adds a self-contained `DetailDrawer` component fed by a new `getHistory` api call; `app/page.tsx` opens it on card-body click. No new AWS calls, no new IAM (history read perm already present).

**Tech Stack:** Backend — Node20 TS pnpm-workspace (Fastify, vitest, Node16 ESM `.js` imports). Frontend — Next.js 14 App Router, TS. Spec: `docs/superpowers/specs/2026-06-14-dashboard-detail-drawer-design.md`. Branch: `feat/dashboard-detail-drawer`.

**Two deliverable units** → two PRs: Tasks 1–3 (backend), Tasks 4–8 (frontend). Each PR is independently green.

---

## File structure

**Backend** (`dashboard/backend/`)
- Create `packages/api/src/routes/history.ts` — the history route (maps records → wire shape).
- Create `packages/api/src/__tests__/history.test.ts` — route test.
- Modify `packages/api/src/server.ts` — `BuildServerOpts.historyClient`, register route, construct `HistoryClient` in the prod entry.
- Modify `infra/dashboard-ecs/main.tf` — add `DDB_TABLE_HISTORY` to the api task env.

**Frontend** (`dashboard/frontend/`)
- Modify `lib/types.ts` — `Project.urls.code_server` + `HistoryRecord`.
- Modify `lib/api.ts` — `getHistory`.
- Create `components/DetailDrawer.tsx` — the drawer.
- Modify `components/ProjectCard.tsx` — card-body click opens drawer; controls `stopPropagation`.
- Modify `app/page.tsx` — `selected` state, render drawer, clear-on-gone.
- Modify `app/globals.css` — drawer + timeline styles.

---

## Task 1: Backend — history route (TDD)

**Files:**
- Test: `dashboard/backend/packages/api/src/__tests__/history.test.ts`
- Create: `dashboard/backend/packages/api/src/routes/history.ts`
- Modify: `dashboard/backend/packages/api/src/server.ts`

- [ ] **Step 1: Write the failing test**

Create `dashboard/backend/packages/api/src/__tests__/history.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { Project } from '@demo-platform/shared';
import { buildServer } from '../server.js';

const project: Project = {
  name: 'p',
  github: { repo: 'o/r', branch: 'main' },
  account: 'atomoh-main',
  resources: [{ type: 'ecs', cluster: 'c', service: 's' }],
};

// One raw HistoryClient record (full shape, incl. pk/ttl that must be stripped).
const rec = {
  pk: 'project#o/r',
  sk: '2026-06-14T09:00:00.000Z#abc-123',
  action: 'turn_off',
  actor: 'atomoh',
  account: 'atomoh-main',
  result: 'success' as const,
  details: { 'ecs:c/s': { original_desired_count: 3 } },
  ttl: 1789000000,
};

function server(listImpl = vi.fn(async () => [rec])) {
  const historyClient = { list: listImpl };
  // stateClient is required for buildServer to mount project routes.
  const stateClient = { read: vi.fn(async () => ({ status: 'on' })) };
  return buildServer({
    skipJwt: true,
    projects: { 'o/r': project },
    stateClient: stateClient as never,
    historyClient: historyClient as never,
  }).then((app) => ({ app, historyClient }));
}

describe('GET /api/projects/:owner/:name/history', () => {
  it('returns mapped records (ts from sk; no pk/ttl)', async () => {
    const { app } = await server();
    const res = await app.inject({ method: 'GET', url: '/api/projects/o/r/history' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.items).toEqual([
      {
        action: 'turn_off',
        actor: 'atomoh',
        account: 'atomoh-main',
        result: 'success',
        details: { 'ecs:c/s': { original_desired_count: 3 } },
        ts: '2026-06-14T09:00:00.000Z',
      },
    ]);
  });

  it('defaults limit to 20 and clamps invalid/negative to a valid positive int', async () => {
    const list = vi.fn(async () => []);
    const { app } = await server(list);
    await app.inject({ method: 'GET', url: '/api/projects/o/r/history' });
    expect(list).toHaveBeenLastCalledWith('o/r', 20);
    await app.inject({ method: 'GET', url: '/api/projects/o/r/history?limit=abc' });
    expect(list).toHaveBeenLastCalledWith('o/r', 20);
    await app.inject({ method: 'GET', url: '/api/projects/o/r/history?limit=-5' });
    expect(list).toHaveBeenLastCalledWith('o/r', 20);
    await app.inject({ method: 'GET', url: '/api/projects/o/r/history?limit=999' });
    expect(list).toHaveBeenLastCalledWith('o/r', 100);
    await app.inject({ method: 'GET', url: '/api/projects/o/r/history?limit=5' });
    expect(list).toHaveBeenLastCalledWith('o/r', 5);
  });

  it('404s for an unknown project', async () => {
    const { app } = await server();
    const res = await app.inject({ method: 'GET', url: '/api/projects/no/such/history' });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd dashboard/backend && pnpm --filter @demo-platform/api test -- history`
Expected: FAIL — `buildServer` does not accept `historyClient` / route not found (404 on the happy path).

- [ ] **Step 3: Create the route**

Create `dashboard/backend/packages/api/src/routes/history.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import type { HistoryClient, Project } from '@demo-platform/shared';
import { NotFoundError } from '@demo-platform/shared';

export interface HistoryRouteDeps {
  projects: Record<string, Project>;
  historyClient: HistoryClient;
}

function parseLimit(raw: unknown): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isInteger(n) || n < 1) return 20; // default for NaN / negative / missing
  return Math.min(n, 100); // DynamoDB Limit must be a positive int
}

export async function registerHistory(app: FastifyInstance, deps: HistoryRouteDeps): Promise<void> {
  app.get('/api/projects/:owner/:name/history', async (req) => {
    const { owner, name } = req.params as { owner: string; name: string };
    const repo = `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`;
    if (!deps.projects[repo]) throw new NotFoundError(`project not found: ${repo}`);
    const limit = parseLimit((req.query as { limit?: string }).limit);
    const records = await deps.historyClient.list(repo, limit);
    // Map to a clean wire shape: ts from sk, drop pk/ttl.
    const items = records.map((r) => ({
      action: r.action,
      actor: r.actor,
      account: r.account,
      result: r.result,
      details: r.details,
      ts: r.sk.split('#')[0],
    }));
    return { items };
  });
}
```

- [ ] **Step 4: Wire it into `buildServer` and the prod entry**

In `dashboard/backend/packages/api/src/server.ts`:

Add to the imports (value import of `HistoryClient`, route import):
```typescript
import { createLogger, makeClient, StateClient, JobsClient, HistoryClient } from '@demo-platform/shared';
```
```typescript
import { registerHistory } from './routes/history.js';
```

Add to `BuildServerOpts` (after `jobsClient?`):
```typescript
  historyClient?: HistoryClient;
```

Register the route inside the `if (opts.projects && opts.stateClient) { ... }` block, after the `registerActions` block:
```typescript
    if (opts.historyClient) {
      await registerHistory(app, { projects: opts.projects, historyClient: opts.historyClient });
    }
```

In the prod entry, construct the client (after the `jobsClient` line):
```typescript
      const historyClient = new HistoryClient({ doc, tableName: requireEnv('DDB_TABLE_HISTORY') });
```
and pass it to `buildServer({ ... })` (add `historyClient,` to the options object).

- [ ] **Step 5: Run the test, verify it passes**

Run: `cd dashboard/backend && pnpm --filter @demo-platform/api test -- history`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck + lint the whole backend**

Run: `cd dashboard/backend && pnpm -r build && pnpm --filter @demo-platform/api lint`
Expected: tsc `Done` for all packages; eslint no errors. (`.js` extensions on the new imports — `tsc -b` is the real gate.)

- [ ] **Step 7: Commit**

```bash
git add dashboard/backend/packages/api/src/routes/history.ts \
  dashboard/backend/packages/api/src/__tests__/history.test.ts \
  dashboard/backend/packages/api/src/server.ts
git commit -m "feat(api): GET /api/projects/:o/:n/history (wire HistoryClient.list)"
```

---

## Task 2: Backend infra — `DDB_TABLE_HISTORY` env on the api task

**Files:**
- Modify: `infra/dashboard-ecs/main.tf` (api `environment` block)

- [ ] **Step 1: Add the env var**

In `infra/dashboard-ecs/main.tf`, in the **api** container `environment = [ ... ]` array, after the `DDB_TABLE_JOBS` line, add:
```hcl
        { name = "DDB_TABLE_HISTORY", value = "demo-platform-history-dev" },
```
(IAM: no change — the task role already includes `local.ddb_history_arn` in its `DynamoDbState` statement.)

- [ ] **Step 2: Format + validate**

Run: `cd infra/dashboard-ecs && terraform fmt && terraform init -backend=false -input=false >/dev/null && terraform validate`
Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add infra/dashboard-ecs/main.tf
git commit -m "feat(infra): inject DDB_TABLE_HISTORY into the api task"
```

---

## Task 3: Backend PR

- [ ] **Step 1: Push + open PR**

```bash
git push -u origin feat/dashboard-detail-drawer
gh pr create --base main --title "feat(api): project action history endpoint" \
  --body "Adds GET /api/projects/:o/:n/history (wires existing HistoryClient.list; maps to a clean wire shape, ts from sk, strips pk/ttl) + DDB_TABLE_HISTORY env on the api task. No IAM change (read perm already present). Part of Sub-project A (detail drawer)."
```

- [ ] **Step 2: After green + merge — deploy (human/operator)**

Per the verified rollout note (api task-def CHANGES → pin the new rev):
```bash
atlantis apply -d infra/dashboard-ecs    # on the PR, before merge (registers new api task-def rev)
# merge → backend-ci rebuilds api image
REV=$(aws ecs describe-task-definition --task-definition demo-platform-api-dev --query 'taskDefinition.revision' --output text --region ap-northeast-2)
aws ecs update-service --cluster demo-platform-dev --service demo-platform-api-dev \
  --task-definition demo-platform-api-dev:$REV --force-new-deployment --region ap-northeast-2
# verify
curl -s -o /dev/null -w '%{http_code}\n' https://admin-api-dev.atomai.click/health   # 200
```

---

## Task 4: Frontend — types + api client

**Files:**
- Modify: `dashboard/frontend/lib/types.ts`
- Modify: `dashboard/frontend/lib/api.ts`

- [ ] **Step 1: Extend types**

In `dashboard/frontend/lib/types.ts`, replace the `Project` interface's `urls` line and add `HistoryRecord`:

```typescript
export interface Project {
  name: string;
  github: { repo: string; branch: string };
  description?: string;
  account: string;
  display?: { category?: string };
  resources: ResourceRef[];
  urls?: {
    demo?: string;
    code_server?: { mode: 'explicit'; url: string } | { mode: 'ec2-tag'; tag: string };
  };
}

export interface HistoryRecord {
  action: string;
  actor: string;
  account: string;
  result: 'success' | 'partial' | 'failure';
  details?: Record<string, unknown>;
  ts: string; // ISO timestamp (mapped from the record sk by the api)
}
```

- [ ] **Step 2: Add the api call**

In `dashboard/frontend/lib/api.ts`, add `HistoryRecord` to the type import and append:

```typescript
export const getHistory = (owner: string, name: string, limit = 20) =>
  req<{ items: HistoryRecord[] }>(
    `/api/projects/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/history?limit=${limit}`,
  );
```

- [ ] **Step 3: Typecheck**

Run: `cd dashboard/frontend && pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add dashboard/frontend/lib/types.ts dashboard/frontend/lib/api.ts
git commit -m "feat(frontend): code_server url type + getHistory api"
```

---

## Task 5: Frontend — DetailDrawer component

**Files:**
- Create: `dashboard/frontend/components/DetailDrawer.tsx`

- [ ] **Step 1: Write the component**

Create `dashboard/frontend/components/DetailDrawer.tsx`:

```tsx
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectRow, HistoryRecord, ResourceRef } from '@/lib/types';
import { getHistory } from '@/lib/api';

const TOGGLEABLE = new Set(['ecs', 'ec2', 'argocd-app', 'rds']);
const LABEL: Record<string, string> = {
  ecs: 'ECS', ec2: 'EC2', 'argocd-app': 'ArgoCD', rds: 'RDS', dynamodb: 'DynamoDB',
  elasticache: 'ElastiCache', kafka: 'Kafka', msk: 'MSK', stepfunctions: 'StepFn',
  lambda: 'Lambda', firehose: 'Firehose',
};

function resourceId(r: ResourceRef): string {
  if (typeof r.cluster === 'string' && typeof r.service === 'string') return `${r.cluster}/${r.service}`;
  if (Array.isArray(r.instance_ids)) return (r.instance_ids as string[]).join(', ');
  if (typeof r.db_identifier === 'string') return r.db_identifier;
  if (typeof r.application === 'string') return r.application;
  if (Array.isArray(r.table_names)) return (r.table_names as string[]).join(', ');
  if (typeof r.cluster_name === 'string') return r.cluster_name;
  if (typeof r.cluster_id === 'string') return r.cluster_id;
  if (typeof r.state_machine_name === 'string') return r.state_machine_name;
  if (Array.isArray(r.function_names)) return (r.function_names as string[]).join(', ');
  if (Array.isArray(r.delivery_stream_names)) return (r.delivery_stream_names as string[]).join(', ');
  return '';
}

function relTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function DetailDrawer({
  row,
  onClose,
  onToggle,
}: {
  row: ProjectRow;
  onClose: () => void;
  onToggle: (repo: string, op: 'turn_on' | 'turn_off') => Promise<void> | void;
}) {
  const [history, setHistory] = useState<HistoryRecord[] | null>(null);
  const [histErr, setHistErr] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [owner, name] = row.repo.split('/');
  const pr = row.project;

  const loadHistory = useCallback(async () => {
    setHistErr(null);
    try {
      const { items } = await getHistory(owner, name);
      setHistory(items);
    } catch (e) {
      setHistErr((e as Error).message);
    }
  }, [owner, name]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { items } = await getHistory(owner, name);
        if (alive) setHistory(items);
      } catch (e) {
        if (alive) setHistErr((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [owner, name]);

  // a11y: focus the close button on open, return focus on close, Esc closes, trap Tab.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && panelRef.current) {
        const f = panelRef.current.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input,[tabindex]:not([tabindex="-1"])',
        );
        if (f.length === 0) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  const handleToggle = async (op: 'turn_on' | 'turn_off') => {
    await onToggle(row.repo, op);
    await loadHistory(); // refresh once so the just-performed action appears
  };

  const cs = pr?.urls?.code_server;
  const demo = pr?.urls?.demo;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div
        ref={panelRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`${pr?.name ?? row.name} detail`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-head">
          <div className="row">
            <h2>{pr?.name ?? row.name}</h2>
            <span className={`pill ${row.status}`}>{row.status}</span>
            <button ref={closeRef} className="drawer-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
          <div className="repo">{row.repo}</div>
          <div className="chips">
            {pr?.display?.category && <span className="chip cat">{pr.display.category}</span>}
            <span className="chip acct">{row.account}</span>
          </div>
          <footer>
            {row.status === 'on' && (
              <button className="btn on" onClick={() => void handleToggle('turn_off')}>Turn off</button>
            )}
            {(row.status === 'off' || row.status === 'error') && (
              <button className="btn off" onClick={() => void handleToggle('turn_on')}>Turn on</button>
            )}
            {row.status === 'transitioning' && (
              <button className="btn" disabled><span className="spinner" />전환 중</button>
            )}
          </footer>
        </div>

        {!pr ? (
          <div className="empty">프로젝트 상세를 불러오지 못했습니다.</div>
        ) : (
          <>
            <section className="drawer-sec">
              <h3>리소스</h3>
              <div className="reslist">
                {pr.resources.map((r, i) => {
                  const on = TOGGLEABLE.has(r.type) && !r.always_on;
                  return (
                    <div className="resrow" key={i}>
                      <span className={`chip ${on ? 'res-on' : 'res-always'}`}>{LABEL[r.type] ?? r.type}</span>
                      <span className="resid">{resourceId(r)}</span>
                    </div>
                  );
                })}
                {pr.resources.length === 0 && <div className="empty">리소스 없음</div>}
              </div>
            </section>

            <section className="drawer-sec">
              <h3>URL</h3>
              {demo ? (
                <a className="btn link" href={demo} target="_blank" rel="noopener noreferrer">데모 열기 ↗</a>
              ) : (
                <span className="btn link" aria-disabled>데모 URL 없음</span>
              )}
              {cs?.mode === 'explicit' ? (
                <a className="btn link" href={cs.url} target="_blank" rel="noopener noreferrer">code-server ↗</a>
              ) : (
                <span className="btn link" aria-disabled>
                  {cs?.mode === 'ec2-tag' ? 'code-server (ec2-tag, Stage 4)' : 'code-server 없음'}
                </span>
              )}
            </section>
          </>
        )}

        <section className="drawer-sec">
          <h3>히스토리</h3>
          {histErr && <div className="empty">히스토리 로드 실패: {histErr}</div>}
          {!histErr && history === null && <div className="empty">불러오는 중…</div>}
          {!histErr && history?.length === 0 && <div className="empty">최근 작업 없음</div>}
          <div className="timeline">
            {history?.map((h, i) => (
              <div className="tl-item" key={i}>
                <span className={`pill ${h.result === 'success' ? 'on' : h.result === 'partial' ? 'transitioning' : 'error'}`}>
                  {h.result}
                </span>
                <span className="tl-action">{h.action}</span>
                <span className="tl-meta">{h.actor} · {relTime(h.ts)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd dashboard/frontend && pnpm typecheck`
Expected: no errors. (If `ResourceRef` indexing complains, it has `[k: string]: unknown` so the `typeof`/`Array.isArray` guards type-narrow correctly.)

- [ ] **Step 3: Commit**

```bash
git add dashboard/frontend/components/DetailDrawer.tsx
git commit -m "feat(frontend): DetailDrawer component (resources, urls, history, a11y)"
```

---

## Task 6: Frontend — wire the drawer into the page + card

**Files:**
- Modify: `dashboard/frontend/app/page.tsx`
- Modify: `dashboard/frontend/components/ProjectCard.tsx`

- [ ] **Step 1: ProjectCard — open on body click, stop propagation on controls**

In `dashboard/frontend/components/ProjectCard.tsx`, change the component signature to accept `onOpen`, make the card body clickable, and stop propagation on the interactive controls.

Replace the props destructure:
```tsx
export function ProjectCard({
  row,
  onToggle,
  onOpen,
}: {
  row: ProjectRow;
  onToggle: (repo: string, op: 'turn_on' | 'turn_off') => void;
  onOpen: (repo: string) => void;
}) {
```

On the outer card `<div className="card">`, add:
```tsx
    <div
      className="card"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(row.repo)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(row.repo);
        }
      }}
    >
```

Wrap the Turn on/off button `onClick` and the demo `<a>` so they don't bubble to the card. For each interactive control change `onClick={() => onToggle(...)}` to `onClick={(e) => { e.stopPropagation(); onToggle(...); }}`, and on the demo `<a>` add `onClick={(e) => e.stopPropagation()}`.

- [ ] **Step 2: page.tsx — selected state, render drawer, clear-on-gone**

In `dashboard/frontend/app/page.tsx`:

Add the import:
```tsx
import { DetailDrawer } from '@/components/DetailDrawer';
```

Add state (next to the other `useState`s):
```tsx
  const [selected, setSelected] = useState<string | null>(null);
```

Add an effect to clear a vanished selection (after the `toast` effect):
```tsx
  useEffect(() => {
    if (selected && !rows.some((r) => r.repo === selected)) setSelected(null);
  }, [rows, selected]);
```

Pass `onOpen` to the card:
```tsx
            <ProjectCard key={r.repo} row={r} onToggle={onToggle} onOpen={setSelected} />
```

Render the drawer at the end of the fragment (after the toast line). `onToggle` returns the `toggle` promise so the drawer can refresh:
```tsx
      {selected && (() => {
        const sel = rows.find((r) => r.repo === selected);
        return sel ? (
          <DetailDrawer
            row={sel}
            onClose={() => setSelected(null)}
            onToggle={(repo, op) => toggle(repo, op, (msg, err) => setToast({ msg, err }))}
          />
        ) : null;
      })()}
```

- [ ] **Step 3: Typecheck + lint + build**

Run: `cd dashboard/frontend && pnpm typecheck && pnpm lint && pnpm build`
Expected: typecheck clean; lint clean; build succeeds (routes: `/`, `/_not-found`, `/auth/callback`).

- [ ] **Step 4: Commit**

```bash
git add dashboard/frontend/app/page.tsx dashboard/frontend/components/ProjectCard.tsx
git commit -m "feat(frontend): open DetailDrawer on card click"
```

---

## Task 7: Frontend — drawer styles

**Files:**
- Modify: `dashboard/frontend/app/globals.css`

- [ ] **Step 1: Append drawer + timeline styles**

Append to `dashboard/frontend/app/globals.css`:

```css
.drawer-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: flex-end;
  z-index: 20;
}
.drawer {
  width: 460px;
  max-width: 92vw;
  height: 100%;
  overflow-y: auto;
  background: var(--bg);
  border-left: 1px solid var(--border);
  padding: 20px 22px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  animation: drawer-in 0.16s ease-out;
}
@keyframes drawer-in {
  from { transform: translateX(24px); opacity: 0.6; }
  to { transform: translateX(0); opacity: 1; }
}
.drawer-head { display: flex; flex-direction: column; gap: 10px; }
.drawer-head .row { display: flex; align-items: center; gap: 10px; }
.drawer-head h2 { font-size: 17px; margin: 0; flex: 1; }
.drawer-close {
  background: none; border: none; color: var(--muted);
  font-size: 22px; line-height: 1; cursor: pointer; padding: 0 4px;
}
.drawer-close:hover { color: var(--text); }
.drawer-sec { display: flex; flex-direction: column; gap: 8px; }
.drawer-sec h3 {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px;
  color: var(--muted); margin: 0;
}
.reslist { display: flex; flex-direction: column; gap: 6px; }
.resrow { display: flex; align-items: center; gap: 10px; }
.resid {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px; color: var(--muted);
}
.timeline { display: flex; flex-direction: column; gap: 8px; }
.tl-item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
}
.tl-action { font-size: 13px; flex: 1; }
.tl-meta { font-size: 12px; color: var(--muted); }
```

- [ ] **Step 2: Build to confirm CSS compiles into the bundle**

Run: `cd dashboard/frontend && pnpm build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add dashboard/frontend/app/globals.css
git commit -m "style(frontend): DetailDrawer + history timeline styles"
```

---

## Task 8: Frontend — runtime smoke + PR

**Files:** none (verification)

- [ ] **Step 1: Run against the dev API**

Start the dev backend (real API, in-memory state) and the frontend with auth disabled:
```bash
cd dashboard/backend && pnpm -r build && PORT=8087 node packages/api/dist/dev-server.js &
cd dashboard/frontend && API_ORIGIN=http://localhost:8087 NEXT_PUBLIC_AUTH_ENABLED=false PORT=3005 pnpm dev
```
(Note: the dev-server is the in-memory `dev-server.ts`; it serves `/api/projects` etc. If it lacks the history route, history shows the empty/error state — acceptable for the smoke; the real api has it. Verify the drawer opens, resources/URLs render, toggle still works.)

- [ ] **Step 2: Confirm in a browser (or Playwright screenshot)**

Open `http://localhost:3005`, click a project card → drawer slides in with resources + URLs + history section; the in-card Turn on/off button and demo link still work without opening the drawer; `Esc`/backdrop closes; focus returns to the card.

- [ ] **Step 3: Push + open the frontend PR**

```bash
git push
gh pr create --base main --title "feat(frontend): project detail drawer" \
  --body "Click a project card → slide-in detail drawer (resources, demo/code-server URLs, action history via GET /api/projects/:o/:n/history). a11y dialog + focus trap; null-project guard; refresh-on-toggle. Part of Sub-project A. Depends on the backend history endpoint PR."
```

- [ ] **Step 4: After green + merge — deploy (human/operator)**

Frontend change is **image-only** (task-def unchanged) → a bare force-deploy re-pulls `:main-latest`:
```bash
# merge → frontend-ci rebuilds the frontend image
aws ecs update-service --cluster demo-platform-dev --service demo-platform-frontend-dev \
  --force-new-deployment --region ap-northeast-2
# verify: open https://admin-dev.atomai.click, log in, click a project → drawer
```

---

## Notes

- Order: ship the **backend PR first** (the frontend depends on the endpoint in prod), then the frontend PR.
- No new IAM, no new AWS describe calls, no cross-account access — read-only history from DynamoDB the task role already permits.
- Frontend has no unit-test runner; verification is `typecheck` + `lint` + `build` + a runtime smoke (per the spec). The backend route is covered by `history.test.ts`.
