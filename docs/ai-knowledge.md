# AI Knowledge / RAG

El módulo convive con `FAQs` y no modifica sus datos. Cada configuración se identifica públicamente por `slug`; el backend filtra los chunks por esa configuración antes de calcular similitud.

Configurar `GEMINI_API_KEY` solamente en Vercel. El provider está encapsulado en `src/integrations/ai`.

Endpoints administrativos (autenticación activa y permiso `ai.view`; mutaciones requieren `ai.manage`): `GET/POST /admin/ai/configurations`, `PATCH/DELETE /admin/ai/configurations/:configurationId`, `POST /admin/ai/configurations/:configurationId/documents` (multipart `file` PDF) y `GET /admin/ai/documents/:configurationId`.

Endpoints públicos: `GET /api/ai/chat/:slug/config` y `POST /api/ai/chat/:slug` con `{ "question": "..." }`. Solo devuelven respuesta y fuentes resumidas.

Por defecto se permiten 5 consultas por minuto por IP/configuración, preguntas de hasta 500 caracteres y PDFs de hasta 10 MiB. La cache usa configuración, pregunta normalizada y `knowledgeVersion`.

Vercel no ofrece disco local persistente; el PDF se procesa en memoria y se conserva metadata, texto, páginas y embeddings en Mongo. Para binarios persistentes habrá que conectar Vercel Blob, S3 u otro almacenamiento aprobado.

El widget reutilizable está en `landings/src/SatAIWidget.tsx` y se usa con `<SatAIWidget slug="allianz-hogar" />`.
