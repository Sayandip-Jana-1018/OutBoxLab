import { cn } from "@/lib/utils";
import {
  CAMPAIGN_STATUS_STYLES,
  EMAIL_STATUS_STYLES,
} from "@/lib/format";
import type { CampaignStatus, EmailStatus } from "@/lib/types";

export function EmailStatusChip({
  status,
  className,
  pulse,
}: {
  status: EmailStatus;
  className?: string;
  pulse?: boolean;
}) {
  const style = EMAIL_STATUS_STYLES[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
        style.chip,
        className,
      )}
    >
      <span
        className={cn("h-1.5 w-1.5 rounded-full", pulse && "animate-pulse")}
        style={{ backgroundColor: style.dot }}
      />
      {style.label}
    </span>
  );
}

export function CampaignStatusChip({
  status,
  className,
}: {
  status: CampaignStatus;
  className?: string;
}) {
  const style = CAMPAIGN_STATUS_STYLES[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
        style.chip,
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: style.dot }} />
      {style.label}
    </span>
  );
}
