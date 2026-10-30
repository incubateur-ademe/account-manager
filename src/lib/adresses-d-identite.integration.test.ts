import { describe, expect, it } from "vitest";

import { candidatsPourAdresse } from "@/lib/connexion";
import { prisma } from "@/lib/db";
import { rapprocherIdentites } from "@/lib/sync/rapprochement";

/**
 * Les adresses qui désignent une personne, lues par une vraie base.
 *
 * Ce qui ne se tient pas plus bas est le filtre que Prisma traduit en SQL : un double qui
 * réécrit le `OR` sur la source prouverait sa propre lecture, pas celle de la base.
 */

const ADRESSE_DECLAREE = "participant@prestataire.example";

describe("une adresse que le membre déclare lui-même ne désigne pas sa fiche", () => {
  it("ne rattache aucun compte et n'identifie personne par la secondaire d'une fiche collectée", async () => {
    // Given un membre collecté qui a déclaré en secondaire l'adresse d'un tiers
    const membre = await prisma.person.create({
      data: {
        username: "membre.exemple",
        fullname: "Membre Exemple",
        source: "BETA",
        primaryEmail: "membre.exemple@beta.gouv.fr",
        communicationEmail: ADRESSE_DECLAREE,
      },
    });
    // And deux comptes Notion, l'un sur cette adresse, l'autre sur sa principale
    await prisma.externalIdentity.createMany({
      data: [
        { provider: "notion", externalId: "n-tiers", handle: ADRESSE_DECLAREE },
        { provider: "notion", externalId: "n-membre", handle: "Membre.Exemple@beta.gouv.fr" },
      ],
    });

    // When la collecte rapproche les comptes isolés
    await rapprocherIdentites("integration-adresses");

    // Then seul le compte ouvert sur la principale lui revient, et en preuve exacte
    const comptes = await prisma.externalIdentity.findMany({
      select: { externalId: true, personId: true, matchMethod: true },
      orderBy: { externalId: "asc" },
    });
    expect(comptes).toEqual([
      { externalId: "n-membre", personId: membre.id, matchMethod: "EMAIL_EXACT" },
      { externalId: "n-tiers", personId: null, matchMethod: "NONE" },
    ]);

    // Then cette adresse n'identifie personne à la connexion, et sa principale le désigne
    await expect(candidatsPourAdresse(ADRESSE_DECLAREE)).resolves.toEqual([]);
    await expect(candidatsPourAdresse("membre.exemple@beta.gouv.fr")).resolves.toMatchObject([
      { personId: membre.id, origine: "FICHE" },
    ]);

    // Given un participant suivi sur une fiche locale, dont un opérateur a saisi la même adresse
    const participant = await prisma.person.create({
      data: {
        username: "participant.exemple",
        fullname: "Participant Exemple",
        source: "LOCAL",
        usernameFabricated: true,
        communicationEmail: ADRESSE_DECLAREE,
      },
    });

    // When la collecte rapproche de nouveau, le compte du tiers étant resté isolé
    await rapprocherIdentites("integration-adresses-2");

    // Then le compte revient au participant, et l'adresse ne désigne que lui
    await expect(
      prisma.externalIdentity.findUnique({
        where: { provider_externalId: { provider: "notion", externalId: "n-tiers" } },
        select: { personId: true, matchMethod: true },
      }),
    ).resolves.toEqual({ personId: participant.id, matchMethod: "EMAIL_EXACT" });
    const candidats = await candidatsPourAdresse(ADRESSE_DECLAREE);
    expect(candidats.map(({ personId }) => personId)).toEqual([participant.id]);
  });

  it("rend à la file des isolés un compte rattaché autrefois par la secondaire, et le trace", async () => {
    // Given un compte Notion rattaché en preuve exacte, du temps où la secondaire valait preuve
    const membre = await prisma.person.create({
      data: {
        username: "ancien.exemple",
        fullname: "Ancien Exemple",
        source: "BETA",
        primaryEmail: "ancien.exemple@beta.gouv.fr",
        communicationEmail: ADRESSE_DECLAREE,
      },
    });
    const herite = await prisma.externalIdentity.create({
      data: {
        provider: "notion",
        externalId: "n-herite",
        handle: ADRESSE_DECLAREE,
        personId: membre.id,
        matchMethod: "EMAIL_EXACT",
      },
    });
    // And un compte rattaché par sa principale, et un autre qu'un opérateur a tranché
    await prisma.externalIdentity.createMany({
      data: [
        {
          provider: "notion",
          externalId: "n-principale",
          handle: "ancien.exemple@beta.gouv.fr",
          personId: membre.id,
          matchMethod: "EMAIL_EXACT",
        },
        {
          provider: "notion",
          externalId: "n-tranche",
          handle: "autre@prestataire.example",
          personId: membre.id,
          matchMethod: "DECLARED",
        },
      ],
    });

    // When la collecte rapproche
    await rapprocherIdentites("integration-reprise");

    // Then seul le rattachement par la secondaire est défait, et il n'est pas refait
    const comptes = await prisma.externalIdentity.findMany({
      select: { externalId: true, personId: true, matchMethod: true },
      orderBy: { externalId: "asc" },
    });
    expect(comptes).toEqual([
      { externalId: "n-herite", personId: null, matchMethod: "NONE" },
      { externalId: "n-principale", personId: membre.id, matchMethod: "EMAIL_EXACT" },
      { externalId: "n-tranche", personId: membre.id, matchMethod: "DECLARED" },
    ]);

    // Then le journal dit ce qui a été défait, et à qui c'était rattaché
    await expect
      .poll(
        () =>
          prisma.auditEvent.findMany({
            where: { action: "identite.preuve-perimee" },
            select: { targetId: true, before: true },
          }),
        { timeout: 5_000, interval: 25 },
      )
      .toEqual([
        { targetId: herite.id, before: { personId: membre.id, matchMethod: "EMAIL_EXACT" } },
      ]);
  });
});
