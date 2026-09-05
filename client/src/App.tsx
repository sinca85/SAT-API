import {
  CheckCircleOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  GoogleOutlined,
  LogoutOutlined,
  PlusOutlined,
  UploadOutlined,
  ContactsOutlined,
  PushpinFilled,
  PushpinOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  App as AntApp,
  Avatar,
  Button,
  Checkbox,
  ConfigProvider,
  Descriptions,
  Divider,
  Drawer,
  Dropdown,
  Empty,
  Flex,
  Layout,
  Input,
  Modal,
  Result,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
  type MenuProps,
  type TableColumnsType,
} from "antd";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";

type UserRole = "admin" | "user";
type UserStatus = "pending" | "active" | "disabled";
type View = "users" | "roles" | "highlevel-contacts" | "leads" | "faqs" | "ai";
type LeadStatus = "new" | "pending_contact" | "contacted" | "follow_up" | "interested" | "quote_sent" | "won" | "not_interested" | "not_qualified" | "unresponsive";

interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  permissions: string[];
  roles: Array<{ id: string; name: string; slug: string }>;
}

interface AdminUser {
  _id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  permissions: string[];
  roleIds: string[];
  lastLoginAt?: string;
  createdAt: string;
}

interface HighLevelContact {
  id: string;
  contactName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  dateAdded?: string;
  tags?: string[];
}

interface AccessRole {
  _id: string;
  name: string;
  slug: string;
  description: string;
  permissions: string[];
  system: boolean;
}

interface FaqEntry {
  _id: string;
  insurer: string;
  product: string;
  question: string;
  answer: string;
  active: boolean;
  source: string;
  updatedAt: string;
}

type FaqImportEntry = Omit<FaqEntry, "_id" | "updatedAt">;

interface Lead {
  _id: string;
  source: string;
  fullName: string;
  email: string;
  phone: string;
  status: LeadStatus;
  pinned: boolean;
  priority: "low" | "normal" | "high" | "urgent";
  nextFollowUpAt?: string;
  createdAt: string;
  personal?: LeadPersonal;
  quote: { postalCode: string; homeType: string; floor: string; requestedSquareMeters?: number; quotedSquareMeters?: number; areaLabel: string; monthlyPrice: number; structureCoverage?: number; contentsCoverage?: number; appliancesCoverage?: number; glassCoverage?: number; theftCoverage?: number; waterDamageCoverage?: number; assistanceIncluded?: boolean; currency: string };
  origin?: { landing?: string; channel?: string; pageUrl?: string; referrer?: string; utmSource?: string; utmMedium?: string; utmCampaign?: string; utmContent?: string; utmTerm?: string };
  notes?: Array<{ _id: string; text: string; authorName: string; createdAt: string }>;
  highLevel: { contactId?: string; opportunityId?: string; syncStatus: "pending" | "contact_synced" | "synced" | "failed"; lastError?: string };
}

interface LeadPersonal {
  firstName?: string;
  lastName?: string;
  dni?: string;
  dateOfBirth?: string;
  address?: string;
  floor?: string;
  apartment?: string;
  postalCode?: string;
  email?: string;
  phone?: string;
}

const leadStatusOptions = [
  ["new", "Nuevo"], ["pending_contact", "Por contactar"], ["contacted", "Contactado"],
  ["follow_up", "Seguimiento"], ["interested", "Interesado"], ["quote_sent", "Propuesta enviada"],
  ["won", "Ganado"], ["not_interested", "No interesado"], ["not_qualified", "No califica"],
  ["unresponsive", "Sin respuesta"],
].map(([value, label]) => ({ value, label }));

const viewPaths: Record<View, string> = {
  users: "/usuarios",
  roles: "/roles",
  leads: "/leads",
  faqs: "/faqs",
  "highlevel-contacts": "/highlevel/contactos",
  ai: "/ia",
};

function viewFromPath(pathname: string): View {
  const entry = Object.entries(viewPaths).find(([, path]) => path === pathname);
  return (entry?.[0] as View | undefined) ?? "users";
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? "No se pudo completar la operación");
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function LoginScreen() {
  return (
    <main className="centered-page">
      <Button
        type="primary"
        size="large"
        className="google-login-button"
        icon={
          <span className="google-logo" aria-hidden="true">
            <GoogleOutlined />
          </span>
        }
        href="/auth/google"
      >
        Continuar con Google
      </Button>
    </main>
  );
}

function UsersTable({
  users,
  roles,
  canManage,
  loading,
  onUpdate,
}: {
  users: AdminUser[];
  roles: AccessRole[];
  canManage: boolean;
  loading: boolean;
  onUpdate: (userId: string, input: Partial<Pick<AdminUser, "status" | "roleIds">>) => Promise<void>;
}) {
  const { message } = AntApp.useApp();
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const update = useCallback(
    async (userId: string, input: Partial<Pick<AdminUser, "status" | "roleIds">>) => {
      setUpdatingId(userId);
      try {
        await onUpdate(userId, input);
        message.success("Usuario actualizado");
      } catch (error) {
        message.error(error instanceof Error ? error.message : "No se pudo actualizar");
      } finally {
        setUpdatingId(null);
      }
    },
    [message, onUpdate],
  );

  const columns: TableColumnsType<AdminUser> = [
    {
      title: "Usuario",
      dataIndex: "name",
      key: "name",
      render: (_, user) => (
        <Space>
          <Avatar icon={<UserOutlined />}>{user.name.slice(0, 1).toUpperCase()}</Avatar>
          <div>
            <Typography.Text strong>{user.name}</Typography.Text>
            <Typography.Text type="secondary" className="block-text">
              {user.email}
            </Typography.Text>
          </div>
        </Space>
      ),
    },
    {
      title: "Roles",
      dataIndex: "roleIds",
      key: "roleIds",
      width: 280,
      render: (roleIds: string[], user) => (
        <Select
          mode="multiple"
          aria-label={`Roles de ${user.name}`}
          value={roleIds || []}
          placeholder="Sin roles asignados"
          style={{ width: "100%" }}
          disabled={!canManage || updatingId === user._id}
          onChange={(values: string[]) => void update(user._id, { roleIds: values })}
          options={roles.map((role) => ({ value: role._id, label: role.name }))}
        />
      ),
    },
    {
      title: "Estado",
      dataIndex: "status",
      key: "status",
      width: 150,
      render: (status: UserStatus) => {
        const color = status === "active" ? "success" : status === "pending" ? "warning" : "default";
        const label = status === "active" ? "Activo" : status === "pending" ? "Pendiente" : "Inactivo";
        return <Tag color={color}>{label}</Tag>;
      },
    },
    {
      title: "Habilitado",
      key: "enabled",
      width: 130,
      align: "center",
      render: (_, user) => (
        <Switch
          aria-label={`Habilitar a ${user.name}`}
          checked={user.status === "active"}
          loading={updatingId === user._id}
          disabled={!canManage}
          onChange={(checked) => void update(user._id, { status: checked ? "active" : "disabled" })}
        />
      ),
    },
    {
      title: "Último acceso",
      dataIndex: "lastLoginAt",
      key: "lastLoginAt",
      width: 190,
      render: (date?: string) => (date ? new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(date)) : "—"),
    },
  ];

  return (
    <Table
      rowKey="_id"
      columns={columns}
      dataSource={users}
      loading={loading}
      pagination={{ pageSize: 10, hideOnSinglePage: true }}
      scroll={{ x: 900 }}
      locale={{ emptyText: <Empty description="Todavía no hay usuarios" /> }}
    />
  );
}

const permissionOptions = [
  { value: "leads.view", label: "Ver leads" },
  { value: "leads.manage", label: "Gestionar y editar leads" },
  { value: "leads.delete", label: "Eliminar leads" },
  { value: "users.view", label: "Ver usuarios" },
  { value: "users.manage", label: "Habilitar usuarios y asignar roles" },
  { value: "roles.manage", label: "Crear y administrar roles" },
  { value: "highlevel.contacts.view", label: "Ver contactos de HighLevel" },
  { value: "faqs.view", label: "Ver FAQs" },
  { value: "faqs.manage", label: "Crear y administrar FAQs" },
];

function RolesTable({ roles, loading, onReload }: { roles: AccessRole[]; loading: boolean; onReload: () => Promise<void> }) {
  const { message } = AntApp.useApp();
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  const createRole = async () => {
    if (name.trim().length < 2) { message.error("Ingresá un nombre para el rol"); return; }
    setCreating(true);
    try {
      await requestJson("/admin/roles", { method: "POST", body: JSON.stringify({ name, description, permissions: [] }) });
      setName(""); setDescription(""); await onReload(); message.success("Rol creado");
    } catch (error) { message.error(error instanceof Error ? error.message : "No se pudo crear el rol"); }
    finally { setCreating(false); }
  };

  const updatePermissions = async (role: AccessRole, permissions: string[]) => {
    setUpdatingId(role._id);
    try { await requestJson(`/admin/roles/${role._id}`, { method: "PATCH", body: JSON.stringify({ permissions }) }); await onReload(); message.success("Rol actualizado"); }
    catch (error) { message.error(error instanceof Error ? error.message : "No se pudo actualizar el rol"); }
    finally { setUpdatingId(null); }
  };

  const deleteRole = async (role: AccessRole) => {
    setUpdatingId(role._id);
    try { await requestJson(`/admin/roles/${role._id}`, { method: "DELETE" }); await onReload(); message.success("Rol eliminado"); }
    catch (error) { message.error(error instanceof Error ? error.message : "No se pudo eliminar el rol"); }
    finally { setUpdatingId(null); }
  };

  const columns: TableColumnsType<AccessRole> = [
    {
      title: "Rol", key: "role", width: 260,
      render: (_, role) => <div><Typography.Text strong>{role.name}</Typography.Text>{role.system && <Tag color="gold" className="role-system-tag">Sistema</Tag>}<Typography.Text type="secondary" className="block-text">{role.description || "Sin descripción"}</Typography.Text></div>,
    },
    {
      title: "Accesos", dataIndex: "permissions", key: "permissions",
      render: (permissions: string[], role) => role.system ? <Tag color="success">Acceso total</Tag> : <Checkbox.Group options={permissionOptions} value={permissions} disabled={updatingId === role._id} onChange={(values) => void updatePermissions(role, values as string[])} />,
    },
    { title: "", key: "actions", width: 70, render: (_, role) => !role.system && <Button type="text" danger icon={<DeleteOutlined />} loading={updatingId === role._id} aria-label={`Eliminar rol ${role.name}`} onClick={() => void deleteRole(role)} /> },
  ];

  return (<>
    <Flex gap={12} wrap="wrap" className="role-creator"><Input placeholder="Nombre del rol, por ejemplo Vendedor" value={name} onChange={(event) => setName(event.target.value)} /><Input placeholder="Descripción breve" value={description} onChange={(event) => setDescription(event.target.value)} /><Button type="primary" loading={creating} onClick={() => void createRole()}>Crear rol</Button></Flex>
    <Table
      rowKey="_id"
      columns={columns}
      dataSource={roles}
      loading={loading}
      pagination={false}
      scroll={{ x: 820 }}
      locale={{ emptyText: <Empty description="Todavía no hay roles" /> }}
    />
  </>);
}

const emptyFaq = { insurer: "", product: "", question: "", answer: "", active: true, source: "manual" };

function FaqsTable({ canManage }: { canManage: boolean }) {
  const { message, modal } = AntApp.useApp();
  const [faqs, setFaqs] = useState<FaqEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [insurer, setInsurer] = useState<string>();
  const [product, setProduct] = useState<string>();
  const [insurers, setInsurers] = useState<string[]>([]);
  const [products, setProducts] = useState<string[]>([]);
  const [editingFaq, setEditingFaq] = useState<FaqEntry | null>(null);
  const [draft, setDraft] = useState(emptyFaq);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);

  const parsedImport = useMemo(() => {
    if (!importText.trim()) return { entries: [] as FaqImportEntry[], error: "" };
    try {
      const parsed: unknown = JSON.parse(importText);
      const values = Array.isArray(parsed) ? parsed : (parsed as { faqs?: unknown })?.faqs;
      if (!Array.isArray(values) || values.length === 0) throw new Error("El JSON debe contener una lista de FAQs.");
      if (values.length > 500) throw new Error("Podés importar hasta 500 FAQs por vez.");
      const entries = values.map((value, index) => {
        if (!value || typeof value !== "object") throw new Error(`La FAQ ${index + 1} no es válida.`);
        const item = value as Record<string, unknown>;
        const insurer = typeof item.insurer === "string" ? item.insurer.trim() : "";
        const product = typeof item.product === "string" ? item.product.trim() : "";
        const question = typeof item.question === "string" ? item.question.trim() : "";
        const answer = typeof item.answer === "string" ? item.answer.trim() : "";
        if (insurer.length < 2 || product.length < 2 || question.length < 5 || answer.length < 5) throw new Error(`Revisá aseguradora, seguro, pregunta y respuesta en la FAQ ${index + 1}.`);
        return { insurer, product, question, answer, active: typeof item.active === "boolean" ? item.active : true, source: typeof item.source === "string" ? item.source.trim() : "importación JSON" };
      });
      return { entries, error: "" };
    } catch (error) {
      return { entries: [] as FaqImportEntry[], error: error instanceof Error ? error.message : "El JSON no es válido." };
    }
  }, [importText]);

  const loadFaqs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (insurer) params.set("insurer", insurer);
      if (product) params.set("product", product);
      const data = await requestJson<{ faqs: FaqEntry[]; insurers: string[]; products: string[] }>(`/admin/faqs?${params}`);
      setFaqs(data.faqs); setInsurers(data.insurers.sort()); setProducts(data.products.sort());
    } catch (error) { message.error(error instanceof Error ? error.message : "No se pudieron cargar las FAQs"); }
    finally { setLoading(false); }
  }, [insurer, message, product, search]);

  useEffect(() => { const timer = window.setTimeout(() => void loadFaqs(), 250); return () => window.clearTimeout(timer); }, [loadFaqs]);
  const openNew = () => { setEditingFaq(null); setDraft(emptyFaq); setDrawerOpen(true); };
  const openEdit = (faq: FaqEntry) => { setEditingFaq(faq); setDraft({ insurer: faq.insurer, product: faq.product, question: faq.question, answer: faq.answer, active: faq.active, source: faq.source }); setDrawerOpen(true); };
  const saveFaq = async () => {
    if (!draft.insurer.trim() || !draft.product.trim() || draft.question.trim().length < 5 || draft.answer.trim().length < 5) { message.error("Completá aseguradora, tipo de seguro, pregunta y respuesta"); return; }
    setSaving(true);
    try {
      await requestJson(editingFaq ? `/admin/faqs/${editingFaq._id}` : "/admin/faqs", { method: editingFaq ? "PATCH" : "POST", body: JSON.stringify(draft) });
      setDrawerOpen(false); await loadFaqs(); message.success(editingFaq ? "FAQ actualizada" : "FAQ creada");
    } catch (error) { message.error(error instanceof Error ? error.message : "No se pudo guardar la FAQ"); }
    finally { setSaving(false); }
  };
  const deleteFaq = (faq: FaqEntry) => modal.confirm({ title: "Eliminar pregunta", content: faq.question, okText: "Eliminar", cancelText: "Cancelar", okButtonProps: { danger: true }, onOk: async () => { await requestJson(`/admin/faqs/${faq._id}`, { method: "DELETE" }); await loadFaqs(); message.success("FAQ eliminada"); } });
  const selectImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".json")) { message.error("Seleccioná un archivo .json"); return; }
    if (file.size > 1_000_000) { message.error("El archivo no puede superar 1 MB"); return; }
    setImportText(await file.text());
  };
  const importFaqs = async () => {
    if (!parsedImport.entries.length || parsedImport.error) return;
    setImporting(true);
    try {
      const result = await requestJson<{ total: number; created: number; updated: number }>("/admin/faqs/import", { method: "POST", body: JSON.stringify({ faqs: parsedImport.entries }) });
      setImportOpen(false); setImportText(""); await loadFaqs();
      message.success(`${result.total} FAQs procesadas: ${result.created} nuevas y ${result.updated} actualizadas`);
    } catch (error) { message.error(error instanceof Error ? error.message : "No se pudieron importar las FAQs"); }
    finally { setImporting(false); }
  };
  const columns: TableColumnsType<FaqEntry> = [
    { title: "Aseguradora", dataIndex: "insurer", key: "insurer", width: 140, render: (value: string) => <Tag color="blue">{value}</Tag> },
    { title: "Seguro", dataIndex: "product", key: "product", width: 130, render: (value: string) => <Tag>{value}</Tag> },
    { title: "Pregunta y respuesta", key: "content", render: (_, faq) => <div><Typography.Text strong>{faq.question}</Typography.Text><Typography.Paragraph ellipsis={{ rows: 2 }} type="secondary">{faq.answer}</Typography.Paragraph></div> },
    { title: "Estado", dataIndex: "active", key: "active", width: 100, render: (active: boolean) => <Tag color={active ? "success" : "default"}>{active ? "Activa" : "Inactiva"}</Tag> },
    { title: "", key: "actions", width: 100, render: (_, faq) => canManage && <Space><Button type="text" icon={<EditOutlined />} aria-label="Editar FAQ" onClick={() => openEdit(faq)} /><Button type="text" danger icon={<DeleteOutlined />} aria-label="Eliminar FAQ" onClick={() => deleteFaq(faq)} /></Space> },
  ];
  return <>
    <Flex gap={12} wrap="wrap" className="faq-toolbar"><Input.Search allowClear placeholder="Buscar en preguntas y respuestas" value={search} onChange={(event) => setSearch(event.target.value)} /><Select allowClear placeholder="Aseguradora" value={insurer} onChange={setInsurer} options={insurers.map((value) => ({ value, label: value }))} /><Select allowClear placeholder="Tipo de seguro" value={product} onChange={setProduct} options={products.map((value) => ({ value, label: value }))} />{canManage && <><Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>Importar JSON</Button><Button type="primary" icon={<PlusOutlined />} onClick={openNew}>Nueva FAQ</Button></>}</Flex>
    <Table rowKey="_id" columns={columns} dataSource={faqs} loading={loading} pagination={{ pageSize: 15 }} scroll={{ x: 850 }} locale={{ emptyText: <Empty description="Todavía no hay preguntas frecuentes" /> }} />
    <Drawer title={editingFaq ? "Editar FAQ" : "Nueva FAQ"} width={620} open={drawerOpen} onClose={() => setDrawerOpen(false)} extra={<Space><Button onClick={() => setDrawerOpen(false)}>Cancelar</Button><Button type="primary" loading={saving} onClick={() => void saveFaq()}>Guardar</Button></Space>}>
      <div className="faq-form"><label>Aseguradora<Input placeholder="Ej: Allianz" value={draft.insurer} onChange={(event) => setDraft((current) => ({ ...current, insurer: event.target.value }))} /></label><label>Tipo de seguro<Input placeholder="Ej: Hogar" value={draft.product} onChange={(event) => setDraft((current) => ({ ...current, product: event.target.value }))} /></label><label>Pregunta<Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} value={draft.question} onChange={(event) => setDraft((current) => ({ ...current, question: event.target.value }))} /></label><label>Respuesta<Input.TextArea autoSize={{ minRows: 6, maxRows: 14 }} value={draft.answer} onChange={(event) => setDraft((current) => ({ ...current, answer: event.target.value }))} /></label><label className="faq-active"><Switch checked={draft.active} onChange={(active) => setDraft((current) => ({ ...current, active }))} /> Disponible para uso</label></div>
    </Drawer>
    <Drawer title="Importar FAQs desde JSON" width={720} open={importOpen} onClose={() => setImportOpen(false)} extra={<Space><Button onClick={() => setImportOpen(false)}>Cancelar</Button><Button type="primary" loading={importing} disabled={!parsedImport.entries.length || Boolean(parsedImport.error)} onClick={() => void importFaqs()}>Importar {parsedImport.entries.length || ""}</Button></Space>}>
      <div className="faq-import">
        <Typography.Paragraph type="secondary">Pegá una lista JSON o seleccioná un archivo. Si ya existe la misma aseguradora, seguro y pregunta, se actualizará sin crear duplicados.</Typography.Paragraph>
        <div><Button icon={<UploadOutlined />} onClick={() => importFileRef.current?.click()}>Seleccionar archivo .json</Button><input ref={importFileRef} className="faq-file-input" type="file" accept="application/json,.json" onChange={(event) => void selectImportFile(event)} /></div>
        <Input.TextArea value={importText} onChange={(event) => setImportText(event.target.value)} placeholder={'[{"insurer":"allianz","product":"hogar","question":"¿Qué cubre?","answer":"...","active":true,"source":"manual"}]'} autoSize={{ minRows: 12, maxRows: 22 }} />
        {parsedImport.error && <Typography.Text type="danger">{parsedImport.error}</Typography.Text>}
        {!parsedImport.error && parsedImport.entries.length > 0 && <><Typography.Text type="success">{parsedImport.entries.length} FAQs listas para importar</Typography.Text><Table size="small" rowKey={(_, index) => String(index)} dataSource={parsedImport.entries.slice(0, 10)} pagination={false} columns={[{ title: "Aseguradora", dataIndex: "insurer", width: 120 }, { title: "Seguro", dataIndex: "product", width: 100 }, { title: "Pregunta", dataIndex: "question" }]} /><Typography.Text type="secondary">{parsedImport.entries.length > 10 ? `Vista previa de las primeras 10 de ${parsedImport.entries.length}.` : "Revisá la vista previa antes de importar."}</Typography.Text></>}
      </div>
    </Drawer>
  </>;
}

function HighLevelContacts() {
  const { message } = AntApp.useApp();
  const [contacts, setContacts] = useState<HighLevelContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 25;

  const loadContacts = useCallback(async (nextPage: number) => {
    setLoading(true);
    try {
      const data = await requestJson<{
        contacts: HighLevelContact[];
        total: number;
      }>(`/admin/highlevel/contacts?page=${nextPage}&limit=${pageSize}`);
      setContacts(data.contacts);
      setTotal(data.total);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "No se pudieron cargar los contactos");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void loadContacts(page);
  }, [loadContacts, page]);

  const columns: TableColumnsType<HighLevelContact> = [
    {
      title: "Contacto",
      key: "contact",
      render: (_, contact) => {
        const fullName = contact.contactName || [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Sin nombre";
        return (
          <Space>
            <Avatar icon={<UserOutlined />}>{fullName.slice(0, 1).toUpperCase()}</Avatar>
            <Typography.Text strong>{fullName}</Typography.Text>
          </Space>
        );
      },
    },
    { title: "Email", dataIndex: "email", key: "email", render: (email?: string) => email || "—" },
    { title: "Teléfono", dataIndex: "phone", key: "phone", render: (phone?: string) => phone || "—" },
    {
      title: "Etiquetas",
      dataIndex: "tags",
      key: "tags",
      render: (tags?: string[]) => tags?.length ? <Space size={[0, 6]} wrap>{tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</Space> : "—",
    },
    {
      title: "Creado",
      dataIndex: "dateAdded",
      key: "dateAdded",
      width: 170,
      render: (date?: string) => date ? new Intl.DateTimeFormat("es-AR", { dateStyle: "medium" }).format(new Date(date)) : "—",
    },
  ];

  return (
    <Table
      rowKey="id"
      columns={columns}
      dataSource={contacts}
      loading={loading}
      scroll={{ x: 880 }}
      pagination={{
        current: page,
        pageSize,
        total,
        showSizeChanger: false,
        onChange: setPage,
        showTotal: (count) => `${count} contactos`,
      }}
      locale={{ emptyText: <Empty description="No se encontraron contactos en HighLevel" /> }}
    />
  );
}

type LeadSortField = "fullName" | "monthlyPrice" | "source" | "status" | "syncStatus" | "createdAt";

function LeadsTable({ canManage, canDelete }: { canManage: boolean; canDelete: boolean }) {
  const { message, modal } = AntApp.useApp();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [syncingLead, setSyncingLead] = useState(false);
  const [sortBy, setSortBy] = useState<LeadSortField>("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [editing, setEditing] = useState(false);
  const [savingPersonal, setSavingPersonal] = useState(false);
  const [editPersonal, setEditPersonal] = useState<Required<LeadPersonal>>({ firstName: "", lastName: "", dni: "", dateOfBirth: "", address: "", floor: "", apartment: "", postalCode: "", email: "", phone: "" });
  const pageSize = 25;

  const loadLeads = useCallback(async (nextPage: number) => {
    setLoading(true);
    try {
      const data = await requestJson<{ leads: Lead[]; total: number }>(`/admin/leads?page=${nextPage}&limit=${pageSize}&sortBy=${sortBy}&sortOrder=${sortOrder}`);
      setLeads(data.leads); setTotal(data.total);
    } catch (error) { message.error(error instanceof Error ? error.message : "No se pudieron cargar los leads"); }
    finally { setLoading(false); }
  }, [message, sortBy, sortOrder]);

  useEffect(() => { void loadLeads(page); }, [loadLeads, page]);

  const updateLead = async (leadId: string, input: Partial<Pick<Lead, "status" | "pinned" | "priority">>) => {
    setUpdatingId(leadId);
    try {
      const data = await requestJson<{ lead: Lead }>(`/admin/leads/${leadId}`, { method: "PATCH", body: JSON.stringify(input) });
      setLeads((current) => current.map((lead) => lead._id === leadId ? data.lead : lead));
      message.success("Lead actualizado");
    } catch (error) { message.error(error instanceof Error ? error.message : "No se pudo actualizar el lead"); }
    finally { setUpdatingId(null); }
  };

  const columns: TableColumnsType<Lead> = [
    { title: "", key: "pinned", width: 54, align: "center", render: (_, lead) => <Button type="text" disabled={!canManage} aria-label={lead.pinned ? "Quitar destacado" : "Destacar lead"} loading={updatingId === lead._id} icon={lead.pinned ? <PushpinFilled className="pin-active" /> : <PushpinOutlined />} onClick={() => void updateLead(lead._id, { pinned: !lead.pinned })} /> },
    { title: "Lead", key: "fullName", sorter: true, sortOrder: sortBy === "fullName" ? (sortOrder === "asc" ? "ascend" : "descend") : null, render: (_, lead) => <div><Typography.Text strong>{lead.fullName}</Typography.Text><Typography.Text type="secondary" className="block-text">{lead.email} · {lead.phone}</Typography.Text></div> },
    { title: "Cotización", key: "monthlyPrice", sorter: true, sortOrder: sortBy === "monthlyPrice" ? (sortOrder === "asc" ? "ascend" : "descend") : null, render: (_, lead) => <div><Typography.Text>{lead.quote.homeType} · {lead.quote.areaLabel}</Typography.Text><Typography.Text type="secondary" className="block-text">{new Intl.NumberFormat("es-AR", { style: "currency", currency: lead.quote.currency, maximumFractionDigits: 0 }).format(lead.quote.monthlyPrice)}/mes</Typography.Text></div> },
    { title: "Source", dataIndex: "source", key: "source", sorter: true, sortOrder: sortBy === "source" ? (sortOrder === "asc" ? "ascend" : "descend") : null, render: (source: string) => <Tag color="blue">{source}</Tag> },
    { title: "Estado", dataIndex: "status", key: "status", width: 190, sorter: true, sortOrder: sortBy === "status" ? (sortOrder === "asc" ? "ascend" : "descend") : null, render: (status: LeadStatus, lead) => <Select aria-label={`Estado de ${lead.fullName}`} value={status} disabled={!canManage || updatingId === lead._id} options={leadStatusOptions} onChange={(value: LeadStatus) => void updateLead(lead._id, { status: value })} /> },
    { title: "HighLevel", key: "syncStatus", width: 130, sorter: true, sortOrder: sortBy === "syncStatus" ? (sortOrder === "asc" ? "ascend" : "descend") : null, render: (_, lead) => <Tag color={lead.highLevel.syncStatus === "synced" || lead.highLevel.syncStatus === "contact_synced" ? "success" : lead.highLevel.syncStatus === "failed" ? "error" : "warning"}>{lead.highLevel.syncStatus === "synced" ? "Sincronizado" : lead.highLevel.syncStatus === "contact_synced" ? "Contacto creado" : lead.highLevel.syncStatus === "failed" ? "Con error" : "Pendiente"}</Tag> },
    { title: "Ingreso", dataIndex: "createdAt", key: "createdAt", width: 170, sorter: true, sortOrder: sortBy === "createdAt" ? (sortOrder === "asc" ? "ascend" : "descend") : null, render: (date: string) => new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date(date)) },
  ];

  const value = (content?: string | number | null) => content === undefined || content === null || content === "" ? "—" : String(content);
  const money = (amount?: number) => amount === undefined ? "—" : new Intl.NumberFormat("es-AR", { style: "currency", currency: selectedLead?.quote.currency || "ARS", maximumFractionDigits: 0 }).format(amount);
  const retryHighLevelSync = async () => {
    if (!selectedLead) return;
    setSyncingLead(true);
    try {
      const data = await requestJson<{ lead: Lead }>(`/admin/leads/${selectedLead._id}/sync-highlevel`, { method: "POST" });
      setSelectedLead(data.lead);
      setLeads((current) => current.map((lead) => lead._id === data.lead._id ? data.lead : lead));
      if (data.lead.highLevel.syncStatus === "failed") message.error("HighLevel rechazó la sincronización. Ya podés ver el motivo completo.");
      else message.success("Lead sincronizado con HighLevel");
    } catch (error) { message.error(error instanceof Error ? error.message : "No se pudo reintentar la sincronización"); }
    finally { setSyncingLead(false); }
  };
  const addNote = async () => {
    if (!selectedLead || !noteText.trim()) return;
    setSavingNote(true);
    try {
      const data = await requestJson<{ lead: Lead }>(`/admin/leads/${selectedLead._id}/notes`, { method: "POST", body: JSON.stringify({ text: noteText }) });
      setSelectedLead(data.lead); setLeads((current) => current.map((lead) => lead._id === data.lead._id ? data.lead : lead)); setNoteText(""); message.success("Nota agregada");
    } catch (error) { message.error(error instanceof Error ? error.message : "No se pudo agregar la nota"); }
    finally { setSavingNote(false); }
  };
  const deleteNote = async (noteId: string) => {
    if (!selectedLead) return;
    const data = await requestJson<{ lead: Lead }>(`/admin/leads/${selectedLead._id}/notes/${noteId}`, { method: "DELETE" });
    setSelectedLead(data.lead); setLeads((current) => current.map((lead) => lead._id === data.lead._id ? data.lead : lead)); message.success("Nota eliminada");
  };
  const deleteLead = () => {
    if (!selectedLead) return;
    modal.confirm({ title: "Eliminar lead", content: `¿Querés eliminar el registro de ${selectedLead.fullName}? Esta acción no elimina el contacto de HighLevel.`, okText: "Eliminar", cancelText: "Cancelar", okButtonProps: { danger: true }, onOk: async () => { await requestJson(`/admin/leads/${selectedLead._id}`, { method: "DELETE" }); setLeads((current) => current.filter((lead) => lead._id !== selectedLead._id)); setTotal((current) => Math.max(0, current - 1)); setSelectedLead(null); message.success("Lead eliminado"); } });
  };
  const beginEditing = () => {
    if (!selectedLead) return;
    const personal = selectedLead.personal;
    setEditPersonal({
      firstName: personal?.firstName || selectedLead.fullName,
      lastName: personal?.lastName || "",
      dni: personal?.dni || "",
      dateOfBirth: personal?.dateOfBirth || "",
      address: personal?.address || "",
      floor: personal?.floor || selectedLead.quote.floor || "",
      apartment: personal?.apartment || "",
      postalCode: personal?.postalCode || selectedLead.quote.postalCode || "",
      email: personal?.email || selectedLead.email || "",
      phone: personal?.phone || selectedLead.phone || "",
    });
    setEditing(true);
  };
  const cancelEditing = () => setEditing(false);
  const changePersonal = (key: keyof LeadPersonal, value: string) => setEditPersonal((current) => ({ ...current, [key]: value }));
  const savePersonal = async () => {
    if (!selectedLead) return;
    setSavingPersonal(true);
    try {
      const data = await requestJson<{ lead: Lead }>(`/admin/leads/${selectedLead._id}`, { method: "PATCH", body: JSON.stringify({ personal: editPersonal }) });
      setSelectedLead(data.lead);
      setLeads((current) => current.map((lead) => lead._id === data.lead._id ? data.lead : lead));
      setEditing(false);
      if (data.lead.highLevel.syncStatus === "failed") message.warning("Los datos se guardaron, pero HighLevel rechazó la sincronización.");
      else message.success("Datos actualizados y sincronizados");
    } catch (error) { message.error(error instanceof Error ? error.message : "No se pudieron guardar los datos"); }
    finally { setSavingPersonal(false); }
  };

  const editInput = (key: keyof LeadPersonal, options?: { type?: string; placeholder?: string }) => <Input type={options?.type} placeholder={options?.placeholder} value={editPersonal[key]} onChange={(event) => changePersonal(key, event.target.value)} />;

  return <>
    <Table rowKey="_id" columns={columns} dataSource={leads} loading={loading} scroll={{ x: 1200 }} onChange={(_, __, sorter) => { const selected = Array.isArray(sorter) ? sorter[0] : sorter; if (!selected?.order || !selected.columnKey) return; setSortBy(selected.columnKey as LeadSortField); setSortOrder(selected.order === "ascend" ? "asc" : "desc"); setPage(1); }} onRow={(lead) => ({ onClick: (event) => { if ((event.target as HTMLElement).closest("button, .ant-select")) return; setSelectedLead(lead); }, className: "clickable-row" })} pagination={{ current: page, pageSize, total, showSizeChanger: false, onChange: setPage, showTotal: (count) => `${count} leads` }} locale={{ emptyText: <Empty description="Todavía no hay leads" /> }} />
    <Drawer title="Detalle del lead" width={720} open={Boolean(selectedLead)} onClose={() => { setSelectedLead(null); setEditing(false); }} extra={<Space>{canManage && (editing ? <><Button onClick={cancelEditing} disabled={savingPersonal}>Cancelar</Button><Button type="primary" loading={savingPersonal} onClick={() => void savePersonal()}>Guardar</Button></> : <Button icon={<EditOutlined />} onClick={beginEditing}>Editar</Button>)}{canDelete && !editing && <Button danger icon={<DeleteOutlined />} onClick={deleteLead}>Eliminar lead</Button>}</Space>}>
      {selectedLead && <>
        {selectedLead.highLevel.lastError && <div className="lead-sync-error"><Typography.Text strong type="danger">Error de sincronización con HighLevel</Typography.Text><Typography.Paragraph copyable>{selectedLead.highLevel.lastError}</Typography.Paragraph>{canManage && <Button danger loading={syncingLead} onClick={() => void retryHighLevelSync()}>Reintentar sincronización</Button>}</div>}
        <Typography.Title level={5}>Datos personales</Typography.Title>
        <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
          <Descriptions.Item label="Nombre">{editing ? editInput("firstName") : value(selectedLead.personal?.firstName || selectedLead.fullName)}</Descriptions.Item><Descriptions.Item label="Apellido">{editing ? editInput("lastName") : value(selectedLead.personal?.lastName)}</Descriptions.Item>
          <Descriptions.Item label="DNI">{editing ? editInput("dni") : value(selectedLead.personal?.dni)}</Descriptions.Item><Descriptions.Item label="Fecha de nacimiento">{editing ? editInput("dateOfBirth", { type: "date" }) : value(selectedLead.personal?.dateOfBirth)}</Descriptions.Item>
          <Descriptions.Item label="Domicilio" span={2}>{editing ? editInput("address", { placeholder: "Calle y número" }) : value(selectedLead.personal?.address)}</Descriptions.Item><Descriptions.Item label="Piso">{editing ? <Select value={editPersonal.floor || undefined} placeholder="Seleccioná el piso" style={{ width: "100%" }} onChange={(value) => changePersonal("floor", value)} options={["Planta baja", "Primer piso", "Segundo piso o superior", "No corresponde"].map((value) => ({ value, label: value }))} /> : value(selectedLead.personal?.floor || selectedLead.quote.floor)}</Descriptions.Item><Descriptions.Item label="Departamento">{editing ? editInput("apartment") : value(selectedLead.personal?.apartment)}</Descriptions.Item>
          <Descriptions.Item label="Código postal">{editing ? editInput("postalCode") : value(selectedLead.personal?.postalCode || selectedLead.quote.postalCode)}</Descriptions.Item><Descriptions.Item label="Email">{editing ? editInput("email", { type: "email" }) : value(selectedLead.personal?.email || selectedLead.email)}</Descriptions.Item><Descriptions.Item label="Celular" span={2}>{editing ? editInput("phone", { type: "tel", placeholder: "+54 9 11 1234 5678" }) : value(selectedLead.personal?.phone || selectedLead.phone)}</Descriptions.Item>
        </Descriptions>
        <Divider />
        <Typography.Title level={5}>Cotización</Typography.Title>
        <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
          <Descriptions.Item label="Tipo de vivienda">{value(selectedLead.quote.homeType)}</Descriptions.Item><Descriptions.Item label="Superficie ingresada">{value(selectedLead.quote.requestedSquareMeters ? `${selectedLead.quote.requestedSquareMeters} m²` : selectedLead.quote.areaLabel)}</Descriptions.Item>
          <Descriptions.Item label="Tramo tarifado">{value(selectedLead.quote.quotedSquareMeters ? `${selectedLead.quote.quotedSquareMeters} m²` : selectedLead.quote.areaLabel)}</Descriptions.Item><Descriptions.Item label="Cuota mensual">{money(selectedLead.quote.monthlyPrice)}</Descriptions.Item>
          <Descriptions.Item label="Incendio estructura">{money(selectedLead.quote.structureCoverage)}</Descriptions.Item><Descriptions.Item label="Incendio contenido">{money(selectedLead.quote.contentsCoverage)}</Descriptions.Item>
          <Descriptions.Item label="Electrodomésticos">{money(selectedLead.quote.appliancesCoverage)}</Descriptions.Item><Descriptions.Item label="Cristales">{money(selectedLead.quote.glassCoverage)}</Descriptions.Item>
          <Descriptions.Item label="Robo de contenido">{money(selectedLead.quote.theftCoverage)}</Descriptions.Item><Descriptions.Item label="Daños por agua">{money(selectedLead.quote.waterDamageCoverage)}</Descriptions.Item>
          <Descriptions.Item label="Asistencia 24 h" span={2}>{selectedLead.quote.assistanceIncluded === false ? "No incluida" : "Incluida"}</Descriptions.Item>
        </Descriptions>
        <Divider />
        <Typography.Title level={5}>Origen y sincronización</Typography.Title>
        <Descriptions bordered size="small" column={1}>
          <Descriptions.Item label="Source">{value(selectedLead.source)}</Descriptions.Item><Descriptions.Item label="Landing">{value(selectedLead.origin?.landing)}</Descriptions.Item><Descriptions.Item label="Campaña UTM">{value(selectedLead.origin?.utmCampaign)}</Descriptions.Item>
          <Descriptions.Item label="Contacto HighLevel">{value(selectedLead.highLevel.contactId)}</Descriptions.Item><Descriptions.Item label="Oportunidad HighLevel">{value(selectedLead.highLevel.opportunityId)}</Descriptions.Item><Descriptions.Item label="Estado de sincronización">{value(selectedLead.highLevel.syncStatus)}</Descriptions.Item>
        </Descriptions>
        <Divider />
        <Typography.Title level={5}>Notas</Typography.Title>
        {canManage && <div className="note-composer"><Input.TextArea value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="Escribí una nota sobre la gestión..." autoSize={{ minRows: 2, maxRows: 5 }} maxLength={3000} /><Button type="primary" loading={savingNote} disabled={!noteText.trim()} onClick={() => void addNote()}>Agregar nota</Button></div>}
        {selectedLead.notes?.length ? selectedLead.notes.map((note) => <div className="lead-note" key={note._id}><div><Typography.Paragraph>{note.text}</Typography.Paragraph><Typography.Text type="secondary">{note.authorName} · {new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date(note.createdAt))}</Typography.Text></div>{canManage && <Button type="text" danger aria-label="Eliminar nota" icon={<DeleteOutlined />} onClick={() => void deleteNote(note._id)} />}</div>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Sin notas" />}
      </>}
    </Drawer>
  </>;
}

function AIKnowledgePanel({ canManage }: { canManage: boolean }) {
  const { message } = AntApp.useApp();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({ name: "", slug: "", company: "Allianz", product: "Hogar", title: "", fallbackMessage: "No encontré esa información en la documentación disponible." });
  const [editing, setEditing] = useState<any | null>(null);
  const load = useCallback(async () => { setLoading(true); try { const data = await requestJson<{ configurations: any[] }>("/admin/ai/configurations"); setItems(data.configurations); } catch (e) { message.error(e instanceof Error ? e.message : "No se pudo cargar IA"); } finally { setLoading(false); } }, [message]);
  useEffect(() => { void load(); }, [load]);
  const create = async () => { try { await requestJson("/admin/ai/configurations", { method: "POST", body: JSON.stringify({ ...draft, active: true, placeholder: "¿Qué querés saber?", welcomeMessage: "Consultá sobre tu seguro.", systemInstructions: "" }) }); setDraft({ name: "", slug: "", company: "Allianz", product: "Hogar", title: "", fallbackMessage: "No encontré esa información en la documentación disponible." }); await load(); message.success("Asistente creado"); } catch (e) { message.error(e instanceof Error ? e.message : "No se pudo crear"); } };
  const remove = (item: any) => Modal.confirm({ title: "Eliminar asistente", content: `Se eliminará ${item.name} y sus referencias documentales.`, okText: "Eliminar", cancelText: "Cancelar", okButtonProps: { danger: true }, onOk: async () => { await requestJson(`/admin/ai/configurations/${item._id}`, { method: "DELETE" }); await load(); message.success("Asistente eliminado"); } });
  const upload = async (item: any, files: File[]) => { const body = new FormData(); files.forEach(file => body.append("files", file)); const response = await fetch(`/admin/ai/configurations/${item._id}/documents`, { method: "POST", credentials: "same-origin", body }); const data = await response.json().catch(() => null) as { documents?: Array<{ name?: string; status?: string; error?: string }> } | null; if (!response.ok) throw new Error("No se pudo cargar el PDF"); const failed = data?.documents?.filter(document => document.status !== "ready") ?? []; await load(); if (failed.length) throw new Error(failed.map(document => `${document.name}: ${document.error || "error de procesamiento"}`).join(" | ")); message.success(`${files.length} PDF${files.length === 1 ? "" : "s"} cargado${files.length === 1 ? "" : "s"}`); };
  return <Space direction="vertical" size="large" style={{ width: "100%" }}>
    {canManage && <div className="ai-create-card"><Typography.Title level={4}>Nuevo asistente documental</Typography.Title><Typography.Text type="secondary">Asociá una base de conocimiento a una aseguradora y producto.</Typography.Text><Flex gap={12} wrap="wrap" style={{ marginTop: 16 }}><Input placeholder="Nombre" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /><Input placeholder="Slug (ej. allianz-hogar)" value={draft.slug} onChange={e => setDraft({ ...draft, slug: e.target.value })} /><Input placeholder="Aseguradora" value={draft.company} onChange={e => setDraft({ ...draft, company: e.target.value })} /><Input placeholder="Tipo de seguro" value={draft.product} onChange={e => setDraft({ ...draft, product: e.target.value })} /><Input placeholder="Título público" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /><Button type="primary" icon={<PlusOutlined />} onClick={() => void create()} disabled={!draft.name || !draft.slug}>Crear asistente</Button></Flex></div>}
    <Table loading={loading} rowKey="_id" dataSource={items} columns={[{ title: "Asistente", render: (_: unknown, x: any) => <Space direction="vertical" size={0}><Typography.Text strong>{x.name}</Typography.Text><Typography.Text type="secondary">/{x.slug}</Typography.Text></Space> }, { title: "Aseguradora", dataIndex: "company" }, { title: "Producto", dataIndex: "product" }, { title: "Estado", dataIndex: "active", render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "Activo" : "Inactivo"}</Tag> }, { title: "Versión", dataIndex: "knowledgeVersion" }, { title: "Acciones", render: (_: unknown, x: any) => <Space wrap>{canManage && <><Button size="small" icon={<EditOutlined />} onClick={() => setEditing({ ...x })}>Editar</Button><Button size="small" icon={<UploadOutlined />} onClick={() => { const input = document.createElement("input"); input.type = "file"; input.multiple = true; input.accept = "application/pdf,.pdf"; input.onchange = () => { const files = Array.from(input.files ?? []); if (files.length) void upload(x, files).catch(e => message.error(e instanceof Error ? e.message : "Error")); }; input.click(); }}>Adjuntar PDFs</Button><Button danger size="small" icon={<DeleteOutlined />} onClick={() => remove(x)}>Eliminar</Button></>}</Space> }]} locale={{ emptyText: <Empty description="Todavía no hay asistentes de IA" /> }} />
    <Modal open={Boolean(editing)} title="Editar asistente" okText="Guardar" cancelText="Cancelar" onCancel={() => setEditing(null)} onOk={async () => { if (!editing) return; try { await requestJson(`/admin/ai/configurations/${editing._id}`, { method: "PATCH", body: JSON.stringify({ name: editing.name, slug: editing.slug, company: editing.company, product: editing.product, title: editing.title, active: editing.active, fallbackMessage: editing.fallbackMessage }) }); setEditing(null); await load(); message.success("Asistente actualizado"); } catch (e) { message.error(e instanceof Error ? e.message : "No se pudo actualizar"); } }}>
      {editing && <Space direction="vertical" style={{ width: "100%" }}><Input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="Nombre" /><Input value={editing.slug} onChange={e => setEditing({ ...editing, slug: e.target.value })} placeholder="Slug" /><Input value={editing.company} onChange={e => setEditing({ ...editing, company: e.target.value })} placeholder="Aseguradora" /><Input value={editing.product} onChange={e => setEditing({ ...editing, product: e.target.value })} placeholder="Producto" /><Input value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="Título público" /><Switch checked={editing.active} onChange={active => setEditing({ ...editing, active })} checkedChildren="Activo" unCheckedChildren="Inactivo" /></Space>}
    </Modal>
  </Space>;
}

function AdminPanel({ sessionUser }: { sessionUser: SessionUser }) {
  const { message } = AntApp.useApp();
  const can = useCallback((permission: string) => sessionUser.permissions.includes("*") || sessionUser.permissions.includes(permission), [sessionUser.permissions]);
  const [view, setView] = useState<View>(() => viewFromPath(window.location.pathname));
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<AccessRole[]>([]);
  const [loading, setLoading] = useState(true);

  const loadUsers = useCallback(async () => {
    if (!can("users.view")) { setLoading(false); return; }
    setLoading(true);
    try {
      const data = await requestJson<{ users: AdminUser[]; roles: AccessRole[] }>("/admin/users");
      setUsers(data.users); setRoles(data.roles);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "No se pudieron cargar los usuarios");
    } finally {
      setLoading(false);
    }
  }, [can, message]);

  const loadRoles = useCallback(async () => {
    if (!can("roles.manage")) return;
    try {
      const data = await requestJson<{ roles: AccessRole[] }>("/admin/roles");
      setRoles(data.roles);
    } catch (error) { message.error(error instanceof Error ? error.message : "No se pudieron cargar los roles"); }
  }, [can, message]);

  useEffect(() => {
    void loadUsers();
    void loadRoles();
  }, [loadRoles, loadUsers]);

  useEffect(() => {
    const onPopState = () => setView(viewFromPath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((nextView: View) => {
    const path = viewPaths[nextView];
    if (window.location.pathname !== path) window.history.pushState({}, "", path);
    setView(nextView);
  }, []);

  useEffect(() => {
    const allowed = (view === "users" && can("users.view")) || (view === "roles" && can("roles.manage")) || (view === "leads" && can("leads.view")) || (view === "faqs" && can("faqs.view")) || (view === "ai" && can("ai.view")) || (view === "highlevel-contacts" && can("highlevel.contacts.view"));
    if (allowed) return;
    const fallback: View | undefined = can("leads.view") ? "leads" : can("faqs.view") ? "faqs" : can("ai.view") ? "ai" : can("users.view") ? "users" : can("roles.manage") ? "roles" : can("highlevel.contacts.view") ? "highlevel-contacts" : undefined;
    if (fallback) navigate(fallback);
  }, [can, navigate, view]);

  const updateUser = useCallback(
    async (userId: string, input: Partial<Pick<AdminUser, "status" | "roleIds">>) => {
      const data = await requestJson<{ user: AdminUser }>(`/admin/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
      setUsers((current) => current.map((user) => (user._id === userId ? data.user : user)));
    },
    [],
  );

  const userMenu = useMemo<MenuProps["items"]>(
    () => [
      can("users.view") ? { key: "users", label: "Ver todos los usuarios", icon: <TeamOutlined /> } : null,
      can("roles.manage") ? { key: "roles", label: "Ver roles", icon: <SafetyCertificateOutlined /> } : null,
    ].filter(Boolean) as MenuProps["items"],
    [can],
  );

  const highLevelMenu = useMemo<MenuProps["items"]>(
    () => can("highlevel.contacts.view") ? [{ key: "highlevel-contacts", label: "Contactos", icon: <ContactsOutlined /> }] : [],
    [can],
  );

  const logout = async () => {
    await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
    window.location.assign("/");
  };

  return (
    <Layout className="admin-layout">
      <Layout.Header className="admin-header">
        <img className="brand-logo" src="/sat-logo-full-blanco.svg" alt="Seguro a Tiempo" />
        <nav aria-label="Navegación principal">
          <Space>
            {can("leads.view") && <Button type="text" className="header-menu-button" icon={<ContactsOutlined />} onClick={() => navigate("leads")}>Leads</Button>}
            {can("faqs.view") && <Button type="text" className="header-menu-button" icon={<SafetyCertificateOutlined />} onClick={() => navigate("faqs")}>FAQs</Button>}
            {can("ai.view") && <Button type="text" className="header-menu-button" icon={<SafetyCertificateOutlined />} onClick={() => navigate("ai")}>IA</Button>}
            {(can("users.view") || can("roles.manage")) &&
            <Dropdown
              menu={{ items: userMenu, onClick: ({ key }) => navigate(key as View) }}
              trigger={["click"]}
            >
              <Button type="text" className="header-menu-button" icon={<TeamOutlined />}>
                Usuarios <DownOutlined />
              </Button>
            </Dropdown>}
            {can("highlevel.contacts.view") &&
            <Dropdown
              menu={{ items: highLevelMenu, onClick: ({ key }) => navigate(key as View) }}
              trigger={["click"]}
            >
              <Button type="text" className="header-menu-button" icon={<ContactsOutlined />}>
                HighLevel <DownOutlined />
              </Button>
            </Dropdown>}
          </Space>
        </nav>
        <Space className="account-actions">
          <Typography.Text className="account-name">{sessionUser.name}</Typography.Text>
          <Button type="text" className="logout-button" icon={<LogoutOutlined />} onClick={() => void logout()}>
            Salir
          </Button>
        </Space>
      </Layout.Header>

      <Layout.Content className="admin-content">
        <Flex justify="space-between" align="center" gap={16} wrap="wrap" className="page-heading">
          <div>
            <Typography.Title level={2}>
              {view === "users" ? "Usuarios" : view === "roles" ? "Roles" : view === "leads" ? "Leads" : view === "faqs" ? "Preguntas frecuentes" : view === "ai" ? "Inteligencia artificial" : "Contactos de HighLevel"}
            </Typography.Title>
            <Typography.Text type="secondary">
              {view === "users"
                ? "Administrá quién puede ingresar al sistema y su nivel de acceso."
                : view === "roles"
                  ? "Creá roles y definí qué partes del sistema puede utilizar cada uno."
                  : view === "leads"
                    ? "Solicitudes recibidas desde los cotizadores y su estado de sincronización."
                    : view === "faqs"
                      ? "Base de preguntas y respuestas organizada por aseguradora y tipo de seguro."
                    : view === "ai" ? "Asistentes y bases de conocimiento por aseguradora y tipo de seguro." : "Contactos sincronizados desde la subcuenta de Seguro a Tiempo."}
            </Typography.Text>
          </div>
          {view === "users" && (
            <Tag icon={<CheckCircleOutlined />} color="processing">
              {users.filter((user) => user.status === "active").length} activos
            </Tag>
          )}
        </Flex>

        <section className="content-card">
          {view === "users" ? (
            can("users.view") ? <UsersTable users={users} roles={roles} canManage={can("users.manage")} loading={loading} onUpdate={updateUser} /> : <Result status="403" title="Sin acceso" />
          ) : view === "roles" ? (
            can("roles.manage") ? <RolesTable roles={roles} loading={loading} onReload={loadRoles} /> : <Result status="403" title="Sin acceso" />
          ) : view === "leads" ? (
            can("leads.view") ? <LeadsTable canManage={can("leads.manage")} canDelete={can("leads.delete")} /> : <Result status="403" title="Sin acceso" />
          ) : view === "faqs" ? (
            can("faqs.view") ? <FaqsTable canManage={can("faqs.manage")} /> : <Result status="403" title="Sin acceso" />
          ) : view === "ai" ? (
            can("ai.view") ? <AIKnowledgePanel canManage={can("ai.manage")} /> : <Result status="403" title="Sin acceso" />
          ) : (
            can("highlevel.contacts.view") ? <HighLevelContacts /> : <Result status="403" title="Sin acceso" />
          )}
        </section>
      </Layout.Content>
    </Layout>
  );
}

function SessionGate() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    requestJson<{ user: SessionUser | null }>("/auth/me")
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <main className="centered-page">
        <Spin size="large" />
      </main>
    );
  }

  if (!user) return <LoginScreen />;

  if (user.status !== "active") {
    return (
      <main className="centered-page">
        <Result
          status="info"
          title="Tu acceso está pendiente"
          subTitle="Un administrador debe habilitar tu usuario antes de que puedas ingresar."
          extra={<Button onClick={() => window.location.assign("/auth/google")}>Volver a intentar</Button>}
        />
      </main>
    );
  }

  return <AdminPanel sessionUser={user} />;
}

export function App() {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#ef7d00",
          colorInfo: "#1657b8",
          colorText: "#17324d",
          borderRadius: 10,
          fontFamily: "Inter, Arial, Helvetica, sans-serif",
        },
      }}
    >
      <AntApp>
        <SessionGate />
      </AntApp>
    </ConfigProvider>
  );
}
