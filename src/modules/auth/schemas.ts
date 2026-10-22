import { z } from "zod";
import { elevationScopes } from "./service";

// Request bodies (Tech §5: Zod at every boundary, unknown fields rejected).
const pin = z.string().regex(/^\d{4,6}$/);

export const ownerLoginBody = z.strictObject({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
});

export const pinLoginBody = z.strictObject({
  userId: z.uuid(),
  pin,
});

export const elevateBody = z.strictObject({
  pin,
  scope: z.enum(elevationScopes),
});

export const registerDeviceBody = z.strictObject({
  name: z.string().trim().min(1).max(60),
});
