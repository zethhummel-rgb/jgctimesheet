export async function rfiPhotosResponse(client: any, request: Request, url: URL) {
  const rfi = url.searchParams.get('rfi');
  const id = url.searchParams.get('id');
  const table = client.from('estimator_rfi_photos');
  const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
  let result;
  if (request.method === 'GET') {
    if (!id) {
      const rows = [];
      for (let offset = 0; ; offset += 250) {
        const page = await client.from('estimator_rfi_photos').select('id,name').eq('rfi_id', rfi)
          .order('created_at').order('position').order('id').range(offset, offset + 249);
        if (page.error) return json({ error: page.error.message }, 400);
        rows.push(...page.data);
        if (page.data.length < 250) return json(rows);
      }
    }
    result = await table.select('jpeg').eq('rfi_id', rfi).eq('id', id).single();
  } else if (request.method === 'POST') {
    const photos = await request.json();
    if (!Array.isArray(photos) || !photos.length || photos.length > 8) return json({ error: 'Choose up to eight photos per upload.' }, 400);
    result = await table.upsert(photos.map((photo, position) => ({ id: photo.id, rfi_id: rfi, position, name: photo.name, jpeg: photo.jpeg })), { ignoreDuplicates: true });
  } else if (request.method === 'DELETE') {
    const ids = await request.json();
    if (!Array.isArray(ids) || !ids.length) return json({ error: 'Choose photos to clear.' }, 400);
    for (let start = 0; start < ids.length; start += 50) {
      const removed = await client.from('estimator_rfi_photos').delete().eq('rfi_id', rfi).in('id', ids.slice(start, start + 50));
      if (removed.error) return json({ error: removed.error.message }, 400);
    }
    return json({});
  } else return json({}, 405);
  return result.error ? json({ error: result.error.message }, result.error.code === '40001' ? 409 : 400) : json(result.data ?? {});
}
