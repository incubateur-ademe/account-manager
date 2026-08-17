import type { ActorKind } from "@/generated/prisma/enums";

export interface AuditInput {
  actorKind: ActorKind;
  actorUsername?: string;
  action: string;
  targetType: string;
  targetId?: string;
  correlationId?: string;
  before?: unknown;
  after?: unknown;
  result: "SUCCESS" | "FAILURE" | "SKIPPED";
}
