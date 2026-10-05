type Dependencies = { createClient: (url: string, key: string, options?: any) => any; env: (name: string) => string | undefined };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const boardToken = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}){2}$/i;

export function createHandler({ createClient, env }: Dependencies) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin') || '';
    const permitted = origin === 'https://zethhummel-rgb.github.io' || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'Vary': 'Origin',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };
    if (permitted) headers['Access-Control-Allow-Origin'] = origin;
    const reply = (body: any, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (origin && !permitted) return reply({ error: 'This origin is not allowed.' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply({ error: 'Use POST.' }, 405);
    try {
      const text = await request.text();
      if (text.length > 4096) return reply({ error: 'Request is too large.' }, 413);
      const body = JSON.parse(text);
      if (!body || typeof body.boardToken !== 'string' || typeof body.documentId !== 'string' || (body.visitToken !== undefined && body.visitToken !== null && typeof body.visitToken !== 'string') || !boardToken.test(body.boardToken) || !uuid.test(body.documentId) || (body.visitToken && !uuid.test(body.visitToken))) return reply({ error: 'Document unavailable.' }, 404);
      const url = env('SUPABASE_URL'), anonKey = env('SUPABASE_ANON_KEY'), secret = env('SUPABASE_SERVICE_ROLE_KEY');
      if (!url || !anonKey || !secret) return reply({ error: 'Document service is unavailable.' }, 503);
      // Resolve through caller-scoped RPC first. The server-only signer cannot widen access.
      const authorization = request.headers.get('authorization') || `Bearer ${anonKey}`;
      const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
      const { data: record, error } = await caller.rpc('resolve_job_board_download', {
        p_token: body.boardToken, p_visit_token: body.visitToken || null, p_document_id: body.documentId,
      });
      if (error || !record) return reply({ error: 'Document unavailable. Sign in again if needed.' }, 404);
      if (record.id !== body.documentId || !uuid.test(record.board_id || '')) return reply({ error: 'Document unavailable.' }, 404);
      const fileName = record.file_name;
      if (record.source_type && record.source_type !== 'policies') {
        if (!['inspection_records', 'toolbox_talk_reports', 'daily_site_reports', 'incident_reports', 'accident_reports', 'employee_injury_reports'].includes(record.source_type)) return reply({ error: 'Document unavailable.' }, 404);
        return reply({ sourcePayload: { source_type: record.source_type, record: record.source_payload }, fileName, mimeType: 'application/pdf' });
      }
      const bucket = record.source_type === 'policies' ? 'policies' : 'job-board-files';
      const path = bucket === 'policies' ? record.source_payload?.file_path : record.object_path;
      if (!path || typeof path !== 'string' || path.includes('..') || path.startsWith('/')) return reply({ error: 'Document unavailable.' }, 404);
      if (bucket === 'job-board-files') {
        const parts = path.split('/'), extensions: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
        if (parts.length !== 3 || parts[0] !== record.board_id || parts[1] !== body.documentId || parts[2] !== 'original.' + extensions[record.mime_type]) return reply({ error: 'Document unavailable.' }, 404);
      }
      const signer = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
      const result = await signer.storage.from(bucket).createSignedUrl(path, 120, { download: fileName });
      if (result.error || !result.data?.signedUrl) return reply({ error: 'The file could not be opened. Please retry.' }, 502);
      return reply({ url: result.data.signedUrl, fileName, mimeType: record.mime_type });
    } catch {
      // Do not return tokens, payload contents, request headers or raw service errors.
      return reply({ error: 'The document could not be opened. Please retry.' }, 400);
    }
  };
}
