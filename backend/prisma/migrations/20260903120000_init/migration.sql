-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SenderProvider" AS ENUM ('ETHEREAL', 'SMTP');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('SCHEDULED', 'PROCESSING', 'DEFERRED', 'SENT', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EmailEventType" AS ENUM ('QUEUED', 'PICKED_UP', 'DEFERRED_RATE_LIMIT', 'DEFERRED_PACING', 'SENT', 'FAILED', 'RETRY_SCHEDULED', 'RESCHEDULED', 'CANCELLED', 'RECONCILED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "senders" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "fromName" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "provider" "SenderProvider" NOT NULL DEFAULT 'ETHEREAL',
    "smtpHost" TEXT NOT NULL,
    "smtpPort" INTEGER NOT NULL DEFAULT 587,
    "smtpUser" TEXT NOT NULL,
    "smtpPassword" TEXT NOT NULL,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT false,
    "hourlyLimit" INTEGER NOT NULL DEFAULT 10,
    "minDelayMs" INTEGER NOT NULL DEFAULT 2000,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastVerified" TIMESTAMP(3),
    "previewBase" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "senders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "senderId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "subjectTemplate" TEXT NOT NULL,
    "bodyTemplate" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "delayBetweenEmailsMs" INTEGER NOT NULL,
    "hourlyLimit" INTEGER NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'SCHEDULED',
    "totalRecipients" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_emails" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "campaignId" UUID,
    "senderId" UUID NOT NULL,
    "to" TEXT NOT NULL,
    "vars" JSONB NOT NULL DEFAULT '{}',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sendAt" TIMESTAMP(3) NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'SCHEDULED',
    "hourlyLimit" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "deferredCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "messageId" TEXT,
    "previewUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_events" (
    "id" UUID NOT NULL,
    "emailId" UUID NOT NULL,
    "type" "EmailEventType" NOT NULL,
    "message" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "senders_userId_isActive_idx" ON "senders"("userId", "isActive");

-- CreateIndex
CREATE INDEX "campaigns_userId_status_idx" ON "campaigns"("userId", "status");

-- CreateIndex
CREATE INDEX "campaigns_userId_createdAt_idx" ON "campaigns"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "scheduled_emails_status_sendAt_idx" ON "scheduled_emails"("status", "sendAt");

-- CreateIndex
CREATE INDEX "scheduled_emails_senderId_status_idx" ON "scheduled_emails"("senderId", "status");

-- CreateIndex
CREATE INDEX "scheduled_emails_userId_status_sendAt_idx" ON "scheduled_emails"("userId", "status", "sendAt");

-- CreateIndex
CREATE INDEX "scheduled_emails_campaignId_sendAt_idx" ON "scheduled_emails"("campaignId", "sendAt");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_emails_campaignId_to_key" ON "scheduled_emails"("campaignId", "to");

-- CreateIndex
CREATE INDEX "email_events_emailId_createdAt_idx" ON "email_events"("emailId", "createdAt");

-- AddForeignKey
ALTER TABLE "senders" ADD CONSTRAINT "senders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "senders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_emails" ADD CONSTRAINT "scheduled_emails_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_emails" ADD CONSTRAINT "scheduled_emails_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_emails" ADD CONSTRAINT "scheduled_emails_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "senders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "scheduled_emails"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Full-text search
--
-- OutboxLab deliberately does NOT run an Elasticsearch mirror. A functional
-- GIN index over a weighted tsvector gives ranked multi-field search on the
-- recipient, subject and body with no second datastore to keep in sync, no
-- dual-write consistency window and ~1.5 GB less memory to run locally.
--
-- The expression is immutable (the 'english' regconfig is a literal), which is
-- what allows it to be indexed directly instead of needing a stored column
-- plus a trigger.
--
-- Weights: recipient = A, subject = B, body = C, so a match on the address
-- outranks a match buried in the body. Queried with websearch_to_tsquery, so
-- users get quoted phrases and -negation for free.
-- ---------------------------------------------------------------------------
CREATE INDEX "scheduled_emails_search_idx" ON "scheduled_emails" USING GIN (
    (
        setweight(to_tsvector('english', coalesce("to", '')), 'A') ||
        setweight(to_tsvector('english', coalesce("subject", '')), 'B') ||
        setweight(to_tsvector('english', coalesce("body", '')), 'C')
    )
);

-- Supports fast case-insensitive substring/prefix matching on the recipient,
-- used as the fallback path when a query is too short for tsquery to be useful
-- (e.g. a user typing "ann" expecting to find "anna@example.com").
CREATE INDEX "scheduled_emails_to_lower_idx" ON "scheduled_emails" (lower("to") text_pattern_ops);

