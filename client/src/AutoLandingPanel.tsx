import { useEffect, useState } from "react";
import { Alert, App, Button, Card, Input, InputNumber, Select, Space, Spin, Switch, Typography } from "antd";

type Settings = {
  sendQuoteEmail: boolean; sendCommercialEmailOnContract: boolean; contractRecipientEmail: string;
  environment: "test" | "production"; baseUrl: string; sandboxUsername: string; productionUsername: string; producerCode: string; commercialPlanCode: string;
  commercialDiscountEnabled: boolean; commercialDiscountPercent: number;
  connectionRoute: "oracle" | "fixie";
  billingModeCode: string; paymentConditionCode: string; paymentMethodCode: string; personTypeCode: string; useTypeCode: string; ivaCode: string; iibbCode: string; analyticsEnabled: boolean;
  hasSandboxPassword: boolean; hasSandboxBasicAuthorization: boolean; hasProductionPassword: boolean; hasProductionBasicAuthorization: boolean; secretsStorageAvailable: boolean;
};
type Option = { value: string; label: string };
type Catalogs = { plans: (Option & { producerCode: string })[]; people: Option[]; uses: Option[]; iva: Option[]; iibb: Option[]; billingModes: Option[]; paymentConditions: Option[]; paymentMethods: Option[] };
type ConnectionStatus = { activeRoute?: "oracle" | "fixie" | "unconfigured"; switchedAt?: string; lastOracleSuccessAt?: string; lastFixieUseAt?: string; lastError?: string } | null;
type Response = { settings: Settings; commercialEmail?: string; connectionStatus?: ConnectionStatus };
async function readResponse<T>(response: globalThis.Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) {
    const message = data.error === "Invalid request" ? "Revisá los valores ingresados." : data.error || "No se pudo completar la consulta.";
    const galeno = data.galeno === undefined ? "" : ` Respuesta de Galeno: ${typeof data.galeno === "string" ? data.galeno : JSON.stringify(data.galeno)}`;
    throw new Error(`${message}${galeno}`);
  }
  return data as T;
}
export function AutoLandingPanel({ canManage }: { canManage: boolean }) {
  const { message } = App.useApp();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [commercialEmail, setCommercialEmail] = useState("");
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(null);
  const [sandboxPassword, setSandboxPassword] = useState("");
  const [productionPassword, setProductionPassword] = useState("");
  const [sandboxBasicAuthorization, setSandboxBasicAuthorization] = useState("");
  const [productionBasicAuthorization, setProductionBasicAuthorization] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [catalogs, setCatalogs] = useState<Catalogs | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [connectionTesting, setConnectionTesting] = useState(false);
  const [connectionTest, setConnectionTest] = useState<{ brands: Option[] } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    void fetch("/admin/auto", { credentials: "include", signal: controller.signal }).then(readResponse<Response>).then(data => { setSettings(data.settings); setCommercialEmail(data.commercialEmail ?? ""); setConnectionStatus(data.connectionStatus ?? null); }).catch((err: unknown) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "No se pudo cargar."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);
  const plan = settings?.commercialPlanCode;
  const billing = settings?.billingModeCode;
  const hasPassword = settings?.environment === "production" ? settings.hasProductionPassword : settings?.hasSandboxPassword;
  const storage = settings?.secretsStorageAvailable;
  useEffect(() => {
    setCatalogs(null); setCatalogError("");
    if (!hasPassword || !storage || !canManage) { setCatalogLoading(false); return; }
    const controller = new AbortController();
    setCatalogLoading(true);
    void fetch("/admin/auto/catalogs", { method: "POST", credentials: "include", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commercialPlanCode: plan || "", billingModeCode: billing || "" }) })
      .then(readResponse<{ catalogs: Catalogs }>).then(data => { if (!controller.signal.aborted) setCatalogs(data.catalogs); })
      .catch((err: unknown) => { if (!controller.signal.aborted) setCatalogError(err instanceof Error ? err.message : "No se pudieron cargar los catálogos."); })
      .finally(() => { if (!controller.signal.aborted) setCatalogLoading(false); });
    return () => controller.abort();
  }, [hasPassword, storage, canManage, plan, billing, catalogAttempt]);
  const patch = (values: Partial<Settings>) => setSettings(current => current ? { ...current, ...values } : current);
  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const { sendQuoteEmail, sendCommercialEmailOnContract, contractRecipientEmail, environment, connectionRoute, sandboxUsername, productionUsername, producerCode, commercialPlanCode, commercialDiscountEnabled, commercialDiscountPercent, billingModeCode, paymentConditionCode, paymentMethodCode, personTypeCode, useTypeCode, ivaCode, iibbCode, analyticsEnabled } = settings;
      const response = await fetch("/admin/auto", { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sendQuoteEmail, sendCommercialEmailOnContract, contractRecipientEmail, environment, connectionRoute, sandboxUsername, productionUsername, producerCode, commercialPlanCode, commercialDiscountEnabled, commercialDiscountPercent, billingModeCode, paymentConditionCode, paymentMethodCode, personTypeCode, useTypeCode, ivaCode, iibbCode, analyticsEnabled, ...(sandboxPassword ? { sandboxPassword } : {}), ...(productionPassword ? { productionPassword } : {}), ...(sandboxBasicAuthorization ? { sandboxBasicAuthorization } : {}), ...(productionBasicAuthorization ? { productionBasicAuthorization } : {}) }) });
      const data = await readResponse<Response>(response);
      setSettings(data.settings); setSandboxPassword(""); setProductionPassword(""); setSandboxBasicAuthorization(""); setProductionBasicAuthorization(""); setCatalogAttempt(value => value + 1); message.success("Configuración de Auto guardada");
    } catch (err) { message.error(err instanceof Error ? err.message : "No se pudo guardar."); }
    finally { setSaving(false); }
  };
  const testOracle = async () => {
    setConnectionTesting(true); setConnectionTest(null);
    try {
      const response = await fetch("/admin/auto/oracle-test", { method: "POST", credentials: "include" });
      const data = await readResponse<{ ok: true; route: "oracle" | "fixie"; brands: Option[] }>(response);
      setConnectionTest({ brands: data.brands });
      setConnectionStatus(current => ({ ...current, activeRoute: data.route, ...(data.route === "oracle" ? { lastOracleSuccessAt: new Date().toISOString() } : { lastFixieUseAt: new Date().toISOString() }) }));
      message.success(`${data.route === "oracle" ? "Oracle" : "Fixie"} respondió y Galeno devolvió ${data.brands.length} marcas`);
    } catch (err) { message.error(err instanceof Error ? err.message : "No se pudo probar Oracle."); }
    finally { setConnectionTesting(false); }
  };
  if (loading) return <Spin />;
  if (error || !settings) return <Alert type="error" title={error || "Configuración no disponible"} action={<Button onClick={() => setAttempt(value => value + 1)}>Reintentar</Button>} />;
  const disabled = !canManage || saving;
  const field = (key: "personTypeCode" | "useTypeCode" | "ivaCode" | "iibbCode" | "billingModeCode" | "paymentConditionCode" | "paymentMethodCode", label: string, choices: Option[] = []) => <div style={{ display: "grid", gap: 8 }} key={key}><label htmlFor={`auto-${key}`}>{label}</label><Select id={`auto-${key}`} aria-label={label} showSearch optionFilterProp="label" disabled={disabled || catalogLoading || !choices.length} loading={catalogLoading} value={settings[key] || undefined} placeholder="Seleccioná una opción" options={choices.length ? choices : settings[key] ? [{ value: settings[key], label: `Código guardado: ${settings[key]}` }] : []} onChange={value => patch({ [key]: value, ...(key === "billingModeCode" ? { paymentConditionCode: "", paymentMethodCode: "" } : {}) })} /></div>;
  return <Space orientation="vertical" size="large" style={{ width: "100%" }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}><div><Typography.Title level={4} style={{ margin: 0 }}>Seguro Auto Galeno</Typography.Title><Typography.Text type="secondary">Acceso y valores predeterminados del cotizador de Auto.</Typography.Text></div><Button href="https://cotizar.seguroatiempo.com/auto" target="_blank" rel="noreferrer">Ver landing</Button></div>
    <Alert type={settings.environment === "production" ? "warning" : "info"} showIcon title={settings.environment === "production" ? "Galeno Producción activo" : "Galeno Sandbox activo"} description={settings.environment === "production" ? "Las consultas reales de la landing se enviarán al API productivo con sus credenciales propias." : "Las consultas pertenecen al entorno de prueba y no generan operaciones productivas."} />
    <Alert type={settings.connectionRoute === "oracle" ? "success" : "warning"} showIcon title={settings.connectionRoute === "oracle" ? "Salida configurada: Oracle" : "Salida configurada: Fixie"} description={settings.connectionRoute === "oracle" ? "Las consultas salen mediante la IP fija de Oracle. Si Oracle falla, no se cambia automáticamente a Fixie." : "Las consultas salen mediante Fixie hasta que cambies esta opción manualmente."} action={<Button disabled={!canManage} loading={connectionTesting} onClick={() => void testOracle()}>Probar conexión</Button>} />
    {connectionTest && <Alert type="success" showIcon title={`Prueba exitosa: ${connectionTest.brands.length} marcas recibidas desde Galeno`} description={<Typography.Paragraph style={{ margin: 0 }}>{connectionTest.brands.map(brand => brand.label).join(", ")}</Typography.Paragraph>} />}
    <Card title="Acceso al API de Galeno"><Space orientation="vertical" size="middle" style={{ width: "100%" }}>
      <div style={{ display: "grid", gap: 8 }}><label>Ambiente activo</label><Space><Switch disabled={disabled} checked={settings.environment === "production"} checkedChildren="PROD" unCheckedChildren="TEST" onChange={production => { patch({ environment: production ? "production" : "test", baseUrl: production ? "https://www.gsbeneficios.com.ar/WS-Seguros" : "https://www.gsbeneficios.com.ar/WS-Seguros-desa" }); setCatalogs(null); setConnectionTest(null); }} /><strong>{settings.environment === "production" ? "Producción" : "Sandbox"}</strong></Space></div>
      <Typography.Text type="secondary">El switch se aplica al guardar. Cada ambiente conserva su propio usuario, contraseña y Authorization Basic.</Typography.Text>
      <label>IP de salida<Select style={{ width: "100%", marginTop: 8 }} disabled={disabled} value={settings.connectionRoute} options={[{ value: "oracle", label: "Oracle · IP fija principal" }, { value: "fixie", label: "Fixie · respaldo manual" }]} onChange={connectionRoute => { patch({ connectionRoute }); setConnectionTest(null); }} /></label>
      <Typography.Text type="secondary">El cambio se aplica al guardar. No existe switcheo automático entre Oracle y Fixie.</Typography.Text>
      <Card size="small" title="Credenciales de sandbox"><Space orientation="vertical" style={{ width: "100%" }}>
        <label>Usuario de sandbox<Input disabled={disabled} autoComplete="off" value={settings.sandboxUsername} onChange={event => patch({ sandboxUsername: event.target.value })} /></label>
        <label>Contraseña de sandbox<Input.Password disabled={disabled || !settings.secretsStorageAvailable} autoComplete="new-password" value={sandboxPassword} onChange={event => setSandboxPassword(event.target.value)} placeholder={settings.hasSandboxPassword ? "Guardada. Dejá vacío para conservarla." : "Ingresá la contraseña de sandbox"} /></label>
        <label>Authorization Basic de sandbox<Input.Password disabled={disabled || !settings.secretsStorageAvailable} autoComplete="new-password" value={sandboxBasicAuthorization} onChange={event => setSandboxBasicAuthorization(event.target.value)} placeholder={settings.hasSandboxBasicAuthorization ? "Guardada. Dejá vacío para conservarla." : "Opcional: se usa el valor documentado por Galeno"} /></label>
      </Space></Card>
      <Card size="small" title="Credenciales de producción"><Space orientation="vertical" style={{ width: "100%" }}>
        <label>Usuario de producción<Input disabled={disabled} autoComplete="off" value={settings.productionUsername} onChange={event => patch({ productionUsername: event.target.value })} /></label>
        <label>Contraseña de producción<Input.Password disabled={disabled || !settings.secretsStorageAvailable} autoComplete="new-password" value={productionPassword} onChange={event => setProductionPassword(event.target.value)} placeholder={settings.hasProductionPassword ? "Guardada. Dejá vacío para conservarla." : "Ingresá la contraseña de producción"} /></label>
        <label>Authorization Basic de producción (opcional)<Input.Password disabled={disabled || !settings.secretsStorageAvailable} autoComplete="new-password" value={productionBasicAuthorization} onChange={event => setProductionBasicAuthorization(event.target.value)} placeholder={settings.hasProductionBasicAuthorization ? "Guardada. Dejá vacío para conservarla." : "Solo si Galeno entrega un valor diferente"} /></label>
      </Space></Card>
      {!settings.secretsStorageAvailable && <Alert type="warning" title="Falta la clave de cifrado del servidor" description="Configurar GALENO_SETTINGS_ENCRYPTION_KEY para poder guardar las credenciales." />}
      <details><summary>Configuración avanzada de conexión</summary><Typography.Paragraph style={{ marginTop: 12 }}>URL activa fija: {settings.baseUrl}</Typography.Paragraph></details>
      <Typography.Text type="secondary">Galeno debe habilitar la IP de salida del servidor. Las credenciales quedan cifradas y no se muestran al volver a abrir el panel.</Typography.Text>
      <Button disabled={disabled || !(settings.environment === "production" ? settings.productionUsername : settings.sandboxUsername).trim() || (settings.environment === "production" ? !productionPassword && !settings.hasProductionPassword : !sandboxPassword && !settings.hasSandboxPassword)} loading={saving} onClick={() => void save()}>Guardar acceso y cargar opciones</Button>
    </Space></Card>
    <Card title="Opciones para todas las cotizaciones"><Space orientation="vertical" size="middle" style={{ width: "100%" }}>
      <Typography.Text type="secondary">La persona que cotiza no completa estos datos. Las opciones se consultan en Galeno según el productor y el plan.</Typography.Text>
      {!hasPassword && <Alert type="info" title="Primero guardá el usuario y la contraseña del ambiente activo para cargar los selectores." />}
      {catalogLoading && <Space><Spin size="small" /> Consultando opciones de Galeno...</Space>}
      {catalogError && <Alert type="error" title={catalogError} action={<Button disabled={disabled} onClick={() => setCatalogAttempt(value => value + 1)}>Reintentar</Button>} />}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: 20 }}>
        <div><label htmlFor="auto-plan">Productor y plan comercial</label><Select id="auto-plan" aria-label="Productor y plan comercial" style={{ width: "100%", marginTop: 8 }} disabled={disabled || catalogLoading || !catalogs} showSearch optionFilterProp="label" value={settings.commercialPlanCode && settings.producerCode ? `${settings.producerCode}|${settings.commercialPlanCode}` : undefined} options={catalogs?.plans.map(item => ({ value: `${item.producerCode}|${item.value}`, label: `${item.producerCode} · ${item.label}` }))} placeholder="Seleccioná productor y plan" onChange={value => { const [producerCode, commercialPlanCode] = value.split("|"); patch({ producerCode, commercialPlanCode, billingModeCode: "", paymentConditionCode: "", paymentMethodCode: "" }); }} /></div>
        <div style={{ display: "grid", gap: 8 }}><label>Bonificación comercial</label><Space><Switch aria-label="Habilitar bonificación comercial" disabled={disabled} checked={settings.commercialDiscountEnabled} onChange={commercialDiscountEnabled => patch({ commercialDiscountEnabled })} checkedChildren="ON" unCheckedChildren="OFF" /><strong>{settings.commercialDiscountEnabled ? "Habilitada" : "Deshabilitada"}</strong></Space></div>
        <div style={{ display: "grid", gap: 8 }}><label htmlFor="auto-commercial-discount">Porcentaje de bonificación</label><InputNumber id="auto-commercial-discount" aria-label="Porcentaje de bonificación comercial" style={{ width: "100%" }} disabled={disabled || !settings.commercialDiscountEnabled} min={0} max={100} precision={2} addonAfter="%" value={settings.commercialDiscountPercent} onChange={value => patch({ commercialDiscountPercent: value ?? 0 })} /></div>
        {field("billingModeCode", "Modo de facturación / periodicidad", catalogs?.billingModes)}
        {field("paymentConditionCode", "Condición de pago / cuotas", catalogs?.paymentConditions)}
        {field("paymentMethodCode", "Medio de pago", catalogs?.paymentMethods)}
        {field("personTypeCode", "Tipo de persona", catalogs?.people)}
        {field("useTypeCode", "Uso del vehículo", catalogs?.uses)}
        {field("ivaCode", "Condición de IVA", catalogs?.iva)}
        {field("iibbCode", "Ingresos Brutos", catalogs?.iibb)}
      </div>
      <Typography.Text type="secondary">La bonificación se envía a Galeno en todas las cotizaciones cuando está habilitada. Facturación y medios de pago aparecerán solo si Galeno los habilita para el plan.</Typography.Text>
      <Button disabled={disabled || !hasPassword} onClick={() => { patch({ commercialPlanCode: "", producerCode: "", billingModeCode: "", paymentConditionCode: "", paymentMethodCode: "" }); setCatalogAttempt(value => value + 1); }}>Volver a elegir productor y plan</Button>
    </Space></Card>
    <Card title="Analytics de Auto"><Space orientation="vertical" size="middle"><Space><Switch aria-label="Analytics de Auto" disabled={disabled} checked={settings.analyticsEnabled} onChange={analyticsEnabled => patch({ analyticsEnabled })} checkedChildren="ON" unCheckedChildren="OFF" /><strong>{settings.analyticsEnabled ? "Activado" : "Desactivado"}</strong></Space><Typography.Text type="secondary">OFF: Auto no carga Google Analytics ni Meta Pixel. ON: usa el Measurement ID general y el Pixel de Seguro a Tiempo, con eventos propios de Auto. Se aplica al guardar y cargar nuevamente la landing. Hogar conserva su configuración.</Typography.Text></Space></Card>
    <Card title="Emails y notificaciones"><Space orientation="vertical" size="large" style={{ width: "100%" }}>
      <label><Switch disabled={disabled} checked={settings.sendQuoteEmail} onChange={sendQuoteEmail => patch({ sendQuoteEmail })} aria-label="Enviar opciones al usuario luego de cotizar" /> <strong>Enviar las opciones al usuario</strong><p>Cuando Galeno devuelve la cotización, envía al cliente las opciones mostradas y un botón de WhatsApp para cada una.</p></label>
      <label><Switch disabled={disabled} checked={settings.sendCommercialEmailOnContract} onChange={sendCommercialEmailOnContract => patch({ sendCommercialEmailOnContract })} aria-label="Notificar a Comercial cuando eligen una cobertura" /> <strong>Notificar a Comercial al elegir una cobertura</strong><p>Envía los datos del lead, el ID de Galeno y la opción elegida a la casilla configurada.</p></label>
      <label>Destinatario alternativo<Input disabled={disabled} type="email" value={settings.contractRecipientEmail} placeholder="destinatario@ejemplo.com" onChange={event => patch({ contractRecipientEmail: event.target.value })} /></label><Typography.Text type="secondary">Vacío utiliza el email comercial: {commercialEmail || "todavía no configurado"}.</Typography.Text>
    </Space></Card>
    <Button type="primary" disabled={disabled} loading={saving} onClick={() => void save()}>Guardar configuración de Auto</Button>
  </Space>;
}
