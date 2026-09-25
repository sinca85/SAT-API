import { useEffect, useState } from "react";
import { Alert, App, Button, Card, Input, Select, Space, Spin, Switch, Typography } from "antd";

type Settings = {
  sendQuoteEmail: boolean; sendCommercialEmailOnContract: boolean; contractRecipientEmail: string;
  environment: "test"; baseUrl: string; username: string; producerCode: string; commercialPlanCode: string;
  billingModeCode: string; paymentConditionCode: string; paymentMethodCode: string; personTypeCode: string; useTypeCode: string; ivaCode: string; iibbCode: string; analyticsEnabled: boolean;
  hasPassword: boolean; hasBasicAuthorization: boolean; secretsStorageAvailable: boolean;
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
  const [password, setPassword] = useState("");
  const [basicAuthorization, setBasicAuthorization] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [catalogs, setCatalogs] = useState<Catalogs | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    void fetch("/admin/auto", { credentials: "include", signal: controller.signal }).then(readResponse<Response>).then(data => { setSettings(data.settings); setCommercialEmail(data.commercialEmail ?? ""); setConnectionStatus(data.connectionStatus ?? null); }).catch((err: unknown) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "No se pudo cargar."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);
  const plan = settings?.commercialPlanCode;
  const billing = settings?.billingModeCode;
  const hasPassword = settings?.hasPassword;
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
      const { sendQuoteEmail, sendCommercialEmailOnContract, contractRecipientEmail, environment, baseUrl, username, producerCode, commercialPlanCode, billingModeCode, paymentConditionCode, paymentMethodCode, personTypeCode, useTypeCode, ivaCode, iibbCode, analyticsEnabled } = settings;
      const response = await fetch("/admin/auto", { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sendQuoteEmail, sendCommercialEmailOnContract, contractRecipientEmail, environment, baseUrl, username, producerCode, commercialPlanCode, billingModeCode, paymentConditionCode, paymentMethodCode, personTypeCode, useTypeCode, ivaCode, iibbCode, analyticsEnabled, ...(password ? { password } : {}), ...(basicAuthorization ? { basicAuthorization } : {}) }) });
      const data = await readResponse<Response>(response);
      setSettings(data.settings); setPassword(""); setBasicAuthorization(""); setCatalogAttempt(value => value + 1); message.success("Configuración de Auto guardada");
    } catch (err) { message.error(err instanceof Error ? err.message : "No se pudo guardar."); }
    finally { setSaving(false); }
  };
  if (loading) return <Spin />;
  if (error || !settings) return <Alert type="error" title={error || "Configuración no disponible"} action={<Button onClick={() => setAttempt(value => value + 1)}>Reintentar</Button>} />;
  const disabled = !canManage || saving;
  const field = (key: "personTypeCode" | "useTypeCode" | "ivaCode" | "iibbCode" | "billingModeCode" | "paymentConditionCode" | "paymentMethodCode", label: string, choices: Option[] = []) => <div style={{ display: "grid", gap: 8 }} key={key}><label htmlFor={`auto-${key}`}>{label}</label><Select id={`auto-${key}`} aria-label={label} showSearch optionFilterProp="label" disabled={disabled || catalogLoading || !choices.length} loading={catalogLoading} value={settings[key] || undefined} placeholder="Seleccioná una opción" options={choices.length ? choices : settings[key] ? [{ value: settings[key], label: `Código guardado: ${settings[key]}` }] : []} onChange={value => patch({ [key]: value, ...(key === "billingModeCode" ? { paymentConditionCode: "", paymentMethodCode: "" } : {}) })} /></div>;
  return <Space orientation="vertical" size="large" style={{ width: "100%" }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}><div><Typography.Title level={4} style={{ margin: 0 }}>Seguro Auto Galeno</Typography.Title><Typography.Text type="secondary">Acceso y valores predeterminados del cotizador de Auto.</Typography.Text></div><Button href="https://cotizar.seguroatiempo.com/auto" target="_blank" rel="noreferrer">Ver landing</Button></div>
    <Alert type="info" showIcon title="Sandbox de Galeno · Solo cotización" description="Guardá el acceso, cargá las opciones de tu cuenta y elegí los valores que se usarán para todas las cotizaciones. Los resultados pertenecen al entorno de prueba." />
    {connectionStatus?.activeRoute === "fixie" && <Alert type="warning" showIcon title="Cotizando mediante Fixie" description={`Oracle no respondió y el respaldo está activo desde ${connectionStatus.switchedAt ? new Date(connectionStatus.switchedAt).toLocaleString("es-AR") : "la última consulta"}. ${connectionStatus.lastError || ""}`} />}
    {connectionStatus?.activeRoute === "oracle" && <Alert type="success" showIcon title="Conexión principal operativa" description="Las consultas de Galeno están saliendo mediante la IP fija de Oracle." />}
    {!connectionStatus?.activeRoute || connectionStatus.activeRoute === "unconfigured" ? <Alert type="info" showIcon title="Ruta de Galeno todavía sin verificar" description="El estado se actualizará con la próxima consulta al sandbox." /> : null}
    <Card title="Acceso al API de Galeno"><Space orientation="vertical" size="middle" style={{ width: "100%" }}>
      <Typography.Text>Ambiente: <strong>Pruebas (sandbox)</strong></Typography.Text>
      <label>Usuario de Galeno<Input disabled={disabled} autoComplete="off" value={settings.username} onChange={event => patch({ username: event.target.value })} /></label>
      <label>Contraseña de Galeno<Input.Password disabled={disabled || !settings.secretsStorageAvailable} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} placeholder={settings.hasPassword ? "Guardada. Dejá vacío para conservarla." : "Ingresá la contraseña del API"} /></label>
      {!settings.secretsStorageAvailable && <Alert type="warning" title="Falta la clave de cifrado del servidor" description="Configurar GALENO_SETTINGS_ENCRYPTION_KEY para poder guardar las credenciales." />}
      <details><summary>Configuración avanzada de conexión</summary><Typography.Paragraph style={{ marginTop: 12 }}>URL: {settings.baseUrl}. Se utiliza la autorización Basic de sandbox documentada por Galeno.</Typography.Paragraph><label>Reemplazar Authorization Basic (opcional)<Input.Password disabled={disabled || !settings.secretsStorageAvailable} autoComplete="new-password" value={basicAuthorization} onChange={event => setBasicAuthorization(event.target.value)} placeholder={settings.hasBasicAuthorization ? "Personalizada guardada; vacío la conserva" : "Solo si Galeno te proporciona otro valor"} /></label></details>
      <Typography.Text type="secondary">Galeno debe habilitar la IP de salida del servidor. Las credenciales quedan cifradas y no se muestran al volver a abrir el panel.</Typography.Text>
      <Button disabled={disabled || !settings.username.trim() || (!password && !settings.hasPassword)} loading={saving} onClick={() => void save()}>Guardar acceso y cargar opciones</Button>
    </Space></Card>
    <Card title="Opciones para todas las cotizaciones"><Space orientation="vertical" size="middle" style={{ width: "100%" }}>
      <Typography.Text type="secondary">La persona que cotiza no completa estos datos. Las opciones se consultan en Galeno según el productor y el plan.</Typography.Text>
      {!settings.hasPassword && <Alert type="info" title="Primero guardá tu usuario y contraseña para cargar los selectores." />}
      {catalogLoading && <Space><Spin size="small" /> Consultando opciones de Galeno...</Space>}
      {catalogError && <Alert type="error" title={catalogError} action={<Button disabled={disabled} onClick={() => setCatalogAttempt(value => value + 1)}>Reintentar</Button>} />}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: 20 }}>
        <div><label htmlFor="auto-plan">Productor y plan comercial</label><Select id="auto-plan" aria-label="Productor y plan comercial" style={{ width: "100%", marginTop: 8 }} disabled={disabled || catalogLoading || !catalogs} showSearch optionFilterProp="label" value={settings.commercialPlanCode && settings.producerCode ? `${settings.producerCode}|${settings.commercialPlanCode}` : undefined} options={catalogs?.plans.map(item => ({ value: `${item.producerCode}|${item.value}`, label: `${item.producerCode} · ${item.label}` }))} placeholder="Seleccioná productor y plan" onChange={value => { const [producerCode, commercialPlanCode] = value.split("|"); patch({ producerCode, commercialPlanCode, billingModeCode: "", paymentConditionCode: "", paymentMethodCode: "" }); }} /></div>
        {field("billingModeCode", "Modo de facturación / periodicidad", catalogs?.billingModes)}
        {field("paymentConditionCode", "Condición de pago / cuotas", catalogs?.paymentConditions)}
        {field("paymentMethodCode", "Medio de pago", catalogs?.paymentMethods)}
        {field("personTypeCode", "Tipo de persona", catalogs?.people)}
        {field("useTypeCode", "Uso del vehículo", catalogs?.uses)}
        {field("ivaCode", "Condición de IVA", catalogs?.iva)}
        {field("iibbCode", "Ingresos Brutos", catalogs?.iibb)}
      </div>
      <Typography.Text type="secondary">Facturación (anual, semestral, trimestral u otras) y medios de pago (tarjeta, débito u otros) aparecerán solo si Galeno los habilita para el plan. No se solicitan datos de tarjeta ni CBU para cotizar.</Typography.Text>
      <Button disabled={disabled || !settings.hasPassword} onClick={() => { patch({ commercialPlanCode: "", producerCode: "", billingModeCode: "", paymentConditionCode: "", paymentMethodCode: "" }); setCatalogAttempt(value => value + 1); }}>Volver a elegir productor y plan</Button>
    </Space></Card>
    <Card title="Analytics de Auto"><Space orientation="vertical" size="middle"><Space><Switch aria-label="Analytics de Auto" disabled={disabled} checked={settings.analyticsEnabled} onChange={analyticsEnabled => patch({ analyticsEnabled })} checkedChildren="ON" unCheckedChildren="OFF" /><strong>{settings.analyticsEnabled ? "Activado" : "Desactivado"}</strong></Space><Typography.Text type="secondary">OFF: Auto no carga Google Analytics ni Meta Pixel. ON: usa el Measurement ID general y el Pixel de Seguro a Tiempo, con eventos propios de Auto. Se aplica al guardar y cargar nuevamente la landing. Hogar conserva su configuración.</Typography.Text></Space></Card>
    <Card title="Emails y notificaciones"><Space orientation="vertical" size="large" style={{ width: "100%" }}>
      <label><Switch disabled={disabled} checked={settings.sendQuoteEmail} onChange={sendQuoteEmail => patch({ sendQuoteEmail })} aria-label="Enviar email al usuario luego de cotizar" /> <strong>Enviar email al usuario luego de cotizar</strong><p>Preferencia reservada para la etapa de envíos. En sandbox no se envían emails.</p></label>
      <label><Switch disabled={disabled} checked={settings.sendCommercialEmailOnContract} onChange={sendCommercialEmailOnContract => patch({ sendCommercialEmailOnContract })} aria-label="Enviar email al contratar" /> <strong>Enviar email al contratar</strong><p>Reservado para una etapa futura. Este flujo solo cotiza.</p></label>
      <label>Destinatario alternativo<Input disabled={disabled} type="email" value={settings.contractRecipientEmail} placeholder="destinatario@ejemplo.com" onChange={event => patch({ contractRecipientEmail: event.target.value })} /></label><Typography.Text type="secondary">Vacío utiliza el email comercial: {commercialEmail || "todavía no configurado"}.</Typography.Text>
    </Space></Card>
    <Button type="primary" disabled={disabled} loading={saving} onClick={() => void save()}>Guardar configuración de Auto</Button>
  </Space>;
}
