import type { ReleveSysteme, SystemeMuet } from "@/core/collecte";
import { type AccesConstate, inventaireParSysteme, type LigneDInventaire } from "@/core/inventaire";
import { revueDe } from "@/core/revue";
import { OU_RESSEMBLANCE_A_CONFIRMER, OU_SANS_DETENTEUR } from "@/lib/comptes-isoles";
import { prisma } from "@/lib/db";

/** Ce que « récemment » veut dire pour le compteur du journal, et rien d'autre. */
export const FENETRE_JOURNAL_JOURS = 30;

const JOUR = 24 * 60 * 60 * 1000;

export interface Inventaire {
  systemes: LigneDInventaire[];
  /**
   * Les deux sous-chiffres sont disjoints et leur somme est le total : le total n'est
   * pas relu en base, il en découle, ce qui interdit qu'ils divergent.
   */
  nonRevocables: { sansDetenteur: number; ressemblance: number; total: number };
  comptesDeService: { suivis: number; enRetard: number };
  startups: { suivies: number; terminales: number };
  /**
   * Approximatif par construction : le journal s'écrit sans attendre, avec capture
   * d'erreur, donc une panne d'écriture ne se voit nulle part. C'est une preuve
   * d'activité, jamais une couverture, et jamais un dénominateur.
   */
  operationsTracees: number;
}

export interface PerimetreDInventaire {
  phasesTerminales: readonly string[];
  /**
   * Les startups qui portent encore au moins une personne. L'écran des startups ne
   * compte comme terminale que celle qui a gardé quelqu'un, parce qu'une startup finie
   * et vide n'appelle plus aucun geste. Les deux écrans afficheraient sinon deux
   * nombres sous le même intitulé.
   */
  ghidsPeuples: ReadonlySet<string>;
  /** Les systèmes attendus, dans leur ordre de déclaration. */
  attendus: readonly string[];
  releves: readonly ReleveSysteme[];
  muets: readonly SystemeMuet[];
}

/**
 * Tout l'inventaire en un seul aller, et un nombre de requêtes qui ne dépend pas du
 * nombre de connecteurs déclarés.
 *
 * L'écran Systèmes interroge la base une fois par connecteur ; à dix connecteurs, ce
 * patron ferait dix requêtes pour un seul chiffre. Ici les comptes sont regroupés par
 * système en une passe, et les systèmes attendus sont recoupés après coup.
 *
 * Rien ici ne parle au réseau : le socle ne lit que ce que la dernière collecte a
 * laissé. Ce qui interroge un système est une tuile, et une tuile ne décide rien.
 */
export async function chargerInventaire(
  maintenant: Date,
  perimetre: PerimetreDInventaire,
): Promise<Inventaire> {
  const depuis = new Date(maintenant.getTime() - FENETRE_JOURNAL_JOURS * JOUR);

  const [
    comptesParProvider,
    acces,
    ressources,
    sansDetenteur,
    ressemblance,
    comptes,
    startups,
    operations,
  ] = await Promise.all([
    prisma.externalIdentity.groupBy({
      by: ["provider"],
      where: { vanishedAt: null },
      _count: { _all: true },
    }),
    // `resourceId` et non la relation `resource` : Prisma traduit une relation
    // sélectionnée par une seconde requête dont la clause `IN` reprend un paramètre
    // par accès, doublons compris. Les ressources se lisent d'un coup, à part, et se
    // recollent en mémoire ; elles sont deux ordres de grandeur moins nombreuses.
    // L'identité doit être vivante elle aussi, et pas seulement l'accès. Les deux
    // datations sont découplées : un garde-fou peut refuser de dater les accès d'un
    // système tout en laissant dater ses identités, et ce refus s'installe. Sans cette
    // clause, le total et son détail sortent de deux populations différentes, et
    // « dont » finit par désigner plus de comptes que le nombre qui le précède.
    prisma.accessGrant.findMany({
      where: { vanishedAt: null, externalIdentity: { vanishedAt: null } },
      select: { externalIdentityId: true, role: true, firstSeenAt: true, resourceId: true },
    }),
    prisma.resource.findMany({ select: { id: true, provider: true } }),
    prisma.externalIdentity.count({ where: OU_SANS_DETENTEUR }),
    prisma.externalIdentity.count({ where: OU_RESSEMBLANCE_A_CONFIRMER }),
    prisma.serviceAccount.findMany({
      select: { reviewEveryDays: true, lastReviewedAt: true, createdAt: true },
    }),
    prisma.startup.findMany({
      where: { vanishedAt: null },
      select: { ghid: true, currentPhase: true },
    }),
    prisma.auditEvent.count({ where: { at: { gte: depuis } } }),
  ]);

  const providerDeLaRessource = new Map(ressources.map((une) => [une.id, une.provider]));

  const constates: AccesConstate[] = acces.flatMap((un) => {
    const provider = providerDeLaRessource.get(un.resourceId);
    // Un accès dont la ressource a disparu de la table ne se rattache à aucun système :
    // le compter quelque part serait l'inventer.
    return provider === undefined
      ? []
      : [
          {
            externalIdentityId: un.externalIdentityId,
            provider,
            role: un.role,
            firstSeenAt: un.firstSeenAt,
          },
        ];
  });

  return {
    systemes: inventaireParSysteme(
      perimetre.attendus,
      comptesParProvider.map((ligne) => ({ provider: ligne.provider, comptes: ligne._count._all })),
      constates,
      perimetre.releves,
      perimetre.muets,
    ),
    nonRevocables: {
      sansDetenteur,
      ressemblance,
      total: sansDetenteur + ressemblance,
    },
    comptesDeService: {
      suivis: comptes.length,
      // Sans seuil de politique : l'écran des comptes de service appelle `revueDe`
      // avec son défaut, et deux appels différents afficheraient deux chiffres.
      enRetard: comptes.filter((compte) => revueDe(compte, maintenant).etat === "EN_RETARD").length,
    },
    startups: {
      suivies: startups.length,
      terminales: startups.filter(
        (une) =>
          une.currentPhase !== null &&
          perimetre.phasesTerminales.includes(une.currentPhase) &&
          perimetre.ghidsPeuples.has(une.ghid),
      ).length,
    },
    operationsTracees: operations,
  };
}
