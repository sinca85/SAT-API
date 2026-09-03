# SAT API

Backend central para leads, usuarios, roles e integraciones de Seguro a Tiempo.

## Desarrollo

```bash
cp .env.example .env
npm install
npm run dev
```

El endpoint inicial de diagnóstico es `GET /health`.

Las credenciales de HighLevel deben guardarse únicamente en `.env` o en el gestor de secretos del hosting. Nunca deben enviarse al frontend.
