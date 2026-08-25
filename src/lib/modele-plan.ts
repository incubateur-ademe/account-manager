import {
  CLE_INCUBATEUR,
  type EtapeDeModele,
  type EtapesDeModeles,
  etapesDepuisModeles,
  lireSaisieAttendue,
  type ModeleDePlan,
  modeleDuPlan,
} from "@/core/modele-plan";
import { startupsEffectives } from "@/core/rattachement-startup";
import type { PlanKind, RiskLevel } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";

/**
 * Ce module ne connaît que la lecture, et l'édition vit à côté dans
 * `modele-plan-edition.ts` : le calcul d'un plan traverserait sinon la session, le
 * cache de Next et NextAuth pour la seule raison que les écritures partagent ses
 * requêtes.
 */
export const SELECTION_ETAPE = {
  key: true,
  position: true,
  title: true,
  runbook: true,
  deeplink: true,
  doneWhen: true,
  input: true,
  riskLevel: true,
} as const;

export interface LigneDEtape {
  key: string;
  position: number;
  title: string;
  runbook: string | null;
  deeplink: string | null;
  doneWhen: string;
  input: unknown;
  riskLevel: RiskLevel;
}

interface LigneDeModele {
  ownerKey: string;
  startupsMayExtend: boolean;
  steps: readonly LigneDEtape[];
}

/**
 * Relit la saisie attendue d'une étape stockée, sans jamais lever.
 *
 * Une saisie mal formée ne se tait pas pour autant : la taire ferait pointer « fait »
 * sur une étape qui réclamait une valeur. L'étape est marquée et l'assemblage l'écarte,
 * mais seulement après avoir appliqué l'autorisation. Lever ici ferait tomber
 * l'ouverture, la confirmation, le recalcul et l'affichage d'un dossier pour une étape
 * de startup que l'autorisation aurait de toute façon neutralisée, et sur un message
 * que l'écran d'erreur n'affiche pas.
 */
function saisieDeLEtape(etape: LigneDEtape): Pick<EtapeDeModele, "saisie" | "saisieIllisible"> {
  try {
    return { saisie: lireSaisieAttendue(etape.input), saisieIllisible: false };
  } catch {
    return { saisie: null, saisieIllisible: true };
  }
}

/**
 * Le passage des colonnes au vocabulaire du cœur. Explicite et non générique : les
 * noms anglais s'arrêtent à la ligne Prisma, et le reste du code ne connaît que
 * `titre`, `critere` et `marcheASuivre`.
 */
function modeleDeLaLigne(ligne: LigneDeModele): ModeleDePlan {
  return {
    proprietaire: ligne.ownerKey,
    startupsPeuventCompleter: ligne.startupsMayExtend,
    etapes: ligne.steps.map(
      (etape): EtapeDeModele => ({
        cle: etape.key,
        position: etape.position,
        titre: etape.title,
        marcheASuivre: etape.runbook,
        lien: etape.deeplink,
        critere: etape.doneWhen,
        risque: etape.riskLevel,
        ...saisieDeLEtape(etape),
      }),
    ),
  };
}

const AUCUNE_ETAPE: EtapesDeModeles = { origines: [], ecartees: [] };

/**
 * Ce que les modèles déclarés demandent pour cette personne et ce moment, prêt à
 * être assemblé avec ce que les connecteurs proposent.
 *
 * Les modèles se lisent en une requête, celle de l'incubateur et celles des startups
 * ensemble : une requête par startup ferait dépendre le temps d'affichage d'un
 * dossier du nombre de rattachements de la personne.
 *
 * Les startups lues sont les **effectives** et non `Person.startups` : un
 * rattachement manuel en cours est précisément le cas qu'un modèle d'arrivée sert, et
 * l'ignorer priverait de ses étapes la personne pour qui elles ont été écrites.
 */
export async function etapesDeclarees(
  personId: string,
  kind: PlanKind,
  maintenant: Date,
): Promise<EtapesDeModeles> {
  const moment = modeleDuPlan(kind);
  if (moment === null) {
    return AUCUNE_ETAPE;
  }

  const personne = await prisma.person.findUnique({
    where: { id: personId },
    select: {
      startups: true,
      startupAssignments: {
        where: { endedAt: null },
        select: { startupGhid: true, until: true, endedAt: true },
      },
    },
  });

  if (!personne) {
    return AUCUNE_ETAPE;
  }

  const lignes = await prisma.planTemplate.findMany({
    where: {
      ownerKey: {
        in: [
          CLE_INCUBATEUR,
          ...startupsEffectives(personne.startups, personne.startupAssignments, maintenant),
        ],
      },
      kind: moment,
    },
    select: { ownerKey: true, startupsMayExtend: true, steps: { select: SELECTION_ETAPE } },
  });

  return etapesDepuisModeles({ modeles: lignes.map(modeleDeLaLigne), moment });
}
