"use server";

import { randomUUID } from "node:crypto";

import { after } from "next/server";

import { actionTracee } from "@/lib/actions";
import { deconnecter, prisma } from "@/lib/db";
import { requireOperateur } from "@/lib/session";
import { collecteEnCours, executerSync } from "@/lib/sync/executer";

export interface EtatLancement {
  message?: string;
  erreur?: string;
}

/**
 * Une collecte dure de trente à soixante secondes : l'attendre exposerait la requête
 * au délai du proxy, et un onglet fermé laisserait le travail sans destinataire.
 * `after` la lance une fois la réponse envoyée, dans le même processus.
 *
 * Deux verrous, parce qu'ils ne couvrent pas la même chose. Celui en mémoire arrête
 * le double clic, dans la seconde qui sépare le clic de l'ouverture du premier run.
 * Celui en base arrête ce qui tourne encore et survit à un rechargement de page.
 */
let lancementEnCours = false;

export async function lancerCollecte(): Promise<EtatLancement> {
  await requireOperateur();

  const maintenant = new Date();

  if (lancementEnCours) {
    return { erreur: "Une collecte vient d'être lancée." };
  }

  const enCours = await collecteEnCours(maintenant);
  if (enCours) {
    const minutes = Math.floor((maintenant.getTime() - enCours.depuis.getTime()) / 60_000);
    return {
      erreur: `Une collecte est déjà en cours depuis ${minutes} minute${minutes > 1 ? "s" : ""} (${enCours.provider}).`,
    };
  }

  const correlationId = randomUUID();
  lancementEnCours = true;

  await actionTracee({
    action: "sync.lancement",
    targetType: "collecte",
    targetId: correlationId,
    after: { declenchement: "manuel" },
    revalider: ["/collectes", "/"],
    ecrire: async () => {
      after(async () => {
        try {
          /*
           * Le détail par étape n'existe nulle part ailleurs : la base garde les
           * runs, les constats et le journal d'audit, pas « 241 personnes, 0 créées,
           * 241 mises à jour », qui est ce qu'on lit quand une collecte se comporte
           * bizarrement. Sa place est donc dans les journaux du conteneur, au même
           * endroit que ceux de la collecte nocturne.
           */
          await executerSync(new Date(), correlationId, (ligne) => {
            // biome-ignore lint/suspicious/noConsole: sortie de collecte, voir ci-dessus
            console.log(ligne);
          });
        } catch (error: unknown) {
          console.error("[sync] échec non rattrapé", error);
        } finally {
          lancementEnCours = false;
          await deconnecter().catch(() => undefined);
        }
      });
    },
  });

  return { message: "Collecte lancée. Rafraîchissez dans une minute." };
}

export type EtatAutorisation = { erreur: string } | null;

/**
 * Lève une fois le garde-fou de chute pour un fournisseur.
 *
 * Le garde-fou refuse de dater des disparitions quand une collecte perd une part
 * excessive de ce qu'elle connaissait, et il a raison : sans lui, une lecture qui
 * échoue à moitié ferait disparaître des gens. Mais quand la chute vient de données
 * que ce refus empêche justement de nettoyer, il se maintient lui-même et plus aucune
 * disparition n'est jamais datée pour ce système.
 *
 * L'autorisation ne vaut que pour un passage, et elle est nominative : c'est une
 * décision, pas un réglage. Rien n'est écrit ici sur les accès eux-mêmes, c'est la
 * prochaine collecte qui conclura, avec ce que ses propres yeux auront vu.
 */
export async function autoriserDatation(
  _etat: EtatAutorisation,
  formData: FormData,
): Promise<EtatAutorisation> {
  await requireOperateur();

  const provider = String(formData.get("provider") ?? "").trim();
  const famille = String(formData.get("famille") ?? "").trim();
  const raison = String(formData.get("raison") ?? "").trim();

  if (famille !== "identites" && famille !== "ressources") {
    return { erreur: "Famille de garde-fou non reconnue." };
  }
  if (!provider) {
    return { erreur: "Système introuvable." };
  }
  if (raison.length < 3) {
    return {
      erreur:
        "Indiquez pourquoi cette chute est légitime : lever un garde-fou sans motif est une décision qu'on ne saura pas réexaminer.",
    };
  }

  const dejaPosee = await prisma.scopeDropOverride.findFirst({
    where: { provider, famille, consumedAt: null },
    select: { id: true },
  });
  if (dejaPosee) {
    return { erreur: "Une autorisation attend déjà la prochaine collecte pour ce système." };
  }

  await actionTracee({
    action: "sync.gardefou.autorise",
    targetType: "system",
    targetId: provider,
    after: { famille, raison },
    revalider: ["/collectes"],
    ecrire: async (operateur) => {
      await prisma.scopeDropOverride.create({
        data: { provider, famille, reason: raison, createdBy: operateur.username },
      });
    },
  });

  return null;
}
