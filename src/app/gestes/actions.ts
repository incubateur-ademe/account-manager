"use server";

import { intentionDUnGeste } from "@/core/geste";
import { actionTracee } from "@/lib/actions";
import { prisma } from "@/lib/db";
import { enregistrerPlan, messageDeRefus } from "@/lib/dossier";
import { calculerGeste, departOuvertSur, REFUS_DEPART_OUVERT } from "@/lib/geste";
import { requireOperateur } from "@/lib/session";

export interface EtatDUnGeste {
  erreur?: string;
  /** L'identifiant du brouillon écrit, que l'écran ira confirmer. */
  planId?: string;
}

/**
 * Longueur minimale d'une justification, sur le modèle de la clôture d'un constat : le
 * schéma dit la forme, l'action dit la règle de saisie.
 */
const JUSTIFICATION_MINIMALE = 3;

/**
 * Ouvre un geste hors dossier : un plan de plus, simplement un plan qui n'a pas de dossier.
 *
 * La trace vise la personne et non le plan, et ce n'est pas un choix de commodité :
 * `actionTracee` journalise avant d'écrire, alors que l'identifiant du plan est tiré à
 * l'intérieur d'`enregistrerPlan`. Viser un plan qui n'existe pas encore poserait au
 * journal, à rétention indéfinie, une ligne pointant vers rien.
 *
 * La garde précède la première lecture, et `actionTracee` la repose ensuite sans qu'on lui
 * passe d'utilisateur : rien ici ne relit de droit avant d'écrire, contrairement au pointage
 * et au verdict, seuls appelants qui fournissent le leur. S'en remettre à elle seule
 * laisserait cette action lire la fiche et son dossier avant que quiconque ait prouvé qu'il
 * est de l'équipe.
 */
export async function ouvrirGeste(
  _etat: EtatDUnGeste | null,
  formData: FormData,
): Promise<EtatDUnGeste> {
  await requireOperateur();

  const username = String(formData.get("username") ?? "").trim();
  const systeme = String(formData.get("systeme") ?? "").trim();
  const justification = String(formData.get("justification") ?? "").trim();
  const terme = String(formData.get("expiresInDays") ?? "").trim();
  const scopeEcrit = String(formData.get("scope") ?? "").trim();

  if (justification.length < JUSTIFICATION_MINIMALE) {
    return {
      erreur:
        "La justification est ce qui restera quand personne ne se souviendra de la demande : écrivez-la en clair.",
    };
  }

  let scope: unknown;
  try {
    scope = scopeEcrit.length === 0 ? {} : JSON.parse(scopeEcrit);
  } catch {
    return { erreur: "Le périmètre demandé n'est pas lisible : il attend un objet JSON." };
  }

  const lue = intentionDUnGeste.safeParse({
    systeme,
    scope,
    justification,
    ...(terme.length === 0 ? {} : { expiresInDays: Number(terme) }),
  });

  if (!lue.success) {
    return {
      erreur: `Cette demande n'a pas la forme d'une intention : ${lue.error.issues
        .map((probleme) => `${probleme.path.join(".") || "intention"} : ${probleme.message}`)
        .join(" ; ")}`,
    };
  }

  const personne = await prisma.person.findUnique({
    where: { username },
    select: { id: true, username: true },
  });

  if (!personne) {
    return { erreur: "Cette fiche n'existe plus." };
  }

  // Lu avant toute trace, et refermé du côté de l'écriture par la condition d'ancrage de la
  // confirmation : ce qui peut arriver entre les deux est l'ouverture d'un départ.
  if (await departOuvertSur(personne.id)) {
    return { erreur: REFUS_DEPART_OUVERT };
  }

  const maintenant = new Date();
  const calcule = await calculerGeste(lue.data, personne.id, personne.username, maintenant);

  // Ici et pas au milieu de la transaction, comme le recalcul le fait déjà : un scope que le
  // schéma du connecteur refuse, ou un rôle élevé sans terme, se dit sous le formulaire.
  if (calcule.refus.length > 0) {
    return { erreur: messageDeRefus(calcule.refus) };
  }

  const planId = await actionTracee({
    action: "geste.ouverture",
    targetType: "personne",
    targetId: personne.username,
    after: { intention: lue.data, etapes: calcule.etapes.length, empreinte: calcule.empreinte },
    revalider: [`/personnes/${personne.username}`],
    ecrire: (operateur) =>
      prisma.$transaction(async (transaction) => {
        // Un brouillon de geste n'a ni recalcul ni annulation : reposer le geste est sa
        // seule sortie, et c'est le code qui tient cette unicité, l'index unique partiel
        // laissant libres les plans sans dossier.
        await transaction.plan.updateMany({
          where: { subjectId: personne.id, kind: "MANUAL_OP", state: "DRAFT" },
          data: { state: "STALE" },
        });

        return enregistrerPlan(
          { kind: "MANUAL_OP", subjectId: personne.id, intention: lue.data },
          calcule,
          operateur.username,
          maintenant,
          transaction,
        );
      }),
  });

  return { planId };
}
