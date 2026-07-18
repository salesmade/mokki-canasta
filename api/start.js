import { api, body, run } from './_lib.js';
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST vain' });
  run(res, async () => (await api()).start(await body(req)));
}
