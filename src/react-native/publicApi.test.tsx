import publicApi from '../../scripts/public-api.json';
import * as sdk from '../index';

describe('public entry point', () => {
  it('exports exactly the names listed in scripts/public-api.json', () => {
    // A deliberate API change regenerates the list: node scripts/public-api.mjs --write
    expect(Object.keys(sdk).sort()).toEqual(publicApi.index.values);
  });

  it('includes the React Native integration and the error classes apps catch', () => {
    for (const name of ['GameFXProvider', 'GameFXOverlay', 'GameFXTarget', 'useGameFX', 'InvalidOptionError', 'DisposedError', 'NotReadyError', 'AssetLoadError']) {
      expect(sdk).toHaveProperty(name);
    }
  });
});
