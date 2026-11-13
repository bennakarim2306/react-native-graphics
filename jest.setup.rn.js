/* global jest */
// Worklets and Reanimated ship official Jest mocks (shared values become plain objects).
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => {
  const mock = require('react-native-reanimated/mock');
  const { useRef } = require('react');
  return {
    ...mock,
    // The official mock creates a new shared value on every render; the real hook returns the
    // same one for the component's lifetime. Keep it stable so animated styles (re-evaluated on
    // each render by the mock) show values written from outside React, as on a device.
    useSharedValue: (init) => {
      const ref = useRef(null);
      if (ref.current === null) ref.current = mock.useSharedValue(init);
      return ref.current;
    },
  };
});
