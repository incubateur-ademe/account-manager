import { z } from "zod";

import type {
  CollectError,
  CollectResult,
  Connector,
  ConnectorContract,
  Diagnosis,
  NonEmptyArray,
  ObservedGrant,
  ObservedIdentity,
} from "@/core/connector";
import { lireChaque } from "@/core/lecture";
import { env } from "@/lib/env";

/**
 * Trois hôtes sont publiés par Notion selon les pages, et les trois répondent. Celui-ci
 * est le seul qui ait été éprouvé, et `meta.location` des réponses, qui en désigne un
 * autre, n'est pas suivi : rien ne garantit qu'il reste servi.
 */
const HOTE = "https://api.notion.com/scim/v2";

const CREDENTIAL = "notion:scim";

/** Notion n'expose pas d'adresse par membre : l'opérateur atterrit sur la liste. */
const MEMBRES = "https://www.notion.so/settings/members";

const RUNBOOK =
  "Retirer la personne dans Paramètres > Membres du workspace Notion, puis vérifier qu'elle ne figure plus dans la liste. Deux limites : le propriétaire qui a créé le jeton SCIM ne se retire pas par ce chemin, et les invités n'y figurent pas, si bien qu'une fiche sans compte Notion peut garder un accès invité.";

const PAR_PAGE = 100;

/** Large pour une page de cent fiches, court devant une nuit de collecte bloquée. */
const DELAI_MS = 15_000;

/**
 * Dix pages valent mille sièges, bien au-delà du parc réel. La borne existe parce
 * qu'un `totalResults` menteur ferait boucler sans fin, et signaler l'anomalie vaut
 * mieux que de rendre un inventaire tronqué pour complet.
 */
const PAGES_MAX = 10;

const EXTENSION = "urn:ietf:params:scim:schemas:extension:notion:2.0:User";

/**
 * Calé sur ce que l'instance rend, jamais sur ce que la RFC promet. Sont requis les
 * seuls champs sans lesquels l'identité n'existe pas : un champ exigé à tort ferait
 * écarter la fiche, donc la ferait dater comme disparue au passage suivant.
 *
 * `name` n'est pas déclaré du tout : le test de contrat a établi que sur le parc réel,
 * aucun de ses sous-champs n'est garanti, pas même `formatted`. Le nom d'affichage se
 * lit de toute façon sur la fiche de la personne, pas sur le compte. `meta` et
 * `photos` ne sont pas déclarés non plus, leurs horodatages étant des chaînes de
 * chiffres que Notion annonce lui-même comme dénuées de sens.
 */
const utilisateurSchema = z.object({
  id: z.string().min(1),
  userName: z.string().min(1),
  emails: z.array(z.object({ value: z.string().nullish() })).nullish(),
  active: z.boolean().nullish(),
  // Une chaîne libre et non une énumération : Notion a ajouté `restricted_member`
  // sans prévenir, et un rôle inconnu ferait écarter la fiche entière, donc dater
  // comme disparu quelqu'un dont le seul tort serait d'avoir un rôle neuf.
  [EXTENSION]: z.object({ role: z.string().min(1).nullish() }).nullish(),
});

type UtilisateurScim = z.infer<typeof utilisateurSchema>;

/** `Resources` reste en `unknown` pour que chaque entrée soit triée séparément. */
const enveloppeSchema = z.object({
  totalResults: z.number().int().nonnegative(),
  Resources: z.array(z.unknown()).optional(),
});

/**
 * La lecture distante, séparée de l'assemblage : ce qui appelle le réseau d'un côté,
 * ce qui décide de l'autre, faute de quoi le connecteur ne se teste pas sans jeton.
 */
export type LecteurScim = (startIndex: number, count: number) => Promise<unknown>;

export interface LectureMembres {
  membres: UtilisateurScim[];
  /**
   * Entrées reçues dans les enveloppes, illisibles comprises. C'est ce nombre qui se
   * compare à `totalResults` et détecte une troncature, jamais celui des identités
   * rendues : les confondre ferait passer une page illisible pour une page absente.
   */
  recus: number;
  total: number | null;
  erreurs: CollectError[];
  /** Vrai quand aucune enveloppe n'a pu être lue, donc qu'il n'y a rien à écrire. */
  fatale: boolean;
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function lireTout(startIndex: number, count: number): Promise<unknown> {
  const jeton = env.NOTION_SCIM_TOKEN;
  if (!jeton) {
    throw new Error("aucun jeton SCIM configuré");
  }

  const reponse = await fetch(`${HOTE}/Users?startIndex=${startIndex}&count=${count}`, {
    headers: { authorization: `Bearer ${jeton}`, accept: "application/scim+json" },
    // `fetch` n'a aucun délai par défaut : une réponse qui ne vient jamais gèlerait la
    // collecte entière, qui tourne la nuit sans personne pour la relancer. Un abandon
    // remonte comme n'importe quelle erreur de lecture, donc en run non `ok`.
    signal: AbortSignal.timeout(DELAI_MS),
  });

  if (!reponse.ok) {
    throw new Error(`${reponse.status} ${reponse.statusText}`);
  }

  return reponse.json();
}

/**
 * SCIM annonce son total, ce qui vaut mieux que la fin de page incomplète dont GitHub
 * doit se contenter : on redemande tant que le cumul reçu reste sous ce total. Une
 * enveloppe vide arrête aussi la boucle, sinon un total menteur la ferait tourner.
 *
 * Le serveur déclare ne pas savoir trier, si bien que l'ordre entre deux pages n'est
 * garanti par rien. Une fiche qui glisse d'une page à l'autre entre deux requêtes est
 * alors vue deux fois pendant qu'une autre n'est jamais vue, et les deux s'annulent
 * dans le compte d'entrées reçues : le total tomberait juste sur un inventaire
 * incomplet. D'où la détection du doublon lui-même, qui est le seul signe observable
 * de ce désordre, et qui force la collecte en partielle plutôt que de la laisser
 * conclure.
 */
export async function lireMembres(lire: LecteurScim): Promise<LectureMembres> {
  const lecture: LectureMembres = {
    membres: [],
    recus: 0,
    total: null,
    erreurs: [],
    fatale: false,
  };

  const vus = new Set<string>();
  let pagesLues = 0;
  let startIndex = 1;

  for (let page = 1; page <= PAGES_MAX; page += 1) {
    let brut: unknown;
    try {
      brut = await lire(startIndex, PAR_PAGE);
    } catch (cause: unknown) {
      lecture.erreurs.push({
        scope: "membres",
        itemRef: `startIndex=${startIndex}`,
        message: message(cause),
      });
      break;
    }

    const enveloppe = enveloppeSchema.safeParse(brut);
    if (!enveloppe.success) {
      lecture.erreurs.push({
        scope: "membres",
        itemRef: `startIndex=${startIndex}`,
        message: `enveloppe illisible (${enveloppe.error.issues.map((issue) => issue.message).join(", ")})`,
      });
      break;
    }

    pagesLues += 1;
    lecture.total ??= enveloppe.data.totalResults;

    const entrees = enveloppe.data.Resources ?? [];
    if (entrees.length === 0) {
      break;
    }

    const lus = lireChaque(entrees, utilisateurSchema, "membre");

    for (const membre of lus.items) {
      if (vus.has(membre.id)) {
        lecture.erreurs.push({
          scope: "membres",
          itemRef: membre.id,
          message:
            "entrée rendue deux fois : l'inventaire a bougé pendant la pagination, une autre fiche a donc pu être sautée",
        });
        continue;
      }
      vus.add(membre.id);
      lecture.membres.push(membre);
    }

    // Le rang de l'entrée fautive est déjà dans le message que rend `lireChaque` :
    // le recalculer ici ferait pointer le rang de l'erreur, qui ne coïncide avec
    // celui de l'entrée que lorsqu'aucune entrée saine ne les sépare.
    for (const texte of lus.erreurs) {
      lecture.erreurs.push({
        scope: "membre",
        itemRef: `page à partir de ${startIndex}`,
        message: texte,
      });
    }

    lecture.recus += entrees.length;
    startIndex = lecture.recus + 1;

    if (lecture.recus >= lecture.total) {
      break;
    }

    if (page === PAGES_MAX) {
      lecture.erreurs.push({
        scope: "membres",
        message: `pagination anormalement longue, arrêtée après ${PAGES_MAX} pages`,
      });
    }
  }

  lecture.fatale = pagesLues === 0;

  if (!lecture.fatale && lecture.recus === 0) {
    lecture.erreurs.push({
      scope: "membres",
      message:
        "aucune entrée rendue : un inventaire vide ne se distingue pas d'une panne silencieuse",
    });
  }

  if (!lecture.fatale && lecture.total !== null && lecture.recus !== lecture.total) {
    lecture.erreurs.push({
      scope: "membres",
      message: `inventaire tronqué : ${lecture.recus} entrées reçues pour ${lecture.total} annoncées`,
    });
  }

  return lecture;
}

function adressesDe(membre: UtilisateurScim): readonly string[] {
  const brutes = [membre.userName, ...(membre.emails ?? []).map((courriel) => courriel.value)];
  return [...new Set(brutes.filter((adresse): adresse is string => Boolean(adresse)))];
}

/**
 * Un membre du workspace détient un accès au système entier et à rien de plus précis :
 * aucune ressource n'est émise, le socle rattache l'accès à la ressource réservée qu'il
 * pose lui-même. Les groupes feraient de bonnes ressources, mais retirer quelqu'un du
 * workspace le retire de tous ses groupes : le chemin de révocation ne perd rien.
 */
export function assembler(membres: readonly UtilisateurScim[]): {
  identites: ObservedIdentity[];
  acces: ObservedGrant[];
} {
  const identites = new Map<string, ObservedIdentity>();
  const acces: ObservedGrant[] = [];

  for (const membre of membres) {
    // Un accès par identité et non par entrée : deux entrées portant le même
    // identifiant produiraient sinon deux accès vivants pour un seul siège.
    if (identites.has(membre.id)) {
      continue;
    }

    const retire = membre.active === false;

    identites.set(membre.id, {
      externalId: membre.id,
      idKind: "opaque",
      handle: membre.userName,
      emails: adressesDe(membre),
      ...(retire ? { details: [{ label: "État du compte", value: "retiré du workspace" }] } : {}),
    });

    // Chez Notion, `active: false` n'est pas une suspension mais l'opération de
    // retrait : émettre un accès vivant pour un compte retiré serait affirmer un
    // droit que le fournisseur dit éteint. L'identité, elle, reste rendue, sans quoi
    // le socle la daterait comme disparue alors que Notion la connaît encore.
    if (!retire) {
      acces.push({
        identityExternalId: membre.id,
        role: membre[EXTENSION]?.role ?? "member",
      });
    }
  }

  return { identites: [...identites.values()], acces };
}

export async function collecter(lire: LecteurScim): Promise<CollectResult> {
  const lecture = await lireMembres(lire);

  if (lecture.fatale) {
    // Une liste d'erreurs vide ici signifierait qu'on ne sait pas pourquoi on a
    // echoue : le dire vaut mieux qu'un tableau vide sous un type qui promet le
    // contraire.
    const [premiere, ...reste] = lecture.erreurs;
    const erreurs: NonEmptyArray<CollectError> = premiere
      ? [premiere, ...reste]
      : [{ scope: "membres", message: "aucune enveloppe lue, sans erreur rapportée" }];

    return { status: "failed", errors: erreurs };
  }

  const { identites, acces } = assembler(lecture.membres);

  const payload = {
    itemsSeen: identites.length,
    identities: identites,
    resources: [],
    grants: acces,
  };

  const [premiere, ...reste] = lecture.erreurs;

  return premiere
    ? { status: "partial", errors: [premiere, ...reste], ...payload }
    : { status: "ok", ...payload };
}

/**
 * Ce que la collecte ne peut pas voir, et que le diagnostic va chercher.
 *
 * Un champ requis qui disparaît fait écarter les fiches, donc rend un run non `ok` :
 * la collecte s'en charge seule. Ceux-ci sont facultatifs, si bien que leur
 * disparition ne casserait rien et ne se lirait que des mois plus tard, sur une
 * dérive des rattachements que personne ne rapporterait à Notion.
 */
const ATTENDUS: readonly { quoi: string; present: (membre: UtilisateurScim) => boolean }[] = [
  {
    quoi: "une adresse exploitable",
    // Sans elle, plus aucun compte neuf ne se rattache : les anciens restent liés et
    // la file des comptes isolés grossit sans que rien ne dise pourquoi.
    present: (membre) => adressesDe(membre).some((adresse) => adresse.includes("@")),
  },
  {
    quoi: `le rôle d'espace sous ${EXTENSION}`,
    // Une extension renommée est indistinguable d'une extension absente : tout le
    // monde deviendrait « membre » sur une collecte parfaitement verte.
    present: (membre) => membre[EXTENSION]?.role != null,
  },
];

/**
 * Notion ne publie pour SCIM ni schéma, ni journal des changements, ni exemple de
 * réponse : sa seule documentation est une page d'aide. Ce connecteur porte donc un
 * diagnostic, là où un connecteur lisant une API spécifiée pourrait s'en passer et
 * laisser la collecte échouer d'elle-même.
 *
 * Une page suffit : ce qu'on cherche est une disparition de champ, qui frappe tout le
 * monde à la fois, pas une anomalie sur une fiche.
 */
export async function diagnostiquer(lire: LecteurScim): Promise<Diagnosis> {
  const ecart = (texte: string): Diagnosis => ({
    findings: [{ scope: "diagnostic", message: texte }],
  });

  // Une seule page, et non tout l'inventaire : ce qu'on cherche est une disparition
  // de champ, qui frappe tout le monde a la fois. Paginer deux fois le workspace pour
  // la trouver doublerait le cout de chaque collecte sans rien apprendre de plus.
  let brut: unknown;
  try {
    brut = await lire(1, PAR_PAGE);
  } catch (cause: unknown) {
    return ecart(
      `le workspace n'a pas répondu, sa forme ne peut pas être constatée (${message(cause)})`,
    );
  }

  const enveloppe = enveloppeSchema.safeParse(brut);
  if (!enveloppe.success) {
    return ecart("l'enveloppe de la réponse n'a plus la forme attendue");
  }

  const membres = lireChaque(enveloppe.data.Resources ?? [], utilisateurSchema, "membre").items;
  if (membres.length === 0) {
    return ecart("aucun membre lisible, la forme a changé ou le workspace est vide");
  }

  // Qu'aucun membre ne porte le champ, et non qu'un seul lui manque : c'est ce qui
  // distingue une disparition de champ d'un compte incomplet, lequel est déjà le
  // travail de la collecte.
  return {
    findings: ATTENDUS.filter((attendu) => !membres.some(attendu.present)).map((attendu) => ({
      scope: "diagnostic",
      message: `${attendu.quoi} : aucun des ${membres.length} membres lus ne le porte, la forme de la réponse a changé`,
    })),
  };
}

export const CONTRAT_NOTION: ConnectorContract = {
  key: "notion",
  label: "Notion",
  criticality: "high",
  runbook: RUNBOOK,
  credentials: [
    {
      id: CREDENTIAL,
      source: "env",
      scopeNote:
        "Jeton SCIM du workspace, sans aucun système de portée : il permet de retirer un membre et de le déconnecter de toutes ses sessions, alors que cet outil ne s'en sert qu'en lecture. Sa rotation doit précéder toute mise en service d'un chemin d'écriture.",
      // Notion le révoque au départ de la personne qui l'a créé, mais aussi à son
      // simple changement de rôle, et tout propriétaire de workspace peut le retirer.
      nominative: true,
    },
  ],
  capabilities: {
    list: [{ requires: [CREDENTIAL], tier: "auto" }],
    // SCIM sait retirer un membre, mais rien dans cet outil n'appelle `execute` :
    // afficher un tier automatique que personne n'exécute serait un tier théorique.
    revoke: [{ requires: [], tier: "manual", runbook: RUNBOOK }],
  },
  // Un membre l'est du workspace entier : un octroi Notion n'a pas de portée à décrire.
  scopeSchema: z.object({}),
};

export const notion: Connector = {
  contract: CONTRAT_NOTION,

  probe: () =>
    Promise.resolve([
      {
        id: CREDENTIAL,
        available: Boolean(env.NOTION_SCIM_TOKEN),
        ...(env.NOTION_SCIM_TOKEN
          ? {}
          : { unavailableReason: "NOTION_SCIM_TOKEN absent de l'environnement" }),
        checkedAt: new Date(),
      },
    ]),

  diagnose: (): Promise<Diagnosis> => diagnostiquer(lireTout),

  list: (): Promise<CollectResult> => collecter(lireTout),

  plan: (intent) => {
    if (intent.kind !== "revoke" || intent.subject.kind !== "person") {
      return Promise.resolve([]);
    }

    const username = intent.subject.username;

    return Promise.resolve([
      {
        systemKey: "notion",
        capability: "revoke" as const,
        tier: "manual" as const,
        action: "retirer-du-workspace",
        label: `Retirer ${username} du workspace Notion`,
        params: { username },
        riskLevel: "high" as const,
        expectedState: { membre: false },
        idempotencyKey: `notion:revoke:${username}`,
        manual: {
          title: `Retirer ${username} du workspace Notion`,
          runbook: RUNBOOK,
          deeplink: MEMBRES,
          doneWhen: `Aucun compte au nom de ${username} n'apparaît plus dans la liste des membres du workspace. Le compte peut y porter une adresse personnelle plutôt que son adresse beta.gouv : chercher aussi sur le nom affiché.`,
        },
      },
    ]);
  },
};
