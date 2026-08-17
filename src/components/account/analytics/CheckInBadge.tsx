import React from "react";
import { UserCheck } from "lucide-react";

interface Props {
  scannedCount: number;
  ratePct: number;
}

export function CheckInBadge({ scannedCount, ratePct }: Props) {
  return (
    <div className="inline-flex items-center gap-2 border border-la-co/30 bg-la-co/10 px-3 py-1.5 text-xs font-bold text-la-co">
      <UserCheck className="h-4 w-4" />
      <span>
        Check-in: {scannedCount} lượt ({ratePct}%)
      </span>
    </div>
  );
}
