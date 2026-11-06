export interface RfiPhoto { id: string; name: string }
export interface PhotoUpload extends RfiPhoto { jpeg: string }

export async function preparePhoto(file: File): Promise<PhotoUpload> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPG, PNG or WebP photo.');
  if (file.size > 20 * 1024 * 1024) throw new Error('Choose photos smaller than 20 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 2000 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This photo could not be prepared.');
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const jpeg = canvas.toDataURL('image/jpeg', 0.84).split(',')[1];
    if (!jpeg || jpeg.length > 4000000) throw new Error('Choose a smaller photo.');
    return { id: crypto.randomUUID(), name: file.name.slice(0, 200), jpeg };
  } finally { URL.revokeObjectURL(url); }
}

export async function photoRequest<T>(rfiId: string, method = 'GET', body?: unknown, id?: string): Promise<T> {
  const params = new URLSearchParams({ rfi: rfiId });
  if (id) params.set('id', id);
  const response = await fetch('/api/rfi-photos?' + params, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (response.status === 409) throw new Error('RFI save pending');
  if (!response.ok) throw new Error('RFI photos could not be accessed. Check your connection and retry.');
  return response.json();
}

export async function uploadSavedPhotos(rfiId: string, photos: PhotoUpload[]) {
  for (let attempt = 0; ; attempt++) {
    try {
      await photoRequest(rfiId, 'POST', photos);
      return;
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'RFI save pending' || attempt >= 10) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}
