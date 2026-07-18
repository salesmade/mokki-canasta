import { api, send } from './_lib.js';

// GET /api/state?code=XXXX&seat=0  -> pollattava sensuroitu näkymä.
export default async function handler(req, res) {
  try {
    const { code, seat } = req.query || {};
    send(res, await api().state({ code, seat }));
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
}
