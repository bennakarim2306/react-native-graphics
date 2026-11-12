import { SDK_VERSION } from './index';
import packageJson from '../package.json';

describe('package entry point', () => {
  it('exports a version that matches package.json', () => {
    expect(SDK_VERSION).toBe(packageJson.version);
  });
});
