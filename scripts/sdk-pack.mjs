// Shared helpers for the scripts that build, pack and install the SDK tarball.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Quotes one argument for cmd.exe. Without quotes cmd.exe splits a path at its spaces
 * (`C:\Program Files\nodejs\node.exe` becomes the command `C:\Program`).
 */
const quoteForCmd = (arg) => (/^[\w.,/:\\=@+-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '""')}"`);

/**
 * How to start a command. Node, tar and other executables start directly, with no shell, so
 * paths with spaces and code passed with `-e` reach them unchanged. npm is a .cmd file on
 * Windows, which Node starts only through cmd.exe. Under `npm run`, npm_execpath names npm's
 * JavaScript entry point, which this Node runs directly; otherwise cmd.exe gets a quoted command.
 */
export function commandLine(command, args, platform = process.platform, env = process.env) {
  if (command === 'npm' && env.npm_execpath && /npm-cli\.[cm]?js$/.test(env.npm_execpath)) {
    return { file: process.execPath, args: [env.npm_execpath, ...args], shell: false };
  }
  if (command === 'npm' && platform === 'win32') {
    return { file: [command, ...args].map(quoteForCmd).join(' '), args: [], shell: true };
  }
  return { file: command, args, shell: false };
}

/** Runs a command and throws when it fails. */
export function run(command, args, options = {}) {
  const line = commandLine(command, args);
  const result = spawnSync(line.file, line.args, {
    stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
    shell: line.shell,
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...options.env },
  });
  if (result.error) throw new Error(`${command} could not be started: ${result.error.message}`);
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
