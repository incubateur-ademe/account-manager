import {
  CLE_INCUBATEUR,
  cleDEtape,
  type SaisieAttendue,
  saisieAttendueSchema,
} from "@/core/modele-plan";
import { Prisma } from "@/generated/prisma/client";
import type { RiskLevel, TemplateKind } from "@/generated/prisma/enums";
import { actionTracee } from "@/lib/actions";
import { prisma } from "@/lib/db";
import { type LigneDEtape, SELECTION_ETAPE } from "@/lib/modele-plan";

/**
 * Les écritures d'édition d'un modèle, séparées de sa lecture : chacune passe par
 * `actionTracee`, qui traverse la session et le cache de Next, et le calcul d'un plan
 * n'a rien à faire de tout cela.
 *
 * Aucune de ces fonctions ne vérifie la session par elle-même. L'action serveur qui
 * les appelle pose `requireOperateur()` avant sa première lecture en base, faute de
 * quoi une session hors de l'allowlist apprendrait ce qui existe avant d'être
 * refusée.
 */

/** Le moment, tel qu'une phrase adressée à un opérateur le nomme. */
const DU_MOMENT: Record<TemplateKind, string> = {
  ONBOARDING: "d'arrivée",
  OFFBOARDING: "de départ",
};

/**
 * Le refus d'une étape de startup que l'incubateur n'a pas admise. Une phrase et non
 * un code : elle nomme le modèle qui décide et dit les deux façons d'en sortir.
 */
function refusDeCompletion(moment: TemplateKind): string {
  return `Le modèle ${DU_MOMENT[moment]} de l'incubateur n'autorise pas les startups à le compléter. Ouvrez l'autorisation depuis le modèle de l'incubateur, ou faites porter cette étape par ce modèle.`;
}

/**
 * Ce qu'une écriture d'édition rend. Un refus est une phrase destinée à l'écran, pas
 * une exception : ce qui est refusé ici l'est par une règle métier que l'opérateur
 * peut lever lui-même.
 */
export type ResultatDEcriture = { ok: true } | { ok: false; erreur: string };

const FAIT: ResultatDEcriture = { ok: true };

function refus(erreur: string): ResultatDEcriture {
  return { ok: false, erreur };
}

function cheminsDuModele(proprietaire: string): string[] {
  return [
    "/modeles",
    proprietaire === CLE_INCUBATEUR ? "/modeles/incubateur" : `/modeles/startup/${proprietaire}`,
  ];
}

function cible(proprietaire: string, moment: TemplateKind): string {
  return `${proprietaire}:${moment}`;
}

function estCollision(erreur: unknown): boolean {
  return erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2002";
}

async function modeleExistant(
  proprietaire: string,
  moment: TemplateKind,
): Promise<{ id: string; startupsMayExtend: boolean } | null> {
  return prisma.planTemplate.findUnique({
    where: { ownerKey_kind: { ownerKey: proprietaire, kind: moment } },
    select: { id: true, startupsMayExtend: true },
  });
}

/**
 * Le modèle d'un propriétaire pour un moment, créé s'il n'existe pas encore.
 *
 * La lecture avant création ne suffit pas, deux ajouts d'étape simultanés la passant
 * tous les deux : l'unicité `(propriétaire, moment)` tranche en base, et la course s'y
 * résout en rendant le modèle gagnant.
 *
 * Le rattrapage vit hors de la trace, comme sur le dossier : avalée dans l'écriture, la
 * collision laissait au journal une création réussie pour le perdant de la course, qui
 * n'a rien écrit.
 */
async function creerModele(proprietaire: string, moment: TemplateKind): Promise<string> {
  const existant = await modeleExistant(proprietaire, moment);
  if (existant) {
    return existant.id;
  }

  try {
    return await actionTracee({
      action: "modele.creation",
      targetType: "modele",
      targetId: cible(proprietaire, moment),
      after: { proprietaire, moment },
      revalider: cheminsDuModele(proprietaire),
      ecrire: async () => {
        const cree = await prisma.planTemplate.create({
          data: { ownerKey: proprietaire, kind: moment },
          select: { id: true },
        });
        return cree.id;
      },
    });
  } catch (erreur) {
    if (!estCollision(erreur)) {
      throw erreur;
    }

    // Sans modèle derrière, la collision ne vient pas d'une course, et l'avaler
    // rendrait un identifiant que rien ne porte.
    const gagnant = await modeleExistant(proprietaire, moment);
    if (!gagnant) {
      throw erreur;
    }

    return gagnant.id;
  }
}

/**
 * Ouvre ou referme le droit des startups de compléter un moment.
 *
 * Refermer ne supprime rien : les étapes de startup restent en base et l'assemblage
 * les écarte avec leur raison. Rouvrir les rend à l'identique.
 */
export async function basculerAutorisation(
  moment: TemplateKind,
  autorise: boolean,
): Promise<ResultatDEcriture> {
  const avant = await modeleExistant(CLE_INCUBATEUR, moment);
  const id = avant?.id ?? (await creerModele(CLE_INCUBATEUR, moment));

  await actionTracee({
    action: "modele.autorisation",
    targetType: "modele",
    targetId: cible(CLE_INCUBATEUR, moment),
    before: { startupsPeuventCompleter: avant?.startupsMayExtend ?? false },
    after: { moment, startupsPeuventCompleter: autorise },
    revalider: cheminsDuModele(CLE_INCUBATEUR),
    ecrire: async () => {
      await prisma.planTemplate.update({
        where: { id },
        data: { startupsMayExtend: autorise },
      });
    },
  });

  return FAIT;
}

/** Ce qu'un opérateur saisit pour une étape, avant qu'elle ne prenne une clé. */
export interface EtapeSaisie {
  titre: string;
  critere: string;
  marcheASuivre: string | null;
  lien: string | null;
  risque: RiskLevel;
  saisie: SaisieAttendue | null;
}

interface EtapeValidee extends EtapeSaisie {
  cle: string;
}

/**
 * Vérifie une saisie et lui attache sa clé.
 *
 * `cleFigee` est la clé que la ligne porte déjà, et `null` à la création seulement :
 * une clé se dérive du titre une fois, à la naissance de l'étape, et plus jamais
 * ensuite. La recalculer à chaque réécriture ferait d'un titre corrigé une autre
 * étape, retirée du plan et rajoutée sous un autre nom pour un mot changé.
 */
function valider(valeurs: EtapeSaisie, cleFigee: string | null): EtapeValidee | ResultatDEcriture {
  const titre = valeurs.titre.trim();
  const critere = valeurs.critere.trim();
  const cle = cleFigee ?? cleDEtape(titre);

  // Une clé vide reste une clé aux yeux de l'unicité : deux titres sans lettre ni
  // chiffre se dédoubleraient l'un l'autre, ici comme à l'assemblage. Le refus ne vaut
  // qu'à la création, la clé d'une étape existante n'étant plus en jeu.
  if (cleFigee === null && !cle) {
    return refus(
      "Donnez à cette étape un titre qui porte au moins une lettre ou un chiffre : c'est lui qui fait sa clé.",
    );
  }

  if (!critere) {
    return refus(
      "Dites ce qu'il faut constater pour cocher cette étape : sans ce critère, « fait » ne veut rien dire.",
    );
  }

  return {
    ...valeurs,
    titre,
    critere,
    cle,
    marcheASuivre: valeurs.marcheASuivre?.trim() || null,
    lien: valeurs.lien?.trim() || null,
    // Dernier passage avant la colonne : une saisie que rien n'aurait relue s'y
    // figerait telle quelle et ferait lever la relecture d'un dossier, des mois plus
    // tard, loin de l'écran qui l'a écrite.
    saisie: valeurs.saisie === null ? null : saisieAttendueSchema.parse(valeurs.saisie),
  };
}

function colonnesDeLEtape(etape: EtapeValidee) {
  return {
    key: etape.cle,
    title: etape.titre,
    doneWhen: etape.critere,
    runbook: etape.marcheASuivre,
    deeplink: etape.lien,
    riskLevel: etape.risque,
    input: etape.saisie ?? Prisma.DbNull,
  };
}

function traceDeLEtape(etape: EtapeValidee): Record<string, unknown> {
  return {
    cle: etape.cle,
    titre: etape.titre,
    critere: etape.critere,
    marcheASuivre: etape.marcheASuivre,
    lien: etape.lien,
    risque: etape.risque,
    saisie: etape.saisie,
  };
}

/**
 * Le refus opposé à une étape de startup que l'incubateur n'admet pas, ou rien.
 *
 * L'absence de modèle d'incubateur pour ce moment vaut absence d'autorisation, sans
 * quoi un moment que personne n'a encore ouvert serait le plus permissif de tous.
 */
async function completionRefusee(
  proprietaire: string,
  moment: TemplateKind,
): Promise<ResultatDEcriture | null> {
  if (proprietaire === CLE_INCUBATEUR) {
    return null;
  }

  const incubateur = await modeleExistant(CLE_INCUBATEUR, moment);
  return incubateur?.startupsMayExtend === true ? null : refus(refusDeCompletion(moment));
}

/**
 * Ajoute une étape à un modèle, à la suite des siennes.
 *
 * Le refus d'une étape de startup se joue ici et à l'assemblage, délibérément : ici
 * une phrase dit quoi faire, là-bas l'étape déjà écrite est écartée avec sa raison.
 */
export async function ajouterEtape(
  proprietaire: string,
  moment: TemplateKind,
  valeurs: EtapeSaisie,
): Promise<ResultatDEcriture> {
  const etape = valider(valeurs, null);
  if ("ok" in etape) {
    return etape;
  }

  const refuse = await completionRefusee(proprietaire, moment);
  if (refuse) {
    return refuse;
  }

  const templateId = await creerModele(proprietaire, moment);
  const derniere = await prisma.planTemplateStep.findFirst({
    where: { templateId },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  try {
    await actionTracee({
      action: "modele.etape.ajout",
      targetType: "modele",
      targetId: cible(proprietaire, moment),
      after: { moment, ...traceDeLEtape(etape) },
      revalider: cheminsDuModele(proprietaire),
      ecrire: async () => {
        await prisma.planTemplateStep.create({
          data: {
            templateId,
            position: (derniere?.position ?? -1) + 1,
            ...colonnesDeLEtape(etape),
          },
        });
      },
    });
  } catch (erreur) {
    if (!estCollision(erreur)) {
      throw erreur;
    }
    return refus(
      `Ce modèle porte déjà une étape sous la clé « ${etape.cle} » : deux titres qui se ressemblent à ce point n'en font qu'un.`,
    );
  }

  return FAIT;
}

async function etapeEnBase(etapeId: string) {
  return prisma.planTemplateStep.findUnique({
    where: { id: etapeId },
    select: {
      id: true,
      ...SELECTION_ETAPE,
      template: { select: { ownerKey: true, kind: true } },
    },
  });
}

function avantDeLEtape(etape: LigneDEtape): Record<string, unknown> {
  return {
    cle: etape.key,
    position: etape.position,
    titre: etape.title,
    critere: etape.doneWhen,
    marcheASuivre: etape.runbook,
    lien: etape.deeplink,
    risque: etape.riskLevel,
    saisie: etape.input,
  };
}

/**
 * Réécrit une étape d'un modèle. Sa clé, elle, ne bouge pas : figée à la création,
 * c'est elle qui fait de cette étape la même étape d'un plan à l'autre, et deux
 * modèles qui déclarent le même geste continuent de n'en faire faire qu'un.
 *
 * Ne touche aucun plan déjà instancié, les étapes étant figées à leur création. Un
 * titre ou un critère réécrit déplace en revanche l'empreinte du plan : un brouillon
 * en cours se découvre obsolète au prochain calcul et se répare par un recalcul, ce
 * qui est le seul chemin par lequel une correction atteint un dossier ouvert.
 *
 * Le même refus qu'à l'ajout, et pour la même raison : une autorisation refermée vaut
 * pour la réécriture d'une étape de startup comme pour son écriture, sans quoi ce que
 * l'ajout interdit se rattrape en renommant une étape déjà posée.
 */
export async function modifierEtape(
  etapeId: string,
  valeurs: EtapeSaisie,
): Promise<ResultatDEcriture> {
  const etape = await etapeEnBase(etapeId);
  if (!etape) {
    return refus("Cette étape n'existe plus.");
  }

  const nouvelle = valider(valeurs, etape.key);
  if ("ok" in nouvelle) {
    return nouvelle;
  }

  const refuse = await completionRefusee(etape.template.ownerKey, etape.template.kind);
  if (refuse) {
    return refuse;
  }

  await actionTracee({
    action: "modele.etape.modification",
    targetType: "modele",
    targetId: cible(etape.template.ownerKey, etape.template.kind),
    before: avantDeLEtape(etape),
    after: { moment: etape.template.kind, ...traceDeLEtape(nouvelle) },
    revalider: cheminsDuModele(etape.template.ownerKey),
    ecrire: async () => {
      await prisma.planTemplateStep.update({
        where: { id: etape.id },
        data: colonnesDeLEtape(nouvelle),
      });
    },
  });

  return FAIT;
}

/**
 * Retire une étape d'un modèle, franchement.
 *
 * Pas de colonne « retirée le » : elle obligerait tous les lecteurs à la filtrer pour
 * un objet qui n'a pas d'historique propre. La trace porte l'étape entière dans son
 * `before`, et le journal est cet historique.
 */
export async function retirerEtape(etapeId: string): Promise<ResultatDEcriture> {
  const etape = await etapeEnBase(etapeId);
  if (!etape) {
    return refus("Cette étape n'existe plus.");
  }

  await actionTracee({
    action: "modele.etape.retrait",
    targetType: "modele",
    targetId: cible(etape.template.ownerKey, etape.template.kind),
    before: avantDeLEtape(etape),
    after: { moment: etape.template.kind, cle: etape.key },
    revalider: cheminsDuModele(etape.template.ownerKey),
    ecrire: async () => {
      await prisma.planTemplateStep.delete({ where: { id: etape.id } });
    },
  });

  return FAIT;
}
