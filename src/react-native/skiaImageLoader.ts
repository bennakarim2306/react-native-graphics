import { Skia } from '@shopify/react-native-skia';
import type { SkImage } from '@shopify/react-native-skia';
import { Image } from 'react-native';
import type { ImageLoader, LoadedImage } from '../assets/assets';

/** Sources the Skia loader understands. */
export type ImageSource =
  /** `require('./sprite.png')` (bundled asset). */
  | number
  /** A URI: `https://…`, `file://…`, `data:…`. */
  | string
  | { readonly uri: string }
  /** Encoded image bytes (PNG, JPEG, WebP). */
  | Uint8Array;

function toUri(source: unknown): string | null {
  if (typeof source === 'string') return source;
  if (typeof source === 'number') return Image.resolveAssetSource(source)?.uri ?? null;
  if (typeof source === 'object' && source !== null && typeof (source as { uri?: unknown }).uri === 'string') {
    return (source as { uri: string }).uri;
  }
  return null;
}

/**
 * Image loader backed by React Native Skia: resolves bundled assets with
 * `Image.resolveAssetSource`, fetches bytes with `Skia.Data.fromURI` and decodes them with
 * `Skia.Image.MakeImageFromEncoded`. `GameFXProvider` installs it on the engine's asset manager.
 */
export function createSkiaImageLoader(skia: typeof Skia = Skia): ImageLoader {
  return {
    async load(source: unknown, id: string): Promise<LoadedImage> {
      let data;
      if (source instanceof Uint8Array) {
        data = skia.Data.fromBytes(source);
      } else {
        const uri = toUri(source);
        if (!uri) throw new Error(`unsupported image source for "${id}"`);
        data = await skia.Data.fromURI(uri);
      }
      const image = skia.Image.MakeImageFromEncoded(data);
      if (!image) throw new Error('the image data could not be decoded');
      return { native: image, width: image.width(), height: image.height() };
    },
    release(native: unknown): void {
      (native as SkImage | undefined)?.dispose();
    },
  };
}
