const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const portalRoot = path.resolve(__dirname, "..");
const portalApi = fs.readFileSync(path.join(portalRoot, "estimating-app", "src", "portal-api.ts"), "utf8");
const estimateDesk = fs.readFileSync(path.join(portalRoot, "estimating-app", "app", "estimate-desk.tsx"), "utf8");
const migration = fs.readFileSync(
  path.join(portalRoot, "supabase", "migrations", "20260905120000_estimator_admin_only_rls.sql"),
  "utf8",
);

test("Estimator data policies require an approved administrator", () => {
  expect(migration).toContain("create or replace function private.jgc_has_estimator_admin_access()");
  expect(migration).toContain("profile.id = (select auth.uid())");
  expect(migration).toContain("profile.account_status = 'approved'");
  expect(migration).toContain("profile.role = 'admin'");
  expect(migration).toContain("set search_path = ''");
  expect(migration).not.toContain("jgc_has_full_portal_access");
  expect(migration).toContain("revoke all on function private.jgc_has_estimator_admin_access() from public, anon, authenticated");

  [
    "estimator_workspaces",
    "estimator_supplier_price_imports",
    "estimator_supplier_catalog_items",
  ].forEach((table) => {
    expect(migration).toContain(`alter table public.${table} enable row level security`);
    expect(migration).toContain(`revoke all on table public.${table} from anon, authenticated`);
  });

  expect(migration.match(/using \(\(select private\.jgc_has_estimator_admin_access\(\)\)\)/g)).toHaveLength(3);
  expect(migration.match(/with check \(\(select private\.jgc_has_estimator_admin_access\(\)\)\)/g)).toHaveLength(3);
});

test("Job statistics paginate collection reads and chunk ID filters", () => {
  const statisticsSource = portalApi.slice(
    portalApi.indexOf("const PORTAL_STATISTICS_PAGE_SIZE"),
    portalApi.indexOf("function secureDocumentLink"),
  );
  const primaryQueries = statisticsSource.slice(
    statisticsSource.indexOf("const [submittedResult"),
    statisticsSource.indexOf("const primaryResults"),
  );
  const relatedQueries = statisticsSource.slice(
    statisticsSource.indexOf("const [capturedResult"),
    statisticsSource.indexOf("const relatedResults"),
  );

  expect(statisticsSource).toContain("queryFactory().range(from, from + PORTAL_STATISTICS_PAGE_SIZE - 1)");
  expect(statisticsSource).toContain("expectedCount");
  expect(statisticsSource).toContain("PORTAL_STATISTICS_ID_CHUNK_SIZE");
  expect(statisticsSource).toContain("PORTAL_STATISTICS_MAX_PAGES");
  expect(statisticsSource).toContain("PORTAL_STATISTICS_MAX_ROWS");
  expect(statisticsSource).toContain("pageNumber < PORTAL_STATISTICS_MAX_PAGES");
  expect(statisticsSource).toContain("seenIds.has(id)");
  expect(statisticsSource).toContain("Portal record pagination did not advance safely.");
  expect(statisticsSource).toContain("Portal record pagination exceeded its safe page limit.");
  expect(statisticsSource).toContain("data.length + result.data.length > PORTAL_STATISTICS_MAX_ROWS");
  expect(primaryQueries.match(/loadPortalStatisticPages\(/g)).toHaveLength(9);
  expect(relatedQueries.match(/loadPortalStatisticIdChunks\(/g)).toHaveLength(4);
  expect(primaryQueries.match(/\.order\("id"/g)).toHaveLength(9);
  expect(relatedQueries.match(/\.order\("id"/g)).toHaveLength(4);
  expect(`${primaryQueries}${relatedQueries}`.match(/\{ count: "exact" \}/g)).toHaveLength(13);
});

test("Daily reports use canonical job identifiers instead of a bare job name", () => {
  const statisticsSource = portalApi.slice(
    portalApi.indexOf("async function jobStatisticsResponse"),
    portalApi.indexOf("function secureDocumentLink"),
  );

  expect(statisticsSource).toContain("const reportProjects = [...new Set([jobNumber, jobDisplay].filter(Boolean))]");
  expect(statisticsSource).not.toContain("[jobDisplay, jobNumber, jobName]");
  expect(statisticsSource).toContain('.in("project", reportProjects)');
});

test("Portal document-link synchronization replaces only the stable imported entry", () => {
  const synchronizationSource = portalApi.slice(
    portalApi.indexOf("function syncPortalData"),
    portalApi.indexOf("async function getState"),
  );

  expect(synchronizationSource).toContain('const portalDocumentLinkId = `portal-job-link-${job.id}`');
  expect(synchronizationSource).toContain("savedDocumentLinks.filter((link) => link.id !== portalDocumentLinkId)");
  expect(synchronizationSource).toContain("previousPortalDocumentLink?.createdAt");
  expect(estimateDesk).toContain('const jobId = uid("job")');
  expect(estimateDesk).toContain('id: `portal-job-link-${jobId}`');
});
