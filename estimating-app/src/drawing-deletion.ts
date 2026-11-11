type DrawingDeletion = {
  target: 'drawing' | 'shop';
  jobId: string;
  drawingId: string;
  expected: string;
};

export async function permanentlyDeleteDrawing(deletion: DrawingDeletion, onPrepared?: () => void) {
  const factory = (window as Window & { createJgcSupabaseClient?: () => any }).createJgcSupabaseClient;
  if (!factory) throw new Error('Sign in to the Portal before deleting a drawing.');
  const client = factory();
  const request = (action: 'prepare' | 'finish') => client.rpc('manage_drawing_deletion', {
    target: deletion.target, action, job_key: deletion.jobId, drawing_key: deletion.drawingId, expected: deletion.expected,
  });
  const prepared = await request('prepare');
  if (prepared.error) throw new Error(prepared.error.message || 'The drawing could not be prepared for deletion.');
  onPrepared?.();
  const paths: string[] = prepared.data;
  const bucket = deletion.target === 'drawing' ? 'job-drawings' : 'shop-drawing-transmittals';
  for (let i = 0; i < paths.length; i += 1000) {
    const result = await client.storage.from(bucket).remove(paths.slice(i, i + 1000));
    if (result.error) throw new Error(result.error.message || 'The PDF could not be cleared. Retry deleting the drawing.');
  }
  const finished = await request('finish');
  if (finished.error) throw new Error(finished.error.message || 'The drawing could not be deleted. Please retry.');
}
