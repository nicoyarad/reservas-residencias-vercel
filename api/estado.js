/**
 * Estado compartido del calendario de reservas.
 *
 *  GET  /api/estado          -> { rev, estado }
 *  POST /api/estado          -> { base, estado }  ->  { rev }
 *                               409 si otro guardó primero (devuelve rev y estado vigentes)
 *                               503 si no hay almacenamiento configurado
 *
 * Almacenamiento: usa Upstash Redis si están definidas KV_REST_API_URL y
 * KV_REST_API_TOKEN; si no, Vercel Blob con BLOB_READ_WRITE_TOKEN.
 */

const CLAVE = "calendario:estado";
const PREFIJO = "calendario/estado-";

/* Codigo de acceso: el guardado en el propio documento manda; la variable de
   entorno CODIGO_ACCESO funciona como respaldo maestro (si se olvida el otro). */
const CODIGO_MAESTRO = process.env.CODIGO_ACCESO || "1962";
function codigoEnviado(req) {
  const h = req.headers["x-codigo"];
  if (h) return String(h).trim();
  if (req.query && req.query.codigo) return String(req.query.codigo).trim();
  return "";
}
function codigoValido(v) {
  return typeof v === "string" && /^[0-9A-Za-z._-]{4,24}$/.test(v.trim());
}

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";

async function almacen() {
  if (REDIS_URL && REDIS_TOKEN) {
    const { Redis } = await import("@upstash/redis");
    const redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
    return {
      tipo: "redis",
      async leer() {
        const v = await redis.get(CLAVE);
        if (!v) return null;
        return typeof v === "string" ? JSON.parse(v) : v;
      },
      async escribir(doc) {
        await redis.set(CLAVE, JSON.stringify(doc));
      },
    };
  }

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put, list, del } = await import("@vercel/blob");
    const recientes = async () => {
      const { blobs } = await list({ prefix: PREFIJO });
      blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
      return blobs;
    };
    return {
      tipo: "blob",
      async leer() {
        const blobs = await recientes();
        if (!blobs.length) return null;
        const r = await fetch(blobs[0].url, { cache: "no-store" });
        if (!r.ok) return null;
        return await r.json();
      },
      async escribir(doc) {
        await put(PREFIJO + doc.rev + ".json", JSON.stringify(doc), {
          access: "public",
          contentType: "application/json",
          addRandomSuffix: false,
          allowOverwrite: true,
          cacheControlMaxAge: 0,
        });
        const blobs = await recientes();
        const viejos = blobs.slice(6);
        if (viejos.length) await del(viejos.map((b) => b.url));
      },
    };
  }

  return null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  const st = await almacen();
  if (!st) {
    return res.status(503).json({
      error: "sin_almacenamiento",
      mensaje:
        "Falta conectar un almacenamiento. En Vercel: Storage → Create Database → Blob (o Upstash for Redis), conectarlo al proyecto y volver a desplegar.",
    });
  }

  try {
    const doc0 = await st.leer();
    const vigente = doc0 && doc0.codigo ? String(doc0.codigo) : CODIGO_MAESTRO;
    const dado = codigoEnviado(req);
    if (!dado || (dado !== vigente && dado !== CODIGO_MAESTRO)) {
      return res.status(401).json({ error: "codigo_invalido" });
    }

    if (req.method === "GET") {
      return res.status(200).json({ rev: doc0 ? doc0.rev || 0 : 0, estado: doc0 ? doc0.estado : null });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      if (!body.estado || typeof body.estado !== "object") {
        return res.status(400).json({ error: "estado_invalido" });
      }
      const revActual = doc0 ? doc0.rev || 0 : 0;
      if (body.base != null && Number(body.base) !== revActual) {
        return res.status(409).json({ error: "conflicto", rev: revActual, estado: doc0 ? doc0.estado : null });
      }
      let codigo = vigente;
      if (body.codigoNuevo != null && String(body.codigoNuevo).trim() !== "") {
        if (!codigoValido(String(body.codigoNuevo))) {
          return res.status(400).json({ error: "codigo_no_valido", mensaje: "El codigo debe tener entre 4 y 24 caracteres (numeros o letras sin espacios)." });
        }
        codigo = String(body.codigoNuevo).trim();
      }
      const doc = { rev: Date.now(), codigo: codigo, estado: body.estado };
      await st.escribir(doc);
      return res.status(200).json({ rev: doc.rev, almacen: st.tipo, codigo: codigo });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "metodo_no_permitido" });
  } catch (e) {
    return res.status(500).json({ error: "fallo_almacenamiento", mensaje: String((e && e.message) || e) });
  }
}
