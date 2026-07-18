// Triviaali testifunktio: ei yhtään importtia. Diagnoosia varten.
export default function handler(req, res) {
  res.status(200).json({ ok: true, node: process.version });
}
