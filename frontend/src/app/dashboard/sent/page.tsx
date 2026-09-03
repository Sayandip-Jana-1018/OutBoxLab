"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { EmailTable } from "@/components/dashboard/email-table";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/primitives";

function SentContent() {
  const params = useSearchParams();
  const emailId = params.get("email");

  return (
    <EmailTable
      view="history"
      statuses={["SENT", "FAILED", "CANCELLED"]}
      initialEmailId={emailId}
      emptyTitle="No delivery history yet"
      emptyDescription="Once emails finish - delivered, failed or cancelled - they land here, each keeping its Ethereal preview link."
    />
  );
}

export default function SentPage() {
  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Delivery history"
        title="Sent &amp; history"
        description="Finished work, newest first. Every delivered message keeps a preview link so you can read exactly what was sent."
      />

      <React.Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <SentContent />
      </React.Suspense>
    </div>
  );
}
