import { createServer, connect } from 'node:net';
import type { Socket } from 'node:net';
/** A real PostgreSQL wire proxy. It loses replies after the server actually confirms COMMIT. */
export async function postgresFaultProxy(connectionString: string) {
  const target = new URL(connectionString);
  const upstreamHost = target.hostname, upstreamPort = Number(target.port || 5432);
  const sockets = new Set<Socket>();
  let dropCommit = false, blackhole = false;
  const server = createServer(client => {
    const upstream = connect({ host: upstreamHost, port: upstreamPort });
    sockets.add(client); sockets.add(upstream);
    let loseThisCommit = false;
    client.on('data', data => {
      // COMMIT is an unparameterized simple-query message. Parameterized statements are passed
      // byte-for-byte; this fixture never substitutes their result or intercepts application data.
      if (dropCommit && data[0] === 0x51 && data.subarray(5).toString('utf8').replace(/\0$/u, '').trim() === 'COMMIT') {
        dropCommit = false; loseThisCommit = true;
      }
      upstream.write(data);
    });
    upstream.on('data', data => {
      if (blackhole) {return;}
      if (loseThisCommit && data.includes(Buffer.from('COMMIT\0'))) {
        loseThisCommit = false; client.destroy(); upstream.destroy(); return;
      }
      if (!loseThisCommit) {client.write(data);}
    });
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => { if (!blackhole) {client.destroy();} });
    client.on('close', () => { sockets.delete(client); upstream.destroy(); });
    upstream.on('close', () => { sockets.delete(upstream); if (!blackhole) {client.destroy();} });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (address === null || typeof address === 'string') {throw new Error('Proxy listener has no address');}
  target.hostname = '127.0.0.1'; target.port = String(address.port);
  return {
    connectionString: target.toString(),
    loseNextCommit() { dropCommit = true; },
    blackholeReplies(value: boolean) { blackhole = value; },
    async close() {
      for (const socket of sockets) {socket.destroy();}
      await new Promise<void>((resolve, reject) => { server.close(error => { if (error) {reject(error);} else {resolve();} }); });
    },
  };
}
