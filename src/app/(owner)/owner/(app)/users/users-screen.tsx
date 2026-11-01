"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Info, KeyRound, Plus, Tablet } from "lucide-react";
import Link from "next/link";
import { type FormEvent, type ReactNode, useState } from "react";
import { Button } from "@/components/button";
import { TextField } from "@/components/field";
import { Modal } from "@/components/modal";
import { type MessageKey, t } from "@/i18n";
import { api, type ApiResult, type Json } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { roleLabel } from "@/lib/role-label";
import { formatDate, formatLastActive } from "@/lib/time";
import type { DeviceSummary, UserSummary } from "@/modules/auth/service";
import {
  Notice,
  PageBody,
  PageHead,
  TableCard,
  Tag,
  tdClass,
  thClass,
  useSignedOutGuard,
} from "../owner-ui";

export type UserData = Json<UserSummary>;
export type DeviceData = Json<DeviceSummary>;

const USERS_QUERY = ["owner", "users"] as const;
const DEVICES_QUERY = ["owner", "devices"] as const;

const deviceKindLabel: Record<DeviceData["kind"], MessageKey> = {
  counter: "owner.deviceCounter",
  kitchen: "owner.deviceKitchen",
  other: "owner.deviceOther",
};

type Dialog =
  { kind: "add" } | { kind: "pin"; user: UserData } | { kind: "device" } | null;

export function UsersScreen({
  initialUsers,
  initialDevices,
}: {
  initialUsers: UserData[];
  initialDevices: DeviceData[];
}) {
  const queryClient = useQueryClient();
  const signedOut = useSignedOutGuard();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [done, setDone] = useState<ReactNode>(null);

  const { data: users } = useQuery({
    queryKey: USERS_QUERY,
    queryFn: async () => {
      const result = await api<{ users: UserData[] }>("/api/owner/users");
      if (signedOut(result)) return initialUsers;
      if (!result.ok) throw new Error(result.error.message);
      return result.data.users;
    },
    initialData: initialUsers,
  });
  const { data: devices } = useQuery({
    queryKey: DEVICES_QUERY,
    queryFn: async () => {
      const result = await api<{ devices: DeviceData[] }>("/api/owner/devices");
      if (signedOut(result)) return initialDevices;
      if (!result.ok) throw new Error(result.error.message);
      return result.data.devices;
    },
    initialData: initialDevices,
  });

  const now = new Date();
  const lastActive = (at: string | null) =>
    at ? formatLastActive(new Date(at), now, t("owner.yesterday")) : "—";

  return (
    <PageBody>
      <PageHead
        title={t("owner.usersTitle")}
        subtitle={t("owner.usersSubtitle")}
      >
        <Button
          icon={<Plus aria-hidden="true" />}
          onClick={() => {
            setDone(null);
            setDialog({ kind: "add" });
          }}
        >
          {t("owner.addUser")}
        </Button>
      </PageHead>

      {done && <Notice tone="success">{done}</Notice>}

      <TableCard label={t("owner.usersTitle")} minWidth="min-w-220">
        <thead>
          <tr>
            <th scope="col" className={thClass}>
              {t("owner.colName")}
            </th>
            <th scope="col" className={`${thClass} w-36`}>
              {t("owner.colRole")}
            </th>
            <th scope="col" className={`${thClass} w-52`}>
              {t("owner.colSignIn")}
            </th>
            <th scope="col" className={`${thClass} w-28`}>
              {t("owner.colStatus")}
            </th>
            <th scope="col" className={`${thClass} w-36`}>
              {t("owner.colLastActive")}
            </th>
            <th scope="col" className={`${thClass} w-40`}>
              <span className="sr-only">{t("owner.colActions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <th scope="row" className={`${tdClass} font-semibold`}>
                {user.name}
              </th>
              <td className={tdClass}>{t(roleLabel[user.role])}</td>
              <td className={tdClass}>
                {user.role === "owner"
                  ? t("owner.signInOwner")
                  : t("owner.signInPin")}
              </td>
              <td className={tdClass}>
                {user.isActive ? (
                  <Tag tone="ready">{t("owner.active")}</Tag>
                ) : (
                  <Tag tone="expired">{t("owner.inactive")}</Tag>
                )}
              </td>
              <td className={tdClass} suppressHydrationWarning>
                {lastActive(user.lastActiveAt)}
              </td>
              <td className={`${tdClass} text-right`}>
                <Button
                  variant="ghost"
                  icon={<KeyRound aria-hidden="true" />}
                  aria-label={t("owner.resetPinFor", { name: user.name })}
                  onClick={() => {
                    setDone(null);
                    setDialog({ kind: "pin", user });
                  }}
                >
                  {t("owner.resetPin")}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </TableCard>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h2 className="flex-1 text-h2 text-ink">{t("owner.devicesTitle")}</h2>
        <Button
          variant="secondary"
          icon={<Tablet aria-hidden="true" />}
          onClick={() => {
            setDone(null);
            setDialog({ kind: "device" });
          }}
        >
          {t("owner.registerThisDevice")}
        </Button>
      </div>

      <TableCard label={t("owner.devicesTitle")} minWidth="min-w-180">
        <thead>
          <tr>
            <th scope="col" className={thClass}>
              {t("owner.colDevice")}
            </th>
            <th scope="col" className={`${thClass} w-32`}>
              {t("owner.colKind")}
            </th>
            <th scope="col" className={`${thClass} w-60`}>
              {t("owner.colRegistered")}
            </th>
            <th scope="col" className={`${thClass} w-36`}>
              {t("owner.colLastActive")}
            </th>
          </tr>
        </thead>
        <tbody>
          {devices.length === 0 && (
            <tr>
              <td colSpan={4} className={`${tdClass} text-ink-muted`}>
                {t("owner.devicesEmpty")}
              </td>
            </tr>
          )}
          {devices.map((device) => (
            <tr key={device.id}>
              <th scope="row" className={`${tdClass} font-semibold`}>
                <span className="flex items-center gap-2">
                  {device.name}
                  {device.revokedAt && (
                    <Tag tone="expired">{t("owner.deviceRevoked")}</Tag>
                  )}
                </span>
              </th>
              <td className={tdClass}>{t(deviceKindLabel[device.kind])}</td>
              <td className={tdClass}>
                {device.registeredByName
                  ? t("owner.registeredBy", {
                      date: formatDate(new Date(device.registeredAt)),
                      name: device.registeredByName,
                    })
                  : formatDate(new Date(device.registeredAt))}
              </td>
              <td className={tdClass} suppressHydrationWarning>
                {lastActive(device.lastSeenAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </TableCard>

      <div className="flex gap-3 rounded-card bg-info-soft px-4 py-3.5">
        <Info
          aria-hidden="true"
          size={20}
          className="mt-0.5 shrink-0 text-info"
        />
        <div>
          <p className="text-body font-semibold text-ink">
            {t("owner.boardNoteTitle")}
          </p>
          <p className="text-caption text-ink-muted">
            {t("owner.boardNoteBody")}
          </p>
        </div>
      </div>

      {dialog?.kind === "add" && (
        <AddUserDialog
          onClose={() => setDialog(null)}
          onDone={async (name) => {
            await queryClient.invalidateQueries({ queryKey: USERS_QUERY });
            setDialog(null);
            setDone(t("owner.userAdded", { name }));
          }}
        />
      )}
      {dialog?.kind === "pin" && (
        <ResetPinDialog
          user={dialog.user}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            setDone(t("owner.pinReset", { name: dialog.user.name }));
          }}
        />
      )}
      {dialog?.kind === "device" && (
        <RegisterDeviceDialog
          onClose={() => setDialog(null)}
          onDone={async (name) => {
            await queryClient.invalidateQueries({ queryKey: DEVICES_QUERY });
            setDialog(null);
            setDone(
              <>
                {t("owner.deviceRegistered", { name })}{" "}
                <Link
                  href="/counter/login"
                  className="focus-ring underline"
                  prefetch={false}
                >
                  {t("owner.openCounterLogin")}
                </Link>
              </>,
            );
          }}
        />
      )}
    </PageBody>
  );
}

const PIN = /^\d{4,6}$/;

// Shared by "Tambah pengguna" and "Reset PIN": the PIN twice, so a typo
// does not lock the person out.
function usePinPair() {
  const [pin, setPin] = useState("");
  const [repeat, setRepeat] = useState("");
  const [errors, setErrors] = useState<{ pin?: string; repeat?: string }>({});
  function check(): boolean {
    const next: typeof errors = {};
    if (!PIN.test(pin)) next.pin = t("owner.pinInvalid");
    else if (pin !== repeat) next.repeat = t("owner.pinMismatch");
    setErrors(next);
    return Object.keys(next).length === 0;
  }
  const fields = (
    <>
      <TextField
        label={t("owner.pinNew")}
        type="password"
        inputMode="numeric"
        autoComplete="new-password"
        maxLength={6}
        value={pin}
        error={errors.pin}
        helper={t("owner.pinHelp")}
        onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
      />
      <TextField
        label={t("owner.pinRepeat")}
        type="password"
        inputMode="numeric"
        autoComplete="new-password"
        maxLength={6}
        value={repeat}
        error={errors.repeat}
        onChange={(event) => setRepeat(event.target.value.replace(/\D/g, ""))}
      />
    </>
  );
  return { pin, check, fields };
}

function DialogForm({
  title,
  description,
  submitLabel,
  busy,
  failure,
  onSubmit,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  submitLabel: string;
  busy: boolean;
  failure: string | null;
  onSubmit: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal
      title={title}
      description={description}
      width="w-120"
      onClose={onClose}
    >
      <form
        noValidate
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          onSubmit();
        }}
        className="flex flex-col gap-4 px-6 pt-4 pb-6"
      >
        {failure && <Notice tone="danger">{failure}</Notice>}
        {children}
        <Button
          type="submit"
          loading={busy}
          icon={<Check aria-hidden="true" />}
          className="mt-2 w-full"
        >
          {submitLabel}
        </Button>
      </form>
    </Modal>
  );
}

function useSubmit() {
  const signedOut = useSignedOutGuard();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  async function submit<T>(
    request: () => Promise<ApiResult<T>>,
  ): Promise<T | null> {
    setBusy(true);
    setFailure(null);
    const result = await request();
    if (signedOut(result)) return null;
    setBusy(false);
    if (!result.ok) {
      setFailure(result.error.message);
      return null;
    }
    return result.data;
  }
  return { busy, failure, submit };
}

function AddUserDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [role, setRole] = useState<"staff" | "barista">("staff");
  const pins = usePinPair();
  const { busy, failure, submit } = useSubmit();

  async function save() {
    const trimmed = name.trim();
    setNameError(trimmed ? null : t("owner.nameRequired"));
    if (!pins.check() || !trimmed) return;
    const user = await submit<{ name: string }>(() =>
      api("/api/owner/users", {
        method: "POST",
        body: { name: trimmed, role, pin: pins.pin },
      }),
    );
    if (user) await onDone(user.name);
  }

  return (
    <DialogForm
      title={t("owner.addUser")}
      description={t("owner.addUserHelp")}
      submitLabel={t("owner.addUser")}
      busy={busy}
      failure={failure}
      onSubmit={() => void save()}
      onClose={onClose}
    >
      <TextField
        label={t("owner.colName")}
        value={name}
        maxLength={40}
        autoComplete="off"
        error={nameError}
        onChange={(event) => setName(event.target.value)}
      />
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-caption font-medium text-ink">
          {t("owner.colRole")}
        </legend>
        <div className="grid grid-cols-2 gap-3">
          {(["staff", "barista"] as const).map((value) => (
            <label
              key={value}
              className={cn(
                "flex h-12 cursor-pointer items-center gap-2.5 rounded-control border px-3.5 text-body has-focus-visible:outline-3 has-focus-visible:outline-brand",
                role === value
                  ? "border-brand bg-accent-soft font-semibold text-brand"
                  : "border-border-strong text-ink",
              )}
            >
              <input
                type="radio"
                name="role"
                value={value}
                checked={role === value}
                onChange={() => setRole(value)}
                className="size-4 accent-brand"
              />
              {t(roleLabel[value])}
            </label>
          ))}
        </div>
      </fieldset>
      {pins.fields}
    </DialogForm>
  );
}

function ResetPinDialog({
  user,
  onClose,
  onDone,
}: {
  user: UserData;
  onClose: () => void;
  onDone: () => void;
}) {
  const pins = usePinPair();
  const { busy, failure, submit } = useSubmit();

  async function save() {
    if (!pins.check()) return;
    const result = await submit(() =>
      api(`/api/owner/users/${user.id}/pin`, {
        method: "POST",
        body: { pin: pins.pin },
      }),
    );
    if (result) onDone();
  }

  return (
    <DialogForm
      title={t("owner.resetPinFor", { name: user.name })}
      description={t("owner.resetPinHelp", { name: user.name })}
      submitLabel={t("owner.savePin")}
      busy={busy}
      failure={failure}
      onSubmit={() => void save()}
      onClose={onClose}
    >
      {pins.fields}
    </DialogForm>
  );
}

function RegisterDeviceDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const { busy, failure, submit } = useSubmit();

  async function save() {
    const trimmed = name.trim();
    setNameError(trimmed ? null : t("owner.nameRequired"));
    if (!trimmed) return;
    const result = await submit<{ device: { name: string } }>(() =>
      api("/api/devices/register", { method: "POST", body: { name: trimmed } }),
    );
    if (result) await onDone(result.device.name);
  }

  return (
    <DialogForm
      title={t("owner.registerThisDevice")}
      description={t("owner.registerDeviceHelp")}
      submitLabel={t("owner.register")}
      busy={busy}
      failure={failure}
      onSubmit={() => void save()}
      onClose={onClose}
    >
      <TextField
        label={t("owner.deviceName")}
        placeholder={t("owner.deviceNamePlaceholder")}
        value={name}
        maxLength={60}
        autoComplete="off"
        error={nameError}
        onChange={(event) => setName(event.target.value)}
      />
    </DialogForm>
  );
}
