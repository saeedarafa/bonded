// Entry mapped to `react-native-reanimated` in Jest. Kept separate from reanimated-mock.tsx
// (mapped to `react-native-reanimated/mock`): expo-router's test setup does
// jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock')), and if both
// names pointed at one file the factory would require itself.
export * from './reanimated-mock';
export { default } from './reanimated-mock';
