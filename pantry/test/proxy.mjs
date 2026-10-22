// A small pass-through proxy in front of the Firestore emulator that can hold back what the server says, so a test can make a phone
// whose connection is flaky in one direction (a VPN that buffers one of the two streams):
//   set({ write: true })   the server still gets and applies every write, but its acknowledgements never reach the phone
//                          (the phone thinks its change is waiting; the server already has it)
//   set({ listen: true })  the server's changes (and the confirmation that the phone's own write is now part of what it
//                          listens to) never reach the phone, while writes are acknowledged normally
//   set({ dropListen: true })  what the server says on the listen stream is thrown away (a dead stream: the phone never hears again on
//                          that connection, and nothing tells it); new connections made after `dropListen: false` work
//   set({ write: false, listen: false })  lets everything held through, in order
// The app is pointed at the proxy with ?emulator=<port>:9099 (cloud.js). Local emulator only; never a live project.
import http from 'node:http';

export function stallProxy(target = Number((process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085').split(':')[1]) || 8085) {
  const state = { write: false, listen: false, dropListen: false };
  const flushers = new Set(), sockets = new Set();
  const srv = http.createServer((req, res) => {
    const kind = /\/Write\//.test(req.url) ? 'write' : /\/Listen\//.test(req.url) ? 'listen' : 'other';
    const up = http.request({ host: '127.0.0.1', port: target, method: req.method, path: req.url, headers: req.headers, agent: false }, ur => {
      res.writeHead(ur.statusCode, ur.headers);
      const q = [];
      let ended = false;
      const stalled = () => (kind === 'write' && state.write) || (kind === 'listen' && state.listen);
      const flush = () => {
        while (q.length && !stalled()) res.write(q.shift());
        if (ended && !q.length) { flushers.delete(flush); res.end(); }
      };
      flushers.add(flush);
      ur.on('data', c => { if (kind === 'listen' && state.dropListen) return; q.push(c); flush(); });
      ur.on('end', () => { ended = true; flush(); });
      ur.on('error', () => res.destroy());
      res.on('close', () => flushers.delete(flush));
    });
    up.on('error', () => res.destroy());
    res.on('close', () => up.destroy());
    req.pipe(up);
  });
  srv.on('connection', c => { sockets.add(c); c.on('close', () => sockets.delete(c)); });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({
    port: srv.address().port,
    set(o) { Object.assign(state, o); for (const f of [...flushers]) f(); },
    close() { for (const f of flushers) f(); for (const c of sockets) c.destroy(); srv.close(); },
  })));
}
