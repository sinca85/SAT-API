import {
  CheckCircleOutlined,
  DownOutlined,
  GoogleOutlined,
  LogoutOutlined,
  ContactsOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  App as AntApp,
  Avatar,
  Button,
  ConfigProvider,
  Dropdown,
  Empty,
  Flex,
  Layout,
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
import { useCallback, useEffect, useMemo, useState } from "react";
import satLogoWhite from "../../../Recursos/sat-logo-full-blanco.svg";

type UserRole = "admin" | "user";
type UserStatus = "pending" | "active" | "disabled";
type View = "users" | "permissions" | "highlevel-contacts";

interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  permissions: string[];
}

interface AdminUser {
  _id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  permissions: string[];
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
  loading,
  onUpdate,
}: {
  users: AdminUser[];
  loading: boolean;
  onUpdate: (userId: string, input: Partial<Pick<AdminUser, "role" | "status" | "permissions">>) => Promise<void>;
}) {
  const { message } = AntApp.useApp();
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const update = useCallback(
    async (userId: string, input: Partial<Pick<AdminUser, "role" | "status" | "permissions">>) => {
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
      title: "Rol",
      dataIndex: "role",
      key: "role",
      width: 160,
      render: (role: UserRole, user) => (
        <Select
          aria-label={`Rol de ${user.name}`}
          value={role}
          disabled={updatingId === user._id}
          onChange={(value: UserRole) => void update(user._id, { role: value })}
          options={[
            { value: "admin", label: "Administrador" },
            { value: "user", label: "Usuario" },
          ]}
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

function PermissionsTable({
  users,
  loading,
  onUpdate,
}: {
  users: AdminUser[];
  loading: boolean;
  onUpdate: (userId: string, input: { permissions: string[] }) => Promise<void>;
}) {
  const { message } = AntApp.useApp();
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const columns: TableColumnsType<AdminUser> = [
    {
      title: "Usuario",
      key: "user",
      width: 280,
      render: (_, user) => (
        <div>
          <Typography.Text strong>{user.name}</Typography.Text>
          <Typography.Text type="secondary" className="block-text">
            {user.email}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: "Permisos",
      dataIndex: "permissions",
      key: "permissions",
      render: (permissions: string[], user) => (
        <Select
          mode="tags"
          aria-label={`Permisos de ${user.name}`}
          className="permissions-select"
          placeholder="Agregar permiso"
          value={permissions}
          disabled={updatingId === user._id}
          tokenSeparators={[","]}
          onChange={async (values: string[]) => {
            setUpdatingId(user._id);
            try {
              await onUpdate(user._id, { permissions: values });
              message.success("Permisos actualizados");
            } catch (error) {
              message.error(error instanceof Error ? error.message : "No se pudieron actualizar los permisos");
            } finally {
              setUpdatingId(null);
            }
          }}
          options={[]}
        />
      ),
    },
  ];

  return (
    <Table
      rowKey="_id"
      columns={columns}
      dataSource={users}
      loading={loading}
      pagination={false}
      scroll={{ x: 680 }}
      locale={{ emptyText: <Empty description="Todavía no hay usuarios" /> }}
    />
  );
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

function AdminPanel({ sessionUser }: { sessionUser: SessionUser }) {
  const { message } = AntApp.useApp();
  const [view, setView] = useState<View>("users");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await requestJson<{ users: AdminUser[] }>("/admin/users");
      setUsers(data.users);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "No se pudieron cargar los usuarios");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const updateUser = useCallback(
    async (userId: string, input: Partial<Pick<AdminUser, "role" | "status" | "permissions">>) => {
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
      { key: "users", label: "Ver todos los usuarios", icon: <TeamOutlined /> },
      { key: "permissions", label: "Ver permisos", icon: <SafetyCertificateOutlined /> },
    ],
    [],
  );

  const highLevelMenu = useMemo<MenuProps["items"]>(
    () => [
      { key: "highlevel-contacts", label: "Contactos", icon: <ContactsOutlined /> },
    ],
    [],
  );

  const logout = async () => {
    await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
    window.location.assign("/");
  };

  return (
    <Layout className="admin-layout">
      <Layout.Header className="admin-header">
        <img className="brand-logo" src={satLogoWhite} alt="Seguro a Tiempo" />
        <nav aria-label="Navegación principal">
          <Space>
            <Dropdown
              menu={{ items: userMenu, onClick: ({ key }) => setView(key as View) }}
              trigger={["click"]}
            >
              <Button type="text" className="header-menu-button" icon={<TeamOutlined />}>
                Usuarios <DownOutlined />
              </Button>
            </Dropdown>
            <Dropdown
              menu={{ items: highLevelMenu, onClick: ({ key }) => setView(key as View) }}
              trigger={["click"]}
            >
              <Button type="text" className="header-menu-button" icon={<ContactsOutlined />}>
                HighLevel <DownOutlined />
              </Button>
            </Dropdown>
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
              {view === "users" ? "Usuarios" : view === "permissions" ? "Permisos" : "Contactos de HighLevel"}
            </Typography.Title>
            <Typography.Text type="secondary">
              {view === "users"
                ? "Administrá quién puede ingresar al sistema y su nivel de acceso."
                : view === "permissions"
                  ? "Asigná permisos específicos como etiquetas a cada usuario."
                  : "Contactos sincronizados desde la subcuenta de Seguro a Tiempo."}
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
            <UsersTable users={users} loading={loading} onUpdate={updateUser} />
          ) : view === "permissions" ? (
            <PermissionsTable users={users} loading={loading} onUpdate={updateUser} />
          ) : (
            <HighLevelContacts />
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

  if (user.role !== "admin") {
    return (
      <main className="centered-page">
        <Result status="403" title="Sin acceso al panel" subTitle="Tu usuario no tiene permisos de administrador." />
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
