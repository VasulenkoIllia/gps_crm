import { Button, Checkbox, Table, Tag } from "antd";
import { useStore } from "../store/DemoStore";
import { DEFAULT_ROLE_MATRIX, PERMISSIONS, ROLE_LABELS, type Permission } from "../domain/permissions";
import type { RoleId } from "../domain/types";
import { USERS } from "../data/reference";
import { PageTitle, Section } from "../components/ui";

const ROLES: RoleId[] = ["admin", "manager", "tech"];

export default function Roles() {
  const { ui, setUi, can } = useStore();
  const editable = can("users.manage");

  const toggle = (role: RoleId, perm: Permission, on: boolean) => {
    const current = ui.matrix[role];
    setUi({ matrix: { ...ui.matrix, [role]: on ? [...current, perm] : current.filter((p) => p !== perm) } });
  };

  return (
    <>
      <PageTitle
        title="Ролі та доступи"
        extra={
          editable && (
            <Button onClick={() => setUi({ matrix: DEFAULT_ROLE_MATRIX })}>Повернути пропозицію</Button>
          )
        }
      >
        Пропозиція прав для обговорення. Змініть галочку і перемкніть роль у шапці, щоб побачити результат.
      </PageTitle>

      <div className="grid grid-roles">
        <Section title="Матриця прав">
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={PERMISSIONS}
            scroll={{ x: 640 }}
            columns={[
              { title: "Розділ", dataIndex: "group", width: 120, render: (g: string) => <span className="secondary">{g}</span> },
              {
                title: "Право",
                dataIndex: "label",
              },
              ...ROLES.map((role) => ({
                title: ROLE_LABELS[role],
                align: "center" as const,
                width: 120,
                render: (_: unknown, p: (typeof PERMISSIONS)[number]) => (
                  <Checkbox
                    checked={ui.matrix[role].includes(p.id)}
                    disabled={!editable || role === "admin"}
                    onChange={(e) => toggle(role, p.id, e.target.checked)}
                    aria-label={`${ROLE_LABELS[role]}: ${p.label}`}
                  />
                ),
              })),
            ]}
          />
        </Section>
        <div className="grid" style={{ alignContent: "start" }}>
          <Section title="Користувачі">
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={USERS}
              columns={[
                { title: "Ім'я", dataIndex: "name" },
                { title: "Роль", render: (_, u) => <Tag>{ROLE_LABELS[u.role]}</Tag> },
              ]}
            />
          </Section>
          <Section title="Журнал змін">
            <p className="secondary" style={{ margin: 0 }}>
              Кожна зміна (хто, коли, що змінив) записується в журнал абонента та об'єкта замість поля «Дата останньої зміни».
              Видалення «м'яке», з можливістю відновлення.
            </p>
          </Section>
        </div>
      </div>
    </>
  );
}
