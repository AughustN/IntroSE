import { useRef, useState } from "react";

/** Optimistic preview with rollback to the last server-confirmed media settings. */
export function usePersistedMedia<T>(value: T, onChange: (value: T) => void) {
  const persisted = useRef(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (operation: () => Promise<T | void>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await operation();
      if (next) {
        persisted.current = next;
        onChange(next);
      }
    } catch (reason) {
      setError((reason as Error).message);
      onChange(persisted.current);
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, run };
}
