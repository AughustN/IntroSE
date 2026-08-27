import { useCallback, useEffect, useRef, useState } from "react";
import ConfirmDialog, { type ConfirmRequest } from "../components/ConfirmDialog";

export function useConfirmation() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolve = useRef<((answer: boolean) => void) | null>(null);
  const ask = useCallback(
    (next: ConfirmRequest) =>
      new Promise<boolean>((answer) => {
        resolve.current?.(false);
        resolve.current = answer;
        setRequest(next);
      }),
    [],
  );
  const answer = useCallback((value: boolean) => {
    resolve.current?.(value);
    resolve.current = null;
    setRequest(null);
  }, []);
  useEffect(
    () => () => {
      resolve.current?.(false);
      resolve.current = null;
    },
    [],
  );
  return {
    ask,
    dialog: request && (
      <ConfirmDialog {...request} onConfirm={() => answer(true)} onCancel={() => answer(false)} />
    ),
  };
}
