import { scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
type SqlTx = { unsafe: (query: string, params?: any[]) => Promise<any[]> };

const scrypt = promisify(scryptCallback);

export async function verifyPin(pin: string, stored: string) {
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;
  const derived = await scrypt(pin, salt, 64) as Buffer;
  const expected = Buffer.from(key, "hex");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export async function findManagerByPin(tx: SqlTx, pin: string) {
  if (!/^\d{4,6}$/.test(pin)) return null;
  const managers = await tx.unsafe("select id, full_name, pin_hash from users where role in ('admin','manager') and is_active=true and pin_hash is not null");
  for (const manager of managers) {
    if (await verifyPin(pin, manager.pin_hash)) return manager;
  }
  return null;
}
