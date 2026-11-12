/* global jest */
// Worklets and Reanimated ship official Jest mocks (shared values become plain objects).
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
