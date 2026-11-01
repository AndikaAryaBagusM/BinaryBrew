import type { MessageKey } from "@/i18n";
import type { UserRole } from "@/modules/auth/service";

export const roleLabel: Record<UserRole, MessageKey> = {
  owner: "counter.roleOwner",
  staff: "counter.roleStaff",
  barista: "counter.roleBarista",
};
