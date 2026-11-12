// Babel is only used by Jest to strip TypeScript. Type checking is done by `tsc`.
// Phase 3 is expected to switch to `@react-native/babel-preset` once RN rendering is added.
module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    '@babel/preset-typescript',
  ],
};
