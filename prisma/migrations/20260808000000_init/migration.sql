-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PersonSource" AS ENUM ('BETA', 'LOCAL', 'SERVICE');

-- CreateEnum
CREATE TYPE "Attachment" AS ENUM ('STARTUPS', 'DECLARED', 'BOTH', 'LOCAL');

-- CreateEnum
CREATE TYPE "IdKind" AS ENUM ('OPAQUE', 'EMAIL', 'UPN');

-- CreateEnum
CREATE TYPE "MatchMethod" AS ENUM ('DECLARED', 'GITHUB_LOGIN', 'EMAIL_EXACT', 'HEURISTIC', 'NONE');

-- CreateEnum
CREATE TYPE "OnOffboard" AS ENUM ('ARCHIVE', 'TRANSFER', 'KEEP');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('OK', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "DepartureState" AS ENUM ('WATCH', 'CANDIDATE', 'CONFIRMED', 'CANCELLED', 'DONE');

-- CreateEnum
CREATE TYPE "PlanKind" AS ENUM ('OFFBOARDING', 'DRIFT_FIX', 'MANUAL_OP');

-- CreateEnum
CREATE TYPE "PlanState" AS ENUM ('DRAFT', 'CONFIRMABLE', 'EXECUTING', 'EXECUTED', 'PARTIALLY_EXECUTED', 'CANCELLED', 'EXPIRED', 'STALE');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "StepState" AS ENUM ('PENDING', 'SKIPPED', 'SUCCEEDED', 'ALREADY_ABSENT', 'STALE', 'FAILED');

-- CreateEnum
CREATE TYPE "FindingKind" AS ENUM ('ORPHAN', 'UNREGISTERED', 'UNMATCHED_IDENTITY', 'EXPIRED_GRANT', 'DORMANT', 'PRIVILEGE_DRIFT', 'UNVERIFIABLE', 'OVERDUE_MANUAL_ACTION');

-- CreateEnum
CREATE TYPE "ActorKind" AS ENUM ('HUMAN', 'SYSTEM');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "username" TEXT,
    "isBetaGouvMember" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "fullname" TEXT NOT NULL,
    "primaryEmail" TEXT,
    "communicationEmail" TEXT,
    "githubLogin" TEXT,
    "missionEnd" DATE,
    "source" "PersonSource" NOT NULL DEFAULT 'BETA',
    "attachment" "Attachment" NOT NULL DEFAULT 'STARTUPS',
    "startups" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vanishedAt" TIMESTAMP(3),

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceAccount" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "ownerUsername" TEXT NOT NULL,
    "reviewEveryDays" INTEGER NOT NULL DEFAULT 180,
    "lastReviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalIdentity" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "idKind" "IdKind" NOT NULL DEFAULT 'OPAQUE',
    "handle" TEXT NOT NULL,
    "personId" TEXT,
    "serviceAccountId" TEXT,
    "matchMethod" "MatchMethod" NOT NULL DEFAULT 'NONE',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vanishedAt" TIMESTAMP(3),

    CONSTRAINT "ExternalIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessGrant" (
    "id" TEXT NOT NULL,
    "externalIdentityId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "lastActivityAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vanishedAt" TIMESTAMP(3),

    CONSTRAINT "AccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reference" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "onOffboard" "OnOffboard" NOT NULL DEFAULT 'ARCHIVE',

    CONSTRAINT "Reference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "SyncStatus" NOT NULL,
    "itemsSeen" INTEGER NOT NULL DEFAULT 0,
    "error" JSONB,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepartureCase" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "state" "DepartureState" NOT NULL DEFAULT 'WATCH',
    "firstSignalAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveDate" DATE,
    "cancelledReason" TEXT,

    CONSTRAINT "DepartureCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "departureCaseId" TEXT,
    "kind" "PlanKind" NOT NULL,
    "state" "PlanState" NOT NULL DEFAULT 'DRAFT',
    "planDigest" TEXT NOT NULL,
    "confirmedDigest" TEXT,
    "createdBy" TEXT NOT NULL,
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanStep" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "systemKey" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "expectedState" JSONB NOT NULL,
    "state" "StepState" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "executedAt" TIMESTAMP(3),
    "reversibleUntil" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,

    CONSTRAINT "PlanStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "kind" "FindingKind" NOT NULL,
    "personId" TEXT,
    "externalIdentityId" TEXT,
    "severity" "RiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "dedupKey" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Derogation" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Derogation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorKind" "ActorKind" NOT NULL,
    "actorUsername" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "correlationId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "result" TEXT NOT NULL,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "Person_username_key" ON "Person"("username");

-- CreateIndex
CREATE INDEX "Person_missionEnd_idx" ON "Person"("missionEnd");

-- CreateIndex
CREATE INDEX "Person_vanishedAt_idx" ON "Person"("vanishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceAccount_key_key" ON "ServiceAccount"("key");

-- CreateIndex
CREATE INDEX "ServiceAccount_ownerUsername_idx" ON "ServiceAccount"("ownerUsername");

-- CreateIndex
CREATE INDEX "ServiceAccount_lastReviewedAt_idx" ON "ServiceAccount"("lastReviewedAt");

-- CreateIndex
CREATE INDEX "ExternalIdentity_personId_idx" ON "ExternalIdentity"("personId");

-- CreateIndex
CREATE INDEX "ExternalIdentity_serviceAccountId_idx" ON "ExternalIdentity"("serviceAccountId");

-- CreateIndex
CREATE INDEX "ExternalIdentity_provider_vanishedAt_idx" ON "ExternalIdentity"("provider", "vanishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalIdentity_provider_externalId_key" ON "ExternalIdentity"("provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Resource_provider_externalId_key" ON "Resource"("provider", "externalId");

-- CreateIndex
CREATE INDEX "AccessGrant_vanishedAt_idx" ON "AccessGrant"("vanishedAt");

-- CreateIndex
CREATE INDEX "AccessGrant_lastActivityAt_idx" ON "AccessGrant"("lastActivityAt");

-- CreateIndex
CREATE UNIQUE INDEX "AccessGrant_externalIdentityId_resourceId_role_key" ON "AccessGrant"("externalIdentityId", "resourceId", "role");

-- CreateIndex
CREATE INDEX "Reference_provider_idx" ON "Reference"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "Reference_personId_resourceId_key" ON "Reference"("personId", "resourceId");

-- CreateIndex
CREATE INDEX "SyncRun_provider_startedAt_idx" ON "SyncRun"("provider", "startedAt");

-- CreateIndex
CREATE INDEX "SyncRun_status_idx" ON "SyncRun"("status");

-- CreateIndex
CREATE INDEX "DepartureCase_personId_idx" ON "DepartureCase"("personId");

-- CreateIndex
CREATE INDEX "DepartureCase_state_idx" ON "DepartureCase"("state");

-- CreateIndex
CREATE INDEX "Plan_state_idx" ON "Plan"("state");

-- CreateIndex
CREATE INDEX "Plan_departureCaseId_idx" ON "Plan"("departureCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanStep_idempotencyKey_key" ON "PlanStep"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PlanStep_planId_idx" ON "PlanStep"("planId");

-- CreateIndex
CREATE INDEX "PlanStep_state_idx" ON "PlanStep"("state");

-- CreateIndex
CREATE UNIQUE INDEX "Finding_dedupKey_key" ON "Finding"("dedupKey");

-- CreateIndex
CREATE INDEX "Finding_kind_closedAt_idx" ON "Finding"("kind", "closedAt");

-- CreateIndex
CREATE INDEX "Finding_personId_idx" ON "Finding"("personId");

-- CreateIndex
CREATE INDEX "Derogation_targetType_targetId_idx" ON "Derogation"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "Derogation_expiresAt_idx" ON "Derogation"("expiresAt");

-- CreateIndex
CREATE INDEX "AuditEvent_at_idx" ON "AuditEvent"("at");

-- CreateIndex
CREATE INDEX "AuditEvent_targetType_targetId_idx" ON "AuditEvent"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditEvent_correlationId_idx" ON "AuditEvent"("correlationId");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUsername_idx" ON "AuditEvent"("actorUsername");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_serviceAccountId_fkey" FOREIGN KEY ("serviceAccountId") REFERENCES "ServiceAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_externalIdentityId_fkey" FOREIGN KEY ("externalIdentityId") REFERENCES "ExternalIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reference" ADD CONSTRAINT "Reference_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reference" ADD CONSTRAINT "Reference_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartureCase" ADD CONSTRAINT "DepartureCase_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_departureCaseId_fkey" FOREIGN KEY ("departureCaseId") REFERENCES "DepartureCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanStep" ADD CONSTRAINT "PlanStep_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_externalIdentityId_fkey" FOREIGN KEY ("externalIdentityId") REFERENCES "ExternalIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

