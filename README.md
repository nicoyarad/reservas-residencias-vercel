# Reservas de residencias — Acperforaciones

Calendario diario compartido para reservar residencias, casas de faena y otros
destinos. Filas = lugares, columnas = días. Cada persona se anota con un rango
de fechas, adultos y niños. El contador diario suma adultos (A) y niños (N) por
separado y marca en rojo los días que exceden el cupo de cada lugar.

Aplicación de un solo archivo (`index.html`) más una función serverless
(`api/estado.js`) que guarda el estado compartido.

---

## 1. Subir el proyecto a Vercel

**Opción A — arrastrar la carpeta (más simple)**

1. Descomprimir el ZIP.
2. Ir a vercel.com → **Add New…** → **Project** → pestaña de importación manual
   y arrastrar la carpeta completa (debe contener `index.html`, `package.json`,
   `vercel.json` y la carpeta `api/`).
3. Framework Preset: **Other**. No definir Build Command ni Output Directory.
4. **Deploy**.

**Opción B — Vercel CLI**

    npm i -g vercel
    cd <carpeta del proyecto>
    vercel            # despliegue de prueba
    vercel --prod     # despliegue de producción

**Opción C — repositorio Git**

Subir la carpeta a un repositorio (GitHub/GitLab/Bitbucket) e importarlo desde
Vercel. Cada push a la rama de producción vuelve a desplegar automáticamente.

---

## 2. Conectar el almacenamiento (obligatorio)

Sin almacenamiento la aplicación abre y funciona, pero **no guarda nada** y
muestra el aviso «Almacenamiento no configurado».

1. Panel de Vercel → el proyecto → pestaña **Storage** → **Create Database**.
2. En *Marketplace Database Providers*: **Upstash** → **Serverless DB (Redis)**
   → Continue. Aceptar términos, plan **Free**, región **sa-east-1 (São Paulo)**
   por cercanía a Chile → Create.
   *Alternativa de primera parte: elegir **Blob** en lugar de Upstash; el código
   soporta ambos. Redis maneja mejor las ediciones simultáneas.*
3. **Connect to Project** → el proyecto, entornos Production / Preview /
   Development.
4. **Deployments** → último despliegue → menú ⋯ → **Redeploy**.

Vercel inyecta las variables solo. El código acepta:

| Almacenamiento | Variables |
|---|---|
| Upstash Redis | `KV_REST_API_URL` + `KV_REST_API_TOKEN`, o `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` |
| Vercel Blob | `BLOB_READ_WRITE_TOKEN` |

Redis tiene prioridad si ambas están presentes.

---

## 3. Código de acceso

- Valor inicial: **1962**.
- Se cambia desde la propia aplicación: **Configurar → Código de acceso**
  (4 a 24 caracteres, números o letras sin espacios). Queda guardado junto al
  calendario y rige para todos.
- Respaldo maestro opcional: definir la variable de entorno **`CODIGO_ACCESO`**
  en Vercel (Settings → Environment Variables). Ese valor siempre es válido,
  incluso si el código de la aplicación se pierde. Si no se define, el maestro
  es 1962.
- Recomendación: definir `CODIGO_ACCESO` con un valor distinto del que circula
  entre el personal, para separar el respaldo del código de uso diario.
- Alcance: es una clave compartida, suficiente para evitar accesos casuales a
  una URL pública. No identifica quién hizo cada cambio.

---

## 4. Formato CSV de importación

    Lugar;Cupo;Asistente;Adultos;Ninos;Total personas;Desde;Hasta;Dias;Nota
    Residencia A;4;J. Pérez;2;1;3;2026-09-01;2026-09-07;7;Turno día

- Obligatorias: **Lugar**, **Asistente**, **Desde**. El resto es opcional
  (Adultos por defecto 1, Niños 0).
- Separador punto y coma, coma o tabulación, detectado automáticamente.
- Fechas en AAAA-MM-DD o DD-MM-AAAA. **Hasta** vacío = reserva sin fecha de
  término.
- Encabezados flexibles: reconoce Destino/Residencia, Persona/Nombre,
  Entrada/Salida, Menores, Capacidad, Observaciones.
- Los lugares que no existan se crean automáticamente.
- «Total personas» y «Dias» se ignoran al importar (se recalculan).
- La exportación usa las mismas columnas: un archivo exportado se puede
  reimportar.

---

## 5. Estructura y funcionamiento

    index.html        aplicación completa (HTML + CSS + JS en un archivo)
    api/estado.js     función serverless: lectura y escritura del estado
    package.json      dependencias (@upstash/redis, @vercel/blob)
    vercel.json       cabeceras sin caché para /api
    README.md         este archivo

**API**

    GET  /api/estado    cabecera x-codigo -> { rev, estado }
    POST /api/estado    cabecera x-codigo, cuerpo { base, estado, codigoNuevo? }
                        401 código ausente o incorrecto
                        409 otro guardó primero (devuelve rev y estado vigentes)
                        503 sin almacenamiento configurado

**Concurrencia.** Cada guardado envía la revisión (`rev`) sobre la que se
trabajó. Si otra persona guardó primero, la API responde 409 y la página se
actualiza con la versión del servidor avisando al usuario. Además sincroniza
cada 15 segundos y al volver a la pestaña.

**Datos iniciales.** El archivo trae 3 lugares y 4 reservas de ejemplo. Se
eliminan desde Configurar (quitar lugares y «Borrar todas las reservas»).
