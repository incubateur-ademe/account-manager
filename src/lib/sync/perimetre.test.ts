import { describe, expect, it } from "vitest";

import { champsCollectes, type PersonneResolue } from "./perimetre";

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
    const champs = champsCollectes(resolue(), MAINTENANT);

    expect(Object.keys(champs).sort()).toEqual([
      "attachment",
      "betaUuid",
      "communicationEmail",
      "fullname",
      "githubLogin",
      "lastSeenAt",
      "missionEnd",
      "primaryEmail",
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

    const champs = champsCollectes(declaree, MAINTENANT);

    expect(champs.startups).toEqual([]);
    expect(champs.attachment).toBe("NONE");
    expect(champs.source).toBe("LOCAL");
  });
});
