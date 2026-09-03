import { Router } from 'express';
import { currentUser, requireAuth } from '../../middleware/auth';
import { subscribeToUser, type RealtimeEvent } from '../../services/events';
import { subLogger } from '../../lib/logger';

const log = subLogger('sse');

/** Proxies and load balancers drop idle connections; keep it warm. */
const HEARTBEAT_MS = 25_000;

export const eventsRouter = Router();

/**
 * Server-Sent Events stream.
 *
 * SSE rather than WebSockets, deliberately:
 *   - The data only ever flows server -> client, so a duplex protocol buys
 *     nothing while costing an extra handshake and a heavier client.
 *   - It rides on plain HTTP, so the existing cookie auth and CORS setup apply
 *     unchanged - no separate token exchange for the socket.
 *   - `EventSource` reconnects automatically, so a worker restart or a laptop
 *     waking from sleep repairs itself with no client-side retry logic.
 *
 * The dashboard therefore does zero polling: rows change status in place as
 * the worker publishes.
 */
eventsRouter.get('/', requireAuth, (req, res) => {
  const user = currentUser(req);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    // `no-transform` stops intermediaries from buffering the stream, which
    // would defeat the point.
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (event: RealtimeEvent) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  };

  // Tell the client we are live before anything else happens.
  send({ type: 'ping', at: new Date().toISOString() });

  const unsubscribe = subscribeToUser(user.id, send);

  const heartbeat = setInterval(() => {
    // A comment frame is enough to keep the socket alive without the client
    // having to handle a message.
    res.write(`: heartbeat ${Date.now()}\n\n`);
  }, HEARTBEAT_MS);

  log.debug({ userId: user.id }, 'SSE client connected');

  req.on('close', () => {
    clearInterval(heartbeat);
    void unsubscribe();
    res.end();
    log.debug({ userId: user.id }, 'SSE client disconnected');
  });
});
