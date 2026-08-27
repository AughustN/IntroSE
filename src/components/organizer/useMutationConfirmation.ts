import type { ConfirmRequest } from "../ConfirmDialog";
import { useConfirmation } from "../../hooks/useConfirmation";
import { mutationConfirmation } from "./mutationConfirmation";

export function useMutationConfirmation(isLive: boolean) {
  const { ask, dialog } = useConfirmation();
  const confirmMutation = async (fields: readonly string[], destructive?: ConfirmRequest) => {
    const request = mutationConfirmation(isLive, fields, destructive);
    return request ? ask(request) : true;
  };
  return { confirmMutation, dialog };
}
