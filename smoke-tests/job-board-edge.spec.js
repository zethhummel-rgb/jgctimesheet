// Offline Edge-handler tests. Both `node --test` and the existing Playwright
// runner execute these without credentials, network or a deployed function.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const test = process.env.NODE_TEST_CONTEXT ? require('node:test').test : require('@playwright/test').test;
const ts = require('../estimating-app/node_modules/typescript');
const source = fs.readFileSync(path.join(__dirname, '../supabase/functions/jgc-job-board-document/handler.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = { exports: {} };
Function('exports', 'module', compiled)(loaded.exports, loaded);
const { createHandler } = loaded.exports;

const BOARD = '00000000-0000-4000-8000-000000000100';
const DOC = '00000000-0000-4000-8000-000000000101';
const OTHER_DOC = '00000000-0000-4000-8000-000000000102';
const VISIT = '00000000-0000-4000-8000-000000000103';
const TOKEN = BOARD + OTHER_DOC;
const ORIGIN = 'https://zethhummel-rgb.github.io';
const SERVICE = 'SYNTHETIC_SERVICE_KEY_NEVER_RETURN';
const ANON = 'SYNTHETIC_PUBLIC_ANON_KEY';
const privateUrl = 'https://synthetic.example.invalid/storage/v1/object/sign/job-board-files/original.pdf?token=SYNTHETIC_SIGNED_TOKEN';
const normalRecord = () => ({ id: DOC, board_id: BOARD, bucket: 'job-board-files', object_path: `${BOARD}/${DOC}/original.pdf`, file_name: 'Site safety.pdf', mime_type: 'application/pdf', file_size: 1234, category: 'site-specific', title: 'Synthetic site safety', source_type: null, source_id: null });

function fixture(options = {}) {
  const calls = [];
  const envValues = { SUPABASE_URL: 'https://synthetic.example.invalid', SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, ...options.env };
  const handler = createHandler({
    env: name => envValues[name],
    createClient(url, key, clientOptions) {
      calls.push({ type: 'createClient', url, key, options: clientOptions });
      if (key === ANON) return { rpc: async (name, args) => {
        calls.push({ type: 'rpc', name, args });
        if (options.rpcThrows) throw new Error(`SENSITIVE_INTERNAL_DATABASE_ERROR ${SERVICE}`);
        if (options.rpcError) return { data: null, error: { message: `SENSITIVE_INTERNAL_DATABASE_ERROR ${SERVICE}`, code: '42501' } };
        return { data: options.record === undefined ? normalRecord() : options.record, error: null };
      } };
      assert.equal(key, SERVICE, 'only the server-only signer uses the service key');
      return { storage: { from: bucket => {
        calls.push({ type: 'bucket', bucket });
        return { createSignedUrl: async (objectPath, seconds, signedOptions) => {
          calls.push({ type: 'sign', bucket, objectPath, seconds, options: signedOptions });
          if (options.signThrows) throw new Error(`SENSITIVE_INTERNAL_STORAGE_ERROR ${SERVICE}`);
          if (options.signError) return { data: null, error: { message: `SENSITIVE_INTERNAL_STORAGE_ERROR ${SERVICE}` } };
          return { data: { signedUrl: privateUrl }, error: null };
        } };
      } } };
    },
  });
  const invoke = async ({ body = { boardToken: TOKEN, visitToken: VISIT, documentId: DOC }, origin = ORIGIN, authorization, method = 'POST', rawBody } = {}) => {
    const headers = new Headers();
    if (origin !== null) headers.set('origin', origin);
    if (authorization) headers.set('authorization', authorization);
    const request = new Request('https://synthetic.example.invalid/functions/v1/jgc-job-board-document', { method, headers, ...(method === 'POST' ? { body: rawBody === undefined ? JSON.stringify(body) : rawBody } : {}) });
    const response = await handler(request);
    const text = await response.text();
    assert(!text.includes(SERVICE), 'service credentials must never enter a response');
    assert(!text.includes('SENSITIVE_INTERNAL'), 'internal errors must never enter a response');
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    return { response, text, body: text ? JSON.parse(text) : null };
  };
  return { calls, invoke };
}

test('Edge authorizes through caller RPC before creating a server signer', async () => {
  const fx = fixture();
  const result = await fx.invoke({ authorization: 'Bearer SYNTHETIC_STAFF_TOKEN' });
  assert.equal(result.response.status, 200);
  assert.deepEqual(fx.calls.map(c => c.type), ['createClient', 'rpc', 'createClient', 'bucket', 'sign']);
  assert.equal(fx.calls[0].key, ANON);
  assert.equal(fx.calls[0].options.global.headers.Authorization, 'Bearer SYNTHETIC_STAFF_TOKEN');
  assert.deepEqual(fx.calls[1], { type: 'rpc', name: 'resolve_job_board_download', args: { p_token: TOKEN, p_visit_token: VISIT, p_document_id: DOC } });
  assert.deepEqual(fx.calls[4], { type: 'sign', bucket: 'job-board-files', objectPath: `${BOARD}/${DOC}/original.pdf`, seconds: 120, options: { download: 'Site safety.pdf' } });
  assert.deepEqual(result.body, { url: privateUrl, fileName: 'Site safety.pdf', mimeType: 'application/pdf' });
});

test('Edge anonymous denial and unverified caller denial never create a service signer', async () => {
  for (const authorization of [undefined, 'Bearer FORGED_UNVERIFIED_CLIENT_TOKEN']) {
    const fx = fixture({ rpcError: true });
    const result = await fx.invoke({ authorization });
    assert.equal(result.response.status, 404);
    assert.equal(fx.calls[0].options.global.headers.Authorization, authorization || `Bearer ${ANON}`);
    assert.deepEqual(fx.calls.map(c => c.type), ['createClient', 'rpc']);
    assert(!result.text.includes('FORGED_UNVERIFIED_CLIENT_TOKEN'));
  }
});

test('Edge rejects malformed and short QR tokens and invalid document or visitor IDs before client creation', async () => {
  for (const body of [
    { boardToken: BOARD, visitToken: VISIT, documentId: DOC },
    { boardToken: `${TOKEN}x`, visitToken: VISIT, documentId: DOC },
    { boardToken: 'guessed-token', visitToken: VISIT, documentId: DOC },
    { boardToken: TOKEN, visitToken: 'guessed-visit', documentId: DOC },
    { boardToken: TOKEN, visitToken: VISIT, documentId: '../other-document' },
    { boardToken: TOKEN, visitToken: VISIT, documentId: null },
    { boardToken: [TOKEN], visitToken: VISIT, documentId: DOC },
    { boardToken: TOKEN, visitToken: [VISIT], documentId: DOC },
    { boardToken: TOKEN, visitToken: VISIT, documentId: [DOC] },
  ]) {
    const fx = fixture(); const result = await fx.invoke({ body });
    assert.equal(result.response.status, 404); assert.equal(fx.calls.length, 0);
  }
});

test('Edge returns private signed URLs only for the exact authorized original', async () => {
  for (const record of [
    { ...normalRecord(), object_path: `${BOARD}/${OTHER_DOC}/original.pdf` },
    { ...normalRecord(), id: OTHER_DOC },
    { ...normalRecord(), object_path: `${OTHER_DOC}/${DOC}/original.pdf` },
    { ...normalRecord(), bucket: 'private-payroll', object_path: 'private-payroll/payroll.pdf' },
    { ...normalRecord(), object_path: '../private/file.pdf' },
    { ...normalRecord(), object_path: '/private/file.pdf' },
    { ...normalRecord(), object_path: 'https://other.example.invalid/private.pdf' },
    { ...normalRecord(), object_path: `${BOARD}/${DOC}/copy.pdf` },
    { ...normalRecord(), object_path: `${BOARD}/${DOC}/original.js`, mime_type: 'text/javascript' },
  ]) {
    const fx = fixture({ record }); const result = await fx.invoke();
    assert.equal(result.response.status, 404, `unexpected signing for ${JSON.stringify(record)}`); assert.equal(fx.calls.filter(c => c.key === SERVICE).length, 0);
  }
});

test('Edge returns authorized JPEG originals with their MIME type and filename', async () => {
  const fx = fixture({ record: { ...normalRecord(), mime_type: 'image/jpeg', object_path: `${BOARD}/${DOC}/original.jpg`, file_name: 'Paper JSA.jpg' } });
  const result = await fx.invoke(); assert.equal(result.response.status, 200);
  assert.equal(result.body.mimeType, 'image/jpeg'); assert.equal(result.body.fileName, 'Paper JSA.jpg');
  assert.equal(fx.calls.find(c => c.type === 'sign').objectPath, `${BOARD}/${DOC}/original.jpg`);
});

test('Edge imported policy documents sign only the explicit policies path', async () => {
  const fx = fixture({ record: { ...normalRecord(), source_type: 'policies', source_id: OTHER_DOC, source_payload: { title: 'Imported JGC policy', file_path: 'company-policies/2026/Health and Safety.pdf' } } });
  const result = await fx.invoke(); assert.equal(result.response.status, 200);
  assert.deepEqual(fx.calls.find(c => c.type === 'sign'), { type: 'sign', bucket: 'policies', objectPath: 'company-policies/2026/Health and Safety.pdf', seconds: 120, options: { download: 'Site safety.pdf' } });
  for (const filePath of [undefined, '', '../policy.pdf', '/policy.pdf']) {
    const invalid = fixture({ record: { ...normalRecord(), source_type: 'policies', source_payload: { file_path: filePath } } });
    assert.equal((await invalid.invoke()).response.status, 404); assert.equal(invalid.calls.filter(c => c.type === 'sign').length, 0);
  }
});

test('Edge authorized saved-report PDF snapshots never need a service signer', async () => {
  const report = { id: OTHER_DOC, title: 'Synthetic JSA', inspection_type: 'JSA', form_data: { fields: [{ label: 'Project / Job', value: '26999 - Synthetic job' }] } };
  const fx = fixture({ record: { ...normalRecord(), source_type: 'inspection_records', source_id: OTHER_DOC, source_payload: report } });
  const result = await fx.invoke(); assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, { sourcePayload: { source_type: 'inspection_records', record: report }, fileName: 'Site safety.pdf', mimeType: 'application/pdf' });
  assert.deepEqual(fx.calls.map(c => c.type), ['createClient', 'rpc']);
  const denied = fixture({ rpcError: true, record: { ...normalRecord(), source_type: 'inspection_records', source_payload: report } });
  const deny = await denied.invoke(); assert.equal(deny.response.status, 404); assert(!deny.text.includes('Synthetic JSA'));
});

test('Edge missing RPC records and signer failures return bounded errors without internal details', async () => {
  for (const [options, status] of [[{ record: null }, 404], [{ rpcError: true }, 404], [{ rpcThrows: true }, 400], [{ signError: true }, 502], [{ signThrows: true }, 400]]) {
    const fx = fixture(options); const result = await fx.invoke(); assert.equal(result.response.status, status); assert(result.body.error);
    assert(!result.text.includes(TOKEN)); assert(!result.text.includes(VISIT)); assert(!result.text.includes('source_payload'));
  }
});

test('Edge no-store responses enforce CORS, methods and preflight before creating clients', async () => {
  for (const origin of [ORIGIN, 'http://localhost:41738', 'http://127.0.0.1:41738']) {
    const fx = fixture(); const result = await fx.invoke({ origin, method: 'OPTIONS' });
    assert.equal(result.response.status, 204); assert.equal(result.response.headers.get('access-control-allow-origin'), origin); assert.equal(result.response.headers.get('vary'), 'Origin'); assert.equal(fx.calls.length, 0);
  }
  const hostile = fixture(); const denied = await hostile.invoke({ origin: 'https://untrusted.example.invalid' });
  assert.equal(denied.response.status, 403); assert.equal(denied.response.headers.get('access-control-allow-origin'), null); assert.equal(hostile.calls.length, 0);
  const method = fixture(); assert.equal((await method.invoke({ method: 'GET' })).response.status, 405); assert.equal(method.calls.length, 0);
  const noOrigin = fixture(); assert.equal((await noOrigin.invoke({ origin: null })).response.headers.get('access-control-allow-origin'), null);
});

test('Edge malformed, oversize and unavailable-service requests never create clients or leak configuration', async () => {
  for (const [options, invocation, status] of [
    [{}, { rawBody: '{broken' }, 400],
    [{}, { rawBody: 'x'.repeat(4097) }, 413],
    [{ env: { SUPABASE_SERVICE_ROLE_KEY: undefined } }, {}, 503],
    [{ env: { SUPABASE_ANON_KEY: undefined } }, {}, 503],
    [{ env: { SUPABASE_URL: undefined } }, {}, 503],
  ]) {
    const fx = fixture(options); const result = await fx.invoke(invocation); assert.equal(result.response.status, status); assert.equal(fx.calls.length, 0);
  }
});
