import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
      // Nettoyage des vieux salons (plus de 24h)
    try {
      const keys = await redis.keys('rooms/*');
      if (keys.length > 0) {
        const rooms = await redis.mget(...keys);
        for (let i = 0; i < keys.length; i++) {
          const room = rooms[i];
          if (room && room.ts) {
            const age = Date.now() - room.ts;
            if (age > 24 * 60 * 60 * 1000) { // 24 heures
              await redis.del(keys[i]);
              const roomCode = keys[i].replace('rooms/', '');
              const subKeys = await redis.keys('rooms/' + roomCode + '/*');
              if (subKeys.length > 0) await redis.del(...subKeys);
            }
          }
        }
      }
    } catch (e) {
      console.log('Nettoyage échoué :', e);
    }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    let body = req.method === 'POST'
      ? (typeof req.body === 'string' ? JSON.parse(req.body) : req.body)
      : { ...req.query };
    const op = body.op;
    if (op === 'get') {
      const v = await redis.get(body.path);
      return res.status(200).json({ exists: v !== null && v !== undefined, data: v ?? null });
    }
    if (op === 'set') { await redis.set(body.path, body.data); return res.status(200).json({ ok: true }); }
    if (op === 'update') {
      const cur = (await redis.get(body.path)) || {};
      await redis.set(body.path, { ...cur, ...body.data });
      return res.status(200).json({ ok: true });
    }
    if (op === 'delete') { await redis.del(body.path); return res.status(200).json({ ok: true }); }
    if (op === 'list') {
      const keys = await redis.keys(body.path + '/*');
      const items = [];
      if (keys.length) {
        const vals = await redis.mget(...keys);
        keys.forEach((k, i) => items.push({ id: k.substring(body.path.length + 1), data: vals[i] }));
      }
      return res.status(200).json(items);
    }
    if (op === 'watch') {
      const results = [];
      for (const item of (body.items || [])) {
        if (item.k === 'doc') {
          const v = await redis.get(item.p);
          results.push({ exists: v !== null && v !== undefined, data: v ?? null });
        } else {
          const keys = await redis.keys(item.p + '/*');
          const items = [];
          if (keys.length) {
            const vals = await redis.mget(...keys);
            keys.forEach((k, i) => items.push({ id: k.substring(item.p.length + 1), data: vals[i] }));
          }
          results.push(items);
        }
      }
      return res.status(200).json(results);
    }
    return res.status(400).json({ error: 'op inconnue' });
  } catch (err) {
    return res.status(500).json({ error: String((err && err.message) || err) });
  }
}
