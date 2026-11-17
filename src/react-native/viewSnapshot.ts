import { makeImageFromView } from '@shopify/react-native-skia';
import type { Component, RefObject } from 'react';
import { Platform } from 'react-native';
import type { LoadedImage } from '../assets/assets';

/**
 * Whether views can be captured as images here. React Native Skia captures native views on iOS
 * and Android; on the web it needs a callback that renders the DOM, which the SDK does not ship,
 * so effects that need a picture (burn-away) use their fallback there.
 */
export function canSnapshotViews(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

/**
 * Captures a mounted view (with its children, untransformed, in physical pixels) as a Skia
 * image. The view must not be collapsed by the platform (`collapsable={false}`).
 */
export async function snapshotView(ref: RefObject<unknown>): Promise<LoadedImage> {
  // Skia only needs the native tag behind the ref, whatever component type holds it.
  const image = await makeImageFromView(ref as RefObject<Component<unknown, unknown> | null>);
  if (!image) throw new Error('The view could not be captured.');
  return { native: image, width: image.width(), height: image.height() };
}
