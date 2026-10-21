import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:net';
import type { Socket } from 'node:net';

/** A fresh child uses only Node built-ins and unmodified global fetch. No SDK mocks or credentials. */
async function probe(): Promise<void> {
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket);
    socket.once('close', () => { sockets.delete(socket); });
    socket.once('data', () => {
      // Six codings exceed fetch's five-coding limit; the declared body never arrives.
      socket.end('HTTP/1.1 200 OK\r\nContent-Length: 1\r\nContent-Encoding: gzip, gzip, gzip, gzip, gzip, gzip\r\nConnection: close\r\n\r\n');
    });
  });
  const watchdog = setTimeout(() => {
    for (const socket of sockets) {socket.destroy();}
    server.close();
    console.error('Runtime security probe exceeded its bounded loopback deadline');
    process.exit(70);
  }, 5_000);
  watchdog.unref();
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address !== null && typeof address !== 'string');
    await assert.rejects(globalThis.fetch(`http://127.0.0.1:${address.port}/runtime-security-probe`), error => {
      assert.ok(error instanceof TypeError && error.cause instanceof Error);
      assert.match(error.cause.message, /too many content-encodings/u);
      return true;
    });
    await new Promise<void>((resolve, reject) => {
      server.close(error => { if (error) {reject(error);} else {resolve();} });
    });
    console.log(JSON.stringify({ node: process.version, undici: process.versions.undici, mode: 'unmodified-global-fetch', rejectionCaught: true, serverClosed: true }));
  } finally {
    clearTimeout(watchdog);
    for (const socket of sockets) {socket.destroy();}
    server.close();
  }
}

assert.ok(process.argv[2] === undefined || process.argv[2] === '--child', 'Expected runtime-security-probe.ts [--child]');
if (process.argv[2] === '--child') {
  await probe();
} else {
  // The shared admitted capture boundary requires an actual zero exit, after all stream errors.
  const { command } = await import('./package-artifacts.ts');
  const output = await command(process.execPath, [import.meta.filename, '--child']);
  const result = JSON.parse(output) as { node: string; mode: string; rejectionCaught: boolean; serverClosed: boolean };
  assert.deepEqual([result.node, result.mode, result.rejectionCaught, result.serverClosed], [process.version, 'unmodified-global-fetch', true, true]);
  console.log(output.trim());
  console.log('Runtime security child completed with exit code 0');
}
