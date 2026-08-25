import type { z } from "zod";

import type { PlannedStep, ResolvedCapability, RiskLevel, SubjectRef } from "@/core/connector";
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
  /**
   * Ce que l'accès vise, sous une forme stable et sans le rôle demandé : deux accès qui
   * rendent la même valeur visent la même chose.
   *
   * Le rôle en est absent, et c'est tout l'intérêt. Deux rôles sur une même cible ne
   * s'ajoutent pas, le second remplace le premier : exécutée après lui, la seconde étape
   * constate un état différent de celui qu'elle attend, et reste en écart pour toujours.
   * C'est ce que le connecteur seul sait dire de son scope, et ce qui fait refuser le
   * profil à sa vérification plutôt qu'à l'exécution.
   */
  cible: string;
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
  /**
   * Rang de l'accès dans la liste du profil, seul identifiant qu'un accès possède :
   * rien ne l'y rend unique, et deux accès d'un même profil peuvent viser le même
   * système, sur deux organisations par exemple. Sans lui, un accès valide affiche le
   * refus de son voisin.
   */
  acces: number;
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

type AccesDeProfil = Profil["accesses"][number];

interface VerdictDAcces {
  /** Vide quand l'accès s'applique. Non vide, aucune étape n'en sort. */
  motifs: readonly string[];
  /** Le scope tel que le schéma du système l'a rendu. Nul dès qu'un motif existe. */
  scope: unknown;
  /** Ce que le connecteur dit de ce scope, quand il sait en dire quelque chose. */
  examen: ExamenDeScope | null;
}

/**
 * Le verdict d'un seul accès, et le seul endroit où un scope se valide.
 *
 * Écrit une fois parce que les deux appelants doivent conclure à l'identique : la
 * vérification de la politique refuse le fichier, la construction d'un plan refuse le
 * plan, et un scope que l'une accepterait sans l'autre laisserait un profil valide
 * produire une arrivée qui ne part jamais.
 */
function verdictDAcces(
  acces: AccesDeProfil,
  systeme: SystemeOffrantOctroi | undefined,
  connus: string,
): VerdictDAcces {
  const refuse = (motif: string): VerdictDAcces => ({ motifs: [motif], scope: null, examen: null });

  // Deux motifs distincts et non un seul, parce qu'ils appellent deux gestes
  // différents : corriger une clé, ou attendre qu'un connecteur sache faire.
  if (!systeme) {
    return refuse(
      `aucun connecteur ne porte cette clé. Systèmes connus : ${connus.length > 0 ? connus : "aucun"}.`,
    );
  }

  if (!systeme.octroiDeclare) {
    return refuse(
      "ce système ne déclare aucun octroi : son connecteur ne sait pas encore donner un accès, même à la main. L'accès est à retirer du profil en attendant qu'il le sache.",
    );
  }

  // C'est ici, et nulle part au chargement, que ce qui n'est pas un objet se dit :
  // un schéma de scope sans champ attendu accepterait n'importe quel scalaire, son
  // objet strict n'ayant aucune clé inconnue à refuser.
  if (typeof acces.scope !== "object" || acces.scope === null || Array.isArray(acces.scope)) {
    return refuse(
      `scope : ce champ attend un objet, ce profil y met ${typeRecu(acces.scope)}. Laissez-le vide pour un scope vide, ou écrivez sous lui les clés que ce système attend.`,
    );
  }

  const lu = systeme.scopeSchema.safeParse(acces.scope);

  if (!lu.success) {
    return {
      motifs: lu.error.issues.map((probleme) => motifDeScope(probleme, acces.scope)),
      scope: null,
      examen: null,
    };
  }

  const examen = systeme.examinerScope?.(lu.data) ?? null;
  const motifs = [...(examen?.refus ?? [])];

  if (examen?.risque === "high" && acces.expiresInDays === undefined) {
    motifs.push(
      `${examen.libelle} est un accès à risque élevé : il exige une échéance, sous expiresInDays. Sans terme, il ne se referme jamais de lui-même.`,
    );
  }

  return { motifs, scope: lu.data, examen };
}

function clesConnues(catalogue: readonly SystemeOffrantOctroi[]): string {
  return catalogue
    .map((systeme) => systeme.key)
    .sort()
    .join(", ");
}

interface AccesExamine<T extends SystemeOffrantOctroi> {
  /** Rang de l'accès dans la liste du profil, seul identifiant qu'un accès possède. */
  rang: number;
  acces: AccesDeProfil;
  systeme: T | undefined;
  verdict: VerdictDAcces;
  /** Ce qui refuse cet accès : les motifs de son verdict, plus la cible déjà visée. */
  motifs: readonly string[];
}

/**
 * Les accès d'un profil, examinés un par un puis rapprochés entre eux.
 *
 * Écrit une fois, pour la même raison que `verdictDAcces` : la vérification de la
 * politique et la construction d'un plan doivent conclure à l'identique, sans quoi un
 * profil que la vérification accepte ferait échouer un plan, ou l'inverse.
 *
 * Un accès qui vise ce qu'un accès précédent du même profil vise déjà est refusé ici, et
 * c'est le seul verdict qui ne se prononce pas sur un accès isolé. Deux rôles sur une
 * même cible produisent deux étapes : la première exécutée fait constater à la seconde un
 * état différent de celui qu'elle attend, et cette seconde étape reste en écart, sans que
 * personne puisse la débloquer autrement qu'à la main. Un accès déjà refusé pour une
 * autre raison ne réserve aucune cible : il ne produira aucune étape.
 */
function examinerProfil<T extends SystemeOffrantOctroi>(
  profil: Profil,
  parCle: ReadonlyMap<string, T>,
  connus: string,
): readonly AccesExamine<T>[] {
  const visees = new Map<string, { rang: number; libelle: string }>();
  const examines: AccesExamine<T>[] = [];

  for (const [rang, acces] of profil.accesses.entries()) {
    const systeme = parCle.get(acces.system);
    const verdict = verdictDAcces(acces, systeme, connus);
    const motifs = [...verdict.motifs];
    const examen = verdict.examen;

    if (motifs.length === 0 && examen) {
      const cible = `${acces.system}:${examen.cible}`;
      const premiere = visees.get(cible);

      if (premiere) {
        motifs.push(
          `${examen.libelle} vise ce que ${premiere.libelle} vise déjà, déclaré au rang ${premiere.rang} de ce profil : deux accès sur une même cible ne s'ajoutent pas, le second y remplacerait le rôle posé par le premier. À l'exécution, la seconde étape constaterait un autre état que celui qu'elle attend et resterait en écart pour toujours. Ne gardez que le rôle voulu.`,
        );
      } else {
        visees.set(cible, { rang, libelle: examen.libelle });
      }
    }

    examines.push({ rang, acces, systeme, verdict, motifs });
  }

  return examines;
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
  const connus = clesConnues(catalogue);

  const refus: RefusDOctroi[] = [];

  for (const profil of profils) {
    for (const { rang, acces, motifs } of examinerProfil(profil, parCle, connus)) {
      for (const motif of motifs) {
        refus.push({ profil: profil.key, acces: rang, systeme: acces.system, motif });
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
 * C'est la seule lecture d'identités qu'une arrivée fait, et elle ne sert qu'à viser un
 * compte : ce qui est observé ne dit rien de ce qu'il faut donner, et le faire entrer
 * ailleurs dans le plan afficherait un accès existant comme un manque.
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

// ---------------------------------------------------------------------------
// L'assemblage des étapes d'un octroi
// ---------------------------------------------------------------------------

/**
 * Un système du catalogue tel que la construction d'un plan d'arrivée le voit : ce que
 * la vérification de politique lui demande déjà, plus la voie d'octroi résolue et ce
 * que son connecteur propose.
 *
 * `planifier` est synchrone, et ce n'est pas un raccourci : décider des étapes d'un
 * octroi ne lit rien, ni réseau ni base, et le rendre asynchrone rendrait asynchrone
 * un assemblage dont la seule raison d'être est de se prouver sans rien brancher. Un
 * connecteur expose donc la même décision sous deux formes, l'une pour le `plan` de
 * son contrat, l'autre pour ici.
 *
 * Il reçoit le scope tel que `scopeSchema` l'a rendu, jamais autrement, et le sujet
 * complet : c'est sous `handles` que le connecteur trouve, ou ne trouve pas,
 * l'identifiant dont on répond. Une clé absente le fait dégrader en manuel de
 * lui-même, ce qui manque étant une donnée et non un credential.
 *
 * Il doit rendre une étape non automatique porteuse de sa tâche manuelle, critère de
 * complétion compris, et ce critère lui appartient : le socle ne sait pas qu'un octroi
 * GitHub sur un non-membre crée une invitation en attente plutôt qu'une adhésion, et
 * un critère qui exigerait de voir la personne parmi les membres ferait tenir pour
 * refermé un accès pourtant accordé.
 */
export interface SystemeOctroyeur extends SystemeOffrantOctroi {
  capacite: ResolvedCapability;
  planifier: (scope: unknown, sujet: SubjectRef) => readonly PlannedStep[];
}

export interface OctroiCalcule {
  etapes: readonly PlannedStep[];
  /**
   * Non vide, la construction échoue et aucun plan ne s'enregistre : un profil dont un
   * accès ne s'applique pas n'ouvre pas les autres à moitié.
   */
  refus: readonly RefusDOctroi[];
}

const ACTION_OCTROI = "ouvrir-l-acces";

function nommer(sujet: SubjectRef): string {
  return sujet.kind === "person" ? sujet.username : sujet.key;
}

/**
 * Le scope, ramené à un seul niveau de clés.
 *
 * `empreinteDuPlan` filtre les clés de `params` à tous les niveaux : un sous-objet
 * dont les clés ne figurent pas au premier niveau disparaîtrait de l'empreinte, et
 * deux octrois qui ne diffèrent que par lui deviendraient indiscernables. Ce qui n'est
 * pas un scalaire est donc rendu en texte plutôt que laissé imbriqué.
 */
function aplatirScope(scope: unknown): Record<string, unknown> {
  if (typeof scope !== "object" || scope === null || Array.isArray(scope)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(scope).map(([cle, valeur]) => [
      cle,
      valeur === null || typeof valeur !== "object" ? valeur : JSON.stringify(valeur),
    ]),
  );
}

/**
 * Ce qui identifie un octroi dans une clé d'idempotence : son scope, et non son rang
 * dans le profil. Réordonner deux lignes du fichier de politique ne change aucun geste
 * et ne doit donc rendre obsolète aucun brouillon en vol.
 */
function signatureDeScope(scope: unknown): string {
  const plat = aplatirScope(scope);
  return Object.keys(plat)
    .sort()
    .map((cle) => `${cle}=${String(plat[cle])}`)
    .join(",");
}

/**
 * L'étape qu'un octroi produit quand son connecteur n'en propose aucune, faute de voie
 * praticable ou faute de savoir la décrire.
 *
 * Elle est émise malgré tout : une ligne d'arrivée qui manque est précisément le mode
 * de panne que cet outil existe pour éviter, là où une ligne qui dit « à faire à la
 * main, voici la marche à suivre, voici ce qui manque » se traite.
 *
 * Jamais au tier automatique, même quand la capacité y résout : cette étape porte une
 * action que le socle a inventée, et que le connecteur n'a jamais planifiée. La laisser
 * au tier de la capacité ferait appeler son exécution avec un ordre qu'il ne connaît
 * pas, et la ferait compter dans le plafond de masse comme si elle partait toute seule.
 * Le tier `none` se conserve, lui, parce qu'il dit quelque chose de vrai : aucune voie
 * n'existe, pas même manuelle.
 */
function etapeSansVoie(
  systeme: SystemeOctroyeur,
  examen: ExamenDeScope | null,
  scope: unknown,
  sujet: SubjectRef,
): PlannedStep {
  const qui = nommer(sujet);
  const libelle = examen?.libelle ?? `l'accès demandé sur ${systeme.key}`;
  const manque = systeme.capacite.degradedFrom?.missing ?? [];
  const signature = signatureDeScope(scope);

  const pourquoi =
    manque.length > 0
      ? ` Aucune voie automatique n'est praticable, il manque : ${manque.join(", ")}.`
      : " Ce connecteur ne sait pas encore décrire cet octroi de lui-même.";

  return {
    systemKey: systeme.key,
    capability: "grant",
    tier: systeme.capacite.tier === "none" ? "none" : "manual",
    action: ACTION_OCTROI,
    label: `Ouvrir ${libelle} à ${qui}`,
    params: { beneficiaire: qui, ...aplatirScope(scope) },
    riskLevel: examen?.risque ?? "medium",
    expectedState: {},
    idempotencyKey: `${systeme.key}:grant:${qui}${signature.length > 0 ? `:${signature}` : ""}`,
    manual: {
      title: `Ouvrir ${libelle} à ${qui}, à la main`,
      runbook: `${systeme.capacite.runbook}${pourquoi}`,
      doneWhen: `${qui} détient ${libelle}, ou porte une demande d'accès que le système n'attend plus que d'accepter : une demande en attente est un accès accordé, pas un accès en suspens.`,
    },
  };
}

/**
 * Les étapes qu'un profil ouvre, et rien d'autre.
 *
 * Pure et synchrone : tout arrive par paramètre, le profil résolu, le catalogue,
 * l'horloge, et le sujet avec les identifiants dont on répond. Rien n'est lu ici, ni
 * base, ni environnement, ni réseau, si bien qu'un plan d'arrivée se rejoue à
 * l'identique et que son empreinte ne bouge pas d'un calcul à l'autre.
 *
 * Trois règles qu'elle porte seule :
 *
 * - un accès à risque élevé sans échéance fait échouer la **construction**, en nommant
 *   le profil, le système et ce que le rôle ouvre. Refuser à l'exécution laisserait un
 *   plan confirmé que personne ne peut exécuter. La règle regarde le risque du scope
 *   comme celui des étapes émises : un connecteur qui relève le risque de la sienne la
 *   contournerait sinon ;
 * - l'échéance vient de `echeanceDOctroi` et se pose sur l'étape, jamais dans `params` :
 *   absolue et comptée depuis le calcul, elle rendrait sinon tout plan obsolète à la
 *   seconde suivante. Elle écrase ce qu'un connecteur aurait posé, la durée d'un accès
 *   appartenant à la politique et non au système qui l'ouvre ;
 * - `justification` ne se remplit jamais : une `PlannedStep` n'en porte pas, et c'est
 *   la forme la plus forte de la règle. Le profil est la justification, et la déduire
 *   de lui ferait naître la file des accès à justifier déjà pleine de faux.
 *
 * Elle ne regarde aucune identité observée, et c'est l'asymétrie voulue entre les deux
 * sens : un départ écarte l'étape d'une identité douteuse, une arrivée ne le fait pas.
 * Écarter un octroi sur la foi d'une ressemblance priverait quelqu'un d'un accès sans
 * que rien ne le signale, là où un octroi de trop se solde d'un clic sur « déjà
 * présent ».
 */
export function assemblerOctrois(
  profil: Profil,
  catalogue: readonly SystemeOctroyeur[],
  sujet: SubjectRef,
  maintenant: Date,
): OctroiCalcule {
  const parCle = new Map(catalogue.map((systeme) => [systeme.key, systeme]));
  const connus = clesConnues(catalogue);

  const etapes: PlannedStep[] = [];
  const refus: RefusDOctroi[] = [];

  for (const { rang, acces, systeme, verdict, motifs } of examinerProfil(profil, parCle, connus)) {
    const refuser = (motif: string) => {
      refus.push({ profil: profil.key, acces: rang, systeme: acces.system, motif });
    };

    if (motifs.length > 0 || !systeme) {
      for (const motif of motifs) {
        refuser(motif);
      }
      continue;
    }

    const echeance = echeanceDOctroi(acces.expiresInDays, maintenant);
    const proposees =
      systeme.capacite.tier === "none" ? [] : systeme.planifier(verdict.scope, sujet);
    const brutes =
      proposees.length > 0
        ? proposees
        : [etapeSansVoie(systeme, verdict.examen, verdict.scope, sujet)];

    // La règle « un accès élevé porte une échéance » se vérifie aussi sur l'étape émise,
    // et non sur le seul risque du scope : un connecteur qui relève le risque de sa
    // propre étape la contournerait sinon, et l'accès s'ouvrirait sans terme.
    const elevees = echeance === null ? brutes.filter((etape) => etape.riskLevel === "high") : [];

    if (elevees.length > 0) {
      const quoi = verdict.examen?.libelle ?? `l'accès demandé sur ${systeme.key}`;

      for (const etape of elevees) {
        refuser(
          `${quoi} ouvre une étape à risque élevé, « ${etape.label} » : elle exige une échéance, sous expiresInDays. Sans terme, l'accès ne se referme jamais de lui-même.`,
        );
      }
      continue;
    }

    for (const etape of brutes) {
      // L'échéance vient du profil et de lui seul : elle s'écrase et ne se complète pas,
      // de sorte que l'absence de terme dans le profil vaille absence de terme sur
      // l'étape. Sinon, un connecteur déciderait de la durée d'un accès à la place de la
      // politique, en posant lui-même une date que rien n'irait relire.
      const { grantExpiresAt: _posee, ...nue } = etape;
      etapes.push(echeance === null ? nue : { ...nue, grantExpiresAt: echeance });
    }
  }

  // En bloc, et structurellement plutôt que par convention d'appelant : un profil dont
  // un accès ne s'applique pas n'ouvre pas les autres à moitié, et un appelant qui
  // oublierait de regarder `refus` enregistrerait sinon un plan amputé sans le savoir.
  return refus.length > 0 ? { etapes: [], refus } : { etapes, refus };
}
