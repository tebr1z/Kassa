// HTML pattern uses Unicode Sets (v), which requires escaping parentheses too.
export const customerPhonePattern = '[+0-9 \\(\\)\\-]{7,25}';

export function isCustomerPhone(value: string) {
  const phone = value.trim();
  const digits = phone.replace(/\D/g, '').length;
  return /^[+0-9 ()-]{7,25}$/.test(phone) && digits >= 7 && digits <= 15;
}

export function isCustomerName(value: string) {
  const length = value.trim().length;
  return length >= 2 && length <= 100;
}

export function checkoutContactError({name, phone}: {name: string; phone: string}) {
  if (!isCustomerName(name)) return 'Ad, telefon və məhsulları düzgün daxil edin.';
  if (!isCustomerPhone(phone)) return 'Əlaqə telefonunu düzgün yazın.';
  return '';
}
