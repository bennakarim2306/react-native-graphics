/* global CanvasKit */
// Skia's Jest environment loads CanvasKit in the outer Node realm, but test code runs in Jest's
// VM realm. CanvasKit checks gradient color lists with `instanceof Array`, which is false for
// arrays created in another realm, so gradients would throw in tests only (React Native's JSI
// accepts plain arrays). Copy array arguments into the outer realm before calling CanvasKit.
const OuterArray = CanvasKit.getColorComponents(CanvasKit.BLACK).constructor;
for (const name of ['MakeLinearGradient', 'MakeRadialGradient', 'MakeTwoPointConicalGradient', 'MakeSweepGradient']) {
  const original = CanvasKit.Shader[name];
  if (typeof original !== 'function' || original.__realmShim) continue;
  const shim = (...args) => original.apply(CanvasKit.Shader, args.map((a) => (Array.isArray(a) ? OuterArray.from(a) : a)));
  shim.__realmShim = true;
  CanvasKit.Shader[name] = shim;
}
