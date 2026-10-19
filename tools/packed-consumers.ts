import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { command, packPackages, pnpm, repository } from './package-artifacts.ts';

const tarballs = await packPackages();
const root = await mkdtemp(join(tmpdir(), 'payments-packed-'));
const compiler = join(repository, 'node_modules/typescript/bin/tsc');
const profiles = ['NodeNext', 'Bundler'] as const;
const report = [];
try {
  for (const plain of [true, false]) {
    const target = join(root, plain ? 'plain' : 'adapters');
    await mkdir(target);
    const dependencies: Record<string, string> = {};
    for (const [name, tarball] of tarballs) {
      if (!plain || name === '@agent-teams/payments-core') dependencies[name] = `file:${tarball}`;
    }
    if (!plain) Object.assign(dependencies, {
      '@get-modular/core': '0.5.0',
      '@get-modular/assembly': '0.5.0',
      '@get-modular/resources': '0.1.0',
    });
    await writeFile(join(target, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies, packageManager: 'pnpm@11.25.0' }));
    // Every internal transitive dependency must resolve to this build, before these versions
    // exist in a registry. pnpm 11 reads overrides from the workspace file, not package.json.
    const overrides = Object.entries(dependencies).filter(([name]) => name.startsWith('@agent-teams/payments-'));
    await writeFile(join(target, 'pnpm-workspace.yaml'), `overrides:\n${overrides.map(([name, value]) => `  ${JSON.stringify(name)}: ${JSON.stringify(value)}`).join('\n')}\n  "@types/node": "24.13.3"\n`);
    pnpm(['install', '--offline', '--ignore-scripts', '--lockfile=false', '--strict-peer-dependencies'], target);
    const source = Object.keys(dependencies).filter((name) => name.startsWith('@agent-teams/payments-')).map((name, index) => `import * as api${index} from '${name}';\nvoid api${index};`).join('\n');
    await writeFile(join(target, 'index.ts'), source);
    for (const profile of profiles) {
      await writeFile(join(target, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
        target: 'ES2024', module: profile === 'Bundler' ? 'ESNext' : 'NodeNext', moduleResolution: profile,
        strict: true, skipLibCheck: false, noEmit: true, types: [],
      }, include: ['index.ts'] }));
      command(process.execPath, [compiler, '-p', 'tsconfig.json'], target);
      report.push({ consumer: plain ? 'plain' : 'adapters', resolution: profile, passed: true });
    }
    command(process.execPath, ['--input-type=module', '-e', source], target);
    if (plain) {
      command(process.execPath, ['--input-type=module', '-e', "for (const dependency of ['@get-modular/core','@paddle/paddle-node-sdk','pg','@agent-teams/engineering-foundation']) { try { import.meta.resolve(dependency); throw new Error('Unexpected optional dependency '+dependency); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; } }"], target);
    } else {
      // The installed peer graph must resolve one physical Resources copy for every GM consumer.
      const expected = command(process.execPath, ['--input-type=module', '-e', "import {realpathSync} from 'node:fs'; import {fileURLToPath} from 'node:url'; console.log(realpathSync(fileURLToPath(import.meta.resolve('@get-modular/resources'))));"], target).trim();
      const packageManifest = JSON.parse(await readFile(join(target, 'node_modules/@agent-teams/payments-get-modular/package.json'), 'utf8')) as { name: string };
      assert.equal(packageManifest.name, '@agent-teams/payments-get-modular');
      const observed = command(process.execPath, ['--input-type=module', '-e', "import {createRequire} from 'node:module'; import {realpathSync} from 'node:fs'; const require=createRequire(import.meta.resolve('@agent-teams/payments-get-modular')); console.log(realpathSync(require.resolve('@get-modular/resources')));"], target).trim();
      assert.equal(observed, expected, 'GM integration and host must share the same physical Resources package');
    }
  }
  await mkdir(join(repository, '.artifacts'), { recursive: true });
  await writeFile(join(repository, '.artifacts/packed-consumers.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
