import { beforeEach, describe, expect, it, vi } from "vitest";

import { cleDeCible } from "@/core/derogation";
import { prisma } from "@/lib/db";
import { derogationsApplicables } from "@/lib/derogation";
import { politiqueJetable } from "@/test/politique-jetable";
import { leverDerogation, tolererConstat } from "./actions";

/**
 * La tolérance se pose et se lève par cible, contre une vraie base.
 *
 * Ce que ce fichier tient et qu'aucun double ne saurait tenir, c'est la distance entre la
 * ligne qu'un opérateur voit et la cible qu'il croit lever. Le registre rend une ligne par
 * tolérance, et deux d'entre elles peuvent viser le même compte : rien dans les types ne
 * relie le bouton cliqué à ce qui couvre encore après le clic.
 *
 * Et la course de deux poses, qui ne se joue qu'en base : chacune lit la couverture avant
 * d'écrire, et deux constats différents sur le même compte y mènent par des chemins que
 * rien ne fait se croiser côté application.
 */

politiqueJetable("tolerance-integration");

vi.mock("@/lib/session", async () => (await import("@/test/doubles/session")).sessionDe());
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const PROVIDER = "github";
const EXTERNAL_ID = "cpt-partage";
const CIBLE = { type: "identite", provider: PROVIDER, externalId: EXTERNAL_ID } as const;

/** Assez loin pour rester en cours, et sous le plafond de cent quatre-vingts jours. */
const ECHEANCE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const formulaire = (champs: Record<string, string>): FormData => {
  const donnees = new FormData();
  for (const [nom, valeur] of Object.entries(champs)) {
    donnees.set(nom, valeur);
  }
  return donnees;
};

async function semer(): Promise<void> {
  const personne = await prisma.person.create({
    data: { username: "nour.exemple", fullname: "Nour Exemple", source: "BETA" },
  });
  const identite = await prisma.externalIdentity.create({
    data: {
      provider: PROVIDER,
      externalId: EXTERNAL_ID,
      handle: "nour-exemple",
      matchMethod: "GITHUB_LOGIN",
      personId: personne.id,
    },
  });
  // Deux constats qui visent le même compte : c'est par eux que deux tolérances arrivent
  // sur une seule cible, l'écran ne proposant jamais de saisir la cible elle-même.
  for (const kind of ["ORPHAN", "UNREGISTERED"] as const) {
    await prisma.finding.create({
      data: {
        kind,
        dedupKey: `${kind}:${PROVIDER}:${EXTERNAL_ID}`,
        personId: personne.id,
        externalIdentityId: identite.id,
      },
    });
  }
}

const couvertures = async () => {
  const { applicables } = await derogationsApplicables(new Date());
  return applicables.filter((tolerance) => cleDeCible(tolerance.cible) === cleDeCible(CIBLE));
};

const tolerer = (kind: string, raison: string) =>
  tolererConstat(
    null,
    formulaire({ dedupKey: `${kind}:${PROVIDER}:${EXTERNAL_ID}`, raison, jusquAu: ECHEANCE }),
  );

describe("une cible ne se tolère et ne se lève que d'un bloc", () => {
  beforeEach(async () => {
    await semer();
  });

  it("lève toutes les lignes qui couvrent la cible, y compris celle qu'on n'a pas choisie", async () => {
    // Given deux tolérances déjà en base sur le même compte, comme deux poses concurrentes
    // en auraient laissé, et que le registre rend sur deux lignes distinctes
    for (const raison of ["reprise par l'équipe", "passation en cours"]) {
      await prisma.derogation.create({
        data: {
          targetType: "identite",
          targetId: `${PROVIDER}:${EXTERNAL_ID}`,
          reason: raison,
          createdBy: "operatrice.exemple",
          expiresAt: new Date(`${ECHEANCE}T00:00:00Z`),
        },
      });
    }
    const avant = await couvertures();
    expect(avant).toHaveLength(2);

    // When l'opératrice lève la première des deux, qui est la seule qu'elle a cliquée
    const premiere = avant[0];
    expect(premiere).toBeDefined();
    const refus = await leverDerogation(null, formulaire({ derogationId: premiere?.id ?? "" }));

    // Then le geste passe, et plus rien ne couvre la cible : la seconde ligne est levée
    // avec elle, du même nom et du même instant.
    expect(refus).toBeNull();
    expect(await couvertures()).toHaveLength(0);
    const levees = await prisma.derogation.findMany({
      where: { targetId: `${PROVIDER}:${EXTERNAL_ID}` },
      select: { revokedAt: true, revokedBy: true },
    });
    expect(levees).toHaveLength(2);
    for (const ligne of levees) {
      expect(ligne.revokedAt).not.toBeNull();
      expect(ligne.revokedBy).toBe("operatrice.exemple");
    }

    // Then une seconde levée n'a plus rien à couper, et le dit plutôt que de signer une
    // décision qui n'a rien décidé.
    expect(await leverDerogation(null, formulaire({ derogationId: premiere?.id ?? "" }))).toEqual({
      erreur: "Cette tolérance n'est plus en cours.",
    });
  });

  it("ne laisse qu'une ligne active quand deux poses partent ensemble sur la même cible", async () => {
    // When les deux constats du même compte sont tolérés en même temps, chacun lisant une
    // couverture vide avant d'écrire
    const [premiere, seconde] = await Promise.allSettled([
      tolerer("ORPHAN", "reprise par l'équipe"),
      tolerer("UNREGISTERED", "passation en cours"),
    ]);

    // Then une seule des deux a posé sa ligne, l'autre s'étant heurtée au verrou puis à la
    // couverture que la première venait d'écrire.
    const posees = await prisma.derogation.count({
      where: { targetId: `${PROVIDER}:${EXTERNAL_ID}` },
    });
    expect(posees).toBe(1);
    expect(await couvertures()).toHaveLength(1);

    // Then une seule des deux a été acceptée, et l'autre s'est arrêtée sur un refus rendu au
    // formulaire, que ce soit par son verdict si la première avait déjà commité ou par la
    // course constatée sous le verrou. Aucune des deux ne lève : une action qui lève ne
    // remplit pas l'état que l'écran affiche, et la modale se fermerait sur un geste vide.
    const issues = [premiere, seconde];
    expect(issues.map((issue) => issue.status)).toEqual(["fulfilled", "fulfilled"]);
    const rendus = issues.flatMap((issue) => (issue.status === "fulfilled" ? [issue.value] : []));
    expect(rendus.filter((rendu) => rendu === null)).toHaveLength(1);
    expect(rendus.filter((rendu) => rendu !== null && rendu.erreur.length > 0)).toHaveLength(1);

    // Then l'écart de la pose arrêtée reste dans la file : son constat n'est pas clos, donc
    // rien ne se tait sur la foi d'une décision qui n'a pas abouti.
    expect(
      await prisma.finding.count({
        where: { externalIdentity: { externalId: EXTERNAL_ID }, closedAt: null },
      }),
    ).toBe(1);
  });
});
