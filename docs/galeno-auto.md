# Auto Galeno: análisis y base de cotización

Fuente: “Servicios REST - Galeno Seguros v9.5 Final.pdf”, versión 9.5 del 31/01/2024, provisto por el usuario. Análisis realizado el 23/09/2026. No se validaron los servicios contra un ambiente de Galeno. El documento también incluye motos, ART, emisión y consultas; el alcance elegido aquí es exclusivamente cotización de automotores (rama 4).

## Implementación actual: sandbox

- Landing `/auto` con HTML propio, mismo header visual y componente de footer de Hogar. Consulta catálogos de Galeno mediante el backend y muestra las coberturas e importes devueltos por el sandbox. Se retiró el catálogo ficticio. Si faltan credenciales o parámetros, muestra estado no disponible; no vuelve a precios ni vehículos de demostración.
- El usuario completa vehículo, año, versión, 0 km, código postal/localidad, vigencia, GNC y nombre/razón social opcional. **No elige persona, uso, IVA, IIBB ni condiciones de pago.** El backend toma esos valores del panel y rechaza propiedades adicionales en el payload público.
- Panel `Landings → Auto`, ruta `/landings/auto`: usuario y contraseña de Galeno; botón para guardar acceso y cargar catálogos; selectores de productor/plan, facturación, cuotas, medio de pago, tipo de persona, uso, IVA e IIBB. Los catálogos son del usuario conectado; no se inventan códigos para “semestral” o “débito”. Cambiar plan o facturación limpia los valores dependientes.
- Sandbox fijo: `https://www.gsbeneficios.com.ar/WS-Seguros-desa`. La API rechaza cualquier otro destino y no sigue redirects. Utiliza la autorización Basic de pruebas de la página 9 del PDF; el panel permite reemplazarla si Galeno entrega otra. No hay ruta de emisión ni consulta de pólizas.
- Credenciales cifradas con AES-256-GCM. Clave del servidor `GALENO_SETTINGS_ENCRYPTION_KEY`: 32 bytes, representados como 64 caracteres hexadecimales. No ponerla en variables VITE. Guardarla en un gestor de secretos y conservarla; cambiarla sin migrar invalida los secretos y tokens guardados. Los campos vacíos conservan credenciales previas. Ninguna respuesta devuelve secretos, tampoco cifrados. Sin clave se puede guardar el resto de la configuración, pero no las credenciales.
- Sesiones compartidas en la colección `galenosessions`, con token cifrado, vencimiento y bloqueo de renovación por usuario. Evita que distintas instancias invaliden mutuamente sus tokens. Un 401 permite una única renovación/reintento; un timeout de cotización no se reintenta automáticamente.
- Preferencias de emails conservadas para una etapa posterior. **En sandbox no se envían emails**, no se guarda el contacto y no se emiten pólizas.
- `analyticsEnabled` es independiente y por defecto `false`. OFF: no se cargan etiquetas de Google Analytics ni Meta Pixel. ON: Measurement ID general (fallback existente G-WSQ0X7LXTC) y Pixel 1378259864357969, con eventos `auto_vehicle_completed` y `auto_quote_completed`. No incluyen datos personales. La configuración pública usa `Cache-Control: no-store`; los cambios se aplican al recargar la landing. Un fallo de carga de configuración mantiene Analytics apagado. El HTML de Auto no tiene etiquetas estáticas.
- El código original del formulario, estilos, footer, HTML y tracking de Hogar permanece intacto. Se agrega una segunda entrada al build y únicamente rewrites de Auto.
- No se hizo push, despliegue ni escritura en la base de producción durante la implementación.

### Endpoints

| Endpoint | Acceso | Función |
| --- | --- | --- |
| GET /admin/auto | landings.view | Configuración privada sin secretos |
| PATCH /admin/auto | landings.manage | Guardar parámetros y credenciales cifradas |
| POST /admin/auto/catalogs | landings.manage | Conectar y cargar opciones del productor |
| GET /api/auto/config | Público | Disponibilidad, tipo de persona y Analytics; no expone usuario, plan ni secretos |
| GET /api/auto/catalog | Público | Marcas, modelos, años, versiones y localidades |
| POST /api/auto/quote | Público | Validar catálogos y cotizar con los valores del panel |

El router público incluye protección básica de ráfagas por IP y proceso (100 lecturas / 8 cotizaciones por minuto). No equivale a un límite distribuido global.

### Habilitación del sandbox

1. Configurar `GALENO_SETTINGS_ENCRYPTION_KEY` en el servidor de API y conectar MongoDB del ambiente correspondiente.
2. Entrar a Landings → Auto e ingresar usuario y contraseña del API; dejar Analytics OFF.
3. Usar “Guardar acceso y cargar opciones”. Si Galeno rechaza el acceso, confirmar credenciales, autorización Basic e IP pública de salida autorizada.
4. Elegir productor/plan, facturación, cuotas, medio de pago, tipo de persona, uso y condición fiscal. Guardar la configuración.
5. Probar `/auto` con un vehículo válido del catálogo, verificar los importes contra Galeno y probar casos sin cobertura.

## Identificación del vehículo: no requiere una tabla InfoAuto externa

Páginas 13–15 y 25:

1. `GET /api/cotizadores/auto/marcas?rama=4`
2. `GET /api/cotizadores/auto/modelos/{codigoMarca}`
3. `GET /api/cotizadores/auto/anios/{codigoMarca}/{codigoModelo}`
4. `GET /api/cotizadores/auto/submodelos/{codigoMarca}/{codigoModelo}/{anio}`

El último endpoint devuelve `version`, `codigoMarca`, `codigoModelo` y `codigoSubModelo`. **El modelo textual usado en la navegación no es el código numérico del modelo para cotizar**: hay que usar los códigos de la versión seleccionada. `idInfoAuto` es una alternativa a esos tres códigos, no un campo obligatorio adicional. Solo se utilizan códigos devueltos por el catálogo de Galeno.

## Datos mínimos y condicionales

Páginas 24–26, `POST /api/cotizadores/auto/cotizar`:

| Dato | Exigencia del PDF | Origen previsto |
| --- | --- | --- |
| `rama` | Obligatorio, 4 | Backend |
| `tipoPolizaCodigo` | Obligatorio, AUT01 | Backend |
| `planComercialCodigo`, `productorCodigo` | Obligatorios | Panel + validación de planes habilitados |
| `marcaCodigo`, `modeloCodigo`, `subModeloCodigo` | Obligatorios sin `idInfoAuto` | Versión del catálogo de Galeno |
| `anioFabricacion` | Obligatorio | Usuario / catálogo |
| `tomadorTipoPersona` | Obligatorio | Física o jurídica |
| `codigoPostal` | Obligatorio | Usuario + consulta de CP |
| `subCodigoPostal` | Incluido en el ejemplo mínimo, no marcado obligatorio en la enumeración | Localidad devuelta por el servicio de CP; conservarlo |
| `vigenciaDesde` | Obligatorio, dd/mm/yyyy | Fecha seleccionada, conversión en backend |
| `modoFacturacionCodigo`, `condicionPagoCodigo`, `formaPagoCodigo` | Obligatorios | Panel + catálogos dependientes del plan |
| `ceroKM` | S o vacío según descripción; ejemplo usa N | Usuario; confirmar discrepancia en pruebas |
| `tipoUso` | Documentado, no marcado obligatorio | Usuario + catálogo |
| `poseeEquipoGNC` | Condicional | Código 2 si posee, vacío si no; catálogo |
| `accesorio1Codigo`, `accesorio1Valor` | Si tiene GNC: código 25 y valor del equipo | Backend + usuario |
| `tomadorNombre` | No marcado obligatorio | Nombre/razón social opcional |
| Email | No integra el payload documentado | Dato propio para contacto/envío, según decisión comercial |
| IVA / IIBB | Por defecto consumidor final | Validar para persona jurídica antes de integración |

El documento contempla rastreo, suma asegurada manual, cláusula de ajuste, granizo, accesorios, coberturas adicionales y bonificaciones. No se expusieron en este flujo mínimo. Si se habilita rastreo se requiere su código del catálogo; no asumir valores arbitrarios. No se requieren patente, DNI, chasis, motor, domicilio completo, tarjeta ni CBU para este alcance.

## Parámetros comerciales y autenticación

Páginas 8–12 y 16–18:

- Solicitar a Galeno URL de producción, autorización Basic del ambiente e IP pública de salida habilitada. El PDF documenta restricciones por IP también para obtener token. La compatibilidad de la infraestructura actual con una salida estable está pendiente de confirmar; no se asumió que la IP del dominio sea la IP de salida.
- Usuario de servicios y contraseña gestionados por el productor desde Galeno.
- `POST /seguridad/token`: formulario `grant_type=password`, usuario y contraseña; Authorization Basic entregada por Galeno. Ejemplo de vida del access token: 3600 segundos. Obtener uno nuevo invalida la sesión anterior: se implementó caché cifrada y bloqueo compartido en MongoDB.
- Consultar planes: `/api/administracion/usuario/planes/comerciales?rama=4`; la respuesta incluye plan y productor autorizados. Validar la combinación seleccionada.
- Catálogos de facturación, condición y forma de pago son POST dependientes del plan/facturación. No copiar los códigos de ejemplo como valores válidos para cualquier productor.
- El PDF alterna `planComercialCodigo` / `planComercial` en descripción y ejemplos de catálogos. Confirmar payload exacto en pruebas.
- Las llamadas se restringen al sandbox fijo; no se aceptan otros destinos ni redirects.

## Tratamiento del resultado

Páginas 27–34: se muestran solicitud, descripción del vehículo, suma asegurada, coberturas, detalle, franquicia, premio, primera cuota y resto de cuotas. No se presenta la prima como precio final ni se asume que toda cuota es mensual. Se muestra la descripción de facturación y pago seleccionada.

Las coberturas con excepciones se excluyen; una excepción general (item 0) deja el resultado sin opciones. Se contemplan respuestas sin coberturas, errores de validación del vehículo, fallos de autenticación, red y formato inesperado. Los mensajes de infraestructura se sanitizan para no devolver secretos ni cuerpos arbitrarios del proveedor.

## Verificación y límites

Verificado localmente:

- TypeScript backend/cliente y build de ambos proyectos.
- Pruebas de router con persistencia simulada: 401/403, validación, cifrado, no devolución de secretos, contraseña vacía conserva valor, Analytics OFF por defecto y exclusión de secretos del endpoint público.
- Pruebas de cliente con transporte/token store simulados: concurrencia de obtención de token, renovación ante 401, bloqueo de destinos ajenos al sandbox, error de autenticación saneado y no repetición automática de una cotización ante timeout.
- Pruebas de cotización con catálogos controlados: uso de códigos numéricos de versión y defaults del panel, rechazo de overrides del visitante, validación de GNC/fecha/localidad/medios de pago, errores y exclusión de coberturas restringidas.
- Chrome con API simulada: selección en cascada, error y reintento de cotización, payload sin defaults comerciales del cliente, importes, render desktop/móvil sin overflow, Analytics OFF/ON/OFF sin duplicados de StrictMode. Panel: selectores, guardado, recarga y limpieza de cuotas/medio de pago al cambiar facturación.

Ejecutar desde `api`: `node --import tsx --test tests/admin-auto.test.ts tests/galeno.test.ts`.

**Pendiente de prueba real**: no se recibieron ni utilizaron credenciales del productor. No se validó el login, la IP habilitada, los catálogos ni una cotización contra Galeno. Tampoco se probó persistencia con MongoDB real. La documentación v9.5 tiene discrepancias entre descripción y ejemplos (`planComercial` vs `planComercialCodigo`, `ceroKM` vacío vs N); se implementaron los nombres de los ejemplos de catálogos y la descripción de ceroKM, y deben confirmarse con la cuenta de sandbox. La autorización Basic documentada también debe confirmarse si el servicio rechaza el acceso.
