export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const url = process.env.VIDEO_WORKER_URL || '';
  const configured = /^https:\/\/[^\s]+$/.test(url);
  return res.status(200).json({ configured, workerUrl: configured ? url.replace(/\/$/, '') : '' });
}
