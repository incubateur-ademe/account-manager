import type { z } from "zod";

import type { RiskLevel } from "@/core/connector";
import type { Profil } from "@/core/policy";
import { autoriseUneRevocation, normaliserLogin } from "@/core/rapprochement";

/**
 * Ce qu'un connecteur sait d'un scope que son schéma ne peut pas dire. Le schéma est
 * statique et déclaratif, il ne connaît aucune configuration : qu'une organisation
 * figure bien parmi celles déclarées, et qu'un rôle ouvre une administration plutôt
 * qu'une place ordinaire, se lit ici.
 */
export interface ExamenDeScope {
  /** Motifs de refus, rédigés par le connecteur. Vide quand le scope est admis. */
  refus: readonly string[];
  risque: RiskLevel;
  /** Ce que ce scope ouvre, en une ligne, pour qu'un refus le nomme au lieu de le décrire. */
  libelle: string;
}

/**
 * Ce que la vérification des profils a besoin de savoir d'un système. Un booléen et
 * non un tier : la disponibilité d'un octroi dépend des credentials, la validité d'un
 * profil non.
 */
export interface SystemeOffrantOctroi {
  key: string;
  scopeSchema: z.ZodType;
  octroiDeclare: boolean;
  /** Appelé avec un scope que `scopeSchema` a déjà accepté, jamais avec autre chose. */
  examinerScope?: (scope: unknown) => ExamenDeScope;
}

export interface RefusDOctroi {
  profil: string;
  systeme: string;
  motif: string;
}

const TYPES_ATTENDUS: Readonly<Record<string, string>> = {
  array: "une liste",
  boolean: "oui ou non",
  int: "un entier",
  number: "un nombre",
  object: "un objet",
  record: "un objet",
  string: "un texte",
};

function typeRecu(valeur: unknown): string {
  if (valeur === null) {
    return "rien";
  }
  if (Array.isArray(valeur)) {
    return "une liste";
  }

  switch (typeof valeur) {
    case "string":
      return "un texte";
    case "number":
    case "bigint":
      return "un nombre";
    case "boolean":
      return "oui ou non";
    case "object":
      return "un objet";
    default:
      return "une valeur d'un autre genre";
  }
}

/**
 * Ce que le fichier porte à l'endroit fautif. Zod ne rend pas la valeur refusée avec
 * son constat, et c'est elle qui distingue un champ oublié d'un champ mal rempli :
 * les deux appellent une correction différente.
 */
function valeurAu(racine: unknown, chemin: readonly PropertyKey[]): unknown {
  let courant: unknown = racine;

  for (const segment of chemin) {
    if (courant === null || typeof courant !== "object") {
      return undefined;
    }
    courant = (courant as Record<PropertyKey, unknown>)[segment];
  }

  return courant;
}

function citer(valeur: unknown): string {
  return `« ${typeof valeur === "string" ? valeur : JSON.stringify(valeur)} »`;
}

/**
 * Un refus se lit sur un écran français et dans un journal d'intégration continue
 * français, par quelqu'un qui édite un YAML et n'écrit pas de schémas : le message
 * brut de Zod n'y a pas sa place. Le détail technique reste admis, mais la phrase qui
 * porte le refus est française et dit quoi corriger.
 */
function motifDeScope(probleme: z.core.$ZodIssue, scope: unknown): string {
  const champ = probleme.path.length > 0 ? `scope.${probleme.path.map(String).join(".")}` : "scope";

  if (probleme.code === "unrecognized_keys") {
    const cles = probleme.keys.map((cle) => `« ${cle} »`).join(", ");
    const plusieurs = probleme.keys.length > 1;

    return `${champ} : ${plusieurs ? "les clés" : "la clé"} ${cles} ${plusieurs ? "ne sont pas attendues" : "n'est pas attendue"} sur ce système. Une clé inconnue dans un profil écrit à la main est une faute de frappe : corrigez son orthographe, ou retirez-la.`;
  }

  const admises =
    probleme.code === "invalid_value"
      ? ` Valeurs admises : ${probleme.values.map(String).join(", ")}.`
      : "";
  const recu = valeurAu(scope, probleme.path);

  if (recu === undefined) {
    return `${champ} : ce champ est obligatoire, et ce profil ne le porte pas.${admises}`;
  }

  switch (probleme.code) {
    case "invalid_value":
      return `${champ} : ${citer(recu)} n'est pas une valeur admise.${admises}`;
    case "invalid_type":
      return `${champ} : ce champ attend ${TYPES_ATTENDUS[probleme.expected] ?? probleme.expected}, ce profil y met ${typeRecu(recu)}.`;
    case "too_small":
      return probleme.origin === "string" && Number(probleme.minimum) === 1
        ? `${champ} : ce champ ne peut pas être vide.`
        : `${champ} : ${citer(recu)} est trop court, ${probleme.minimum} au minimum.`;
    default:
      return `${champ} : ${citer(recu)} est refusé par le schéma de ce système (${probleme.message}).`;
  }
}

/**
 * La seconde passe de la validation d'une politique, et la raison pour laquelle il y
 * en a deux : faire entrer les `scopeSchema` des connecteurs dans `configSchema`
 * donnerait un verdict d'un seul coup, mais `policy()` lève, si bien qu'une faute de
 * frappe dans un profil arrêterait net la collecte nocturne de tout le parc. La passe
 * Zod garantit que le fichier se charge, celle-ci refuse au bon moment sans rien faire
 * tomber d'autre.
 *
 * Pure : le catalogue est un paramètre, rien n'est lu ici, ni fichier, ni base, ni
 * environnement. Son verdict ne dépend donc d'aucun credential, et c'est voulu : un
 * profil qui vise un système dont l'octroi est indisponible faute de secret reste
 * valide, c'est à l'exécution que le tier dégrade.
 */
export function verifierProfils(
  profils: readonly Profil[],
  catalogue: readonly SystemeOffrantOctroi[],
): readonly RefusDOctroi[] {
  const parCle = new Map(catalogue.map((systeme) => [systeme.key, systeme]));
  const connus = catalogue
    .map((systeme) => systeme.key)
    .sort()
    .join(", ");

  const refus: RefusDOctroi[] = [];

  for (const profil of profils) {
    for (const acces of profil.accesses) {
      const noter = (motif: string) => {
        refus.push({ profil: profil.key, systeme: acces.system, motif });
      };

      const systeme = parCle.get(acces.system);

      // Deux motifs distincts et non un seul, parce qu'ils appellent deux gestes
      // différents : corriger une clé, ou attendre qu'un connecteur sache faire.
      if (!systeme) {
        noter(
          `aucun connecteur ne porte cette clé. Systèmes connus : ${connus.length > 0 ? connus : "aucun"}.`,
        );
        continue;
      }

      if (!systeme.octroiDeclare) {
        noter(
          "ce système ne déclare aucun octroi : son connecteur ne sait pas encore donner un accès, même à la main. L'accès est à retirer du profil en attendant qu'il le sache.",
        );
        continue;
      }

      const lu = systeme.scopeSchema.safeParse(acces.scope);

      if (!lu.success) {
        for (const probleme of lu.error.issues) {
          noter(motifDeScope(probleme, acces.scope));
        }
        continue;
      }

      const examen = systeme.examinerScope?.(lu.data);

      for (const motif of examen?.refus ?? []) {
        noter(motif);
      }

      if (examen?.risque === "high" && acces.expiresInDays === undefined) {
        noter(
          `${examen.libelle} est un accès à risque élevé : il exige une échéance, sous expiresInDays. Sans terme, il ne se referme jamais de lui-même.`,
        );
      }
    }
  }

  return refus;
}

const MS_PAR_JOUR = 24 * 60 * 60 * 1000;

/**
 * L'échéance d'un octroi, absolue et comptée depuis l'instant où le plan se construit.
 *
 * La fin de mission n'est pas un paramètre, et son absence est la règle elle-même : un
 * accès élevé ne se reconduit jamais par simple prolongation de mission. La règle est
 * ainsi portée par la signature, où personne ne peut l'oublier, plutôt que par la
 * discipline de l'appelant. Lui rendre la mission visible reviendrait à la supprimer.
 */
export function echeanceDOctroi(expiresInDays: number | undefined, maintenant: Date): Date | null {
  if (expiresInDays === undefined) {
    return null;
  }

  return new Date(maintenant.getTime() + expiresInDays * MS_PAR_JOUR);
}

/** Un compte observé sur un système, tel que la collecte et le rapprochement l'ont laissé. */
export interface IdentiteConstatee {
  provider: string;
  handle: string;
  methode: string;
  disparue: boolean;
}

const CLE_GITHUB = "github";

function reduire(provider: string, valeur: string): string | null {
  if (provider === CLE_GITHUB) {
    return normaliserLogin(valeur);
  }
  const reduit = valeur.trim();
  return reduit.length > 0 ? reduit : null;
}

/**
 * Les identifiants de la personne dont le socle répond, indexés par clé de système, et
 * ce qu'un `SubjectRef` porte sous `handles`.
 *
 * Deux sources seulement, et les deux sont sûres : le login déclaré sur la fiche, et
 * les comptes observés dont le rattachement autorise déjà une coupure. Une identité
 * rapprochée par ressemblance n'entre jamais ici, et l'asymétrie est voulue : accorder
 * une administration au compte de quelqu'un d'autre parce qu'il ressemble à la
 * personne est plus grave que de couper le mauvais.
 *
 * Une identité disparue n'entre pas davantage : elle désigne un compte que le système
 * ne rend plus, si bien qu'un octroi visant son identifiant viserait un compte mort.
 *
 * Deux valeurs sûres qui se contredisent sur le même système ne se départagent pas :
 * la clé sort absente, et son absence dégrade l'octroi en manuel chez le connecteur.
 * Choisir l'une des deux serait exactement la supposition que cette fonction existe
 * pour interdire.
 *
 * Elle attend encore son appelant, et ce n'est pas un oubli : le calcul de plan ne lit
 * aucune identité pour une arrivée, faute de quoi il ferait une requête pour rien et
 * afficherait un accès existant comme un manque. Elle ne servira qu'au premier
 * connecteur qui rendra une étape d'octroi visant un identifiant.
 */
export function handlesSurs(
  githubLogin: string | null | undefined,
  identites: readonly IdentiteConstatee[],
): Readonly<Record<string, string>> {
  const candidats = new Map<string, Set<string>>();

  const retenir = (provider: string, valeur: string | null) => {
    if (valeur === null) {
      return;
    }
    const connus = candidats.get(provider) ?? new Set<string>();
    connus.add(valeur);
    candidats.set(provider, connus);
  };

  retenir(CLE_GITHUB, normaliserLogin(githubLogin));

  for (const identite of identites) {
    if (identite.disparue || !autoriseUneRevocation(identite.methode)) {
      continue;
    }
    retenir(identite.provider, reduire(identite.provider, identite.handle));
  }

  const surs: Record<string, string> = {};

  for (const [provider, valeurs] of candidats) {
    const seule = [...valeurs];
    if (seule.length === 1 && seule[0] !== undefined) {
      surs[provider] = seule[0];
    }
  }

  return surs;
}
