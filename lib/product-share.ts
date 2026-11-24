'use client';

type ProductShare = { image: string; filename: string; text: string };

function safeJpegName(value: string): string {
  return `${value.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'ellext-product'}.jpg`;
}

async function asJpegFile(image: string, filename: string): Promise<File> {
  const response = await fetch(image);
  if (!response.ok) throw new Error('The product image could not be loaded for sharing.');
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) { bitmap.close(); throw new Error('This browser cannot prepare the product image.'); }
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const jpeg = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The product image could not be converted to JPG.')), 'image/jpeg', 0.92));
  return new File([jpeg], safeJpegName(filename), { type: 'image/jpeg' });
}

/** Opens the platform share sheet with the JPG and its caption (WhatsApp is chosen there). */
export async function shareProductWithImage({ image, filename, text }: ProductShare): Promise<void> {
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') {
    throw new Error('Image and caption sharing needs a browser or phone with the system share sheet. Open this page on a compatible mobile device to share to WhatsApp.');
  }
  const file = await asJpegFile(image, filename);
  // Check file support separately. Some Android share targets treat `title`
  // as the message and silently drop `text` when both are supplied.
  if (!navigator.canShare({ files: [file] })) {
    throw new Error('This device cannot share the product image and caption together. Try WhatsApp sharing from a compatible phone.');
  }
  await navigator.share({ files: [file], text });
}
