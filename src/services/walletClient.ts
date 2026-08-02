import { withAuthRetry } from "./authClient";

export interface CheckoutOrder {
  id: number;
  reservationId: number;
  showtimeId: number;
  totalAmount: number;
  paymentMethod: "wallet";
  status: "paid" | "refunded";
  createdAt: string;
  tickets: Array<{
    id: number;
    ticketCode: string;
    status: "valid" | "used" | "refunded";
    tierLabel: string;
    seatLabel: string | null;
    unitPriceAmount: number;
  }>;
}

export class WalletError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await withAuthRetry((token) => {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(`/api${path}`, {
      method: opts.method ?? "GET",
      headers,
      credentials: "include",
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok)
    throw new WalletError(
      body.error ?? "checkout_failed",
      body.message ?? "Không thể thanh toán bằng ví.",
    );
  return body as T;
}

export const walletClient = {
  checkout: (reservationId: number): Promise<CheckoutOrder> =>
    call("/checkout", { method: "POST", body: { reservationId } }),
};
