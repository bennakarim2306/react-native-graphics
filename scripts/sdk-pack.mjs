// Shared helpers for the scripts that build, pack and install the SDK tarball.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Runs a command and throws when it fails. npm is a .cmd file on Windows, hence the shell there. */
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
    shell: process.platform === 'win32',
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...options.env },
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${String(result.status)}`);
  }
  return result.stdout ?? '';
}

/** Builds lib/ from src/. */
export function buildSdk() {
  run(process.execPath, [join(repoRoot, 'scripts/build.mjs')]);
}

/**
 * Packs the SDK with `npm pack` into `destination`, after removing older SDK tarballs there.
 * Returns the absolute path of the new tarball and npm's description of its contents.
 */
export function packSdk(destination) {
  mkdirSync(destination, { recursive: true });
  for (const name of readdirSync(destination)) {
    if (/^react-native-graphics-.*\.tgz$/.test(name)) rmSync(join(destination, name));
  }
  // --ignore-scripts: the tarball is exactly what `files` selects from the current lib/.
  const output = run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', destination], { capture: true });
  const [info] = JSON.parse(output);
  return { tarball: join(destination, info.filename), info };
}
