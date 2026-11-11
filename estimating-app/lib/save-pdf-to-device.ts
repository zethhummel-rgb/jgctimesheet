export function downloadFile(data: Blob, filename: string) {
  const url = URL.createObjectURL(data);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

type SavePicker = (options: { suggestedName: string }) => Promise<{
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }>;
}>;

// A browser download does not tell the page when the file reaches disk.
export async function savePdfToDevice(blob: Blob, filename: string): Promise<boolean> {
  const picker = (window as Window & { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (picker) {
    let handle: Awaited<ReturnType<SavePicker>> | undefined;
    try {
      handle = await picker.call(window, { suggestedName: filename });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'SecurityError')) throw error;
    }
    if (handle) {
      const writer = await handle.createWritable();
      try {
        await writer.write(blob);
        await writer.close();
      } catch (error) {
        await writer.abort?.().catch(() => {});
        throw error;
      }
      return true;
    }
  }
  downloadFile(blob, filename);
  return false;
}
