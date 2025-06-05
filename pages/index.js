export default function handler(req, res) {
  res.status(200).send('This is a backend-only project. Use POST /api/shopify-webhook.');
}
