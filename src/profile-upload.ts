import type { User } from "@supabase/supabase-js";
import { isUploadedProfileImageUrl } from "./sanitize";
import { getSupabase } from "./supabase";

export const GAMERPIC_MAX_BYTES = 512 * 1024;
export const BANNER_MAX_BYTES = 2 * 1024 * 1024;
export const GAMERPIC_MAX_PX = 512;
export const BANNER_MAX_WIDTH = 1920;
export const BANNER_MAX_HEIGHT = 600;

const GAMERPIC_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const BANNER_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type ProfileImageKind = "gamerpic" | "banner";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read that image file."));
    };
    image.src = objectUrl;
  });
}

function drawSquareAvatar(canvas: HTMLCanvasElement, image: HTMLImageElement, size: number): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available.");
  canvas.width = size;
  canvas.height = size;
  const crop = Math.min(image.width, image.height);
  const sx = (image.width - crop) / 2;
  const sy = (image.height - crop) / 2;
  ctx.drawImage(image, sx, sy, crop, crop, 0, 0, size, size);
}

function drawBanner(canvas: HTMLCanvasElement, image: HTMLImageElement, maxWidth: number, maxHeight: number): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available.");
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(image, 0, 0, width, height);
}

async function canvasToWebpUnderLimit(canvas: HTMLCanvasElement, maxBytes: number): Promise<Blob> {
  const qualities = [0.92, 0.85, 0.75, 0.65, 0.55, 0.45];
  let smallest: Blob | null = null;
  for (const quality of qualities) {
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/webp", quality);
    });
    if (!blob) continue;
    if (!smallest || blob.size < smallest.size) smallest = blob;
    if (blob.size <= maxBytes) return blob;
  }
  if (smallest && smallest.size <= maxBytes) return smallest;
  throw new Error(`Image is still too large after compression (limit ${formatBytes(maxBytes)}). Try a smaller file.`);
}

function validateFileType(file: File, kind: ProfileImageKind): void {
  const allowed = kind === "gamerpic" ? GAMERPIC_TYPES : BANNER_TYPES;
  if (!allowed.has(file.type)) {
    const list = kind === "gamerpic" ? "JPG, PNG, WebP, or GIF" : "JPG, PNG, or WebP";
    throw new Error(`Use ${list} for your ${kind === "gamerpic" ? "gamerpic" : "banner"}.`);
  }
}

function validateRawFileSize(file: File, kind: ProfileImageKind): void {
  const maxBytes = kind === "gamerpic" ? GAMERPIC_MAX_BYTES * 4 : BANNER_MAX_BYTES * 2;
  if (file.size > maxBytes) {
    throw new Error(
      `File is too large (${formatBytes(file.size)}). Pick an image under ${formatBytes(kind === "gamerpic" ? GAMERPIC_MAX_BYTES * 4 : BANNER_MAX_BYTES * 2)} before upload.`
    );
  }
}

async function prepareImageBlob(file: File, kind: ProfileImageKind): Promise<Blob> {
  validateFileType(file, kind);
  validateRawFileSize(file, kind);
  const image = await loadImage(file);
  const canvas = document.createElement("canvas");
  if (kind === "gamerpic") {
    drawSquareAvatar(canvas, image, GAMERPIC_MAX_PX);
    return canvasToWebpUnderLimit(canvas, GAMERPIC_MAX_BYTES);
  }
  drawBanner(canvas, image, BANNER_MAX_WIDTH, BANNER_MAX_HEIGHT);
  return canvasToWebpUnderLimit(canvas, BANNER_MAX_BYTES);
}

export function profileImageUploadHint(kind: ProfileImageKind): string {
  if (kind === "gamerpic") {
    return `Max ${GAMERPIC_MAX_PX}×${GAMERPIC_MAX_PX} px, ${formatBytes(GAMERPIC_MAX_BYTES)}. JPG, PNG, WebP, or GIF.`;
  }
  return `Max ${BANNER_MAX_WIDTH}×${BANNER_MAX_HEIGHT} px, ${formatBytes(BANNER_MAX_BYTES)}. JPG, PNG, or WebP.`;
}

export async function uploadProfileImage(user: User, kind: ProfileImageKind, file: File): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");

  const blob = await prepareImageBlob(file, kind);
  const bucket = kind === "gamerpic" ? "gamerpics" : "profile-banners";
  const objectPath = `${user.id}/${kind === "gamerpic" ? "avatar" : "banner"}.webp`;

  const { error } = await supabase.storage.from(bucket).upload(objectPath, blob, {
    upsert: true,
    contentType: "image/webp",
    cacheControl: "3600"
  });

  if (error) {
    if (/bucket.*not found/i.test(error.message)) {
      throw new Error("Profile image storage is not set up. Apply supabase/migrations/20260527150000_profile_storage.sql.");
    }
    throw new Error(error.message);
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
  const versioned = `${data.publicUrl}?v=${Date.now()}`;
  if (!isUploadedProfileImageUrl(versioned, user.id)) {
    throw new Error("Upload succeeded but the image URL could not be verified.");
  }
  return versioned;
}
