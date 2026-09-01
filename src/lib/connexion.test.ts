import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthUserShape } from "@/core/identite";

import { deciderConnexion, PROVIDER_ADRESSE, voieDuProvider } from "./connexion";

interface FicheEnBase {
  id: string;
  username: string;
  source: "BETA" | "LOCAL" | "SERVICE";
  usernameFabricated: boolean;
  communicationEmail: string | null;
}

interface DroitEnBase {
  personId: string;
  accessCaseId: string;
  channelEmail: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  etat: "WATCH" | "CANDIDATE" | "CONFIRMED" | "CANCELLED" | "DONE";
}

interface LigneEnBase {
  email: string;
  username: string | null;
}

/**
 * Un dépôt en mémoire plutôt que des doubles par appel : ce qui se joue ici est un
 * enchaînement de lectures dont l'ordre et le recoupement portent la décision, et un
 * `mockResolvedValue` par requête rendrait le scénario vrai par construction.
 */
const base = vi.hoisted(() => ({
  operateurs: [] as string[],
  breakGlass: [] as string[],
  declaresLocaux: [] as string[],
  fiches: [] as FicheEnBase[],
  droits: [] as DroitEnBase[],
  lignes: [] as LigneEnBase[],
}));

vi.mock("@/lib/env", () => ({
  webEnv: {
    get OPERATORS() {
      return base.operateurs;
    },
    get BREAK_GLASS_USERNAMES() {
      return base.breakGlass;
    },
  },
}));

vi.mock("@/lib/policy", () => ({
  policy: () => ({
    scope: { local: base.declaresLocaux.map((username) => ({ username, until: "2099-12-31" })) },
  }),
}));

function ficheDe(personId: string): FicheEnBase {
  const fiche = base.fiches.find((candidate) => candidate.id === personId);
  if (fiche === undefined) {
    throw new Error(`fiche absente du dépôt de test : ${personId}`);
  }
  return fiche;
}

vi.mock("@/lib/db", () => ({
  prisma: {
    person: {
      findMany: ({ where }: { where: { communicationEmail: string } }) =>
        Promise.resolve(
          base.fiches.filter((fiche) => fiche.communicationEmail === where.communicationEmail),
        ),
      findFirst: ({ where }: { where: { username: { in: string[] } } }) =>
        Promise.resolve(
          base.fiches.find((fiche) => where.username.in.includes(fiche.username)) ?? null,
        ),
    },
    caseParticipation: {
      findMany: ({ where }: { where: { channelEmail?: string; personId?: string } }) => {
        const droits = base.droits.filter((droit) =>
          where.channelEmail === undefined
            ? droit.personId === where.personId
            : droit.channelEmail === where.channelEmail,
        );
        return Promise.resolve(
          droits.map((droit) => ({
            expiresAt: droit.expiresAt,
            revokedAt: droit.revokedAt,
            accessCase: { state: droit.etat },
            person: ficheDe(droit.personId),
          })),
        );
      },
    },
    user: {
      findUnique: ({ where }: { where: { email: string } }) => {
        const ligne = base.lignes.find((candidate) => candidate.email === where.email);
        return Promise.resolve(ligne === undefined ? null : { username: ligne.username });
      },
    },
  },
}));

const ESPACE_MEMBRE = "espace-membre-beta-gouv-email";

function dans(jours: number): Date {
  return new Date(Date.now() + jours * 24 * 60 * 60 * 1000);
}

function fiche(champs: Partial<FicheEnBase> & { id: string; username: string }): FicheEnBase {
  return {
    source: "LOCAL",
    usernameFabricated: true,
    communicationEmail: null,
    ...champs,
  };
}

function droit(champs: Partial<DroitEnBase> & { personId: string }): DroitEnBase {
  return {
    accessCaseId: "dos_0000000000000000000000",
    channelEmail: null,
    expiresAt: dans(7),
    revokedAt: null,
    etat: "CONFIRMED",
    ...champs,
  };
}

/** Ce que le paquet passe au contrôle sur la voie par adresse : l'adresse en `email`. */
function parAdresse(adresse: string): AuthUserShape {
  return { id: "cm00000000000000000000000", email: adresse };
}

/** Et sur la voie espace-membre : un username, jamais une adresse. */
function parIdentifiant(username: string): AuthUserShape {
  return { id: username, email: "boite@beta.gouv.fr", username };
}

function decider(provider: string, user: AuthUserShape) {
  return deciderConnexion(voieDuProvider(provider), user);
}

beforeEach(() => {
  base.operateurs = [];
  base.breakGlass = [];
  base.declaresLocaux = [];
  base.fiches = [];
  base.droits = [];
  base.lignes = [];
});

describe("l'identification, ses deux portes et ce qu'elles ne se prêtent jamais", () => {
  it("laisse entrer l'opératrice comme avant, et ne fabrique un opérateur par aucune autre voie", async () => {
    // Given l'équipe transverse telle que l'environnement la nomme, et personne d'autre.
    base.operateurs = ["operatrice.exemple"];
    base.breakGlass = ["secours.exemple"];

    // When l'opératrice demande son lien par son identifiant beta.gouv.
    const operatrice = await decider(ESPACE_MEMBRE, parIdentifiant("operatrice.exemple"));

    // Then rien n'a changé pour elle : elle entre sous son nom, sans fiche, et le journal
    // saura dire par quelle porte.
    expect(operatrice).toEqual({
      accepte: true,
      voie: "ESPACE_MEMBRE",
      username: "operatrice.exemple",
      personId: null,
      viaBreakGlass: false,
    });

    // Then l'accès de secours reste distinct, c'est lui qui nomme l'action au journal.
    await expect(decider(ESPACE_MEMBRE, parIdentifiant("secours.exemple"))).resolves.toMatchObject({
      accepte: true,
      viaBreakGlass: true,
    });

    // Then un membre de l'annuaire que rien ne nomme ici est refusé, et le refus le nomme :
    // sur cette voie la saisie est un identifiant, pas une adresse, personne ne verse
    // l'annuaire de son voisin au journal en le tapant.
    await expect(decider(ESPACE_MEMBRE, parIdentifiant("passante.exemple"))).resolves.toEqual({
      accepte: false,
      voie: "ESPACE_MEMBRE",
      username: "passante.exemple",
      refus: "SANS_FICHE",
    });

    // Given une fiche fabriquée qui porte le nom d'une opératrice et une adresse à elle,
    // avec un droit vivant : le cas que le renommage rendait atteignable.
    base.fiches = [
      fiche({
        id: "per_operatrice",
        username: "operatrice.exemple",
        communicationEmail: "contact@ailleurs.fr",
      }),
    ];
    base.droits = [droit({ personId: "per_operatrice" })];

    // Then la porte se ferme, et du même refus que l'octroi oppose déjà à cet
    // identifiant : les deux bouts d'une même règle tiennent la même phrase, et la
    // sûreté cesse de dépendre de l'ordre dans lequel l'allowlist se remplit. L'état
    // ci-dessus n'est atteignable que par cet ordre-là, l'octroi refusant la fiche et
    // le renommage refusant l'identifiant ; l'accepter revenait à laisser vivre un
    // droit posé la veille de l'entrée d'un nom dans l'environnement.
    const parLAdresse = await decider(PROVIDER_ADRESSE, parAdresse("contact@ailleurs.fr"));
    expect(parLAdresse).toEqual({
      accepte: false,
      voie: "ADRESSE",
      username: null,
      refus: "ALLOWLIST",
    });

    // Then quand la partie locale de l'adresse est elle-même un identifiant d'allowlist,
    // la porte se ferme avant tout le reste. C'est le seul garde-fou qui protège une
    // opératrice qui ne s'est jamais connectée : sa ligne d'utilisateur n'existe pas
    // encore, et la naissance de celle du participant l'enfermerait dehors pour de bon.
    base.fiches = [
      fiche({
        id: "per_homonyme",
        username: "camille.exemple",
        communicationEmail: "secours.exemple@ailleurs.fr",
      }),
    ];
    base.droits = [droit({ personId: "per_homonyme" })];
    await expect(
      decider(PROVIDER_ADRESSE, parAdresse("secours.exemple@ailleurs.fr")),
    ).resolves.toMatchObject({ accepte: false, refus: "ALLOWLIST" });

    // Then un fournisseur qui n'est ni l'un ni l'autre n'ouvre rien : le défaut serait
    // celle des deux voies qu'on aurait écrite en dernier.
    expect(voieDuProvider("credentials")).toBeNull();
    await expect(decider("credentials", parAdresse("contact@ailleurs.fr"))).resolves.toEqual({
      accepte: false,
      voie: null,
      username: null,
      refus: "PROVIDER",
    });
  });

  it("laisse le participant revenir une seconde fois, par sa fiche comme par son canal", async () => {
    // Given une fiche locale modifiable, son adresse déclarée, et un droit vivant.
    base.fiches = [
      fiche({
        id: "per_camille",
        username: "camille.exemple",
        communicationEmail: "camille@exemple.org",
      }),
    ];
    base.droits = [droit({ personId: "per_camille" })];

    // When elle demande son premier lien, aucune ligne d'utilisateur ne porte encore son
    // adresse.
    await expect(decider(PROVIDER_ADRESSE, parAdresse("camille@exemple.org"))).resolves.toEqual({
      accepte: true,
      voie: "ADRESSE",
      username: "camille.exemple",
      personId: "per_camille",
      viaBreakGlass: false,
    });

    // When elle a suivi ce lien : le paquet a créé une ligne d'utilisateur portant son
    // adresse et **sans** identifiant, puisqu'il ne remplit jamais celui-ci après coup.
    base.lignes = [{ email: "camille@exemple.org", username: null }];

    // Then sa deuxième demande reste recevable. C'est la clause qui sépare la bonne
    // formulation de la mauvaise : refuser « toute adresse portée par une ligne
    // d'utilisateur » l'enfermerait dehors pour la ligne qu'elle vient de faire naître.
    await expect(
      decider(PROVIDER_ADRESSE, parAdresse("camille@exemple.org")),
    ).resolves.toMatchObject({ accepte: true, personId: "per_camille" });

    // Then une ligne **munie** d'un identifiant est celle de quelqu'un qui est déjà entré
    // par la voie espace-membre : l'adopter donnerait une session assise sur elle.
    base.lignes = [{ email: "camille@exemple.org", username: "camille.beta" }];
    await expect(
      decider(PROVIDER_ADRESSE, parAdresse("camille@exemple.org")),
    ).resolves.toMatchObject({ accepte: false, refus: "LIGNE_ETRANGERE" });

    // Then une personne que la politique déclare n'entre pas par sa propre adresse : le
    // fichier fait autorité sur sa fiche, que la collecte reconstruit chaque nuit.
    base.lignes = [];
    base.declaresLocaux = ["camille.exemple"];
    await expect(
      decider(PROVIDER_ADRESSE, parAdresse("camille@exemple.org")),
    ).resolves.toMatchObject({ accepte: false, refus: "FICHE_FERMEE" });

    // Given une fiche collectée, dont aucune adresse n'est modifiable ici, et un droit
    // vivant. Son adresse de communication n'ouvre rien : ce serait la porte faible vers
    // quelqu'un qui doit entrer par la forte.
    base.declaresLocaux = [];
    base.fiches = [
      fiche({
        id: "per_lead",
        username: "lead.exemple",
        source: "BETA",
        usernameFabricated: false,
        communicationEmail: "lead@beta.gouv.fr",
      }),
    ];
    base.droits = [droit({ personId: "per_lead" })];
    await expect(decider(PROVIDER_ADRESSE, parAdresse("lead@beta.gouv.fr"))).resolves.toMatchObject(
      { accepte: false, refus: "FICHE_FERMEE" },
    );

    // When un opérateur déclare un canal à l'octroi, parce que la boîte beta.gouv meurt
    // avec le départ. Then c'est ce canal qui ouvre, et une fiche collectée avec.
    base.droits = [droit({ personId: "per_lead", channelEmail: "lead@perso.example" })];
    await expect(decider(PROVIDER_ADRESSE, parAdresse("lead@perso.example"))).resolves.toEqual({
      accepte: true,
      voie: "ADRESSE",
      username: "lead.exemple",
      personId: "per_lead",
      viaBreakGlass: false,
    });

    // When il suit ce lien : la ligne d'utilisateur qui naît porte le **canal**, jamais
    // l'adresse de la fiche, que la collecte réécrit sans condition.
    base.lignes = [{ email: "lead@perso.example", username: null }];

    // Then sa deuxième demande passe encore. C'est le cas qui casse le plus vite une
    // règle indexée sur la seule fiche : elle refuserait dès la deuxième demande la
    // personne pour qui le canal a été inventé.
    await expect(
      decider(PROVIDER_ADRESSE, parAdresse("lead@perso.example")),
    ).resolves.toMatchObject({ accepte: true, personId: "per_lead" });

    // Then une adresse qui désigne deux personnes n'en identifie aucune. Aucun index ne
    // sait l'interdire sur un canal, une même personne portant le même sur deux dossiers.
    base.lignes = [];
    base.fiches = [
      ...base.fiches,
      fiche({ id: "per_autre", username: "autre.exemple", communicationEmail: null }),
    ];
    base.droits = [
      droit({ personId: "per_lead", channelEmail: "equipe@perso.example" }),
      droit({
        personId: "per_autre",
        accessCaseId: "dos_1111111111111111111111",
        channelEmail: "equipe@perso.example",
      }),
    ];
    await expect(
      decider(PROVIDER_ADRESSE, parAdresse("equipe@perso.example")),
    ).resolves.toMatchObject({ accepte: false, refus: "PLURALITE" });

    // Then la même personne sur deux dossiers avec le même canal reste, elle, recevable :
    // c'est le cas normal d'un délégué, et le refus compte des personnes, pas des lignes.
    base.droits = [
      droit({ personId: "per_lead", channelEmail: "equipe@perso.example" }),
      droit({
        personId: "per_lead",
        accessCaseId: "dos_1111111111111111111111",
        channelEmail: "equipe@perso.example",
      }),
    ];
    await expect(
      decider(PROVIDER_ADRESSE, parAdresse("equipe@perso.example")),
    ).resolves.toMatchObject({ accepte: true, personId: "per_lead" });

    // Then une adresse que rien ne désigne ne rend rien de plus qu'une adresse refusée :
    // c'est l'appelant qui rend le même écran aux deux.
    await expect(decider(PROVIDER_ADRESSE, parAdresse("inconnue@example.org"))).resolves.toEqual({
      accepte: false,
      voie: "ADRESSE",
      username: null,
      refus: "INCONNUE",
    });

    // Then aucun nom ne part au journal sur un refus par adresse : l'appel n'est pas
    // authentifié, et qui connaît l'adresse de quelqu'un y écrirait son nom à volonté.
    base.lignes = [{ email: "camille@exemple.org", username: "camille.beta" }];
    base.fiches = [
      fiche({
        id: "per_camille",
        username: "camille.exemple",
        communicationEmail: "camille@exemple.org",
      }),
    ];
    await expect(
      decider(PROVIDER_ADRESSE, parAdresse("camille@exemple.org")),
    ).resolves.toMatchObject({ username: null });
  });

  it("refuse un lien émis avant une révocation et suivi après elle, sur les deux voies", async () => {
    // Given un délégué qui entre par son adresse, avec un droit vivant.
    base.fiches = [
      fiche({
        id: "per_camille",
        username: "camille.exemple",
        communicationEmail: "camille@exemple.org",
      }),
    ];
    base.droits = [droit({ personId: "per_camille" })];

    // When le lien est demandé : l'envoi est autorisé.
    await expect(
      decider(PROVIDER_ADRESSE, parAdresse("camille@exemple.org")),
    ).resolves.toMatchObject({ accepte: true });

    // When le droit est révoqué pendant que le courriel voyage, et que le lien est suivi.
    base.droits = [droit({ personId: "per_camille", revokedAt: new Date() })];

    // Then le retour du lien est refusé, parce que le même contrôle s'exécute aux deux
    // invocations et relit la base les deux fois. Rangé sous la phase d'envoi, il aurait
    // ouvert une session vingt minutes après la révocation.
    await expect(
      decider(PROVIDER_ADRESSE, parAdresse("camille@exemple.org")),
    ).resolves.toMatchObject({ accepte: false, refus: "SANS_DROIT" });

    // Then les quatre morts d'un droit se valent, l'état du dossier compris, et un
    // dossier annulé ferme autant qu'un dossier clos.
    for (const mort of [
      droit({ personId: "per_camille", expiresAt: dans(-1) }),
      droit({ personId: "per_camille", etat: "DONE" }),
      droit({ personId: "per_camille", etat: "CANCELLED" }),
    ]) {
      base.droits = [mort];
      await expect(
        decider(PROVIDER_ADRESSE, parAdresse("camille@exemple.org")),
      ).resolves.toMatchObject({ accepte: false, refus: "SANS_DROIT" });
    }

    // Then un dossier en veille ouvre, lui : ce que l'octroi refuse d'écrire et ce que la
    // lecture accepte ne sont pas la même règle.
    base.droits = [droit({ personId: "per_camille", etat: "WATCH" })];
    await expect(
      decider(PROVIDER_ADRESSE, parAdresse("camille@exemple.org")),
    ).resolves.toMatchObject({ accepte: true });

    // Then un canal meurt avec son droit : l'adresse cesse de désigner qui que ce soit,
    // il n'y a pas de compte dormant à retirer.
    base.fiches = [
      fiche({
        id: "per_lead",
        username: "lead.exemple",
        source: "BETA",
        usernameFabricated: false,
        communicationEmail: "lead@beta.gouv.fr",
      }),
    ];
    base.droits = [
      droit({ personId: "per_lead", channelEmail: "lead@perso.example", revokedAt: new Date() }),
    ];
    await expect(
      decider(PROVIDER_ADRESSE, parAdresse("lead@perso.example")),
    ).resolves.toMatchObject({ accepte: false, refus: "INCONNUE" });

    // Then la voie espace-membre suit la même règle pour qui n'est pas opérateur : sa
    // fiche ouvre tant qu'un droit vit, et pas une seconde de plus.
    base.droits = [droit({ personId: "per_lead" })];
    await expect(decider(ESPACE_MEMBRE, parIdentifiant("lead.exemple"))).resolves.toEqual({
      accepte: true,
      voie: "ESPACE_MEMBRE",
      username: "lead.exemple",
      personId: "per_lead",
      viaBreakGlass: false,
    });

    base.droits = [droit({ personId: "per_lead", etat: "DONE" })];
    await expect(decider(ESPACE_MEMBRE, parIdentifiant("lead.exemple"))).resolves.toEqual({
      accepte: false,
      voie: "ESPACE_MEMBRE",
      username: "lead.exemple",
      refus: "SANS_DROIT",
    });
  });
});
