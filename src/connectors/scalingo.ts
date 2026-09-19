import { z } from "zod";
import { cleProposee, fragmentDAdresse } from "@/core/compte-de-service";
import type {
  CollectError,
  CollectResult,
  Connector,
  ConnectorContract,
  NonEmptyArray,
  ObservedGrant,
  ObservedIdentity,
  ObservedResource,
  OpenEngagement,
  PlannedStep,
  PrecheckResult,
  RunContext,
  StepOutcome,
  SubjectRef,
} from "@/core/connector";
import { lireChaque } from "@/core/lecture";
import type { ExamenDeScope } from "@/core/octroi";
import { env } from "@/lib/env";
import { type EmissionDeJeton, ErreurFgp, emettreUnJeton, type JetonEmis } from "@/lib/fgp";

/**
 * Le jeton ne s'emploie pas tel quel : il s'échange contre un porteur valable une
 * heure, sur l'hôte global, quand tout le reste vit sur l'hôte régional.
 */
const HOTE_AUTH = "https://auth.scalingo.com";

const CREDENTIAL = "scalingo:api";
const CREDENTIAL_FGP = "scalingo:fgp";

/** La vue consolidée du tableau de bord, seule page qui montre une personne sur tout le parc. */
const CONSOLIDEE = "https://dashboard.scalingo.com/collaborators";

const pageDesCollaborateurs = (region: string, application: string) =>
  `https://dashboard.scalingo.com/apps/${region}/${application}/settings/collaborators`;

const RUNBOOK =
  "Retirer la personne des collaborateurs de chaque application où elle figure, depuis la vue consolidée du tableau de bord Scalingo. Le propriétaire d'une application ne s'y retire pas, il faut d'abord lui transférer la propriété. Le retrait ne change ni les variables d'environnement ni les identifiants de base.";

const RUNBOOK_OCTROI =
  "Inviter la personne dans Paramètres > Collaborateurs de l'application visée, sur son adresse professionnelle, puis poser son rôle, Scalingo invitant en rôle limité par défaut. Une invitation non acceptée figure déjà dans la liste, et vaut accès accordé.";

/**
 * Une lecture qui tombe ne devient pas manuelle, elle cesse : ce runbook ne dit donc pas
 * comment relever des comptes à la main, mais quoi vérifier pour que la collecte reparte.
 * Sans lui, l'écran des systèmes affiche sous « Lire » la marche à suivre du retrait, qui
 * ne répond pas à la question que se pose qui vient d'y lire « Jamais lu ».
 */
/* Retiré des collaborateurs d'une application, le compte qui porte le jeton cesse de la lire sans
   que rien d'autre ne change : la seconde vérification ne double pas la première. */
const RUNBOOK_LECTURE =
  "Échanger le jeton d'API contre un porteur pour vérifier qu'il répond encore, puis vérifier que le compte qui le porte voit toujours les applications attendues. La collecte se relance par « pnpm sync ».";

/**
 * Il ne demande que ce que l'écran sait recevoir, et le terme en fait désormais partie.
 *
 * Il réclamait aussi de recopier le blob, la cible et les chemins dans une fiche qui
 * n'accepte aucun de ces trois champs : la fiche naissait donc sans terme, la branche du
 * terme passé ne pouvait jamais la concerner, et elle restait « revue en retard » pour
 * toujours, c'est-à-dire le signal qui ne s'éteint jamais. Le terme est ce qui rend la
 * reprise possible, faute de révocation, et c'est donc lui que la saisie a gagné. Les trois
 * autres sont ce que la voie automatique enregistre, et l'écran du lot suivant les portera
 * avec elle : demander de retaper un blob opaque dans un formulaire donne un registre faux,
 * pas un registre.
 */
const RUNBOOK_JETON =
  "Générer le blob depuis le proxy à jetons restreints, en y posant le jeton d'API Scalingo, la cible et les chemins que cette étape nomme, le mode d'authentification « scalingo-exchange », et le terme en secondes. La page rend un blob et une clé. Remettre les deux à la personne, chacun par un canal différent, les deux valant l'accès ensemble et rien séparément. Saisir ensuite la fiche du compte machine depuis l'écran « Comptes de service », sur le système « scalingo », en y posant le détenteur et le terme porté par cette étape, et jamais la clé. Le proxy ne garde rien, et ce terme est la seule reprise qui existe.";

const RUNBOOK_REPRISE_JETON =
  "Ne pas faire tourner le jeton d'API Scalingo. Il est à portée compte entier, il est ce que chaque blob transporte chiffré, et il est celui de la collecte. Le faire tourner ne reprend pas un jeton à une personne, il éteint d'un coup tous les blobs vivants du parc, toutes les écritures et la lecture nocturne, jusqu'à ce que la nouvelle valeur soit posée et l'application redémarrée. Ce n'est pas une étape de départ, c'est un incident, et cela se décide ailleurs que dans un dossier. Le proxy n'offre ni révocation ni introspection. Il n'y a rien à appeler, rien à lister, et rien à couper. Attendre le terme est le seul recours, et un départ survenu avant ce terme ne se solde pas avant lui. Demander à la personne de détruire sa copie du blob et de sa clé, et vérifier que la fiche du compte machine porte bien le terme annoncé.";

const RUNBOOK_ROTATION =
  "Faire tourner les variables d'environnement des applications concernées, et les mots de passe des bases dont la personne a pu relever les identifiants, qu'un retrait ne change pas. Le mot de passe de l'utilisateur par défaut d'une base se change par le support Scalingo, puis la variable et un redémarrage.";

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

const compteSchema = z.object({ user: z.object({ id: z.string().min(1) }) });

const proprietaireSchema = z.object({
  id: z.string().min(1),
  email: z.string().min(1),
  username: z.string().min(1).nullish(),
});

const projetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
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
  // `nullish` parce que la documentation le dit toujours présent sans dire s'il peut être
  // nul, et `catch` parce qu'un projet de forme neuve ferait sinon écarter l'application
  // entière, donc daterait comme disparus les accès qu'elle porte.
  //
  // Le repli vaut `undefined` et non `null`, et les deux ne disent pas la même chose :
  // `null` est une application sans projet, cas ordinaire d'un parc où la notion n'est pas
  // employée, quand `undefined` est une clé disparue ou devenue illisible. Se replier sur
  // `null` rendrait la surveillance aveugle au changement de forme ; surveiller `null`
  // rendrait tout run partiel sur un parc qui n'a simplement pas de projets, donc gèlerait
  // la datation pour un regroupement d'écran.
  project: projetSchema.nullish().catch(undefined),
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

/** Ce qu'une écriture rend, statut compris : c'est lui qui distingue un refus d'un doublon. */
export interface ReponseScalingo {
  statut: number;
  corps: unknown;
}

export type EcritureScalingo = (
  methode: "POST" | "PATCH" | "DELETE",
  url: string,
  corps?: unknown,
) => Promise<ReponseScalingo>;

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export type Pause = (ms: number) => Promise<void>;

/**
 * Une lecture qui a échoué pour une cause passagère est retentée une fois, et une seule.
 * Sont passagers un abandon, un délai dépassé, un plafond de requêtes atteint, une panne
 * du serveur, et le porteur périmé, que le second essai rééchange.
 *
 * La collecte enchaîne une requête par application : sur un parc de plusieurs dizaines,
 * un seul hoquet de réseau rend le run partiel, donc lui interdit de dater la moindre
 * disparition. Le garde-fou de chute est fait pour une source qui ment, pas pour une
 * réponse lente, et le laisser se déclencher là-dessus fige l'inventaire toutes les nuits
 * sans que rien ne soit cassé.
 *
 * Une seule reprise, et seulement sur ce qui peut passer au second essai : un refus de
 * droits ou une forme illisible se reproduiront à l'identique, et les retenter ne ferait
 * que doubler la dépense sous un plafond de soixante requêtes par minute.
 */
export function avecReprise(lire: LecteurScalingo, pause: Pause = attendre): LecteurScalingo {
  return async (url) => {
    try {
      return await lire(url);
    } catch (cause: unknown) {
      if (!passagere(cause)) {
        throw cause;
      }
      await pause(ESPACEMENT_MS);
      return lire(url);
    }
  };
}

/**
 * Ce dont la cause peut disparaître d'elle-même, et rien d'autre.
 *
 * Le statut porté par l'erreur et jamais son texte : un `408 Request Timeout` ne contient
 * pas le mot que chercherait une comparaison de chaînes, et la casse d'un message rendu
 * par un tiers n'est promise par personne. Un abandon n'en porte aucun, et se reconnaît à
 * son nom, que la plateforme fixe.
 */
function passagere(cause: unknown): boolean {
  if (cause instanceof ErreurDeLecture) {
    return cause.statut === 408 || cause.statut === 429 || cause.statut >= 500;
  }
  return cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError");
}

/** Une lecture qui n'a pas abouti, et le statut qui dit si elle peut aboutir plus tard. */
export class ErreurDeLecture extends Error {
  readonly statut: number;

  constructor(texte: string, statut: number) {
    super(texte);
    this.name = "ErreurDeLecture";
    this.statut = statut;
  }
}

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
      "l'inventaire lu est tronqué, la réponse annonçant une page suivante alors que cette route n'en rendait aucune",
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
  proprietaire: string,
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
    // Et seulement celles que l'incubateur possède. Le compte voit aussi les applications
    // d'autres structures dont il n'est que collaborateur : leurs collaborateurs ne
    // relèvent pas de cet outil, et les relever ferait ouvrir des constats sur des gens
    // dont personne ici ne décide des accès.
    .filter((application) => application.owner.id === proprietaire)
    .map((application) => ({ application, region }));

  if (lues.items.length === 0) {
    erreurs.push({
      scope: "applications",
      itemRef: region,
      message:
        "aucune application lisible, une région vide ne se distinguant pas d'une panne silencieuse",
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
        "la réponse ne porte aucune liste de collaborateurs, et son absence ne se distingue pas d'un accès que personne ne détient",
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
 * Le compte que porte le jeton, et rien d'autre : c'est lui qui dit quelles applications
 * appartiennent à l'incubateur. Son échec est fatal, comme celui des régions : sans lui, le
 * périmètre ne se décide pas, et relever tout ce que le compte voit ferait entrer des
 * applications d'autres structures, dont il n'est que collaborateur.
 */
export async function lireCompte(
  lire: LecteurScalingo,
): Promise<{ id?: string; erreurs: CollectError[] }> {
  let brut: unknown;
  try {
    brut = await lire(`${HOTE_AUTH}/v1/users/self`);
  } catch (cause: unknown) {
    return { erreurs: [{ scope: "compte", message: message(cause) }] };
  }

  const lu = compteSchema.safeParse(brut);

  return lu.success
    ? { id: lu.data.user.id, erreurs: [] }
    : { erreurs: [{ scope: "compte", message: "le compte du jeton n'est pas lisible" }] };
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
  const [compte, regions] = [await lireCompte(lire), await lireRegions(lire)];

  if (compte.id === undefined) {
    const [premiere, ...reste] = [...compte.erreurs, ...regions.erreurs];
    return {
      applications: [],
      parApplication: vide,
      erreurs: premiere
        ? [premiere, ...reste]
        : [{ scope: "compte", message: "aucun compte rendu, sans erreur rapportée" }],
      fatale: true,
    };
  }

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
    const parc = await lireApplications(lire, region.name, region.api, compte.id);
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
  //
  // Le `scope` est porté par chaque entrée : deux d'entre elles constatent sur les
  // applications et non sur les collaborations, et une trace qui les rangerait sous les
  // collaborateurs enverrait relire la mauvaise route.
  for (const surveille of [
    {
      assez: relevees.length > 0,
      scope: "collaborateurs",
      // `null` autant qu'absent : le schéma l'accepte, et l'assemblage rend plein tout ce
      // qui ne vaut pas `true`. La clé remplacée par `null` serait donc aussi muette que
      // la clé disparue. Le compte, lui, garde `=== undefined` : `null` y est la forme
      // normale d'une invitation en attente, et un parc qui n'en porterait que serait
      // signalé à tort.
      absent: relevees.every((collaboration) => collaboration.is_limited == null),
      quoi: `le rôle : aucune des ${relevees.length} collaborations lues ne porte is_limited, et tous les accès limités passeraient pour des accès pleins`,
    },
    {
      assez: relevees.length > 0,
      scope: "collaborateurs",
      absent: relevees.every((collaboration) => collaboration.user_id === undefined),
      quoi: `le compte : aucune des ${relevees.length} collaborations lues ne porte user_id, et chaque identité retomberait sur son identifiant de collaboration, donc tout le monde disparaîtrait d'un coup pour réapparaître sous une autre clé`,
    },
    {
      assez: applications.length > 0,
      scope: "applications",
      absent: applications.every(({ application }) => application.parent_app_name === undefined),
      quoi: `l'ascendance : aucune des ${applications.length} applications retenues ne porte parent_app_name, et les environnements de revue entreraient dans le périmètre`,
    },
    {
      assez: applications.length > 0,
      scope: "applications",
      // `=== undefined` et non `== null`, contrairement à `is_limited` : un parc entier
      // sans projet est un état légitime, et le signaler figerait la datation chaque nuit
      // pour un regroupement qui n'ouvre aucun droit. Seule la clé disparue ou illisible
      // se signale, le schéma s'y repliant sur `undefined` pour cette raison.
      absent: applications.every(({ application }) => application.project === undefined),
      quoi: `le projet : aucune des ${applications.length} applications retenues ne porte project, et le regroupement disparaîtrait de l'écran sans que rien ne le dise`,
    },
  ]) {
    if (surveille.assez && surveille.absent) {
      erreurs.push({
        scope: surveille.scope,
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
  // Une fois par projet et non une fois par application : c'est un contenant, et deux
  // applications du même projet doivent désigner la même ressource.
  const projets = new Map<string, ObservedResource>();

  const retenir = (identite: ObservedIdentity) => {
    if (!identites.has(identite.externalId)) {
      identites.set(identite.externalId, identite);
    }
  };

  for (const { application, region } of applications) {
    const projet = application.project;
    if (projet) {
      projets.set(projet.id, { externalId: projet.id, label: `${projet.name}, ${region}` });
    }

    ressources.push({
      externalId: application.id,
      // La région entre dans le libellé : deux régions peuvent servir le même nom, et un
      // écran qui les confondrait enverrait couper un accès sur la mauvaise. Séparée par
      // une virgule et non par des parenthèses : les écrans composent déjà les leurs, et
      // un nom d'application Scalingo n'en contient jamais.
      label: `${application.name}, ${region}`,
      url: pageDesCollaborateurs(region, application.name),
      ...(projet ? { parentExternalId: projet.id } : {}),
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

  // Les contenants d'abord : un projet ne porte aucun accès, Scalingo laissant la gestion
  // des utilisateurs au niveau de l'application, et il n'existe donc dans le relevé que
  // pour regrouper.
  return {
    identites: [...identites.values()],
    ressources: [...projets.values(), ...ressources],
    acces,
  };
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

/** Les statuts dont la cause peut disparaître d'elle-même, et eux seuls. */
function reprenable(statut: number): boolean {
  return statut === 408 || statut === 429 || statut >= 500;
}

function messageDuCorps(corps: unknown): string | null {
  if (typeof corps !== "object" || corps === null) {
    return null;
  }
  const dit = (corps as Record<string, unknown>)["error"];
  return typeof dit === "string" && dit.length > 0 ? dit : null;
}

/**
 * Ce qu'une suppression devient, et le 404 en est le cœur : Scalingo ne documente pas ce
 * qu'il rend sur une collaboration absente, et son client officiel traite tout sauf 204
 * comme une erreur. Les deux cas se traitent donc ici, et « déjà absent » est un succès,
 * c'est le cas nominal quand une autre main est passée avant.
 */
export function interpreterRetrait(statut: number, corps: unknown): StepOutcome {
  if (statut === 404) {
    return { state: "ALREADY_ABSENT" };
  }

  if (statut < 200 || statut >= 300) {
    const dit = messageDuCorps(corps);
    return {
      state: "FAILED",
      error: `Scalingo a répondu ${statut}${dit === null ? "" : ` : ${dit}`}`,
      retryable: reprenable(statut),
    };
  }

  return {
    state: "SUCCEEDED",
    evidence:
      "Collaboration retirée. Les variables d'environnement et les identifiants de base n'ont pas changé. L'étape de rotation s'en charge.",
  };
}

/**
 * Ce qu'une invitation devient. Le conflit est un succès et non un échec : quelqu'un déjà
 * invité détient déjà l'accès, et refaire échouer l'étape enverrait un opérateur corriger
 * ce qui est fait.
 *
 * Le conflit seul, et jamais l'entité non traitable, que Scalingo rend sur un champ
 * invalide sans nulle part écrire qu'elle signifie « déjà présent » ici. L'adresse vient de
 * la base et n'est vérifiée que par la présence d'une arobase : la confondre avec un
 * doublon solderait l'étape sans qu'aucune invitation ne soit partie, c'est-à-dire
 * affirmerait un accès que personne ne détient.
 */
export function interpreterOctroi(statut: number, corps: unknown): StepOutcome {
  if (statut === 409) {
    return { state: "ALREADY_PRESENT" };
  }

  if (statut < 200 || statut >= 300) {
    const dit = messageDuCorps(corps);
    return {
      state: "FAILED",
      error: `Scalingo a répondu ${statut}${dit === null ? "" : ` : ${dit}`}`,
      retryable: reprenable(statut),
    };
  }

  return {
    state: "SUCCEEDED",
    evidence:
      "Invitation envoyée. Elle figure dans les collaborateurs dès maintenant, sans attendre d'être acceptée, et c'est déjà un accès accordé.",
  };
}

/**
 * Ce qu'un changement de rôle devient. Le 404 est le seul cas qui demande une décision :
 * la collaboration a disparu entre la lecture et l'écriture, si bien qu'il n'y a ni rôle
 * corrigé ni panne à signaler.
 *
 * Il ne se solde ni en succès ni en « déjà absent », qui valent tous deux succès pour le
 * socle et affirmeraient un accès que plus personne ne détient. Il se reprend : le second
 * passage relira, ne trouvera personne, et invitera.
 */
export function interpreterChangementDeRole(statut: number, corps: unknown): StepOutcome {
  if (statut === 404) {
    return {
      state: "FAILED",
      error:
        "La collaboration a disparu entre sa lecture et la correction du rôle. Rien n'a été changé, et une reprise invitera.",
      retryable: true,
    };
  }

  if (statut < 200 || statut >= 300) {
    const dit = messageDuCorps(corps);
    return {
      state: "FAILED",
      error: `Scalingo a répondu ${statut}${dit === null ? "" : ` : ${dit}`}`,
      retryable: reprenable(statut),
    };
  }

  return {
    state: "SUCCEEDED",
    evidence:
      "Rôle corrigé en place, sur la collaboration existante. Rien n'a été retiré, et aucune invitation n'a été réémise.",
  };
}

const roleConstate = (collaboration: Collaborateur) =>
  collaboration.is_limited === true ? ROLE_LIMITE : ROLE_PLEIN;

/**
 * Ce que le relevé d'une application dit d'une personne, avant d'écrire. Rapproché sur
 * l'adresse et non sur l'identifiant de collaboration : celui-ci change dès qu'une
 * invitation est retirée puis réémise, si bien qu'un plan confirmé la veille viserait une
 * collaboration morte. C'est aussi ce que fait le client officiel avant de supprimer.
 */
export function constaterCollaboration(
  collaborateurs: readonly Collaborateur[],
  adresse: string,
  attendu: { present: boolean; role?: string },
): PrecheckResult {
  const vise = adresse.trim().toLowerCase();
  const trouve = collaborateurs.find(
    (collaboration) => collaboration.email.trim().toLowerCase() === vise,
  );

  if (!attendu.present) {
    return trouve ? { state: "READY" } : { state: "ALREADY_ABSENT" };
  }

  if (!trouve) {
    return { state: "READY" };
  }

  const role = roleConstate(trouve);
  if (attendu.role === undefined || role === attendu.role) {
    return { state: "ALREADY_PRESENT" };
  }

  // Un rôle qui diffère est prêt, et non en écart : l'écriture le corrige en place sur la
  // collaboration existante, ce qui rend l'étape idempotente. Rendre `STALE` la sortirait
  // pour toujours de la portée de l'exécution, le socle n'exécutant jamais une étape dont
  // le précheck a constaté un écart, et il n'y aurait plus de chemin vers la correction.
  return { state: "READY" };
}

const NATURE_COLLABORATION = "collaboration";
const NATURE_JETON = "jeton";

/**
 * Un usage est un besoin nommé, pas une liste de chemins. Le profil nomme le besoin, le
 * connecteur tient les chemins : l'inverse mettrait une règle de pare-feu dans un fichier
 * de politique que personne ne relit chemin par chemin, et le refus d'octroi n'aurait plus
 * rien d'intelligible à dire.
 *
 * Les trois usages se lisent dans les appels que ce connecteur passe vraiment, et nulle
 * part ailleurs : un usage qu'aucun appel ne sert ouvrirait un droit dont personne n'a
 * l'emploi.
 */
const USAGES_DE_JETON = [
  "inventaire-d-une-region",
  "collaborateurs-d-une-application",
  "catalogue-des-regions",
] as const;

type CleDUsage = (typeof USAGES_DE_JETON)[number];

interface UsageDeJeton {
  libelle: string;
  /** L'hôte unique que le jeton autorise. Il n'en porte qu'un, d'où le choix et non la liste. */
  hote: "region" | "authentification";
  /** Vrai quand les chemins de cet usage nomment une application, donc quand le scope doit la porter. */
  viseUneApplication: boolean;
  /**
   * Les couples méthode plus chemin que le porteur pourra appeler, et rien d'autre.
   *
   * Aucun joker de préfixe sur `/v1/apps` : le motif y matcherait tout ce qui pend sous une
   * application, y compris ce que ce connecteur n'appelle jamais, à commencer par ce qui sert
   * les variables d'environnement. Un jeton « en lecture » écrit ainsi rendrait au porteur
   * exactement ce que le rôle limité ne voit pas, c'est-à-dire la distinction sur laquelle
   * repose `risqueDuRole`. Le catalogue se paie donc de ne pas savoir tout dire.
   */
  chemins: (application: string) => NonEmptyArray<string>;
}

const CATALOGUE_DES_USAGES: Readonly<Record<CleDUsage, UsageDeJeton>> = {
  "inventaire-d-une-region": {
    libelle: "lire les applications d'une région et la vue consolidée de ses collaborateurs",
    hote: "region",
    viseUneApplication: false,
    // Les deux listes plates et rien d'autre : le relevé par application n'a pas de motif
    // qui le désigne sans désigner du même coup tout ce qui pend sous une application.
    chemins: () => ["GET:/v1/apps", "GET:/v1/collaborators"],
  },
  "collaborateurs-d-une-application": {
    libelle: "tenir les collaborateurs d'une seule application",
    hote: "region",
    viseUneApplication: true,
    // Le joker porte sur l'identifiant de collaboration, que personne ne connaît au moment
    // d'émettre et qui change dès qu'une invitation est retirée puis réémise : c'est déjà la
    // raison pour laquelle le retrait relit la liste au lieu de viser l'identifiant stocké.
    chemins: (application) => [
      `GET:/v1/apps/${application}/collaborators`,
      `POST:/v1/apps/${application}/collaborators`,
      `PATCH:/v1/apps/${application}/collaborators/*`,
      `DELETE:/v1/apps/${application}/collaborators/*`,
    ],
  },
  "catalogue-des-regions": {
    libelle: "découvrir les régions et le compte qui porte le jeton",
    hote: "authentification",
    viseUneApplication: false,
    // L'échange n'y figure pas : le proxy le fait lui-même sous le mode `scalingo-exchange`,
    // si bien que le porteur du blob n'a aucun échange à faire.
    chemins: () => ["GET:/v1/regions", "GET:/v1/users/self"],
  },
};

const NATURE = {
  description:
    "Ce que cet accès ouvre : « collaboration » invite quelqu'un sur une application, « jeton » fait émettre un jeton restreint devant l'API.",
};

/**
 * La forme d'un nom de région et d'un nom d'application, bornée au caractère près.
 *
 * C'est la seule ligne de défense qui tienne, parce que ces deux valeurs sont interpolées
 * dans des chaînes qui deviennent un pouvoir durable : la région dans l'hôte que le blob
 * autorise, l'application dans les chemins qu'il ouvre. Le périmètre d'un geste accepte du
 * JSON brut, donc la saisie est la porte d'entrée, et `min(1)` la laissait grande ouverte.
 * Une application réduite à l'étoile mettait celle-ci en place du nom dans les quatre
 * chemins des collaborateurs, c'est-à-dire le joker de préfixe que le catalogue déclare
 * refuser en toutes lettres, et de quoi s'inviter collaborateur de n'importe quelle
 * application du compte puis se porter au rôle plein. Une région `x.exemple.invalid/`
 * rendait la cible
 * `https://api.x.exemple.invalid/.scalingo.com`, dont l'hôte effectif n'est pas Scalingo.
 * Ni l'un ni l'autre ne se rattrape après coup : le proxy n'offre ni révocation ni
 * introspection.
 *
 * Calée sur ce que Scalingo accepte et sur ce que son API rend, minuscules, chiffres et
 * tirets. Tout ce qui pèse dans une URL ou dans un motif de chemin en est dehors, l'étoile
 * comme le point, la barre, les deux-points et le pourcent.
 */
const NOM_SCALINGO = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;

const REFUS_DE_FORME = "minuscules, chiffres et tirets, sans tiret en tête ni en queue";

/**
 * Strict, et sans clé facultative : dans un profil écrit à la main, une clé inconnue est
 * une faute de frappe, et une faute de frappe ignorée en silence donne un octroi qui ne
 * fait pas ce que son auteur croit avoir écrit.
 *
 * Le rôle n'a que deux valeurs parce que l'API n'en expose qu'un booléen. En inventer
 * une troisième décrirait un droit que Scalingo ne sait pas poser, et la propriété d'une
 * application ne s'accorde pas, elle se transfère.
 */
const collaborationSchema = z.strictObject({
  nature: z.literal(NATURE_COLLABORATION).meta({ ...NATURE, examples: [NATURE_COLLABORATION] }),
  region: z
    .string()
    .regex(NOM_SCALINGO, REFUS_DE_FORME)
    .meta({
      description:
        "Région Scalingo de l'application. Deux régions peuvent servir le même nom, et l'adresse du tableau de bord la porte.",
      examples: ["osc-fr1"],
    }),
  application: z
    .string()
    .regex(NOM_SCALINGO, REFUS_DE_FORME)
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

/**
 * La région et l'application sont facultatives parce que chaque usage décide de la
 * sienne : les exiger toutes deux obligerait à écrire une région là où le jeton vise le
 * service d'authentification, et une application là où ses chemins n'en nomment aucune.
 * Ce que le schéma ne peut pas dire de ces deux champs, `examinerScopeScalingo` le dit.
 */
const jetonSchema = z.strictObject({
  nature: z.literal(NATURE_JETON).meta({ ...NATURE, examples: [NATURE_JETON] }),
  usage: z.enum(USAGES_DE_JETON).meta({
    description:
      "Le besoin que ce jeton sert. Les chemins qu'il ouvre appartiennent au connecteur et ne s'écrivent pas ici.",
    examples: ["inventaire-d-une-region"],
  }),
  region: z
    .string()
    .regex(NOM_SCALINGO, REFUS_DE_FORME)
    .optional()
    .meta({
      description:
        "La région dont l'API est la cible. Absente pour un usage qui vise le service d'authentification : un jeton ne porte qu'une cible.",
      examples: ["osc-fr1"],
    }),
  application: z
    .string()
    .regex(NOM_SCALINGO, REFUS_DE_FORME)
    .optional()
    .meta({
      description: "L'application visée, pour les seuls usages dont les chemins la nomment.",
      examples: ["mon-application"],
    }),
});

const SCOPE = z.discriminatedUnion("nature", [collaborationSchema, jetonSchema]);

export type ScopeScalingo = z.infer<typeof SCOPE>;
export type ScopeCollaboration = z.infer<typeof collaborationSchema>;
export type ScopeJeton = z.infer<typeof jetonSchema>;

/**
 * Un collaborateur plein lit les variables d'environnement, donc les secrets de
 * l'application et les identifiants de ses bases. Un collaborateur limité ne les voit
 * pas. C'est la seule différence qui compte ici, et elle vaut un cran de risque.
 */
function risqueDuRole(role: ScopeCollaboration["role"]): "medium" | "high" {
  return role === ROLE_PLEIN ? "high" : "medium";
}

function examinerJeton(scope: ScopeJeton): ExamenDeScope {
  const usage = CATALOGUE_DES_USAGES[scope.usage];
  const regional = usage.hote === "region";
  const refus: string[] = [];

  if (regional && scope.region === undefined) {
    refus.push(
      `scope.region : l'usage « ${scope.usage} » interroge l'API d'une région, et ce profil n'en nomme aucune. Chaque région a son propre hôte, et un jeton n'en ouvre qu'un.`,
    );
  }
  if (!regional && scope.region !== undefined) {
    refus.push(
      `scope.region : l'usage « ${scope.usage} » vise le service d'authentification, qui est le même pour toutes les régions. Retirez la région, sans quoi ce profil décrit une cible que le jeton n'ouvrira pas.`,
    );
  }
  if (usage.viseUneApplication && scope.application === undefined) {
    refus.push(
      `scope.application : les chemins de l'usage « ${scope.usage} » nomment une application, et ce profil n'en nomme aucune.`,
    );
  }
  if (!usage.viseUneApplication && scope.application !== undefined) {
    refus.push(
      `scope.application : les chemins de l'usage « ${scope.usage} » ne nomment aucune application, et « ${scope.application} » n'y ouvrirait donc rien.`,
    );
  }

  return {
    refus,
    // Toute la nature, et sans égard pour l'usage : un jeton ne se révoque pas, si bien
    // que même le plus étroit ouvre quelque chose que rien ne saura refermer avant son
    // terme. C'est ce qui lui fait exiger une échéance.
    risque: "high",
    libelle: `un jeton restreint pour ${usage.libelle}`,
    // L'application en est absente, comme le rôle l'est de la cible d'une collaboration :
    // deux accès qui demandent le même jeton pour la même personne demandent la même
    // chose, et le second resterait en écart pour toujours.
    cible: `jeton:${scope.usage}:${scope.region ?? "global"}`,
  };
}

/**
 * Ce que `SCOPE` ne peut pas dire de lui-même, et qui tient à la nature demandée : les
 * deux champs facultatifs d'un jeton ne le sont que parce que l'usage décide, or le
 * schéma est statique pour que `z.toJSONSchema` le rende.
 *
 * Le scope arrive tel que `SCOPE` l'a rendu et jamais autrement : c'est le contrat de
 * `examinerScope`, qui n'est appelé qu'après validation.
 */
export function examinerScopeScalingo(scope: unknown): ExamenDeScope {
  const lu = scope as ScopeScalingo;

  if (lu.nature === NATURE_JETON) {
    return examinerJeton(lu);
  }

  return {
    refus: [],
    risque: risqueDuRole(lu.role),
    libelle: `le rôle ${lu.role} sur l'application ${lu.application} en région ${lu.region}`,
    // Le rôle en est absent : deux rôles sur une même application ne s'ajoutent pas, le
    // second remplace le premier, et l'accès qui perdrait resterait en écart pour
    // toujours.
    cible: `application:${lu.region}:${lu.application}`,
  };
}

const ACTION_JETON = "emettre-un-jeton-restreint";
const ACTION_REPRISE_JETON = "reprendre-un-jeton-restreint";

/** Le préfixe sous lequel ce connecteur écrit ses clés d'engagement, et le seul à les relire. */
const ENGAGEMENT_JETON = "scalingo:jeton:";

/**
 * L'hôte unique du blob. Un jeton n'en porte qu'un, si bien qu'il n'existe aucun jeton qui
 * fasse à la fois le catalogue des régions et la lecture d'une région : ce sont deux
 * émissions, deux comptes machine, deux termes.
 *
 * Rend `undefined` sur un usage régional sans région, que `examinerJeton` refuse déjà et
 * que la planification ne voit donc jamais. Aucune étape n'est alors émise, et le socle pose
 * la sienne : inventer une cible serait affirmer un geste que personne ne peut faire.
 */
function cibleDUnJeton(scope: ScopeJeton): string | undefined {
  const usage = CATALOGUE_DES_USAGES[scope.usage];
  if (usage.hote !== "region") {
    return HOTE_AUTH;
  }
  return scope.region === undefined ? undefined : hoteDe(scope.region);
}

/**
 * L'étape d'émission, et elle est manuelle sans condition.
 *
 * Ce n'est pas une dégradation faute de credential, c'est le contrat : une émission
 * fabrique deux moitiés, dont une ne repasse jamais. La voie automatique la remonte bien
 * jusqu'à `ResultatDExecution.remises`, mais aucun écran ne la rend encore, si bien
 * qu'emprunter cette voie détruirait ce qu'elle fabrique, en laissant derrière elle un
 * jeton vivant, irrévocable jusqu'à son terme, et dont la clé n'a atteint personne. Le tier
 * le dit donc plutôt qu'une garde enfouie, et l'opérateur voit une marche à suivre là où il
 * aurait vu un bouton qui perd la moitié périssable. L'écran vient au lot suivant, et c'est
 * lui qui rouvrira cette voie ; le jour où il la rouvre, le tier automatique exige les deux
 * credentials et non un seul, l'échange étant fait par le proxy avec le jeton de compte.
 */
export function planifierJetonScalingo(
  scope: ScopeJeton,
  sujet: SubjectRef,
): readonly PlannedStep[] {
  const usage = CATALOGUE_DES_USAGES[scope.usage];
  const qui = sujet.kind === "person" ? sujet.username : sujet.key;
  const cible = cibleDUnJeton(scope);

  if (cible === undefined || (usage.viseUneApplication && scope.application === undefined)) {
    return [];
  }

  const scopes = usage.chemins(scope.application ?? "");
  const ou = scope.region ?? "global";
  // L'application entre dans la clé quand elle entre dans les chemins, à la différence de
  // la cible d'examen qui l'ignore : deux jetons pour deux applications ouvrent deux accès
  // distincts, et leur donner la même clé n'en ferait reparaître qu'un seul au départ.
  const quoi = `${scope.usage}:${ou}${scope.application === undefined ? "" : `:${scope.application}`}`;
  const cle = `${ENGAGEMENT_JETON}${quoi}:${qui}`;

  return [
    {
      systemKey: "scalingo",
      capability: "grant",
      tier: "manual",
      action: ACTION_JETON,
      label: `Émettre un jeton restreint pour ${qui} : ${usage.libelle}`,
      params: { beneficiaire: qui, usage: scope.usage, cible, scopes },
      // Toute la nature, et sans égard pour l'usage : un jeton ne se révoque pas, si bien
      // que même le plus étroit ouvre quelque chose que rien ne saura refermer avant son
      // terme. C'est ce qui lui fait exiger une échéance, le socle refusant toute étape à
      // risque élevé qu'aucun terme ne borne.
      riskLevel: "high",
      expectedState: { jetonEmis: true },
      idempotencyKey: cle,
      // Ce que cette étape ouvre ne reparaîtra dans aucun `CollectResult` : aucune API de
      // Scalingo ne liste les blobs d'un proxy qui n'en garde aucun. Sans cette clé, le
      // départ se tairait sur ce que plus personne ne peut observer.
      engagementKey: cle,
      manual: {
        title: `Émettre un jeton restreint pour ${qui}`,
        runbook: RUNBOOK_JETON,
        doneWhen: `${qui} détient un blob émis sur ${cible}, borné aux chemins ${scopes.join(", ")} et au terme porté par cette étape, et la fiche de son compte machine est saisie depuis l'écran « Comptes de service », terme compris : sans lui, la fiche réclamera une revue que personne ne peut éteindre.`,
      },
    },
  ];
}

/**
 * L'émission, et les refus qui la précèdent.
 *
 * La simulation d'abord, comme pour les deux autres actions et pour la même raison : ce qui
 * ne part pas ne peut pas partir par erreur.
 *
 * Le terme ensuite, et ce refus n'est pas une ceinture de trop, mais ce n'est pas pour la
 * raison qui était écrite ici : un geste hors dossier passe bien par `assemblerOctrois`, via
 * `octroisDUnProfil`, donc son terme y est exigé comme celui d'une arrivée. Ce que cette
 * garde tient est ailleurs : le terme est posé par le socle, vit hors de l'empreinte, et
 * arrive ici recopié depuis la ligne en base. Un plan écrit avant que la règle existe, une
 * colonne restée vide, un futur appelant qui construirait l'étape autrement, et l'émission
 * partirait sans terme, c'est-à-dire sans reprise d'aucune sorte. Le seul endroit qui voie
 * la valeur réellement employée est celui qui écrit.
 *
 * La cible enfin, contre la liste blanche d'hôte : ce qu'un blob porte est l'unique
 * destination vers laquelle le proxy relaiera le jeton de compte entier, et cette liaison
 * survit à la session.
 *
 * Aucune reprise, jamais : retenter une émission dont on ignore si elle a abouti, c'est
 * émettre un second jeton que rien ne listera et que rien ne révoquera.
 */
export async function executerEmissionScalingo(
  emettre: EmissionDeJeton,
  jeton: string | undefined,
  step: PlannedStep,
  ctx: RunContext,
): Promise<StepOutcome> {
  if (ctx.dryRun) {
    throw new Error(REFUS_SIMULATION);
  }

  const terme = step.grantExpiresAt;
  if (terme === undefined) {
    return {
      state: "FAILED",
      error:
        "Cette étape émet un jeton que rien ne saura reprendre, et elle ne porte aucun terme. Rien n'a été émis.",
      retryable: false,
    };
  }

  if (jeton === undefined) {
    return {
      state: "FAILED",
      error: `Aucun jeton Scalingo : ${step.manual?.runbook ?? RUNBOOK_JETON}`,
      retryable: false,
    };
  }

  const demande = demandeDeLEtape(step);
  if (demande === undefined) {
    return {
      state: "FAILED",
      error: `Étape « ${step.action} » sans cible ni chemins lisibles : rien n'a été émis.`,
      retryable: false,
    };
  }

  if (!hoteAutorise(demande.cible)) {
    return {
      state: "FAILED",
      error: `${refusDHote(demande.cible)} Un blob ne porte qu'une cible, et elle lie le jeton de compte entier à cet hôte jusqu'à son terme.`,
      retryable: false,
    };
  }

  const secondes = Math.floor((terme.getTime() - ctx.now.getTime()) / 1_000);

  let emis: JetonEmis;
  try {
    emis = await emettre({
      jeton,
      cible: demande.cible,
      scopes: demande.scopes,
      secondes,
      nom: step.idempotencyKey,
    });
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    // La seule distinction qui compte ici : savoir si le refus exclut qu'un blob ait été
    // créé là-bas. Faute de route d'introspection, personne ne pourra jamais lever le doute.
    const aucunBlob = cause instanceof ErreurFgp && cause.aucunBlob;

    return {
      state: "FAILED",
      error: aucunBlob
        ? `L'émission a été refusée (${message}). Rien n'a été émis.`
        : `L'émission n'a pas abouti (${message}). Un jeton a pu naître : rien ne le liste, rien ne le révoque, et sa clé n'a atteint personne. Il est inutilisable et meurt à son terme. Ne relancez pas à l'aveugle, une seconde tentative en ajouterait un second.`,
      retryable: false,
    };
  }

  return {
    state: "SUCCEEDED",
    // Ce qui devient le motif journalisé de l'étape, dans un journal en écriture seule à
    // rétention indéfinie : la clé client n'y entre pas, et le blob non plus.
    evidence: `Jeton restreint émis pour ${demande.beneficiaire} sur ${demande.cible}, borné à ${demande.scopes.length} chemins et au terme du ${terme.toISOString()}. Sa clé se remet une seule fois et ne s'écrit nulle part. Aucune révocation n'existe côté proxy : ce jeton se reprend en attendant son terme, et par rien d'autre.`,
    credential: {
      // Dérivée de la clé d'idempotence stockée, qui porte l'identifiant du plan et est
      // unique en base : une réémission après un échec ambigu produit une seconde ligne
      // plutôt que d'écraser la première, et c'est voulu, les deux blobs pouvant vivre
      // là-bas sans que ni l'un ni l'autre ne se révoque.
      key: cleProposee("scalingo", step.idempotencyKey.replace(/^scalingo:/u, "")),
      label: `Scalingo · jeton restreint ${demande.usage}`,
      purpose: `${CATALOGUE_DES_USAGES[demande.usage].libelle}, sur ${demande.cible}, pour ${demande.beneficiaire}.`,
      provider: "scalingo",
      ownerUsername: demande.beneficiaire,
      blob: emis.blob,
      target: demande.cible,
      scopes: demande.scopes,
      expiresAt: terme,
      aRemettre: emis.cle,
    },
  };
}

/** Ce qu'une étape d'émission porte, quand elle porte quelque chose de lisible. */
function demandeDeLEtape(step: PlannedStep):
  | {
      cible: string;
      scopes: NonEmptyArray<string>;
      beneficiaire: string;
      usage: CleDUsage;
    }
  | undefined {
  const { cible, scopes, beneficiaire, usage } = step.params;

  if (typeof cible !== "string" || typeof beneficiaire !== "string") {
    return undefined;
  }
  if (typeof usage !== "string" || !(usage in CATALOGUE_DES_USAGES)) {
    return undefined;
  }
  if (!Array.isArray(scopes)) {
    return undefined;
  }
  const chemins = scopes.filter((un): un is string => typeof un === "string");
  const [premier, ...reste] = chemins;
  // Rien de partiel : une liste dont un élément n'est pas un chemin est une étape qu'on ne
  // sait pas lire, et en émettre la portion lisible ouvrirait autre chose que l'approuvé.
  if (premier === undefined || chemins.length !== scopes.length) {
    return undefined;
  }

  return {
    cible,
    scopes: [premier, ...reste],
    beneficiaire,
    usage: usage as CleDUsage,
  };
}

export function planifierOctroiScalingo(
  scope: ScopeCollaboration,
  sujet: SubjectRef,
  credential: boolean,
): readonly PlannedStep[] {
  const qui = sujet.kind === "person" ? sujet.username : sujet.key;
  // Scalingo invite sur une adresse et non sur un compte : sans elle, rien à viser, et
  // l'étape dégrade d'elle-même. Ce qui manque est une donnée, pas un credential.
  const adresse = sujet.kind === "person" ? sujet.email : undefined;
  const auto = credential && adresse !== undefined;

  return [
    {
      systemKey: "scalingo",
      capability: "grant",
      tier: auto ? "auto" : "manual",
      action: "inviter-comme-collaborateur",
      label: `Inviter ${qui} dans ${scope.application} comme ${scope.role}`,
      params: {
        region: scope.region,
        application: scope.application,
        beneficiaire: adresse ?? qui,
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
/**
 * Une étape par application constatée, et le tier de chacune décidé ici : le connecteur est
 * le seul à savoir ce qui lui manque. Sans adresse sûre, il n'a rien à viser et dégrade de
 * lui-même, ce qui manque étant une donnée et non un credential.
 *
 * Sans aucun accès transmis, une seule étape pour tout le parc, manuelle, sur la vue
 * consolidée : c'est ce qui reste faisable quand on ne sait pas où la personne est.
 */
const jour = (date: Date) => date.toISOString().slice(0, 10);

/**
 * La reprise d'un jeton émis, qui ne peut être que manuelle et déclarative.
 *
 * Le critère de complétion ne peut pas dire autre chose que le terme : le proxy n'offre ni
 * révocation ni introspection, son registre est la fiche du compte machine et non une API, et
 * rien au monde ne sait dire si un blob vit encore. D'où le second regard, qui est tout ce
 * qui reste quand aucune lecture ne peut démentir une parole d'opérateur.
 */
function reprisesDesJetons(
  username: string,
  engagements: readonly OpenEngagement[],
): readonly PlannedStep[] {
  return engagements
    .filter((engagement) => engagement.key.startsWith(ENGAGEMENT_JETON))
    .map((engagement) => {
      const terme = engagement.expiresAt;

      return {
        systemKey: "scalingo",
        capability: "revoke" as const,
        tier: "manual" as const,
        action: ACTION_REPRISE_JETON,
        label: `Reprendre le jeton restreint ouvert à ${username} le ${jour(engagement.openedAt)}`,
        params: { username, engagement: engagement.key, ouvertLe: jour(engagement.openedAt) },
        riskLevel: "high" as const,
        expectedState: { jetonRepris: true },
        // L'instant d'ouverture entre dans la clé, et pas seulement l'engagement : une
        // émission n'est pas idempotente, si bien que deux blobs peuvent vivre sous la même
        // clé d'engagement, chacun avec son propre terme. Sans cet instant, le dédoublonnage
        // n'en garderait qu'une étape, dont le critère de complétion ne nommerait qu'un seul
        // des deux termes, et le plus long des deux se solderait sans être échu.
        idempotencyKey: `scalingo:reprise:${engagement.key}:${engagement.openedAt.toISOString()}`,
        expectedActor: "OPERATOR" as const,
        validationBy: "OPERATOR" as const,
        manual: {
          title: `Reprendre le jeton restreint de ${username}`,
          runbook: RUNBOOK_REPRISE_JETON,
          doneWhen: `${
            terme === undefined
              ? "Le terme du jeton est passé"
              : `Le terme du jeton est passé, soit après le ${jour(terme)}`
          }, et aucune émission nouvelle n'a été faite sous cet engagement depuis. Rien d'autre ne se constate : le proxy n'offre ni révocation ni introspection, et son registre est la fiche du compte machine, pas une API. Le jeton d'API Scalingo n'a pas été renouvelé pour autant : le faire couperait tout le parc et la collecte.`,
        },
      };
    });
}

export function planifierDepartScalingo(
  username: string,
  acces: readonly { resourceExternalId?: string; resourceLabel?: string }[],
  adresse: string | undefined,
  credential: boolean,
  engagements: readonly OpenEngagement[] = [],
): readonly PlannedStep[] {
  const cibles = acces.filter((un) => un.resourceExternalId !== undefined);

  const coupures: PlannedStep[] =
    cibles.length === 0 || adresse === undefined
      ? [
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
        ]
      : cibles.map((un) => {
          const application = un.resourceLabel ?? un.resourceExternalId ?? "";
          // Le libellé porte « nom, région », et c'est la région qui donne l'hôte. Le nom
          // d'une application Scalingo ne contient jamais de virgule.
          const [nom = "", region = ""] = application.split(", ");

          return {
            systemKey: "scalingo",
            capability: "revoke" as const,
            tier: credential ? ("auto" as const) : ("manual" as const),
            action: "retirer-des-collaborateurs",
            label: `Retirer ${username} de ${application}`,
            params: { region, application: nom, beneficiaire: adresse },
            riskLevel: "high" as const,
            expectedState: { collaborateur: false },
            idempotencyKey: `scalingo:${region}:${nom}:revoke:${username}`,
            manual: {
              title: `Retirer ${username} de ${application}`,
              runbook: RUNBOOK,
              deeplink: pageDesCollaborateurs(region, nom),
              doneWhen: `${username} n'apparaît plus dans les collaborateurs de ${application}, invitation en attente comprise. Si l'application lui appartient, sa propriété a été transférée : un propriétaire ne figure dans aucune liste de collaborateurs.`,
            },
          };
        });

  return [
    ...coupures,
    ...reprisesDesJetons(username, engagements),
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

/** Ce qu'une étape vise, quand elle vise quelque chose de lisible. */
function cibleDeLEtape(
  step: PlannedStep,
): { region: string; application: string; adresse: string } | undefined {
  const { region, application, beneficiaire } = step.params;
  if (typeof region !== "string" || typeof application !== "string") {
    return undefined;
  }
  if (typeof beneficiaire !== "string" || !beneficiaire.includes("@")) {
    return undefined;
  }
  return { region, application, adresse: beneficiaire };
}

const hoteDe = (region: string) => `https://api.${region}.scalingo.com`;

/**
 * Les seuls hôtes vers lesquels le porteur du compte entier a le droit de partir, et les
 * seules cibles qu'un blob a le droit de porter.
 *
 * Défense en profondeur et non ceinture de trop : la forme d'une région est bornée par le
 * schéma, mais une adresse arrive ici depuis une étape figée en base ou depuis un libellé
 * de ressource relu, et aucun de ces deux chemins ne repasse par le schéma. Le tort n'est
 * pas le même des deux côtés : une écriture vers un hôte étranger produit un appel fugace,
 * une cible étrangère lie un credential durable et irrévocable à un tiers.
 */
function hoteAutorise(adresse: string): boolean {
  let lue: URL;
  try {
    lue = new URL(adresse);
  } catch {
    return false;
  }

  return (
    lue.protocol === "https:" &&
    (lue.hostname === "auth.scalingo.com" ||
      /^api\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\.scalingo\.com$/u.test(lue.hostname))
  );
}

const refusDHote = (adresse: string) =>
  `« ${adresse} » ne désigne aucun hôte Scalingo : rien n'est parti.`;

const ACTIONS_LUES = new Set(["retirer-des-collaborateurs", "inviter-comme-collaborateur"]);

/**
 * Le précheck, qui est une lecture et rien d'autre. Il tourne dans les deux régimes,
 * simulation comprise, et jusque sur une étape manuelle : éviter d'envoyer un humain faire
 * ce qui est déjà fait en est le meilleur usage.
 *
 * Rien à constater n'est pas un échec. Lever ici ferait compter un échec à chaque passage
 * sur une étape dont on sait déjà qu'elle est manuelle, ou sur la rotation des secrets, qui
 * ne se lit par aucune API.
 */
export async function constaterCollaborateur(
  lire: LecteurScalingo,
  step: PlannedStep,
): Promise<PrecheckResult> {
  const cible = cibleDeLEtape(step);
  if (!cible || !ACTIONS_LUES.has(step.action)) {
    return { state: "READY" };
  }

  const releve = await lireCollaborateurs(
    lire,
    `${hoteDe(cible.region)}/v1/apps/${cible.application}/collaborators`,
    "precheck",
  );

  // Ne pas savoir n'autorise pas à écrire, mais n'autorise pas davantage à conclure que le
  // geste est fait : l'étape reste prête, et l'écriture rencontrera le même mur.
  if (!releve.lue) {
    return { state: "READY" };
  }

  return step.action === "retirer-des-collaborateurs"
    ? constaterCollaboration(releve.items, cible.adresse, { present: false })
    : constaterCollaboration(releve.items, cible.adresse, {
        present: true,
        ...(typeof step.params["role"] === "string" ? { role: step.params["role"] } : {}),
      });
}

const REFUS_SIMULATION =
  "ACTIONS_ENABLED n'autorise aucune écriture. Une exécution a été demandée en simulation, et aucun appel n'est parti.";

/**
 * L'écriture, et les refus qui la précèdent.
 *
 * La simulation d'abord, avant même de regarder ce que l'étape demande : ce qui ne part pas
 * ne peut pas partir par erreur.
 */
export async function executerScalingo(
  lire: LecteurScalingo,
  ecrire: EcritureScalingo,
  credential: boolean,
  step: PlannedStep,
  ctx: RunContext,
): Promise<StepOutcome> {
  if (ctx.dryRun) {
    throw new Error(REFUS_SIMULATION);
  }

  if (!credential) {
    return {
      state: "FAILED",
      error: `Aucun jeton Scalingo : ${step.manual?.runbook ?? RUNBOOK}`,
      retryable: false,
    };
  }

  const cible = cibleDeLEtape(step);
  if (!cible || !ACTIONS_LUES.has(step.action)) {
    return {
      state: "FAILED",
      error: `Étape « ${step.action} » sans voie automatique : elle attend la main d'un opérateur.`,
      retryable: false,
    };
  }

  const hote = hoteDe(cible.region);

  // La région vient d'une étape figée en base, et une étape figée ne repasse pas par le
  // schéma qui borne sa forme : une région tordue y mettrait un hôte étranger, vers lequel
  // ce porteur, qui porte le compte entier, n'a rien à dire. Le refus est ici autant que
  // dans le transport, pour qu'aucun appelant n'ait à s'en souvenir.
  if (!hoteAutorise(hote)) {
    return { state: "FAILED", error: refusDHote(hote), retryable: false };
  }

  const collaborateurs = `${hote}/v1/apps/${cible.application}/collaborators`;

  // La collaboration se retrouve par l'adresse et jamais par son identifiant : celui-ci
  // change dès qu'une invitation est retirée puis réémise, si bien qu'un plan confirmé la
  // veille viserait une collaboration morte. C'est aussi ce que fait le client officiel.
  const releve = await lireCollaborateurs(lire, collaborateurs, "execution");
  if (!releve.lue) {
    const cause = releve.erreurs[0]?.message ?? "sans erreur rapportée";
    return {
      state: "FAILED",
      error: `Les collaborateurs de ${cible.application} n'ont pas pu être lus (${cause})`,
      retryable: true,
    };
  }

  const vise = cible.adresse.trim().toLowerCase();
  const trouve = releve.items.find(
    (collaboration) => collaboration.email.trim().toLowerCase() === vise,
  );

  if (step.action === "retirer-des-collaborateurs") {
    if (!trouve) {
      return { state: "ALREADY_ABSENT" };
    }

    const { statut, corps } = await ecrire("DELETE", `${collaborateurs}/${trouve.id}`);

    return interpreterRetrait(statut, corps);
  }

  const demande = step.params["role"];

  // Une seule étape pour l'octroi, et c'est ce relevé qui décide du geste : la
  // planification ne lit aucun système par construction, elle ne peut pas savoir qui est
  // déjà là.
  if (!trouve) {
    const { statut, corps } = await ecrire("POST", collaborateurs, {
      collaborator: {
        email: cible.adresse,
        // Toujours explicite : le défaut de l'API est le rôle limité quand son client en
        // ligne de commande envoie l'inverse, et l'implicite reviendrait à ne pas savoir
        // quel accès on vient d'ouvrir.
        is_limited: demande === ROLE_LIMITE,
      },
    });

    return interpreterOctroi(statut, corps);
  }

  const attendu = demande === ROLE_LIMITE || demande === ROLE_PLEIN ? demande : undefined;
  if (attendu === undefined || roleConstate(trouve) === attendu) {
    return { state: "ALREADY_PRESENT" };
  }

  // Le rôle se corrige en place plutôt que de retirer puis réinviter : le retrait ferait
  // perdre l'invitation acceptée, et la réémission renverrait un courriel pour un accès
  // que la personne détient déjà.
  const { statut, corps } = await ecrire("PATCH", `${collaborateurs}/${trouve.id}`, {
    collaborator: { is_limited: attendu === ROLE_LIMITE },
  });

  return interpreterChangementDeRole(statut, corps);
}

export const CONTRAT_SCALINGO: ConnectorContract = {
  key: "scalingo",
  label: "Scalingo",
  criticality: "high",
  runbook: RUNBOOK,
  /**
   * Scalingo ne rend jamais qu'une adresse, proprietaire d'application comme
   * collaborateur. La branche du nom d'usage n'existe donc pas ici, et l'ajouter par
   * symetrie inventerait un cas que l'API ne produit pas.
   */
  accountSlug: ({ handle }) => fragmentDAdresse(handle),
  credentials: [
    {
      id: CREDENTIAL,
      source: "env",
      scopeNote:
        "Jeton d'API du compte de service propriétaire de la plupart des applications. Sa portée est le compte entier. Un jeton Scalingo hérite de tous les droits du compte qui l'a créé, sur chaque application et chaque base, et le fournisseur ne sait pas le restreindre. Il sait donc supprimer une application de production, alors que cet outil ne s'en sert qu'en lecture. Séparer un jeton de lecture d'un jeton d'écriture ne cloisonnerait rien, les deux héritant du même compte, d'où un seul ici.",
      // Porté par un compte de service et non par une personne : il ne meurt pas avec
      // un départ, ce qui est la seule chose que ce champ dit.
      nominative: false,
    },
    {
      id: CREDENTIAL_FGP,
      source: "fgp",
      scopeNote:
        "Adresse du proxy à jetons restreints, par lequel passe l'émission de jetons pour des tiers. Un blob rétrécit ce que peut faire son porteur, qui ne pourra appeler que les méthodes et les chemins listés à l'émission, sur une seule cible, et jusqu'à un terme. Il ne rétrécit pas ce que peut faire l'instance. Le jeton de compte Scalingo, à portée compte entier, voyage en clair jusqu'au proxy à l'émission et vit chiffré à l'intérieur du blob, si bien que l'instance le manipule en clair à chaque requête qu'elle relaie. Aucune révocation n'existe côté proxy, et un jeton émis se reprend en attendant son terme, par rien d'autre.",
      // Ni nominatif ni personnel : c'est une adresse de service, et l'absence de jeton sur
      // la route de génération est un fait du proxy, pas un oubli de configuration.
      nominative: false,
    },
  ],
  capabilities: {
    list: [{ requires: [CREDENTIAL], tier: "auto", runbook: RUNBOOK_LECTURE }],
    // Les deux sens ont leur voie automatique, et chacun garde la voie manuelle sous
    // elle : sans jeton, il reste une marche à suivre, et c'est ce que le second tier
    // déclare. L'octroi invite ou corrige le rôle en place, le retrait vise chaque
    // application où la personne est constatée, le socle sachant dire sur quelles
    // ressources agir. Ce que ni l'un ni l'autre ne fait est la rotation des secrets,
    // qu'aucune API n'expose et qui sort en étape manuelle.
    //
    // L'émission d'un jeton restreint passe par la même capacité et n'en emprunte pourtant
    // aucune voie automatique : elle sort manuelle par contrat, et le connecteur le décide
    // lui-même dans `octroyer`. C'est pourquoi `CREDENTIAL_FGP` n'est exigé par aucune
    // entrée ci-dessous, et il n'y a rien à corriger là : une sonde qui le rendrait
    // disponible ne doit changer le tier d'aucune étape tant qu'aucun écran ne rend la
    // moitié périssable. Le jour où l'écran la rend, c'est une entrée exigeant les deux
    // credentials qu'il faudra écrire ici, l'échange étant fait par le proxy avec le jeton
    // de compte.
    grant: [
      { requires: [CREDENTIAL], tier: "auto", runbook: RUNBOOK_OCTROI },
      { requires: [], tier: "manual", runbook: RUNBOOK_OCTROI },
    ],
    revoke: [
      { requires: [CREDENTIAL], tier: "auto", runbook: RUNBOOK },
      { requires: [], tier: "manual", runbook: RUNBOOK },
    ],
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
    throw new Error("échange du jeton, la réponse ne porte aucun porteur");
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

const ecrireTout: EcritureScalingo = async (methode, url, corps) => {
  if (!hoteAutorise(url)) {
    throw new Error(refusDHote(url));
  }

  const reponse = await fetch(url, {
    method: methode,
    headers: {
      authorization: `Bearer ${await porteurValide()}`,
      accept: "application/json",
      ...(corps === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    signal: AbortSignal.timeout(DELAI_MS),
  });

  if (reponse.status === 401) {
    porteur = undefined;
  }

  // Un corps illisible n'est pas une panne : une suppression réussie n'en porte aucun, et
  // son statut suffit à l'interpréter.
  const texte = await reponse.text().catch(() => "");
  let lu: unknown;
  try {
    lu = texte.length > 0 ? JSON.parse(texte) : undefined;
  } catch {
    lu = undefined;
  }

  return { statut: reponse.status, corps: lu };
};

const lireTout: LecteurScalingo = async (url) => {
  if (!hoteAutorise(url)) {
    // Définitif et non passager : réessayer une adresse qui n'est pas Scalingo ne la
    // rendrait pas Scalingo.
    throw new ErreurDeLecture(refusDHote(url), 403);
  }

  const reponse = await fetch(url, {
    headers: { authorization: `Bearer ${await porteurValide()}`, accept: "application/json" },
    signal: AbortSignal.timeout(DELAI_MS),
  });

  // Un porteur périmé et un droit manquant ne se distinguent qu'au code : le premier se
  // rattrape par un échange au passage suivant, le second demande une correction côté
  // Scalingo. Les confondre ferait réessayer indéfiniment un refus définitif.
  if (reponse.status === 401) {
    porteur = undefined;
    // Repris comme une panne passagère, et pour cause : le porteur vient d'être oublié,
    // si bien que le second essai en échangera un neuf.
    throw new ErreurDeLecture("le porteur a expiré en cours de lecture", 503);
  }

  if (!reponse.ok) {
    throw new ErreurDeLecture(`${reponse.status} ${reponse.statusText}`, reponse.status);
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
      {
        id: CREDENTIAL_FGP,
        available: Boolean(env.FGP_URL),
        ...(env.FGP_URL ? {} : { unavailableReason: "FGP_URL absent de l'environnement" }),
        checkedAt: new Date(),
      },
    ]),

  list: (): Promise<CollectResult> => collecter(avecReprise(lireTout)),

  precheck: (step) => constaterCollaborateur(lireTout, step),

  execute: (step, ctx) =>
    step.action === ACTION_JETON
      ? executerEmissionScalingo(emettreUnJeton, env.SCALINGO_API_TOKEN, step, ctx)
      : executerScalingo(lireTout, ecrireTout, Boolean(env.SCALINGO_API_TOKEN), step, ctx),

  plan: (intent) => {
    if (intent.subject.kind !== "person") {
      return Promise.resolve([]);
    }

    // Même règle que sur les autres systèmes : un octroi ne sort que sous un scope
    // validé, et le scope vient du profil. Sans lui, aucune étape, faute de quoi le même
    // octroi sortirait sous deux clés que le dédoublonnage ne rapprocherait pas.
    if (intent.kind === "grant") {
      const lu = SCOPE.safeParse(intent.scope);

      return Promise.resolve(lu.success ? octroyer(lu.data, intent.subject) : []);
    }

    return Promise.resolve(
      planifierDepartScalingo(
        intent.subject.username,
        intent.subject.acces ?? [],
        intent.subject.handles?.["scalingo"] ?? intent.subject.email,
        Boolean(env.SCALINGO_API_TOKEN),
        intent.subject.engagements ?? [],
      ),
    );
  },

  planifierOctroi: (scope, sujet) => octroyer(scope as ScopeScalingo, sujet),
};

/**
 * Le connecteur décide du tier de son étape lui-même, nature par nature, là où
 * `resolveCapability` résout par capacité et non par action : les deux natures passent par la
 * même voie déclarée sous `capabilities.grant`, et elles ne se rendent pas praticables par la
 * même chose. La collaboration dégrade faute de credential, l'émission ne dégrade pas, elle
 * est manuelle par contrat tant qu'aucun écran ne rend la moitié périssable.
 */
function octroyer(scope: ScopeScalingo, sujet: SubjectRef): readonly PlannedStep[] {
  return scope.nature === NATURE_COLLABORATION
    ? planifierOctroiScalingo(scope, sujet, Boolean(env.SCALINGO_API_TOKEN))
    : planifierJetonScalingo(scope, sujet);
}
