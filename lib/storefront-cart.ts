export type CustomerCart = Record<string, number>;
export function sanitizeCart(value: unknown): CustomerCart {
 if (!value || typeof value !== "object" || Array.isArray(value)) return {};
 return Object.fromEntries(Object.entries(value).filter(([id, qty]) => /^[0-9a-f-]{36}$/i.test(id) && typeof qty === "number" && Number.isInteger(qty) && qty > 0 && qty <= 100));
}
export function readCart(): CustomerCart {
 try { return sanitizeCart(JSON.parse(sessionStorage.getItem("customer-cart") || "{}")); } catch { return {}; }
}
export function saveCart(cart:CustomerCart) {
 try { sessionStorage.setItem("customer-cart", JSON.stringify(cart)); } catch { /* Storage may be disabled; this page still keeps the basket. */ }
}
