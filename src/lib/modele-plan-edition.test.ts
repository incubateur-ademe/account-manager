import { beforeEach, describe, expect, it, vi } from "vitest";

import { CLE_INCUBATEUR } from "@/core/modele-plan";
import { Prisma } from "@/generated/prisma/client";
import type { RiskLevel, TemplateKind } from "@/generated/prisma/enums";

import { ajouterEtape, type EtapeSaisie, modifierEtape } from "./modele-plan-edition";

process.env["DATABASE_URL"] ??= "postgresql://localhost:5432/inutilise";
process.env["ESPACE_MEMBRE_API_KEY"] ??= "inutilisee";

interface ModeleEnBase {
  id: string;
  ownerKey: string;
  kind: TemplateKind;
  startupsMayExtend: boolean;
}

interface EtapeEnBase {
  id: string;
  templateId: string;
  key: string;
  position: number;
  title: string;
  runbook: string | null;
  deeplink: string | null;
  doneWhen: string;
  input: unknown;
  riskLevel: RiskLevel;
}

interface TraceEnBase {
  action: string;
  targetId: string;
  before: unknown;
  after: unknown;
  /** Le vrai `actionTracee` pose l'intention, puis la dément si l'écriture échoue. */
  issue: "SUCCESS" | "FAILURE";
}

const base = vi.hoisted(() => ({
  modeles: [] as ModeleEnBase[],
  etapes: [] as EtapeEnBase[],
  journal: [] as TraceEnBase[],
  collisionAuProchainModele: null as Error | null,
}));

vi.mock("@/lib/actions", () => ({
  actionTracee: async ({
    action,
    targetId,
    before,
    after,
    ecrire,
  }: {
    action: string;
    targetId: string;
    before?: unknown;
    after?: unknown;
    ecrire: (operateur: { username: string }) => Promise<unknown>;
  }) => {
    base.journal.push({ action, targetId, before, after, issue: "SUCCESS" });
    try {
      return await ecrire({ username: "operatrice.exemple" });
    } catch (erreur) {
      base.journal.push({ action, targetId, before, after, issue: "FAILURE" });
      throw erreur;
    }
  },
}));

/** L'unicité `(modèle, clé)` est jouée pour de vrai : c'est elle qui refuse un doublon. */
function collision(): never {
  throw new Prisma.PrismaClientKnownRequestError(
    "Unique constraint failed on the fields: (`templateId`,`key`)",
    { code: "P2002", clientVersion: "7.9.1" },
  );
}

vi.mock("@/lib/db", () => ({
  prisma: {
    planTemplate: {
      findUnique: ({
        where,
      }: {
        where: { ownerKey_kind: { ownerKey: string; kind: TemplateKind } };
      }) =>
        Promise.resolve(
          base.modeles.find(
            (modele) =>
              modele.ownerKey === where.ownerKey_kind.ownerKey &&
              modele.kind === where.ownerKey_kind.kind,
          ) ?? null,
        ),
      create: ({ data }: { data: { ownerKey: string; kind: TemplateKind } }) => {
        const collision = base.collisionAuProchainModele;
        if (collision) {
          base.collisionAuProchainModele = null;
          base.modeles.push({
            id: "modele-concurrent",
            ownerKey: data.ownerKey,
            kind: data.kind,
            startupsMayExtend: false,
          });
          return Promise.reject(collision);
        }

        const modele: ModeleEnBase = {
          id: `modele-${base.modeles.length + 1}`,
          ownerKey: data.ownerKey,
          kind: data.kind,
          startupsMayExtend: false,
        };
        base.modeles.push(modele);
        return Promise.resolve(modele);
      },
    },
    planTemplateStep: {
      findFirst: ({ where }: { where: { templateId: string } }) =>
        Promise.resolve(
          [...base.etapes]
            .filter((etape) => etape.templateId === where.templateId)
            .sort((a, b) => b.position - a.position)[0] ?? null,
        ),
      findUnique: ({ where }: { where: { id: string } }) => {
        const etape = base.etapes.find((ligne) => ligne.id === where.id);
        if (!etape) {
          return Promise.resolve(null);
        }
        const modele = base.modeles.find((ligne) => ligne.id === etape.templateId);
        return Promise.resolve({
          ...etape,
          template: { ownerKey: modele?.ownerKey ?? "", kind: modele?.kind ?? "OFFBOARDING" },
        });
      },
      create: ({ data }: { data: Omit<EtapeEnBase, "id"> }) => {
        if (
          base.etapes.some(
            (etape) => etape.templateId === data.templateId && etape.key === data.key,
          )
        ) {
          collision();
        }
        const etape: EtapeEnBase = { id: `etape-${base.etapes.length + 1}`, ...data };
        base.etapes.push(etape);
        return Promise.resolve(etape);
      },
      update: ({ where, data }: { where: { id: string }; data: Partial<EtapeEnBase> }) => {
        const etape = base.etapes.find((ligne) => ligne.id === where.id);
        if (!etape) {
          throw new Error("étape absente");
        }
        if (
          base.etapes.some(
            (ligne) =>
              ligne.id !== etape.id &&
              ligne.templateId === etape.templateId &&
              ligne.key === (data.key ?? etape.key),
          )
        ) {
          collision();
        }
        Object.assign(etape, data);
        return Promise.resolve(etape);
      },
    },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const saisie = (titre: string, over: Partial<EtapeSaisie> = {}): EtapeSaisie => ({
  titre,
  critere: `${titre} : c'est fait.`,
  marcheASuivre: null,
  lien: null,
  risque: "LOW",
  saisie: null,
  ...over,
});

const parCle = (cle: string): EtapeEnBase | undefined =>
  base.etapes.find((etape) => etape.key === cle);

const STARTUP = "atelier-des-mobilites";

beforeEach(() => {
  base.modeles.length = 0;
  base.etapes.length = 0;
  base.journal.length = 0;
  base.collisionAuProchainModele = null;
});

/**
 * Une clé d'étape est ce qui fait de deux déclarations le même geste, dans le modèle
 * de l'incubateur comme dans celui d'une startup et dans un plan figé il y a six
 * mois. Ce qui se joue ici est qu'elle naisse une fois et ne bouge plus jamais.
 */
describe("l'édition d'une étape de modèle", () => {
  it("fige la clé d'une étape à sa création et ne la recalcule sur aucune réécriture", async () => {
    // Given une étape d'arrivée écrite par l'incubateur
    expect(await ajouterEtape(CLE_INCUBATEUR, "ONBOARDING", saisie("Signer la charte"))).toEqual({
      ok: true,
    });
    const creee = parCle("signer-la-charte");
    expect(creee?.title).toBe("Signer la charte");
    expect(creee?.position).toBe(0);

    // When on la renomme en profondeur, critère, risque et saisie compris
    const modifie = await modifierEtape(
      creee?.id ?? "",
      saisie("Faire signer la charte d'engagement", {
        critere: "La charte signée est au dossier.",
        risque: "HIGH",
        saisie: { libelle: "Date de signature", obligatoire: true },
      }),
    );

    // Then l'écriture est acceptée et le contenu suit le nouveau texte
    expect(modifie).toEqual({ ok: true });
    expect(creee?.title).toBe("Faire signer la charte d'engagement");
    expect(creee?.doneWhen).toBe("La charte signée est au dossier.");
    expect(creee?.riskLevel).toBe("HIGH");
    expect(creee?.input).toEqual({ libelle: "Date de signature", obligatoire: true });

    // Then la clé, elle, n'a pas bougé d'un caractère. La recalculer ferait de cette
    // étape une autre étape : son `idempotencyKey` changerait, un plan figé la dirait
    // retirée et en annoncerait une nouvelle, pour un mot réécrit.
    expect(creee?.key).toBe("signer-la-charte");
    expect(base.etapes).toHaveLength(1);

    // Then la trace dit les deux états, l'ancien titre comme le nouveau, sous la même
    // clé : le journal est le seul historique d'une étape de modèle.
    const trace = base.journal.at(-1);
    expect(trace?.action).toBe("modele.etape.modification");
    expect(trace?.targetId).toBe(`${CLE_INCUBATEUR}:ONBOARDING`);
    expect(trace?.before).toMatchObject({ cle: "signer-la-charte", titre: "Signer la charte" });
    expect(trace?.after).toMatchObject({
      cle: "signer-la-charte",
      titre: "Faire signer la charte d'engagement",
      risque: "HIGH",
    });
  });

  it("refuse à la création ce qu'une clé figée n'a plus à refuser ensuite", async () => {
    // Given un modèle de départ qui porte déjà une étape
    await ajouterEtape(CLE_INCUBATEUR, "OFFBOARDING", saisie("Rendre le badge"));
    const badge = parCle("rendre-le-badge");
    await ajouterEtape(CLE_INCUBATEUR, "OFFBOARDING", saisie("Vider le casier"));
    const casier = parCle("vider-le-casier");

    // When on ajoute une étape dont le titre ne porte ni lettre ni chiffre
    const sansCle = await ajouterEtape(CLE_INCUBATEUR, "OFFBOARDING", saisie("« ??? »"));

    // Then elle est refusée par une phrase qui dit quoi corriger, pas par un code :
    // une clé vide reste une clé aux yeux de l'unicité, deux titres muets se
    // dédoubleraient l'un l'autre.
    expect(sansCle).toEqual({
      ok: false,
      erreur:
        "Donnez à cette étape un titre qui porte au moins une lettre ou un chiffre : c'est lui qui fait sa clé.",
    });

    // When on ajoute une étape dont le titre retombe sur une clé déjà prise
    const doublon = await ajouterEtape(
      CLE_INCUBATEUR,
      "OFFBOARDING",
      saisie("  RENDRE le Badge !  "),
    );

    // Then le refus le dit avec la clé en cause, et rien n'a été écrit
    expect(doublon.ok).toBe(false);
    expect(doublon.ok === false ? doublon.erreur : "").toContain("rendre-le-badge");
    expect(base.etapes).toHaveLength(2);

    // When on renomme le casier en reprenant mot pour mot le titre du badge
    const renomme = await modifierEtape(casier?.id ?? "", saisie("Rendre le badge"));

    // Then rien ne s'y oppose : la clé ne suit plus le titre, deux étapes peuvent donc
    // porter le même intitulé sans se disputer une clé. Chacune garde la sienne.
    expect(renomme).toEqual({ ok: true });
    expect(casier?.key).toBe("vider-le-casier");
    expect(badge?.key).toBe("rendre-le-badge");

    // Then une étape effacée entre-temps se refuse par une phrase, et non par une levée
    base.etapes.length = 0;
    expect(await modifierEtape(casier?.id ?? "", saisie("Vider le casier"))).toEqual({
      ok: false,
      erreur: "Cette étape n'existe plus.",
    });

    // Then un critère vide se refuse quel que soit le chemin : sans lui, « fait » ne
    // veut rien dire.
    await ajouterEtape(CLE_INCUBATEUR, "OFFBOARDING", saisie("Rendre le badge"));
    const repose = parCle("rendre-le-badge");
    const sansCritere = await modifierEtape(
      repose?.id ?? "",
      saisie("Rendre le badge", { critere: "   " }),
    );
    expect(sansCritere.ok).toBe(false);
    expect(repose?.doneWhen).toBe("Rendre le badge : c'est fait.");

    // Then un lien qui n'est pas une adresse http ou https se refuse de même : c'est
    // le seul champ d'une étape qui finisse dans un `href`, et le seul qu'un opérateur
    // écrive à la main.
    const lienDouteux = await modifierEtape(
      repose?.id ?? "",
      saisie("Rendre le badge", { lien: "javascript:alert(1)" }),
    );
    expect(lienDouteux.ok).toBe(false);
    expect(repose?.deeplink).toBeNull();

    // Then une vraie adresse passe, espaces compris, et atteint la colonne
    expect(
      await modifierEtape(
        repose?.id ?? "",
        saisie("Rendre le badge", { lien: "  https://exemple.fr/badges  " }),
      ),
    ).toEqual({ ok: true });
    expect(repose?.deeplink).toBe("https://exemple.fr/badges");
  });

  it("oppose à la réécriture d'une étape de startup le refus qu'elle oppose à son ajout", async () => {
    // Given un incubateur qui autorise les startups à compléter le départ
    base.modeles.push({
      id: "modele-incubateur",
      ownerKey: CLE_INCUBATEUR,
      kind: "OFFBOARDING",
      startupsMayExtend: true,
    });

    // Given une startup qui en a profité pour déclarer une étape
    expect(await ajouterEtape(STARTUP, "OFFBOARDING", saisie("Rendre le badge"))).toEqual({
      ok: true,
    });
    const badge = parCle("rendre-le-badge");
    expect(badge?.title).toBe("Rendre le badge");

    // When l'incubateur referme l'autorisation
    const incubateur = base.modeles.find((modele) => modele.ownerKey === CLE_INCUBATEUR);
    expect(incubateur).toBeDefined();
    if (incubateur) {
      incubateur.startupsMayExtend = false;
    }

    // Then plus aucune étape de cette startup ne s'ajoute, et le refus dit quoi faire
    const ajout = await ajouterEtape(STARTUP, "OFFBOARDING", saisie("Vider le casier"));
    expect(ajout.ok).toBe(false);
    expect(ajout.ok === false ? ajout.erreur : "").toContain("n'autorise pas les startups");

    // Then la réécriture est refusée du même refus, mot pour mot : sans lui, ce que
    // l'ajout interdit se rattraperait en renommant l'étape déjà posée, et une
    // autorisation refermée ne tiendrait que la moitié de ce qu'elle dit.
    const reecriture = await modifierEtape(badge?.id ?? "", saisie("Rendre le badge et les clés"));
    expect(reecriture).toEqual(ajout);
    expect(badge?.title).toBe("Rendre le badge");
    expect(base.journal.some((trace) => trace.action === "modele.etape.modification")).toBe(false);

    // Then le modèle de l'incubateur, lui, se réécrit sans rien demander à personne :
    // l'autorisation ne parle que des startups.
    await ajouterEtape(CLE_INCUBATEUR, "OFFBOARDING", saisie("Clore les accès"));
    const clore = parCle("clore-les-acces");
    expect(
      await modifierEtape(clore?.id ?? "", saisie("Clore les accès", { risque: "HIGH" })),
    ).toEqual({ ok: true });
    expect(clore?.riskLevel).toBe("HIGH");
  });

  it("rend le modèle gagnant quand deux opérateurs le créent en même temps", async () => {
    // Given aucun modèle d'arrivée pour l'incubateur, et un second opérateur qui crée
    // le sien juste avant nous : notre lecture ne voit rien, et l'unicité en base
    // refuse notre écriture.
    base.collisionAuProchainModele = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`ownerKey`,`kind`)",
      { code: "P2002", clientVersion: "7.9.1" },
    );

    // When on ajoute une étape, ce qui crée le modèle au passage
    const ajout = await ajouterEtape(CLE_INCUBATEUR, "ONBOARDING", saisie("Signer la charte"));

    // Then le geste aboutit sur le modèle de l'autre, et l'étape s'y range : un
    // opérateur qui perd la course n'a pas à savoir qu'elle a eu lieu.
    expect(ajout).toEqual({ ok: true });
    expect(base.modeles).toHaveLength(1);
    expect(base.modeles[0]?.id).toBe("modele-concurrent");
    expect(parCle("signer-la-charte")?.templateId).toBe("modele-concurrent");

    // Then le journal ne laisse pas croire à une création qui n'a pas eu lieu :
    // l'intention y figure, suivie de son démenti.
    const creations = base.journal.filter((trace) => trace.action === "modele.creation");
    expect(creations.map((trace) => trace.issue)).toEqual(["SUCCESS", "FAILURE"]);
  });
});
