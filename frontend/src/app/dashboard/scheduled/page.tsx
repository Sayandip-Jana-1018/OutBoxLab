"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { EmailTable } from "@/components/dashboard/email-table";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/primitives";

function ScheduledContent() {
  // The command palette deep-links here with ?email=<id> to open the drawer.
  const params = useSearchParams();
  const emailId = params.get("email");

  return (
    <EmailTable
      view="pending"
      statuses={["SCHEDULED", "PROCESSING", "DEFERRED"]}
      initialEmailId={emailId}
      emptyTitle="Nothing is queued"
      emptyDescription="Emails waiting in the delayed set appear here and flip status live as the worker picks them up."
    />
  );
}

export default function ScheduledPage() {
  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Pending work"
        title="Scheduled"
        description="Everything still owed a delivery attempt. Rows mutate in place as the engine works - click any row to read its full decision timeline."
      />

      <React.Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <ScheduledContent />
      </React.Suspense>
    </div>
  );
}
