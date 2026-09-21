const MAX_UPLOAD_BYTES = 3.5 * 1024 * 1024;

// Keep the 8 MB picker limit while fitting Vercel's 4.5 MB request cap.
export async function preparePhoto(file) {
  if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name} is over 8 MB.`);
  if (file.size <= MAX_UPLOAD_BYTES) return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    if (bitmap.width * bitmap.height > 20000000) throw new Error("Photo is over 20 megapixels.");
    const ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", 0.82));
    if (!blob || blob.size > MAX_UPLOAD_BYTES) throw new Error("Photo could not be resized. Please choose a smaller JPEG, PNG or WebP.");
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + (blob.type === "image/webp" ? ".webp" : ".png"), { type: blob.type });
  } catch (error) {
    throw new Error(error.message || "Please choose a valid JPEG, PNG or WebP photo.", { cause: error });
  } finally {
    bitmap?.close();
  }
}
