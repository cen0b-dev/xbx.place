/** Reference width for Xbox 360 box art; top strip is cropped at this scale. */
const COVER_REF_WIDTH = 280;
const COVER_CROP_TOP = 48;

const croppedCache = new Map<string, string>();

function cropTopForWidth(naturalWidth: number): number {
  if (!naturalWidth) return COVER_CROP_TOP;
  return Math.round(COVER_CROP_TOP * (naturalWidth / COVER_REF_WIDTH));
}

function rasterizeCroppedCover(image: HTMLImageElement): Promise<string | null> {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (!width || !height) return Promise.resolve(null);

  const cropTop = Math.min(cropTopForWidth(width), height - 1);
  const outHeight = height - cropTop;
  if (outHeight <= 0) return Promise.resolve(null);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = outHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);

  try {
    ctx.drawImage(image, 0, cropTop, width, outHeight, 0, 0, width, outHeight);
  } catch {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        resolve(URL.createObjectURL(blob));
      },
      "image/jpeg",
      0.92
    );
  });
}

function applyDisplayCrop(img: HTMLImageElement, cropped: boolean): void {
  img.classList.toggle("is-raster-cropped", cropped);
}

async function resolveCroppedSrc(rawSrc: string): Promise<{ src: string; rasterized: boolean }> {
  const cached = croppedCache.get(rawSrc);
  if (cached) return { src: cached, rasterized: true };

  return new Promise((resolve) => {
    const loader = new Image();
    loader.crossOrigin = "anonymous";
    loader.decoding = "async";
    loader.onload = () => {
      void rasterizeCroppedCover(loader).then((blobUrl) => {
        if (blobUrl) {
          croppedCache.set(rawSrc, blobUrl);
          resolve({ src: blobUrl, rasterized: true });
          return;
        }
        resolve({ src: rawSrc, rasterized: false });
      });
    };
    loader.onerror = () => resolve({ src: rawSrc, rasterized: false });
    loader.src = rawSrc;
  });
}

export function preloadCroppedCover(rawSrc: string): Promise<string> {
  return resolveCroppedSrc(rawSrc).then((result) => result.src);
}

/** Loads cover art, crops the top strip when possible, then assigns the result to `img`. */
export function bindCroppedCover(
  img: HTMLImageElement,
  rawSrc: string,
  callbacks: {
    onReady?: () => void;
    onError?: () => void;
    fallbackSrc?: string;
  } = {}
): void {
  img.crossOrigin = "anonymous";
  applyDisplayCrop(img, false);

  void resolveCroppedSrc(rawSrc)
    .then(({ src, rasterized }) => {
      img.src = src;
      applyDisplayCrop(img, rasterized);
      callbacks.onReady?.();
    })
    .catch(() => {
      if (callbacks.fallbackSrc) {
        img.src = callbacks.fallbackSrc;
        applyDisplayCrop(img, false);
      }
      callbacks.onError?.();
    });
}
