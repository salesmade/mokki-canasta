import { api, body, send } from './_lib.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST vain' });
    send(res, await api().create(await body(req)));
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
}
