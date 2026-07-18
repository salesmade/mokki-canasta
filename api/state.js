import { api, run } from './_lib.js';
export default async function handler(req, res) {
  const { code, seat } = req.query || {};
  run(res, async () => (await api()).state({ code, seat }));
}
