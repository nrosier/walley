/**
 * Wallos API shapes, from the official Wallos source (ellite/Wallos, main):
 * api/subscriptions/get_subscriptions.php, confirmed 2026-10-22. Only fields that source
 * documents are declared. Fields the example response omits for some subscriptions are
 * optional.
 */
export interface WallosSubscription {
  id: number | string;
  name?: string;
  logo?: string;
  price?: number | string;
  currency_id?: number | string;
  start_date?: string;
  next_payment?: string;
  cycle?: number | string;
  frequency?: number | string;
  auto_renew?: number | boolean;
  notes?: string;
  payment_method_id?: number | string;
  payer_user_id?: number | string;
  category_id?: number | string;
  notify?: number | boolean;
  url?: string;
  inactive?: number | boolean;
  notify_days_before?: number | string;
  user_id?: number | string;
  cancelation_date?: string | null;
  cancellation_date?: string | null;
  replacement_subscription_id?: number | string | null;
  category_name?: string;
  category_ids?: Array<number | string>;
  category_names?: string[];
  payer_user_name?: string;
  payer_user_ids?: Array<number | string>;
  payer_user_names?: string[];
  payment_method_name?: string;
}

/**
 * Response envelope. Auth failures arrive as HTTP 200 with `success: false` and a `title`
 * such as "Invalid API key" or "Missing parameters".
 */
export interface WallosSubscriptionsResponse {
  success: boolean;
  title?: string;
  subscriptions?: WallosSubscription[];
  notes?: unknown[];
}

/**
 * One entry of `currencies` from api/currencies/get_currencies.php (ellite/Wallos, main,
 * confirmed 2026-10-22). The source also sends symbol and in_use; they are not kept.
 * `rate` is the exchange rate Wallos uses for the currency, quoted as a decimal string
 * (for example "1.1000"). It is relative to the Wallos main currency, which is
 * `main_currency` in the same response (not kept here). Optional: absent when Wallos omits it.
 */
export interface WallosCurrency {
  id: number | string;
  code: string;
  name?: string;
  rate?: string;
}

/**
 * One entry of `payment_methods` from api/payment_methods/get_payment_methods.php
 * (ellite/Wallos, main d799b8f). Only the caller's own, enabled methods are kept, as `id`
 * (a string of digits) and `name`. The source also sends icon, enabled, order and in_use.
 */
export interface WallosPaymentMethod {
  id: string;
  name: string;
}

/**
 * One entry of `categories` from api/categories/get_categories.php (ellite/Wallos, main
 * d799b8f). Kept as `id` (a string of digits) and `name`; order and in_use are dropped.
 */
export interface WallosCategory {
  id: string;
  name: string;
}

export const WALLOS_SUBSCRIPTION_FIELDS = [
  'id',
  'name',
  'logo',
  'price',
  'currency_id',
  'start_date',
  'next_payment',
  'cycle',
  'frequency',
  'auto_renew',
  'notes',
  'payment_method_id',
  'payer_user_id',
  'category_id',
  'notify',
  'url',
  'inactive',
  'notify_days_before',
  'user_id',
  'cancelation_date',
  'cancellation_date',
  'replacement_subscription_id',
  'category_name',
  'category_ids',
  'category_names',
  'payer_user_name',
  'payer_user_ids',
  'payer_user_names',
  'payment_method_name',
] as const satisfies ReadonlyArray<keyof WallosSubscription>;
