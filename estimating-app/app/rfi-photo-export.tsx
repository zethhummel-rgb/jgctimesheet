import { useEffect, useRef, useState } from 'react';
import { photoRequest } from '../lib/rfi-photos';

export interface PhotoDownload { rfi: string; ids: string[]; blob: Blob; filename: string }
export function downloadFile(data: Blob, filename: string) {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
type SavePicker = (options: { suggestedName: string }) => Promise<{
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>
}>;
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
      const picker = (window as Window & { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
      if (picker) {
        try {
          const handle = await picker.call(window, { suggestedName: item.filename });
          const writer = await handle.createWritable();
          await writer.write(item.blob);
          await writer.close();
        } catch (failure) {
          if (!(failure instanceof DOMException && failure.name === 'SecurityError')) throw failure;
          downloadFile(item.blob, item.filename);
          setPhase('confirm');
          return;
        }
        await clearSaved();
      } else {
        downloadFile(item.blob, item.filename);
        setPhase('confirm');
      }
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
