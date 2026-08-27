import { describe, expect, it, vi } from "vitest";

import { REFUS_DE_VAGUE, refusDArrivees } from "@/core/collecte";

import { champsCollectes, noterRefusDArrivees, type PersonneResolue } from "./perimetre";

interface RunEnBase {
  id: string;
  status: string;
  error: unknown;
}

const base = vi.hoisted(() => ({
  runs: [] as RunEnBase[],
  ecritures: [] as { id: string; champs: string[] }[],
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    syncRun: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(base.runs.find((run) => run.id === where.id) ?? null),
      update: ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const run = base.runs.find((candidat) => candidat.id === where.id);
        if (run) {
          run.error = data["error"];
        }
        base.ecritures.push({ id: where.id, champs: Object.keys(data) });
        return Promise.resolve(run);
      },
    },
  },
}));

const MAINTENANT = new Date("2026-08-19T02:00:00Z");

const resolue = (over: Partial<PersonneResolue> = {}): PersonneResolue => ({
  username: "camille.exemple",
  betaUuid: "uuid-1",
  fullname: "Camille Exemple",
  githubLogin: "camille-exemple",
  primaryEmail: "camille.exemple@beta.gouv.fr",
  communicationEmail: "camille.exemple@beta.gouv.fr",
  missionEnd: "2026-09-30",
  attachment: "STARTUPS",
  startups: ["produit-alpha"],
  source: "BETA",
  ...over,
});

/**
 * Garde-fou de régression, et c'est tout son objet : le jour où quelqu'un ajoutera
 * un champ à `Person`, ce test dira si la collecte s'est mise à écraser une
 * décision prise à la main.
 */
describe("ce que la collecte réécrit sur une fiche", () => {
  it("n'écrit rien qui touche à un rattachement manuel", () => {
    const champs = champsCollectes(resolue(), MAINTENANT, false);

    expect(Object.keys(champs).sort()).toEqual([
      "attachment",
      "betaUuid",
      "communicationEmail",
      "fullname",
      "githubLogin",
      "lastSeenAt",
      "missionEnd",
      "primaryEmail",
      "returnedAt",
      "source",
      "startups",
      "usernameFabricated",
      "vanishedAt",
    ]);

    expect(champs.missionEnd).toEqual(new Date("2026-09-30T00:00:00Z"));
    expect(champs.lastSeenAt).toBe(MAINTENANT);
    expect(champs.vanishedAt).toBeNull();
    // La collecte adopte la fiche : l'identifiant cesse d'être une construction
    // locale et redevient un pivot que rien ne renomme.
    expect(champs.usernameFabricated).toBe(false);

    // La même liste, exactement, quand la source qui portait l'échéance n'a pas été
    // lue : `undefined` laisse la clé en place et Prisma n'y touche pas, comme pour le
    // retour plus bas. C'est ce qui fait qu'un champ nouvellement porté par une lecture
    // faillible hérite du silence sans une ligne de plus ici. Un spread conditionnel
    // écrirait la même chose en base et ferait disparaître la clé, donc ce garde-fou
    // avec elle : c'est exactement ce qu'on veut voir.
    const nonLue = champsCollectes(resolue({ missionEnd: undefined }), MAINTENANT, false);
    expect(Object.keys(nonLue).sort()).toEqual(Object.keys(champs).sort());
    expect(nonLue.missionEnd).toBeUndefined();
  });

  it("remet à vide les startups d'une personne déclarée dans la politique", () => {
    // C'est le piège de départ du ticket, gravé ici : un rattachement écrit dans
    // cette colonne disparaîtrait à la première nuit, sans erreur ni trace.
    const declaree = resolue({
      username: "prestataire.exemple",
      betaUuid: null,
      fullname: "prestataire.exemple",
      githubLogin: null,
      primaryEmail: null,
      communicationEmail: null,
      missionEnd: "2027-06-30",
      attachment: "NONE",
      startups: [],
      source: "LOCAL",
    });

    const champs = champsCollectes(declaree, MAINTENANT, false);

    expect(champs.startups).toEqual([]);
    expect(champs.attachment).toBe("NONE");
    expect(champs.source).toBe("LOCAL");
  });

  it("date le retour d'une fiche disparue, et n'en invente aucun sur les autres", () => {
    // La disparition est effacée sans condition par ce même objet : ce passage est
    // donc le dernier instant où le retour peut se dater, d'où le verdict en
    // paramètre. Ce qui vaut retour se décide chez l'appelant, contre le prédicat
    // partagé `autrePassageCompletDepuis`.
    const revenue = champsCollectes(resolue(), MAINTENANT, true);

    expect(revenue.vanishedAt).toBeNull();
    expect(revenue.returnedAt).toBe(MAINTENANT);
    // La première vue, elle, ne se réécrit jamais : elle n'est pas de cette liste.
    expect(Object.keys(revenue)).not.toContain("firstSeenAt");

    // Personne n'est réputé revenu sans être parti, ni sans que son absence ait duré.
    // Une fiche dans ce cas garde la date de son retour précédent, et une fiche que ce
    // passage vient de créer n'en a aucune : elle ne revient de nulle part.
    expect(champsCollectes(resolue(), MAINTENANT, false).returnedAt).toBeUndefined();
  });
});

/**
 * Le refus d'une vague d'arrivées ne bascule pas le statut du run, contrairement à
 * celui des disparitions : un passage qui s'est tu sur les arrivées ressemble donc
 * trait pour trait à un passage qui n'en a trouvé aucune. La phrase laissée dans la
 * trace est sa seule différence, et le tableau de bord n'a qu'elle pour ne pas
 * afficher « rien à acter » là où il faudrait lire « on n'a pas regardé ».
 */
describe("ce qu'un passage laisse quand il refuse une vague d'arrivées", () => {
  const REFUS = `${REFUS_DE_VAGUE} : 30 pour un périmètre de 95, aucune arrivée conclue`;

  it("écrit le refus dans la trace du run, sans toucher au statut ni perdre ce qui y était", async () => {
    base.runs.length = 0;
    base.ecritures.length = 0;
    // Le passage a déjà noté un système muet et un refus de datation : la trace n'est
    // pas vierge, elle porte deux natures d'incident, et un refus qui la remplacerait
    // en ferait disparaître une au profit de l'autre.
    base.runs.push({
      id: "run-1",
      status: "OK",
      error: {
        messages: ["notion non lu : credential absent"],
        refus: [{ famille: "identites", reference: 208, observe: 3 }],
      },
    });

    await noterRefusDArrivees("run-1", REFUS);

    const trace = base.runs[0];
    expect(trace?.error).toEqual({
      messages: ["notion non lu : credential absent", REFUS],
      refus: [{ famille: "identites", reference: 208, observe: 3 }],
    });
    // Le statut reste celui qu'il était : un refus d'arrivées n'est pas un échec de
    // collecte, il dit seulement qu'une conclusion a été retenue.
    expect(trace?.status).toBe("OK");
    expect(base.ecritures).toEqual([{ id: "run-1", champs: ["error"] }]);

    // Et c'est bien cette trace que l'écran relit pour ne pas annoncer « rien à
    // acter » sur un passage qui n'a rien regardé.
    expect(refusDArrivees(trace?.error)).toBe(true);
  });

  it("ne dit rien d'un passage ordinaire, ni d'une trace d'une autre nature", async () => {
    base.runs.length = 0;
    base.ecritures.length = 0;
    base.runs.push({ id: "run-2", status: "OK", error: null });

    // Une collecte qui a conclu ne laisse rien : la relecture doit alors dire non, et
    // le tableau de bord affiche son compte d'arrivées sans réserve.
    expect(refusDArrivees(null)).toBe(false);
    expect(refusDArrivees({ messages: ["github FAILED : 502"] })).toBe(false);
    // Le refus de datation des disparitions vit dans la même colonne, sous une autre
    // forme : le confondre avec celui des arrivées ferait taire un compte juste.
    expect(refusDArrivees({ refus: [{ famille: "identites", reference: 208, observe: 3 }] })).toBe(
      false,
    );

    // Un run qui n'existe plus n'invente pas de trace : la collecte se poursuit, elle
    // n'échoue pas sur une écriture de compte rendu.
    await noterRefusDArrivees("run-inconnu", REFUS);

    expect(base.ecritures).toEqual([]);
    expect(base.runs[0]?.error).toBeNull();
  });
});
