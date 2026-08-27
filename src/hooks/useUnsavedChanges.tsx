import { useEffect, useState } from "react";
import ConfirmDialog from "../components/ConfirmDialog";
import { useNavigationGuard } from "./NavigationGuard";

export function useUnsavedChanges({
  dirty,
  busy,
  save,
  warning,
}: {
  dirty: boolean;
  busy: boolean;
  save: () => Promise<boolean>;
  warning?: string;
}) {
  const { registerGuard, requestNavigation } = useNavigationGuard();
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!dirty && !busy) return;
    const unregister = registerGuard((proceed) => {
      setError(null);
      setPending(() => proceed);
    });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      unregister();
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [dirty, busy, registerGuard]);
  const leave = () => {
    setPending(null);
    pending?.();
  };
  const saveAndLeave = async () => {
    if (saving || busy) return;
    setSaving(true);
    setError(null);
    try {
      if (await save()) leave();
      else
        setError(
          "Chưa lưu được thay đổi. Nội dung vẫn được giữ; hãy thử lại hoặc ở lại để kiểm tra lỗi.",
        );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Chưa lưu được thay đổi. Hãy thử lại.");
    } finally {
      setSaving(false);
    }
  };
  return {
    requestLeave: requestNavigation,
    dialog: pending && (
      <ConfirmDialog
        title="Bạn có thay đổi chưa lưu"
        message={`Lưu thay đổi trước khi rời màn chỉnh sửa? Chọn “Bỏ thay đổi” sẽ bỏ phần chưa lưu.${warning ? `\n\nNếu lưu: ${warning}` : ""}`}
        confirmLabel="Bỏ thay đổi"
        cancelLabel="Ở lại"
        tone="danger"
        busy={busy || saving}
        error={error}
        onConfirm={leave}
        onCancel={() => setPending(null)}
        onSave={() => void saveAndLeave()}
      />
    ),
  };
}
