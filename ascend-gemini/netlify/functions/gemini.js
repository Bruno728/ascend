// Función de Netlify: recibe el chat o la foto desde la app y consulta Gemini.
// La clave GEMINI_API_KEY vive solo en Netlify (variables de entorno), nunca en la página.
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const ALLOWED = (process.env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
const IMG_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const reply = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod === 'GET') {
    return reply(200, { ok: true, configured: Boolean(process.env.GEMINI_API_KEY), model: MODEL });
  }
  if (event.httpMethod !== 'POST') return reply(405, { code: 'method', message: 'Método no permitido.' });

  const origin = (event.headers || {}).origin || '';
  if (ALLOWED.length && !ALLOWED.includes(origin)) {
    return reply(403, { code: 'forbidden', message: 'Este sitio no está autorizado a usar la IA.' });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) return reply(500, { code: 'not_configured', message: 'Falta configurar la clave GEMINI_API_KEY en Netlify.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return reply(400, { code: 'bad_request', message: 'La solicitud no es válida.' }); }

  const msgs = (Array.isArray(body.messages) ? body.messages : []).slice(-24);
  if (!msgs.length) return reply(400, { code: 'bad_request', message: 'No hay mensajes para enviar.' });

  const contents = msgs.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(m.content || '').slice(0, 6000) }],
  }));

  const img = (Array.isArray(body.images) ? body.images : [])[0];
  if (img) {
    if (!IMG_TYPES.includes(img.mime) || typeof img.data !== 'string' || img.data.length > 8000000) {
      return reply(400, { code: 'image_rejected', message: 'La foto no es válida. Probá con una imagen JPG o PNG más chica.' });
    }
    const last = contents[contents.length - 1];
    last.parts = [{ inline_data: { mime_type: img.mime, data: img.data } }, ...last.parts];
  }

  const generationConfig = { temperature: 0.6, maxOutputTokens: 1200 };
  if (body.json) generationConfig.responseMimeType = 'application/json';
  const payload = { contents, generationConfig };
  if (typeof body.system === 'string' && body.system) {
    payload.systemInstruction = { parts: [{ text: body.system.slice(0, 6000) }] };
  }

  let r;
  try {
    r = await fetch(https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return reply(502, { code: 'upstream', message: 'No pude conectarme con Gemini. Revisá tu conexión y probá de nuevo.' });
  }

  const data = await r.json().catch(() => ({}));
  if (r.status === 429) return reply(429, { code: 'rate_limited', message: 'Se alcanzó el límite de uso de Gemini. Esperá un momento.' });
  if (!r.ok) return reply(502, { code: 'upstream', message: Gemini no respondió bien (código ${r.status}). Revisá el nombre del modelo y tu clave. });

  const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  const text = parts.map(p => p.text || '').join('').trim();
  if (!text) return reply(502, { code: 'upstream', message: 'Gemini no devolvió texto. Probá de nuevo o reformulá la pregunta.' });
  return reply(200, { text });
};
