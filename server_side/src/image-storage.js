import { v2 as cloudinary } from "cloudinary";
import { mkdirSync } from "node:fs";
import { writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";

export function createImageStorage({
  uploads,
  env = process.env,
  cloud = cloudinary,
}) {
  const credentials = {
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
  };
  const configured = Object.values(credentials).filter(Boolean).length;
  if (configured && configured !== 3)
    throw new Error(
      "Set all three CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET values.",
    );
  const remote = configured === 3;
  if (!remote && env.RENDER === "true")
    throw new Error(
      "Cloudinary is required on Render; uploaded photos cannot use its temporary filesystem.",
    );
  if (!remote) mkdirSync(uploads, { recursive: true });
  const options = {
    ...credentials,
    resource_type: "image",
    type: "authenticated",
    secure: true,
  };

  return {
    remote,
    async save(id, buffer) {
      if (!remote) {
        const path = `${id}.webp`;
        await writeFile(resolve(uploads, path), buffer);
        return path;
      }
      const publicId = `hostel-olx/${id}`;
      await new Promise((resolve, reject) => {
        const stream = cloud.uploader.upload_stream(
          {
            ...options,
            public_id: publicId,
            overwrite: false,
            format: "webp",
            timeout: 60000,
          },
          (error, result) =>
            error
              ? reject(error)
              : result?.public_id === publicId
                ? resolve(result)
                : reject(
                    new Error("Cloudinary did not confirm the uploaded photo."),
                  ),
        );
        stream.on("error", reject);
        stream.end(buffer);
      });
      return `cloudinary:${publicId}`;
    },
    send(path, res) {
      if (path.startsWith("https://")) return res.redirect(path); // Legacy sample photos.
      if (path.startsWith("cloudinary:")) {
        if (!remote)
          throw new Error(
            "Cloudinary credentials are required to read this photo.",
          );
        // Authorization happens in the API before issuing a one-minute link.
        // Do not turn campus photos into permanently public CDN URLs.
        return res.redirect(
          cloud.utils.private_download_url(path.slice(11), "webp", {
            ...options,
            attachment: false,
            expires_at: Math.floor(Date.now() / 1000) + 60,
          }),
        );
      }
      return res.sendFile(resolve(uploads, path));
    },
    async remove(path) {
      if (path.startsWith("https://")) return;
      if (path.startsWith("cloudinary:")) {
        if (!remote)
          throw new Error(
            "Cloudinary credentials are required to remove this photo.",
          );
        const result = await cloud.uploader.destroy(path.slice(11), {
          ...options,
          invalidate: true,
          timeout: 60000,
        });
        if (!["ok", "not found"].includes(result.result))
          throw new Error("Cloudinary could not remove the photo.");
        return;
      }
      await unlink(resolve(uploads, path)).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    },
  };
}
