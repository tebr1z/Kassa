import { z } from "zod";
import {checkoutContactError} from './customer-contact';

const checkoutPayloadSchema = z.object({
  requestKey: z.string().uuid(),
  coupon: z.string().max(30),
  expectedTotal: z.number().finite().min(0),
  fulfillment: z.enum(["pickup", "delivery"]),
  deliveryQuoteId: z.string().uuid().nullable().optional(),
  address: z.string().max(500),
  name: z.string().min(2).max(100),
  phone: z.string().min(7).max(32),
  note: z.string().max(1000),
  items: z.array(z.object({ id: z.string().uuid(), optionId:z.string().uuid().nullable().optional(), quantity: z.number().int().min(1).max(100) })).min(1).max(50),
});

const checkoutAttemptSchema = z.object({
  version: z.literal(1),
  accountId: z.string().uuid(),
  createdAt: z.string().datetime(),
  payload: checkoutPayloadSchema,
  itemNames: z.record(z.string().max(500)),
});

export type CheckoutPayload = z.infer<typeof checkoutPayloadSchema>;
export type CheckoutAttempt = z.infer<typeof checkoutAttemptSchema>;
type AttemptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type AttemptState = { status: "empty" } | { status: "blocked" } | { status: "pending"; attempt: CheckoutAttempt };
const storageKey = (accountId: string) => "customer-checkout-attempt:" + accountId;

// Do not silently discard an unreadable attempt: its order may already exist.
export function readCheckoutAttempt(accountId: string, storage?: AttemptStorage): AttemptState {
  try {
    const raw = (storage ?? globalThis.sessionStorage).getItem(storageKey(accountId));
    if (raw === null) return { status: "empty" };
    const parsed = checkoutAttemptSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.accountId !== accountId) return { status: "blocked" };
    return { status: "pending", attempt: parsed.data };
  } catch {
    return { status: "blocked" };
  }
}

export function saveCheckoutAttempt(attempt: CheckoutAttempt, storage?: AttemptStorage): boolean {
  try {
    const parsed = checkoutAttemptSchema.parse(attempt);
    // Keep the reader backwards-compatible: an old attempt may already have
    // committed. Only newly saved attempts require today's contact rules.
    if (checkoutContactError(parsed.payload)) return false;
    const target = storage ?? globalThis.sessionStorage;
    const key = storageKey(parsed.accountId);
    const value = JSON.stringify(parsed);
    target.setItem(key, value);
    return target.getItem(key) === value;
  } catch {
    return false;
  }
}

export function clearCheckoutAttempt(accountId: string, requestKey: string, storage?: AttemptStorage): boolean {
  const current = readCheckoutAttempt(accountId, storage);
  if (current.status === "empty") return true;
  if (current.status !== "pending" || current.attempt.payload.requestKey !== requestKey) return false;
  try {
    (storage ?? globalThis.sessionStorage).removeItem(storageKey(accountId));
    return true;
  } catch {
    return false;
  }
}

export function isDefinitiveCheckoutRejection(status: number) {
  return status === 400;
}
