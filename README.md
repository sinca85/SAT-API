# SAT API

Backend central para leads, usuarios, roles e integraciones de Seguro a Tiempo.

## Base incluida

- MongoDB mediante Mongoose.
- Sesiones persistidas en MongoDB y cookie `httpOnly`.
- Login exclusivo con Google OAuth.
- Estados de usuario: `pending`, `active` y `disabled`.
- Roles: `admin` y `user`.
- Administración de usuarios protegida por rol.
- Cliente base para la API de HighLevel.
- Captura de leads del cotizador Hogar y sincronización con HighLevel.

## Desarrollo

```bash
cp .env.example .env
npm install
npm run dev
```

El endpoint inicial de diagnóstico es `GET /health`.

Las credenciales de HighLevel deben guardarse únicamente en `.env` o en el gestor de secretos del hosting. Nunca deben enviarse al frontend.

## Vercel

El proyecto exporta Express como una Vercel Function y conserva `app.listen()` únicamente para desarrollo local. Antes de probar el deployment, cargá en Vercel las variables de `.env.example`, especialmente `MONGODB_URI` y `SESSION_SECRET`.

## Primer administrador

Configurá `BOOTSTRAP_ADMIN_EMAILS` con uno o más correos de Google separados por comas. Cuando uno de esos correos inicia sesión, se crea o actualiza automáticamente como usuario `active` con rol `admin`.

Los demás correos se crean con estado `pending`. Un administrador puede habilitarlos con:

```http
PATCH /admin/users/:userId
Content-Type: application/json

{ "status": "active", "role": "user" }
```

## Endpoints de autenticación

- `GET /auth/google`
- `GET /auth/google/callback`
- `GET /auth/me`
- `POST /auth/logout`
- `GET /admin/users`
- `PATCH /admin/users/:userId`
- `POST /leads/home`
- `GET /admin/leads`
- `PATCH /admin/leads/:leadId`
- `POST /admin/leads/:leadId/notes`

## Leads de Hogar

Las solicitudes del cotizador se guardan con el source inmutable `2016_08_allianz_hogar`. La API crea o actualiza el contacto de HighLevel sin reemplazar sus tags existentes. Si se configuran `HIGHLEVEL_PIPELINE_ID` y `HIGHLEVEL_PIPELINE_STAGE_ID`, también crea la oportunidad asociada; sin esos valores, el contacto queda sincronizado y la oportunidad pendiente de configuración.
