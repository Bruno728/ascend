const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const ALLOWED = (process.env.ALLOWED_ORIGIN || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
const IMG_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function reply(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body)
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'GET') {
    return reply(200, { ok: true, configured: Boolean(process.env.GEMINI_API_KEY), model: MODEL });
  }
  if (event.httpMethod !== 'POST') {
    return reply(405, { code: 'method', message: 'Método no permitido.' });
  }

  const headers = event.headers || {};
  const origin = headers.origin || '';
  if (ALLOWED.length && ALLOWED.indexOf(origin) === -1) {
    return reply(403, { code: 'forbidden', message: 'Este sitio no está autorizado a usar la IA.' });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return reply(500, { code: 'not_configured', message: 'Falta configurar la clave GEMINI_API_KEY en Netlify.' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return reply(400, { code: 'bad_request', message: 'La solicitud no es válida.' });
  }

  const msgs = (Array.isArray(body.messages) ? body.messages : []).slice(-24);
  if (!msgs.length) {
    return reply(400, { code: 'bad_request', message: 'No hay mensajes para enviar.' });
  }

  const contents = msgs.map(function (m) {
    return {
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content || '').slice(0, 6000) }]
    };
  });

  const img = (Array.isArray(body.images) ? body.images : [])[0];
  if (img) {
    if (IMG_TYPES.indexOf(img.mime) === -1 || typeof img.data !== 'string' || img.data.length > 8000000) {
      return reply(400, { code: 'image_rejected', message: 'La foto no es válida. Probá con una imagen JPG o PNG más chica.' });
    }
    const last = contents[contents.length - 1];
    last.parts = [{ inline_data: { mime_type: img.mime, data: img.data } }].concat(last.parts);
  }

  const generationConfig = { temperature: 0.6, maxOutputTokens: 1200 };
  if (body.json) {
    generationConfig.responseMimeType = 'application/json';
  }
  const payload = { contents: contents, generationConfig: generationConfig };
  if (typeof body.system === 'string' && body.system) {
    payload.systemInstruction = { parts: [{ text: body.system.slice(0, 6000) }] };
  }

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(MODEL) + ':generateContent';

  let r;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    return reply(502, { code: 'upstream', message: 'No pude conectarme con Gemini. Revisá tu conexión y probá de nuevo.' });
  }

  const data = await r.json().catch(function () { return {}; });
  if (r.status === 429) {
    return reply(429, { code: 'rate_limited', message: 'Se alcanzó el límite de uso de Gemini. Esperá un momento.' });
  }
  if (!r.ok) {
    return reply(502, { code: 'upstream', message: 'Gemini no respondió bien (código ' + r.status + '). Revisá el nombre del modelo y tu clave.' });
  }

  const cand = data.candidates && data.candidates[0];
  const parts = (cand && cand.content && cand.content.parts) || [];
  const text = parts.map(function (p) { return p.text || ''; }).join('').trim();
  if (!text) {
    return reply(502, { code: 'upstream', message: 'Gemini no devolvió texto. Probá de nuevo o reformulá la pregunta.' });
  }
  return reply(200, { text: text });
};
