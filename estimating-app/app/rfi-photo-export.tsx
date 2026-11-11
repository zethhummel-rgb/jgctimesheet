import { savePdfToDevice } from '../lib/save-pdf-to-device';
export { downloadFile } from '../lib/save-pdf-to-device';
import { useEffect, useRef, useState } from 'react';
import { photoRequest } from '../lib/rfi-photos';

export interface PhotoDownload { rfi: string; ids: string[]; blob: Blob; filename: string }
export function RfiPhotoExport({ item, done }: { item: PhotoDownload; done: (message: string) => void }) {
  const [phase, setPhase] = useState<'ready'|'confirm'|'saved'>('ready');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const action = useRef<HTMLButtonElement>(null);
  useEffect(() => { action.current?.focus(); }, []);
  async function clearSaved() {
    setPhase('saved');
    await photoRequest(item.rfi, 'DELETE', item.ids);
    done('PDF saved. Its uploaded photos have been cleared from the portal.');
  }
  async function act() {
    setBusy(true);
    setError('');
    try {
      if (phase !== 'ready') { await clearSaved(); return; }
      if (await savePdfToDevice(item.blob, item.filename)) await clearSaved();
      else setPhase('confirm');
    } catch (failure) {
      setError(failure instanceof DOMException && failure.name === 'AbortError' ? 'Save cancelled. Your photos are still available.' : failure instanceof Error ? failure.message : 'Please retry.');
    } finally { setBusy(false); }
  }
  return <section className="rfi-message" aria-label="Save photo PDF">
    <strong>{item.filename}</strong>
    <p>{phase === 'ready' ? `Ready to save with ${item.ids.length} photo(s). Saving clears these photos from the portal.` :
      phase === 'confirm' ? 'Check that the PDF is saved on your device before clearing its photos.' : 'PDF saved. Finish clearing its photos from the portal.'}</p>
    {error && <p role="alert">{error}</p>}
    <div className="rfi-actions"><button ref={action} className="button primary" disabled={busy} onClick={() => void act()}>{phase === 'ready' ? 'Save PDF with photos' : phase === 'confirm' ? 'PDF saved — clear photos' : 'Retry clearing photos'}</button>
    <button className="button secondary" disabled={busy} onClick={() => done('Photos kept for the next download.')}>Keep photos</button></div>
  </section>;
}
