import { CONNECTEURS, catalogueDOctroi } from "@/connectors";
import type { CredentialProbe, PlannedStep, SubjectRef } from "@/core/connector";
import { resolveCapability } from "@/core/connector";
import {
  assemblerOctrois,
  handlesSurs,
  type IdentiteConstatee,
  type OctroiCalcule,
  type SystemeOctroyeur,
  verifierProfils,
} from "@/core/octroi";
import type { Profil } from "@/core/policy";
import { prisma } from "@/lib/db";
import { policy } from "@/lib/policy";
import type { ChoixDeProfils, ProfilOffert } from "@/ui/profils";

/**
 * Ce qu'un connecteur rend quand il ne sait pas décrire l'octroi d'un profil.
 *
 * Le connecteur qui ne l'expose pas n'est pas en panne : chaque accès de profil visant
 * son système sort en étape manuelle portant le runbook du contrat, ce qui est le
 * comportement voulu. Une ligne d'arrivée qui manque est le mode de panne que ce
 * produit existe pour éviter, là où une ligne « à faire à la main, voici la marche à
 * suivre » se traite.
 */
const SANS_ETAPE = (): readonly PlannedStep[] => [];

/**
 * Le catalogue tel que la construction d'un plan d'arrivée le voit : ce que
 * `verifierProfils` demande déjà, plus la voie d'octroi résolue contre les credentials
 * du jour.
 *
 * Il étend celui de la vérification de politique au lieu de le refaire, et c'est le
 * point : un profil que la politique accepte doit produire un plan, et un scope
 * qu'une passe validerait sans l'autre laisserait un fichier valide donner une arrivée
 * qui ne part jamais.
 */
export async function catalogueOctroyeur(): Promise<readonly SystemeOctroyeur[]> {
  const offrants = new Map(catalogueDOctroi().map((systeme) => [systeme.key, systeme]));

  const sondes = await Promise.all(
    CONNECTEURS.map(
      async (connecteur): Promise<[string, readonly CredentialProbe[]]> => [
        connecteur.contract.key,
        await connecteur.probe(),
      ],
    ),
  );
  const parCle = new Map(sondes);

  return CONNECTEURS.flatMap((connecteur) => {
    const { contract } = connecteur;
    const offrant = offrants.get(contract.key);
    if (!offrant) {
      return [];
    }

    return [
      {
        ...offrant,
        capacite: resolveCapability(
          "grant",
          contract.capabilities.grant,
          parCle.get(contract.key) ?? [],
          contract.runbook,
        ),
        planifier: connecteur.planifierOctroi ?? SANS_ETAPE,
      },
    ];
  });
}

/**
 * Les identifiants de la personne dont le socle répond, tels qu'un connecteur les
 * recevra sous `SubjectRef.handles`.
 *
 * Seule lecture d'identités qu'une arrivée fait, et elle ne sert qu'à ça : viser un
 * compte. Ce qui est observé ne dit rien de ce qu'il faut donner, et l'afficher ferait
 * passer un accès existant pour un manque, si bien qu'aucune de ces lignes n'entre
 * dans le plan autrement que comme cible d'un octroi.
 *
 * Une identité rapprochée par ressemblance n'y entre jamais, `handlesSurs` s'en
 * charge : sans identifiant sûr, l'octroi dégrade en manuel chez le connecteur, ce qui
 * manque étant une donnée et non un credential.
 */
async function identifiantsSurs(personId: string): Promise<Readonly<Record<string, string>>> {
  const [personne, identites] = await Promise.all([
    prisma.person.findUnique({ where: { id: personId }, select: { githubLogin: true } }),
    prisma.externalIdentity.findMany({
      where: { personId, vanishedAt: null },
      select: { provider: true, handle: true, matchMethod: true },
    }),
  ]);

  const constatees: readonly IdentiteConstatee[] = identites.map((identite) => ({
    provider: identite.provider,
    handle: identite.handle,
    methode: identite.matchMethod,
    disparue: false,
  }));

  return handlesSurs(personne?.githubLogin, constatees);
}

export function profilDeLaPolitique(key: string | null | undefined): Profil | undefined {
  if (!key) {
    return undefined;
  }
  return policy().profiles.find((profil) => profil.key === key);
}

/**
 * Les profils tels qu'ils s'offrent au moment d'ouvrir une arrivée, séparés selon que
 * la politique les accepte ou non.
 *
 * La vérification est la même que celle de l'ouverture, faite ici pour que le refus se
 * lise avant le clic plutôt qu'après : un profil dont un accès ne s'applique pas ne
 * produira aucun plan, et le proposer à choisir enverrait droit dans un mur.
 *
 * L'échec de lecture est absorbé, comme sur l'écran des systèmes. Ouvrir une arrivée
 * sans profil reste licite, et une politique refusée ne doit pas retirer ce geste-là
 * en plus du choix qu'elle emporte déjà.
 */
export function profilsOfferts(): ChoixDeProfils {
  try {
    const catalogue = catalogueDOctroi();
    const profils = policy().profiles.map((profil): ProfilOffert => {
      const refus = verifierProfils([profil], catalogue);

      return {
        cle: profil.key,
        libelle: profil.label,
        ouvre: profil.accesses.map((acces) => ({
          systeme: acces.system,
          scope: JSON.stringify(acces.scope),
          echeance:
            acces.expiresInDays === undefined
              ? "sans échéance"
              : `${acces.expiresInDays} jours d'accès`,
        })),
        refus: refus.map(
          (motif) => `accès n°${motif.acces + 1} sur ${motif.systeme} : ${motif.motif}`,
        ),
      };
    });

    return {
      etat: "lus",
      offerts: profils.filter(({ refus }) => refus.length === 0),
      refuses: profils.filter(({ refus }) => refus.length > 0),
    };
  } catch (erreur) {
    console.error("[arrivée] politique illisible, aucun profil n'est proposé", erreur);
    return { etat: "illisible" };
  }
}

/**
 * Les étapes qu'un profil ouvre pour une personne, et les refus qui empêchent d'en
 * enregistrer aucune.
 *
 * Le catalogue interrogé est celui de tous les systèmes qui déclarent savoir donner,
 * et jamais celui des systèmes où la personne est observée : la source s'inverse d'un
 * sens à l'autre, puisqu'à l'arrivée elle n'a par définition encore aucun compte.
 */
export async function octroisDUnProfil(
  profil: Profil,
  personId: string,
  username: string,
  maintenant: Date,
): Promise<OctroiCalcule> {
  const [catalogue, handles] = await Promise.all([
    catalogueOctroyeur(),
    identifiantsSurs(personId),
  ]);

  const sujet: SubjectRef = {
    kind: "person",
    username,
    ...(Object.keys(handles).length > 0 ? { handles } : {}),
  };

  return assemblerOctrois(profil, catalogue, sujet, maintenant);
}
