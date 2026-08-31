import { afterAll, describe, expect, it, vi } from "vitest";

process.env["DATABASE_URL"] ??= "postgresql://localhost:5432/inutilise";
process.env["ESPACE_MEMBRE_API_KEY"] ??= "inutilisee";
process.env["AUTH_SECRET"] ??= "inutilise";
process.env["SMTP_URL"] ??= "smtp://localhost:1025";
process.env["SMTP_EMAIL_FROM"] ??= "inutilise@example.org";

/**
 * L'inverse du harnais de `dossiers/[id]/actions.test.ts`, qui résout un opérateur :
 * ici la garde refuse, et tout ce qui sortirait du processus échoue en se signalant,
 * la base comme le réseau. C'est ce relevé qui porte la démonstration, une assertion
 * sur le message rendu ne dirait rien de ce qui a été lu pour le rendre.
 */
const barriere = vi.hoisted(() => ({
  REDIRECTION: "NEXT_REDIRECT;replace;/login;307;",
  gardes: [] as string[],
  acces: [] as string[],
}));

vi.mock("@/lib/session", () => ({
  requireOperateur: () => {
    barriere.gardes.push("requireOperateur");
    const erreur = new Error(barriere.REDIRECTION);
    Object.assign(erreur, { digest: barriere.REDIRECTION });
    return Promise.reject(erreur);
  },
  operateurCourant: () => Promise.resolve(null),
}));

vi.mock("@/lib/db", () => ({
  prisma: new Proxy(
    {},
    {
      get(_cible, propriete) {
        const nom = String(propriete);
        barriere.acces.push(`prisma.${nom}`);
        throw new Error(`accès en base interdit sans session : prisma.${nom}`);
      },
    },
  ),
  deconnecter: () => Promise.resolve(),
}));

vi.mock("@/lib/auth", () => ({
  auth: () => Promise.resolve(null),
  handlers: {},
  signIn: () => {
    barriere.acces.push("auth.signIn");
    throw new Error("connexion interdite sans session");
  },
  signOut: () => {
    barriere.acces.push("auth.signOut");
    throw new Error("déconnexion interdite sans session");
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

/**
 * Le réseau est piégé au même titre que la base, et pas seulement l'espace-membre :
 * `fetchMemberDetail` l'interroge par un `fetch` nu que le double de Prisma ne voit
 * pas, et c'est l'oracle d'existence le plus large de tous, sa route n'étant pas
 * restreinte à l'incubateur. Sans ce piège, une action qui réordonne ses lectures
 * ferait un jour partir un appel réel depuis la vérification.
 */
vi.stubGlobal("fetch", (cible: unknown) => {
  const url = cible instanceof Request ? cible.url : String(cible);
  barriere.acces.push(`fetch ${url}`);
  throw new Error(`appel sortant interdit sans session : ${url}`);
});

// Un `fetch` piégé qui survivrait à ce fichier ferait échouer ailleurs des tests qui
// n'ont rien demandé, et le diagnostic pointerait le mauvais fichier. L'isolation par
// défaut de Vitest suffirait aujourd'hui, mais elle est un réglage et non une garantie
// de ce fichier.
afterAll(() => {
  vi.unstubAllGlobals();
});

/**
 * Un module marqué `"use server"` en tête n'exporte que des actions serveur : les
 * énumérer donne le parc du jour, là où une liste écrite à la main se périme au
 * prochain ajout et laisse la nouvelle venue passer sans jamais être jouée.
 *
 * Les pages sont balayées à part, pour leur seul `generateMetadata` : il s'exécute
 * pour son compte et lit le référentiel, quand leur composant, lui, est joué par
 * personne ici. Les mises en page en sont absentes, aucune n'en déclarant, et la
 * racine ne s'importe pas hors du rendu de Next.
 */
// En tête de ligne, et les guillemets comme le point-virgule sont libres : Next accepte
// les deux formes, et un module écrit autrement passerait sans être joué, ce que ce
// balayage existe précisément pour empêcher. L'absence d'indentation est ce qui sépare
// une directive de module d'une directive posée dans une fermeture, laquelle ne porte
// aucun export et n'a donc rien à énumérer.
const MARQUEUR = /^["']use server["'];?\s*$/m;
const SOURCES = import.meta.glob("./**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Readonly<Record<string, string>>;
const MODULES = import.meta.glob("./**/*.{ts,tsx}") as Readonly<
  Record<string, () => Promise<Record<string, unknown>>>
>;

/**
 * `loginAction` est la porte d'entrée : elle doit répondre sans session, et rien n'y
 * est lisible qu'un identifiant déjà fourni. L'action de `src/ui/Deconnexion.tsx` ne
 * s'ajoute pas ici et n'y manque pas : c'est une fermeture posée dans du JSX, aucun
 * export ne la porte, et aucune énumération par les exports ne peut l'atteindre.
 */
const EXEMPTES: ReadonlySet<string> = new Set(["loginAction"]);

const PERSONNE = "camille.exemple";
const STARTUP = "vehicule-partage";
const IDENTITE = "idt_0000000000000000000000";
const RATTACHEMENT = "rat_0000000000000000000000";
const ETAPE = "etp_0000000000000000000000";
const PLAN = "pln_0000000000000000000000";
const DOSSIER = "dos_0000000000000000000000";
const CONSTAT = "UNREGISTERED:github:cexemple";

function champs(valeurs: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [cle, valeur] of Object.entries(valeurs)) {
    formData.set(cle, valeur);
  }
  return formData;
}

/**
 * Les identifiants sont plausibles à dessein, et les champs sont ceux que l'action
 * lit vraiment : c'est le cas où une action sans garde répondrait « existe » plutôt
 * que « introuvable », et donc le seul qui renseigne. Une action absente de cette
 * table est jouée quand même, avec un formulaire vide : depuis que la garde tient la
 * première ligne, elle refuse avant de regarder ce qu'on lui a posté.
 */
const CHARGES: Readonly<Record<string, readonly unknown[]>> = {
  enregistrerRevue: [null, champs({ key: "sauvegardes-ovh" })],
  rattacherIdentite: [null, champs({ id: IDENTITE, cible: PERSONNE })],
  creerFichePourCompte: [null, champs({ id: IDENTITE, nom: "Camille Exemple" })],
  cloreConstat: [null, champs({ dedupKey: CONSTAT, raison: "compte fermé chez OVH" })],
  detacherIdentite: [null, champs({ id: IDENTITE })],
  rattacherAStartup: [
    null,
    champs({ username: PERSONNE, startup: STARTUP, jusquAu: "2099-01-31", motif: "coaching" }),
  ],
  retirerRattachement: [null, champs({ id: RATTACHEMENT })],
  forcerAppartenance: [
    null,
    champs({ username: PERSONNE, sens: "EXCLUDE", raison: "prestation terminée" }),
  ],
  libererAppartenance: [null, champs({ username: PERSONNE })],
  modifierFiche: [
    null,
    champs({ username: PERSONNE, fullname: "Camille Exemple", githubLogin: "cexemple" }),
  ],
  renommerFiche: [null, champs({ username: PERSONNE, nouveau: "camille.exemple.2" })],
  lancerCollecte: [],
  autoriserDatation: [
    null,
    champs({ provider: "ovh", famille: "identites", raison: "purge des comptes de test" }),
  ],
  ouvrirDepart: [null, champs({ username: PERSONNE })],
  ouvrirArrivee: [null, champs({ username: PERSONNE })],
  confirmerPlan: [null, champs({ planId: PLAN, empreinte: "0".repeat(64) })],
  pointerEtape: [null, champs({ etapeId: ETAPE, pointage: "fait", note: "" })],
  validerEtape: [null, champs({ etapeId: ETAPE, verdict: "accepter", note: "" })],
  cloreDossier: [null, champs({ dossierId: DOSSIER })],
  annulerDossier: [null, champs({ dossierId: DOSSIER, motif: "ouvert par erreur" })],
  recalculerPlan: [null, champs({ planId: PLAN })],
  lancerExecution: [null, champs({ planId: PLAN, masse: "confirmee" })],
  basculerAutorisationDesStartups: [null, champs({ moment: "ONBOARDING", autorise: "oui" })],
  ajouterEtapeAuModele: [
    null,
    champs({
      moment: "ONBOARDING",
      proprietaire: "incubateur",
      acteur: "OPERATOR",
      titre: "Ouvrir le compte",
      critere: "le compte répond",
    }),
  ],
  modifierEtapeDuModele: [
    null,
    champs({
      etapeId: ETAPE,
      acteur: "OPERATOR",
      titre: "Ouvrir le compte",
      critere: "le compte répond",
    }),
  ],
  retirerEtapeDuModele: [null, champs({ etapeId: ETAPE })],
  declarerHorsIncubateurEnLot: [
    null,
    champs({ username: PERSONNE, startup: STARTUP, raison: "prestation terminée" }),
  ],
  ouvrirDepartsEnLot: [
    null,
    champs({ username: PERSONNE, startup: STARTUP, raison: "fin de la convention" }),
  ],
  cloreConstatsEnLot: [
    null,
    champs({ username: PERSONNE, startup: STARTUP, raison: "startup arrêtée" }),
  ],
};

interface Jeu {
  nom: string;
  jouer: () => Promise<unknown>;
}

function charger(chemin: string): Promise<Record<string, unknown>> {
  const module = MODULES[chemin];
  if (!module) {
    throw new Error(`module introuvable dans l'énumération : ${chemin}`);
  }
  return module();
}

async function actionsServeur(): Promise<Jeu[]> {
  const fichiers = Object.keys(SOURCES)
    .filter((chemin) => !chemin.endsWith(".test.ts"))
    .filter((chemin) => MARQUEUR.test(SOURCES[chemin] ?? ""))
    .sort();

  const jeux: Jeu[] = [];
  for (const chemin of fichiers) {
    for (const [nom, exporte] of Object.entries(await charger(chemin))) {
      if (typeof exporte !== "function" || EXEMPTES.has(nom)) {
        continue;
      }
      const charge = CHARGES[nom] ?? [null, new FormData()];
      const action = exporte as (...args: readonly unknown[]) => Promise<unknown>;
      jeux.push({ nom, jouer: () => action(...charge) });
    }
  }
  return jeux;
}

async function metadonneesDePage(): Promise<Jeu[]> {
  const pages = Object.keys(MODULES)
    .filter((chemin) => chemin.endsWith("/page.tsx"))
    .sort();

  const jeux: Jeu[] = [];
  for (const chemin of pages) {
    const exporte = (await charger(chemin))["generateMetadata"];
    if (typeof exporte !== "function") {
      continue;
    }
    const metadonnee = exporte as (props: unknown) => Promise<unknown>;
    const route = chemin.replace(/^\.\/app/, "").replace(/\/page\.tsx$/, "");
    jeux.push({
      nom: `generateMetadata ${route}`,
      jouer: () =>
        metadonnee({
          params: Promise.resolve({ username: PERSONNE, ghid: STARTUP, id: DOSSIER }),
          searchParams: Promise.resolve({}),
        }),
    });
  }
  return jeux;
}

type Issue =
  | { sort: "redirige" }
  | { sort: "leve"; message: string }
  | { sort: "rend"; valeur: unknown };

function estRedirection(erreur: unknown): boolean {
  if (!(erreur instanceof Error)) {
    return false;
  }
  const digest = String((erreur as { digest?: unknown }).digest ?? "");
  return erreur.message === barriere.REDIRECTION || digest.startsWith("NEXT_REDIRECT");
}

async function issueDe(jouer: () => Promise<unknown>): Promise<Issue> {
  try {
    return { sort: "rend", valeur: await jouer() };
  } catch (erreur: unknown) {
    if (estRedirection(erreur)) {
      return { sort: "redirige" };
    }
    return { sort: "leve", message: erreur instanceof Error ? erreur.message : String(erreur) };
  }
}

describe("la garde de session tient la première ligne de chaque entrée serveur", () => {
  it("sans session valide, rien ne lit le référentiel ni ne parle", async () => {
    // Given une garde qui refuse, et des doubles de la base et du réseau qui échouent
    // sur tout accès en le consignant,
    const jeux = [...(await actionsServeur()), ...(await metadonneesDePage())];

    // When on joue chaque entrée serveur énumérée, avec des identifiants plausibles,
    const issues = new Map<string, Issue>();
    const lectures = new Map<string, readonly string[]>();
    const gardes = new Map<string, number>();

    for (const jeu of jeux) {
      barriere.gardes.length = 0;
      barriere.acces.length = 0;
      issues.set(jeu.nom, await issueDe(jeu.jouer));
      lectures.set(jeu.nom, [...barriere.acces]);
      gardes.set(jeu.nom, barriere.gardes.length);
    }

    // Then le parc joué vient de l'énumération et non de `CHARGES`, dont chaque clé
    // doit s'y retrouver : une table qui nomme une action que le balayage ne voit
    // plus signale un balayage muet, lequel ferait tout passer en ne jouant rien,
    expect([...gardes.keys()]).toEqual(expect.arrayContaining(Object.keys(CHARGES)));
    expect(jeux.filter((jeu) => jeu.nom.startsWith("generateMetadata")).length).toBeGreaterThan(0);

    // Then chacune est passée par la garde, plutôt que de s'en remettre à
    // `actionTracee` qui l'appelle aussi, mais après avoir répondu,
    expect(Object.fromEntries(gardes)).toEqual(Object.fromEntries(jeux.map((jeu) => [jeu.nom, 1])));

    // Then chacune redirige vers la connexion,
    const parIssue = [...issues].map(([nom, issue]) => [nom, issue.sort] as const);
    expect(Object.fromEntries(parIssue)).toEqual(
      Object.fromEntries(jeux.map((jeu) => [jeu.nom, "redirige"])),
    );

    // Then aucune n'a rien lu, ni en base ni au bout du réseau : c'est la seule
    // assertion qui dise quelque chose de l'ordre, un message rendu ne disant rien de
    // ce qui a été lu pour le rendre,
    const touchees = [...lectures].filter(([, acces]) => acces.length > 0);
    expect(Object.fromEntries(touchees)).toEqual({});

    // Then aucune n'a rendu de message, ni celui d'un identifiant connu ni celui d'un
    // identifiant inconnu : ce sont les deux réponses dont la différence renseigne,
    expect([...issues.values()].filter((issue) => issue.sort === "rend")).toEqual([]);

    // Then et son refus ne vient pas d'un double, qui signalerait une lecture partie
    // avant la garde.
    expect([...issues.values()].filter((issue) => issue.sort === "leve")).toEqual([]);
  });
});
