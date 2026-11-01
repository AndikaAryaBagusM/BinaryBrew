import { Suspense } from "react";
import { listDevices, listUsers } from "@/modules/auth/service";
import { asJson, ownerSessionOrLogin } from "../../session";
import { type DeviceData, type UserData, UsersScreen } from "./users-screen";

// O-13 basic (FR-OW-05, Figma 22:2347): users, PIN reset, register this
// device. Revoking devices and switching users off come with P3-05.
export default function OwnerUsersPage() {
  return (
    <Suspense fallback={null}>
      <Users />
    </Suspense>
  );
}

async function Users() {
  const session = await ownerSessionOrLogin();
  const [users, devices] = await Promise.all([
    listUsers(session),
    listDevices(session),
  ]);
  // Same JSON shapes as GET /api/owner/users and /api/owner/devices.
  return (
    <UsersScreen
      initialUsers={asJson<UserData[]>(users)}
      initialDevices={asJson<DeviceData[]>(devices)}
    />
  );
}
