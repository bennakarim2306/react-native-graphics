import packageJson from '../package.json';
import * as core from './core';
import { SDK_VERSION } from './version';

describe('package entry points', () => {
  it('exports a version that matches package.json', () => {
    expect(SDK_VERSION).toBe(packageJson.version);
  });

  it('exposes the platform-independent engine from ./core', () => {
    expect(typeof core.createEngine).toBe('function');
    expect(typeof core.VirtualClock).toBe('function');
    expect(core.particleBurst.name).toBe('particle-burst');
    expect(core.builtInEffects.map((e) => e.name)).toEqual(['particle-burst']);
  });
});
