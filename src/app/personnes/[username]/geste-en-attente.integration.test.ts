import { describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";

import { gesteEnAttente } from "./geste-en-attente";

/**
 * Ce que la fiche lit du brouillon de geste, contre une vraie base.
 *
 * Deux choses n'y tiennent qu'ici. Le tri, parce que l'unicité du brouillon est tenue par
 * le code et par aucun index : l'index partiel laisse libres les plans sans dossier, si
 * bien que deux brouillons peuvent coexister et qu'un double rendrait celui qu'on lui a
 * appris à rendre. Et le repli du système sur l'étape, qui traverse la relation.
 */

const USERNAME = "nour.exemple";
const MAINTENANT = new Date("2026-09-22T09:00:00Z");

const INTENTION = {
  systeme: "scalingo",
  scope: {
    nature: "collaboration",
    region: "osc-fr1",
    application: "service-annuaire",
    role: "collaborator",
  },
  justification: "Renfort pendant une astreinte",
};

async function semerPersonne(): Promise<string> {
  const { id } = await prisma.person.create({
    data: { username: USERNAME, fullname: "Nour Exemple", source: "BETA" },
    select: { id: true },
  });
  return id;
}

async function semerBrouillon(
  personId: string,
  champs: { id: string; intent: unknown; creeIlYA: number; termeDans: number },
): Promise<void> {
  await prisma.plan.create({
    data: {
      id: champs.id,
      kind: "MANUAL_OP",
      state: "DRAFT",
      subjectId: personId,
      intent: champs.intent as never,
      planDigest: `digest-${champs.id}`,
      createdBy: "operatrice.exemple",
      createdAt: new Date(MAINTENANT.getTime() - champs.creeIlYA * 86_400_000),
      expiresAt: new Date(MAINTENANT.getTime() + champs.termeDans * 86_400_000),
      steps: {
        create: {
          systemKey: "scalingo",
          tier: "manual",
          capability: "grant",
          action: "emettre",
          label: "Émettre un jeton restreint",
          params: {},
          riskLevel: "HIGH",
          expectedState: "ALREADY_PRESENT",
          idempotencyKey: `idem-${champs.id}`,
          ordre: 1,
        },
      },
    },
  });
}

describe("le brouillon de geste que la fiche lit", () => {
  it("rend le plus récent, dit son terme, et retrouve le système même sans intention lisible", async () => {
    // Given une personne sans aucun geste,
    const personId = await semerPersonne();

    // Then la fiche n'a rien à rendre, et ne paie aucun recalcul,
    await expect(gesteEnAttente(personId, USERNAME, MAINTENANT)).resolves.toBeNull();

    // Given deux brouillons, celui d'hier et celui d'avant-hier. Le code en périme un à
    // chaque geste posé, mais aucun index ne le garantit.
    await semerBrouillon(personId, {
      id: "pla-ancien",
      intent: INTENTION,
      creeIlYA: 2,
      termeDans: 5,
    });
    await semerBrouillon(personId, {
      id: "pla-recent",
      intent: INTENTION,
      creeIlYA: 1,
      termeDans: 6,
    });

    // Then c'est le plus récent qui se rend, et son terme avec lui,
    const lu = await gesteEnAttente(personId, USERNAME, MAINTENANT);
    expect(lu?.planId).toBe("pla-recent");
    expect(lu?.systeme).toBe("scalingo");
    expect(lu?.perime).toBe(false);
    expect(lu?.etapes.map(({ label }) => label)).toEqual(["Émettre un jeton restreint"]);

    // Then l'écart est constaté plutôt que supposé : l'empreinte semée ne peut pas être
    // celle que le calcul rend, et la confirmation refuserait.
    expect(lu?.ecarte).toBe(true);

    // Given un brouillon dont l'intention gelée ne se relit plus, ce qu'une écriture
    // hors de cet outil ou un champ ajouté au schéma suffisent à produire,
    await prisma.plan.deleteMany({ where: { id: { in: ["pla-ancien", "pla-recent"] } } });
    await semerBrouillon(personId, {
      id: "pla-illisible",
      intent: { systeme: "scalingo", champDUneAutreVersion: true },
      creeIlYA: 1,
      termeDans: 6,
    });

    // Then le système se retrouve sur l'étape, parce que c'est là que le chemin de
    // retour compte le plus : sans lui, le lien mènerait à la liste des systèmes.
    const illisible = await gesteEnAttente(personId, USERNAME, MAINTENANT);
    expect(illisible?.systeme).toBe("scalingo");
    expect(illisible?.ecarte).toBe(true);

    // Given un brouillon dont le terme est passé,
    await prisma.plan.deleteMany({ where: { id: "pla-illisible" } });
    await semerBrouillon(personId, {
      id: "pla-perime",
      intent: INTENTION,
      creeIlYA: 8,
      termeDans: -1,
    });

    // Then il se rend quand même, et se dit périmé. Le taire laisserait la fiche muette
    // sur un geste posé, et reposer le geste est la seule sortie.
    const perime = await gesteEnAttente(personId, USERNAME, MAINTENANT);
    expect(perime?.planId).toBe("pla-perime");
    expect(perime?.perime).toBe(true);
  });
});
