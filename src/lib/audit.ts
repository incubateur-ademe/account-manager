import type { AuditInput } from "@/core/audit";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === undefined) {
    return Prisma.DbNull;
  }
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * Volontairement sans await : une panne d'écriture du journal ne doit jamais
 * faire échouer l'action métier qu'il est censé documenter.
 */
export function audit(input: AuditInput): void {
  void prisma.auditEvent
    .create({
      data: {
        actorKind: input.actorKind,
        actorUsername: input.actorUsername ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        correlationId: input.correlationId ?? null,
        before: toJson(input.before),
        after: toJson(input.after),
        result: input.result,
      },
    })
    .catch((error: unknown) => {
      console.error("[audit] écriture du journal impossible", {
        action: input.action,
        targetType: input.targetType,
        error,
      });
    });
}
