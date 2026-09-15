import { z } from "zod";

import type {
  CollectError,
  CollectResult,
  Connector,
  ConnectorContract,
  NonEmptyArray,
  ObservedGrant,
  ObservedIdentity,
  ObservedResource,
  PlannedStep,
  SubjectRef,
} from "@/core/connector";
import { lireChaque } from "@/core/lecture";
import { env } from "@/lib/env";

/**
 * Le jeton ne s'emploie pas tel quel : il s'échange contre un porteur valable une
 * heure, sur l'hôte global, quand tout le reste vit sur l'hôte régional.
 */
const HOTE_AUTH = "https://auth.scalingo.com";

const CREDENTIAL = "scalingo:api";

/** La vue consolidée du tableau de bord, seule page qui montre une personne sur tout le parc. */
const CONSOLIDEE = "https://dashboard.scalingo.com/collaborators";

const pageDesCollaborateurs = (region: string, application: string) =>
  `https://dashboard.scalingo.com/apps/${region}/${application}/settings/collaborators`;

const RUNBOOK =
  "Retirer la personne des collaborateurs de chaque application où elle figure, depuis la vue consolidée du tableau de bord Scalingo. Deux limites : le propriétaire d'une application ne s'y retire pas, il faut d'abord lui transférer la propriété ; et le retrait ne change ni les variables d'environnement ni les identifiants de base, si bien que la personne peut continuer à joindre directement les services dont elle connaît les identifiants.";

const RUNBOOK_OCTROI =
  "Inviter la personne dans Paramètres > Collaborateurs de l'application visée, sur son adresse professionnelle, puis poser son rôle. Scalingo invite en rôle limité par défaut : le corriger tout de suite si un accès plein est voulu. Une invitation non acceptée figure déjà dans la liste, et c'est un accès accordé, pas un accès en suspens.";

/**
 * Une lecture qui tombe ne devient pas manuelle, elle cesse : ce runbook ne dit donc pas
 * comment relever des comptes à la main, mais quoi vérifier pour que la collecte reparte.
 * Sans lui, l'écran des systèmes affiche sous « Lire » la marche à suivre du retrait, qui
 * ne répond pas à la question que se pose qui vient d'y lire « Jamais lu ».
 */
const RUNBOOK_LECTURE =
  "Échanger le jeton d'API contre un porteur pour vérifier qu'il répond encore, puis vérifier que le compte qui le porte voit toujours les applications attendues : retiré des collaborateurs d'une application, il cesse de la lire sans que rien d'autre ne change. La collecte se relance par « pnpm sync ».";

const RUNBOOK_ROTATION =
  "Faire tourner ce que le retrait ne touche pas : les variables d'environnement des applications concernées, et les mots de passe des bases dont la personne a pu relever les identifiants. Le mot de passe de l'utilisateur par défaut d'une base se change par le support Scalingo, puis la variable et un redémarrage.";

/**
 * `fetch` n'a aucun délai par défaut. Une réponse qui ne vient jamais gèlerait la
 * collecte entière, qui tourne la nuit sans personne pour la relancer, et cette
 * lecture enchaîne une requête par application : une seule suffirait à tout bloquer.
 */
const DELAI_MS = 15_000;

/**
 * Soixante requêtes par minute, et une collecte en dépense une par application. Sans
 * cet espacement, un parc de cinquante applications frôle le plafond, et un 429
 * rendrait le run partiel, donc n'effacerait plus rien : la collecte se mettrait à
 * conserver indéfiniment des accès disparus.
 */
const ESPACEMENT_MS = 1_100;

/**
 * Les régions se demandent plutôt qu'elles ne se déclarent. Chacune a son propre hôte et
 * `GET /v1/apps` ne rend que les applications du sien : une région oubliée serait un
 * tiers du parc invisible sans qu'aucune erreur ne le dise, et une région ajoutée un
 * jour par Scalingo entrerait ici sans que personne n'y pense.
 */
const regionSchema = z.object({ name: z.string().min(1), api: z.url() });

const enveloppeRegions = z.object({ regions: z.array(z.unknown()).optional() });

const proprietaireSchema = z.object({
  id: z.string().min(1),
  email: z.string().min(1),
  username: z.string().min(1).nullish(),
});

/**
 * Calé sur ce que l'API rend, jamais sur ce que la doc promet. Sont requis les seuls
 * champs sans lesquels une application n'existe pas : un champ exigé à tort ferait
 * écarter la fiche, donc daterait comme disparus les accès qu'elle porte.
 *
 * `parent_app_name` décide de l'appartenance au périmètre, mais reste facultatif : son
 * absence est le cas ordinaire d'une application ordinaire.
 */
const applicationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  owner: proprietaireSchema,
  parent_app_name: z.string().nullish(),
});

/**
 * `status` est une chaîne libre et non une énumération. Scalingo en documente deux
 * valeurs, ses propres clients en portent une troisième, et un statut inconnu ferait
 * écarter la fiche entière, donc daterait comme disparu quelqu'un dont le seul tort
 * serait un état neuf.
 */
const collaborateurSchema = z.object({
  id: z.string().min(1),
  email: z.string().min(1),
  status: z.string().min(1),
  is_limited: z.boolean().nullish(),
  app_id: z.string().min(1),
  user_id: z.string().nullish(),
});

type Application = z.infer<typeof applicationSchema>;
type Collaborateur = z.infer<typeof collaborateurSchema>;

/**
 * Une application ne se désigne pas sans sa région : son adresse de tableau de bord la
 * porte, et deux régions peuvent servir le même nom. Elle vient de l'hôte interrogé et
 * non du champ `region` de la réponse, qui est facultatif et dont l'absence ferait
 * écarter la fiche pour un renseignement qu'on détient déjà.
 */
interface ApplicationSituee {
  application: Application;
  region: string;
}

/**
 * `meta` est lu alors qu'aucune de ces listes n'en porte aujourd'hui, et c'est tout
 * l'intérêt : rien chez Scalingo n'écrit que ces routes ne paginent pas, si bien qu'une
 * pagination ajoutée un jour tronquerait l'inventaire en silence. La voir apparaître
 * suffit à rendre le run partiel, donc à ne plus rien effacer.
 */
const paginationSchema = z.object({ next_page: z.unknown().nullish() }).nullish();

const enveloppeApplications = z.object({
  apps: z.array(z.unknown()).optional(),
  meta: z.object({ pagination: paginationSchema }).nullish(),
});

const enveloppeCollaborateurs = z.object({
  collaborators: z.array(z.unknown()).optional(),
  meta: z.object({ pagination: paginationSchema }).nullish(),
});

const STATUT_EN_ATTENTE = "pending";

/**
 * Les rôles sont ceux du fournisseur et non les nôtres : `owner` ne figure dans aucune
 * liste de collaborateurs, il se déduit de l'application elle-même, et les deux autres
 * sont les deux faces du seul booléen que l'API expose.
 */
const ROLE_PROPRIETAIRE = "owner";
const ROLE_PLEIN = "collaborator";
const ROLE_LIMITE = "limited";

/**
 * La lecture distante, séparée de l'assemblage : ce qui appelle le réseau d'un côté, ce
 * qui décide de l'autre, faute de quoi le connecteur ne se teste pas sans jeton. Le
 * porteur d'une heure est un détail du transport, il ne remonte pas jusqu'ici.
 */
export type LecteurScalingo = (url: string) => Promise<unknown>;

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export type Pause = (ms: number) => Promise<void>;

const attendre: Pause = (ms) => new Promise((resoudre) => setTimeout(resoudre, ms));

export interface LectureDuParc {
  applications: ApplicationSituee[];
  /** Les collaborations relevées application par application, indexées par application. */
  parApplication: Map<string, Collaborateur[]>;
  erreurs: CollectError[];
  /** Vrai quand la liste des applications n'a pas pu être lue, donc qu'il n'y a rien à écrire. */
  fatale: boolean;
}

function verifierPagination(
  pagination: { next_page?: unknown } | null | undefined,
  scope: string,
  itemRef: string | undefined,
): CollectError | undefined {
  if (pagination?.next_page == null) {
    return undefined;
  }
  return {
    scope,
    ...(itemRef === undefined ? {} : { itemRef }),
    message:
      "la réponse annonce une page suivante, alors que cette route n'en rendait aucune : l'inventaire lu est tronqué",
  };
}

/**
 * Le relevé application par application est le seul chemin complet. La vue consolidée
 * ne rend rien des applications que le compte ne possède pas, et il y en a : la lire
 * seule laisserait dehors des accès bien réels, sans qu'aucun compte ne cloche.
 *
 * Les applications filles sont écartées ici et non plus bas : ce sont des
 * environnements de revue qui se détruisent d'eux-mêmes en deux jours, une révocation
 * dessus n'a pas de sens, et les garder noierait la file des constats sous une majorité
 * d'accès éphémères. Personne ne s'y perd, un collaborateur d'environnement de revue
 * l'étant d'abord de l'application dont il sort.
 */
export async function lireApplications(
  lire: LecteurScalingo,
  region: string,
  api: string,
): Promise<{
  applications: ApplicationSituee[];
  /** Toutes celles que l'API a rendues, filles comprises : le recoupement en a besoin. */
  connues: Set<string>;
  erreurs: CollectError[];
  fatale: boolean;
}> {
  let brut: unknown;
  try {
    brut = await lire(`${api}/v1/apps`);
  } catch (cause: unknown) {
    return {
      applications: [],
      connues: new Set(),
      erreurs: [{ scope: "applications", itemRef: region, message: message(cause) }],
      fatale: true,
    };
  }

  const enveloppe = enveloppeApplications.safeParse(brut);
  if (!enveloppe.success) {
    return {
      applications: [],
      connues: new Set(),
      erreurs: [{ scope: "applications", itemRef: region, message: "enveloppe illisible" }],
      fatale: true,
    };
  }

  const erreurs: CollectError[] = [];
  const tronquee = verifierPagination(enveloppe.data.meta?.pagination, "applications", region);
  if (tronquee) {
    erreurs.push(tronquee);
  }

  const lues = lireChaque(enveloppe.data.apps ?? [], applicationSchema, "application");
  for (const texte of lues.erreurs) {
    erreurs.push({ scope: "applications", itemRef: region, message: texte });
  }

  const retenues = lues.items
    .filter((application) => !application.parent_app_name)
    .map((application) => ({ application, region }));

  if (lues.items.length === 0) {
    erreurs.push({
      scope: "applications",
      itemRef: region,
      message:
        "aucune application lisible : une région vide ne se distingue pas d'une panne silencieuse",
    });
  }

  return {
    applications: retenues,
    connues: new Set(lues.items.map((application) => application.id)),
    erreurs,
    fatale: false,
  };
}

export async function lireCollaborateurs(
  lire: LecteurScalingo,
  chemin: string,
  scope: string,
  itemRef?: string,
): Promise<{ items: Collaborateur[]; erreurs: CollectError[]; lue: boolean }> {
  let brut: unknown;
  try {
    brut = await lire(chemin);
  } catch (cause: unknown) {
    return {
      items: [],
      erreurs: [{ scope, ...(itemRef === undefined ? {} : { itemRef }), message: message(cause) }],
      lue: false,
    };
  }

  const enveloppe = enveloppeCollaborateurs.safeParse(brut);
  if (!enveloppe.success) {
    return {
      items: [],
      erreurs: [
        {
          scope,
          ...(itemRef === undefined ? {} : { itemRef }),
          message: "enveloppe illisible",
        },
      ],
      lue: false,
    };
  }

  const erreurs: CollectError[] = [];
  const tronquee = verifierPagination(enveloppe.data.meta?.pagination, scope, itemRef);
  if (tronquee) {
    erreurs.push(tronquee);
  }

  // Une clé absente et une liste vide ne veulent pas dire la même chose, et les
  // confondre est le pire mode de panne de ce connecteur : une application sans
  // personne rend bien `collaborators: []`, mais une clé renommée rendrait une liste
  // vide sans erreur, sauterait le garde-fou du rôle faute de collaboration relevée, ne
  // ferait diverger aucun recoupement puisque les deux lectures seraient vides, et
  // laisserait le run se dire `ok` avec zéro accès. Le parc entier se daterait alors
  // comme disparu sur une collecte parfaitement verte.
  if (enveloppe.data.collaborators === undefined) {
    erreurs.push({
      scope,
      ...(itemRef === undefined ? {} : { itemRef }),
      message:
        "la réponse ne porte aucune liste de collaborateurs : la clé a changé de nom, et son absence ne se distingue pas d'un accès que personne ne détient",
    });
  }

  const lues = lireChaque(enveloppe.data.collaborators ?? [], collaborateurSchema, "collaborateur");
  for (const texte of lues.erreurs) {
    erreurs.push({ scope, ...(itemRef === undefined ? {} : { itemRef }), message: texte });
  }

  return { items: lues.items, erreurs, lue: true };
}

/**
 * La vue consolidée n'est pas une seconde source, c'est un témoin. Aucune des routes
 * qui nous intéressent ne déclare de pagination ni n'annonce de total, si bien que rien
 * ne distingue une liste complète d'une liste tronquée : deux chemins qui doivent
 * tomber d'accord sont le seul compteur qu'on puisse se fabriquer.
 *
 * Ce contrôle prouve la cohérence et non l'exhaustivité, deux troncatures identiques
 * coïncideraient. Il tait ce qu'il sait déjà : une application écartée parce qu'elle est
 * fille reste citée par la vue consolidée, et ce n'est pas un écart.
 */
export function recouper(
  parApplication: ReadonlyMap<string, readonly Collaborateur[]>,
  vueGlobale: readonly Collaborateur[],
  connues: ReadonlySet<string>,
): CollectError[] {
  const erreurs: CollectError[] = [];

  const globaleParApplication = new Map<string, Set<string>>();
  for (const collaboration of vueGlobale) {
    const vues = globaleParApplication.get(collaboration.app_id) ?? new Set<string>();
    vues.add(collaboration.id);
    globaleParApplication.set(collaboration.app_id, vues);
  }

  for (const [application, vues] of globaleParApplication) {
    if (!connues.has(application)) {
      erreurs.push({
        scope: "recoupement",
        itemRef: application,
        message: `la vue consolidée porte ${vues.size} collaboration(s) sur une application que la liste des applications ne rend pas`,
      });
      continue;
    }

    const releve = parApplication.get(application);
    if (releve === undefined) {
      continue;
    }

    const parApp = new Set(releve.map((collaboration) => collaboration.id));
    const manquantes = [...vues].filter((id) => !parApp.has(id)).length;
    const surnumeraires = [...parApp].filter((id) => !vues.has(id)).length;

    if (manquantes > 0 || surnumeraires > 0) {
      erreurs.push({
        scope: "recoupement",
        itemRef: application,
        message: `les deux lectures divergent : ${manquantes} collaboration(s) vue(s) seulement par la vue consolidée, ${surnumeraires} seulement par le relevé`,
      });
    }
  }

  return erreurs;
}

/**
 * Les régions se lisent avant tout le reste, et leur échec est fatal : ne pas savoir où
 * chercher n'autorise pas à conclure que le parc est ailleurs vide.
 */
export async function lireRegions(
  lire: LecteurScalingo,
): Promise<{ regions: { name: string; api: string }[]; erreurs: CollectError[] }> {
  let brut: unknown;
  try {
    brut = await lire(`${HOTE_AUTH}/v1/regions`);
  } catch (cause: unknown) {
    return { regions: [], erreurs: [{ scope: "regions", message: message(cause) }] };
  }

  const enveloppe = enveloppeRegions.safeParse(brut);
  if (!enveloppe.success) {
    return { regions: [], erreurs: [{ scope: "regions", message: "enveloppe illisible" }] };
  }

  const lues = lireChaque(enveloppe.data.regions ?? [], regionSchema, "région");

  return {
    regions: lues.items,
    erreurs: lues.erreurs.map((texte) => ({ scope: "regions", message: texte })),
  };
}

export async function lireParc(
  lire: LecteurScalingo,
  pause: Pause = attendre,
): Promise<LectureDuParc> {
  const vide = new Map<string, Collaborateur[]>();
  const regions = await lireRegions(lire);

  if (regions.regions.length === 0) {
    const [premiere, ...reste] = regions.erreurs;
    return {
      applications: [],
      parApplication: vide,
      erreurs: premiere
        ? [premiere, ...reste]
        : [{ scope: "regions", message: "aucune région rendue, sans erreur rapportée" }],
      fatale: true,
    };
  }

  const applications: ApplicationSituee[] = [];
  const parApplication = new Map<string, Collaborateur[]>();
  const erreurs = [...regions.erreurs];
  let lisibles = 0;

  for (const region of regions.regions) {
    const parc = await lireApplications(lire, region.name, region.api);
    erreurs.push(...parc.erreurs);

    // Une région qui tombe n'annule pas les autres : perdre tout le parc parce qu'une
    // seule région ne répond pas effacerait de la vue des accès parfaitement lisibles.
    // Le run reste non `ok`, donc rien ne se date comme disparu.
    if (parc.fatale) {
      continue;
    }
    lisibles += 1;

    for (const situee of parc.applications) {
      await pause(ESPACEMENT_MS);
      const releve = await lireCollaborateurs(
        lire,
        `${region.api}/v1/apps/${situee.application.name}/collaborators`,
        "collaborateurs",
        situee.application.id,
      );
      erreurs.push(...releve.erreurs);
      if (releve.lue) {
        parApplication.set(situee.application.id, releve.items);
      }
    }
    applications.push(...parc.applications);

    await pause(ESPACEMENT_MS);
    const globale = await lireCollaborateurs(lire, `${region.api}/v1/collaborators`, "recoupement");
    erreurs.push(...globale.erreurs);

    // Le témoin n'est utilisable que s'il a été lu : recouper contre une lecture ratée
    // ferait passer une panne de réseau pour une divergence, donc désignerait le relevé
    // comme fautif alors qu'il est le seul à avoir répondu.
    if (globale.lue) {
      erreurs.push(...recouper(parApplication, globale.items, parc.connues));
    }
  }

  const relevees = [...parApplication.values()].flat();

  // Trois champs facultatifs, et la même règle pour les trois : ce qui est requis par un
  // schéma se défend tout seul, puisque son absence fait écarter la fiche et rend le run
  // non `ok`. Ceux-ci ne cassent rien en disparaissant, et c'est exactement ce qui les
  // rend dangereux : chacun ferait mentir la collecte sur un run parfaitement vert.
  //
  // Qu'aucune entrée ne porte le champ, et non qu'une seule en manque : c'est ce qui
  // distingue une disparition de champ d'une ligne incomplète, laquelle est déjà le
  // travail de la collecte. Des erreurs unitaires et non un refus de lire : perdre un
  // attribut ne justifie pas de figer tout ce que le système sait encore dire.
  for (const surveille of [
    {
      assez: relevees.length > 0,
      absent: relevees.every((collaboration) => collaboration.is_limited === undefined),
      quoi: `le rôle : aucune des ${relevees.length} collaborations lues ne porte is_limited, et tous les accès limités passeraient pour des accès pleins`,
    },
    {
      assez: relevees.length > 0,
      absent: relevees.every((collaboration) => collaboration.user_id === undefined),
      quoi: `le compte : aucune des ${relevees.length} collaborations lues ne porte user_id, et chaque identité retomberait sur son identifiant de collaboration, donc tout le monde disparaîtrait d'un coup pour réapparaître sous une autre clé`,
    },
    {
      assez: applications.length > 0,
      absent: applications.every(({ application }) => application.parent_app_name === undefined),
      quoi: `l'ascendance : aucune des ${applications.length} applications retenues ne porte parent_app_name, et les environnements de revue entreraient dans le périmètre`,
    },
  ]) {
    if (surveille.assez && surveille.absent) {
      erreurs.push({
        scope: "collaborateurs",
        message: `${surveille.quoi}, la forme de la réponse a changé`,
      });
    }
  }

  return { applications, parApplication, erreurs, fatale: lisibles === 0 };
}

/**
 * Le propriétaire ne figure dans aucune liste de collaborateurs, il se lit sur
 * l'application. L'omettre ferait sortir du périmètre la personne qui a le plus de
 * droits, et une application sans aucun collaborateur passerait pour une application
 * sans aucun accès.
 */
export function assembler(
  applications: readonly ApplicationSituee[],
  parApplication: ReadonlyMap<string, readonly Collaborateur[]>,
): {
  identites: ObservedIdentity[];
  ressources: ObservedResource[];
  acces: ObservedGrant[];
} {
  const identites = new Map<string, ObservedIdentity>();
  const ressources: ObservedResource[] = [];
  const acces: ObservedGrant[] = [];

  const retenir = (identite: ObservedIdentity) => {
    if (!identites.has(identite.externalId)) {
      identites.set(identite.externalId, identite);
    }
  };

  for (const { application, region } of applications) {
    ressources.push({
      externalId: application.id,
      // La région entre dans le libellé : deux régions peuvent servir le même nom, et un
      // écran qui les confondrait enverrait couper un accès sur la mauvaise.
      label: `${application.name} (${region})`,
      url: pageDesCollaborateurs(region, application.name),
    });

    retenir({
      externalId: application.owner.id,
      idKind: "opaque",
      handle: application.owner.email,
      emails: [application.owner.email],
    });

    acces.push({
      identityExternalId: application.owner.id,
      resourceExternalId: application.id,
      role: ROLE_PROPRIETAIRE,
    });

    for (const collaboration of parApplication.get(application.id) ?? []) {
      const enAttente = collaboration.status === STATUT_EN_ATTENTE;

      // L'identifiant du compte quand il existe, celui de la collaboration sinon : une
      // invitation en attente n'a pas encore de compte derrière elle. Les deux formes
      // sont disjointes chez Scalingo, et fabriquer une clé à nous rendrait illisible
      // toute tolérance posée dessus.
      const externalId = collaboration.user_id ?? collaboration.id;

      retenir({
        externalId,
        idKind: "opaque",
        // Jamais le nom d'utilisateur : il vaut la chaîne littérale « n/a » tant que
        // l'invitation dort, et la prendre pour un identifiant empoisonnerait le
        // rapprochement de toutes les invitations à la fois.
        handle: collaboration.email,
        emails: [collaboration.email],
        ...(enAttente
          ? { details: [{ label: "État de l'accès", value: "invitation en attente" }] }
          : {}),
      });

      acces.push({
        identityExternalId: externalId,
        resourceExternalId: application.id,
        role: collaboration.is_limited === true ? ROLE_LIMITE : ROLE_PLEIN,
      });
    }
  }

  return { identites: [...identites.values()], ressources, acces };
}

export async function collecter(
  lire: LecteurScalingo,
  pause: Pause = attendre,
): Promise<CollectResult> {
  const parc = await lireParc(lire, pause);

  if (parc.fatale) {
    const [premiere, ...reste] = parc.erreurs;
    const erreurs: NonEmptyArray<CollectError> = premiere
      ? [premiere, ...reste]
      : [{ scope: "applications", message: "aucune application lue, sans erreur rapportée" }];

    return { status: "failed", errors: erreurs };
  }

  const { identites, ressources, acces } = assembler(parc.applications, parc.parApplication);

  const payload = {
    itemsSeen: identites.length,
    identities: identites,
    resources: ressources,
    grants: acces,
  };

  const [premiere, ...reste] = parc.erreurs;

  return premiere
    ? { status: "partial", errors: [premiere, ...reste], ...payload }
    : { status: "ok", ...payload };
}

/**
 * Strict, et sans clé facultative : dans un profil écrit à la main, une clé inconnue est
 * une faute de frappe, et une faute de frappe ignorée en silence donne un octroi qui ne
 * fait pas ce que son auteur croit avoir écrit.
 *
 * Le rôle n'a que deux valeurs parce que l'API n'en expose qu'un booléen. En inventer
 * une troisième décrirait un droit que Scalingo ne sait pas poser, et la propriété d'une
 * application ne s'accorde pas, elle se transfère.
 */
const SCOPE = z.strictObject({
  region: z
    .string()
    .min(1)
    .meta({
      description:
        "Région Scalingo de l'application. Deux régions peuvent servir le même nom, et l'adresse du tableau de bord la porte.",
      examples: ["osc-fr1"],
    }),
  application: z
    .string()
    .min(1)
    .meta({
      description:
        "Nom de l'application Scalingo visée par l'octroi, tel qu'il figure dans son adresse de tableau de bord.",
      examples: ["mon-application"],
    }),
  role: z.enum([ROLE_PLEIN, ROLE_LIMITE]).meta({
    description:
      "« collaborator » ouvre les variables d'environnement et les bases, « limited » ne donne que les journaux, les métriques et le redéploiement.",
    examples: [ROLE_LIMITE],
  }),
});

export type ScopeScalingo = z.infer<typeof SCOPE>;

/**
 * Un collaborateur plein lit les variables d'environnement, donc les secrets de
 * l'application et les identifiants de ses bases. Un collaborateur limité ne les voit
 * pas. C'est la seule différence qui compte ici, et elle vaut un cran de risque.
 */
function risqueDuRole(role: ScopeScalingo["role"]): "medium" | "high" {
  return role === ROLE_PLEIN ? "high" : "medium";
}

export function planifierOctroiScalingo(
  scope: ScopeScalingo,
  sujet: SubjectRef,
): readonly PlannedStep[] {
  const qui = sujet.kind === "person" ? sujet.username : sujet.key;

  return [
    {
      systemKey: "scalingo",
      capability: "grant",
      tier: "manual",
      action: "inviter-comme-collaborateur",
      label: `Inviter ${qui} dans ${scope.application} comme ${scope.role}`,
      params: {
        region: scope.region,
        application: scope.application,
        beneficiaire: qui,
        role: scope.role,
      },
      riskLevel: risqueDuRole(scope.role),
      expectedState: { collaborateur: true, role: scope.role },
      idempotencyKey: `scalingo:${scope.region}:${scope.application}:grant:${qui}:${scope.role}`,
      manual: {
        title: `Inviter ${qui} dans ${scope.application}`,
        runbook: RUNBOOK_OCTROI,
        deeplink: pageDesCollaborateurs(scope.region, scope.application),
        doneWhen: `${qui} figure dans les collaborateurs de ${scope.application} avec le rôle ${scope.role}, invitation non acceptée comprise : Scalingo l'y affiche dès l'envoi, et l'accès est accordé à ce moment-là.`,
      },
    },
  ];
}

/**
 * Deux étapes et non une, sous le même système. Scalingo écrit que retirer un
 * collaborateur ne change ni les variables d'environnement ni les identifiants de base,
 * si bien que la personne peut continuer à joindre les services dont elle connaît les
 * identifiants : une seule étape cochée « fait » affirmerait une coupure qui n'a pas eu
 * lieu.
 *
 * Un seul retrait pour tout le parc, et non un par application : le socle ne dit pas à
 * un connecteur sur quelles ressources la personne détient un accès, et la vue
 * consolidée du tableau de bord existe précisément pour traiter les deux d'un coup.
 */
export function planifierDepartScalingo(username: string): readonly PlannedStep[] {
  return [
    {
      systemKey: "scalingo",
      capability: "revoke" as const,
      tier: "manual" as const,
      action: "retirer-des-collaborateurs",
      label: `Retirer ${username} des applications Scalingo`,
      params: { username },
      riskLevel: "high" as const,
      expectedState: { collaborateur: false },
      idempotencyKey: `scalingo:revoke:${username}`,
      manual: {
        title: `Retirer ${username} des applications Scalingo`,
        runbook: RUNBOOK,
        deeplink: CONSOLIDEE,
        doneWhen: `${username} n'apparaît plus dans la vue consolidée des collaborateurs, invitations en attente comprises. Si une application lui appartient, sa propriété a été transférée : ce chemin-là ne passe pas par la liste des collaborateurs, où un propriétaire ne figure jamais.`,
      },
    },
    {
      systemKey: "scalingo",
      capability: "revoke" as const,
      tier: "manual" as const,
      action: "renouveler-les-secrets",
      label: `Renouveler les secrets des applications où ${username} intervenait`,
      params: { username },
      riskLevel: "high" as const,
      expectedState: { secretsRenouveles: true },
      idempotencyKey: `scalingo:rotation:${username}`,
      manual: {
        title: `Renouveler les secrets après le départ de ${username}`,
        runbook: RUNBOOK_ROTATION,
        deeplink: CONSOLIDEE,
        doneWhen: `Les variables d'environnement des applications où ${username} était collaborateur ont été renouvelées, et les mots de passe des bases dont elle ou il a pu relever les identifiants ont été changés.`,
      },
    },
  ];
}

export const CONTRAT_SCALINGO: ConnectorContract = {
  key: "scalingo",
  label: "Scalingo",
  criticality: "high",
  runbook: RUNBOOK,
  credentials: [
    {
      id: CREDENTIAL,
      source: "env",
      scopeNote:
        "Jeton d'API du compte de service propriétaire de la plupart des applications. Sa portée est le compte entier : un jeton Scalingo hérite de tous les droits du compte qui l'a créé, sur chaque application et chaque base, et le fournisseur ne sait pas le restreindre. Il sait donc supprimer une application de production, alors que cet outil ne s'en sert qu'en lecture. Séparer un jeton de lecture d'un jeton d'écriture ne cloisonnerait rien, les deux héritant du même compte : d'où un seul ici, contrairement à GitHub.",
      // Porté par un compte de service et non par une personne : il ne meurt pas avec
      // un départ, ce qui est la seule chose que ce champ dit.
      nominative: false,
    },
  ],
  capabilities: {
    list: [{ requires: [CREDENTIAL], tier: "auto", runbook: RUNBOOK_LECTURE }],
    // Manuel, alors que l'API sait inviter et retirer : le premier lot couvre le
    // système sans jamais écrire dessus. Les voies automatiques viennent ensuite, et
    // celle du retrait attend d'abord que le socle sache dire à un connecteur sur
    // quelles ressources agir.
    grant: [{ requires: [], tier: "manual", runbook: RUNBOOK_OCTROI }],
    revoke: [{ requires: [], tier: "manual", runbook: RUNBOOK }],
  },
  scopeSchema: SCOPE,
};

/**
 * Le porteur vit une heure, et la réponse d'échange ne dit pas laquelle : sa péremption
 * ne se déduit que d'une horloge locale ou d'un 401. Une marge large plutôt qu'un
 * rattrapage au plus juste, un échange de plus coûtant une requête là où un porteur
 * périmé en pleine collecte rendrait le run partiel, donc n'effacerait plus rien.
 */
const VIE_DU_PORTEUR_MS = 45 * 60 * 1_000;

let porteur: { valeur: string; expireA: number } | undefined;

const porteurSchema = z.object({ token: z.string().min(1) });

async function echanger(jeton: string): Promise<string> {
  const reponse = await fetch(`${HOTE_AUTH}/v1/tokens/exchange`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`:${jeton}`).toString("base64")}`,
      accept: "application/json",
    },
    signal: AbortSignal.timeout(DELAI_MS),
  });

  if (!reponse.ok) {
    throw new Error(`échange du jeton refusé (${reponse.status} ${reponse.statusText})`);
  }

  const lu = porteurSchema.safeParse(await reponse.json().catch(() => undefined));
  if (!lu.success) {
    throw new Error("échange du jeton : la réponse ne porte aucun porteur");
  }

  return lu.data.token;
}

async function porteurValide(): Promise<string> {
  const jeton = env.SCALINGO_API_TOKEN;
  if (!jeton) {
    throw new Error("aucun jeton Scalingo configuré");
  }

  const maintenant = Date.now();
  if (porteur !== undefined && porteur.expireA > maintenant) {
    return porteur.valeur;
  }

  const valeur = await echanger(jeton);
  porteur = { valeur, expireA: maintenant + VIE_DU_PORTEUR_MS };

  return valeur;
}

const lireTout: LecteurScalingo = async (url) => {
  const reponse = await fetch(url, {
    headers: { authorization: `Bearer ${await porteurValide()}`, accept: "application/json" },
    signal: AbortSignal.timeout(DELAI_MS),
  });

  // Un porteur périmé et un droit manquant ne se distinguent qu'au code : le premier se
  // rattrape par un échange au passage suivant, le second demande une correction côté
  // Scalingo. Les confondre ferait réessayer indéfiniment un refus définitif.
  if (reponse.status === 401) {
    porteur = undefined;
    throw new Error("le porteur a expiré en cours de lecture");
  }

  if (!reponse.ok) {
    throw new Error(`${reponse.status} ${reponse.statusText}`);
  }

  return reponse.json();
};

export const scalingo: Connector = {
  contract: CONTRAT_SCALINGO,

  probe: () =>
    Promise.resolve([
      {
        id: CREDENTIAL,
        available: Boolean(env.SCALINGO_API_TOKEN),
        ...(env.SCALINGO_API_TOKEN
          ? {}
          : { unavailableReason: "SCALINGO_API_TOKEN absent de l'environnement" }),
        checkedAt: new Date(),
      },
    ]),

  list: (): Promise<CollectResult> => collecter(lireTout),

  plan: (intent) => {
    if (intent.subject.kind !== "person") {
      return Promise.resolve([]);
    }

    // Même règle que sur les autres systèmes : un octroi ne sort que sous un scope
    // validé, et le scope vient du profil. Sans lui, aucune étape, faute de quoi le même
    // octroi sortirait sous deux clés que le dédoublonnage ne rapprocherait pas.
    if (intent.kind === "grant") {
      const lu = SCOPE.safeParse(intent.scope);

      return Promise.resolve(lu.success ? planifierOctroiScalingo(lu.data, intent.subject) : []);
    }

    return Promise.resolve(planifierDepartScalingo(intent.subject.username));
  },

  planifierOctroi: (scope, sujet) => planifierOctroiScalingo(scope as ScopeScalingo, sujet),
};
