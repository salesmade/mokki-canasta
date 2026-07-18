// functions/ping.js
function handler(req, res) {
  res.status(200).json({ ok: true, node: process.version });
}
export {
  handler as default
};
