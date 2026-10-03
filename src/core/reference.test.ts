import { describe, expect, it } from "vitest";

import { etapeDeReference, type ReferenceLue, referencesAgissantes } from "./reference";

function ligne(
  provider: string,
  resourceExternalId: string,
  onOffboard: ReferenceLue["onOffboard"],
  matchMethod = "DECLARED",
): ReferenceLue {
  return {
    provider,
    resourceExternalId,
    resourceLabel: `Objet ${resourceExternalId}`,
    url: `https://exemple.fr/${resourceExternalId}`,
    onOffboard,
    matchMethod,
  };
}

const TEXTE = {
  designation: "le dépôt incubateur-ademe/annuaire",
  runbook: "Donner le rôle Admin au repreneur.",
  repreneur: "Compte du repreneur",
  feminin: false,
};

describe("un objet possédé au départ", () => {
  it("devient une étape à la main par système, seulement quand son destin et son rattachement l'autorisent", () => {
    // Given cinq objets possédés sur deux systèmes : un à garder, un rattaché par
    // ressemblance, un sans adresse et deux qui appellent un geste
    const lignes = [
      ligne("github", "dep-1", "TRANSFER", "GITHUB_LOGIN"),
      ligne("github", "dep-2", "KEEP"),
      ligne("github", "dep-3", "TRANSFER", "HEURISTIC"),
      { ...ligne("notion", "page-1", "ARCHIVE", "EMAIL_EXACT"), url: null },
      ligne("notion", "page-2", "TRANSFER", "NONE"),
    ];

    // When le départ trie ce qui agit
    const parSysteme = referencesAgissantes(lignes);

    // Then un objet gardé ne produit rien, une ressemblance n'ouvre aucun geste, et chaque
    // système ne reçoit que ses objets
    expect([...parSysteme.keys()]).toEqual(["github", "notion"]);
    expect(parSysteme.get("github")).toEqual([
      {
        resourceExternalId: "dep-1",
        resourceLabel: "Objet dep-1",
        url: "https://exemple.fr/dep-1",
        fate: "transfer",
      },
    ]);
    expect(parSysteme.get("notion")).toEqual([
      { resourceExternalId: "page-1", resourceLabel: "Objet page-1", fate: "archive" },
    ]);

    // When le connecteur en fait ses étapes
    const transfert = etapeDeReference("github", parSysteme.get("github")?.[0] ?? never(), TEXTE);
    const archivage = etapeDeReference("notion", parSysteme.get("notion")?.[0] ?? never(), {
      ...TEXTE,
      designation: "la page Feuille de route",
      feminin: true,
    });

    // Then un transfert est à la main, demande son repreneur, et sa clé désigne l'objet et
    // non la personne
    expect(transfert).toMatchObject({
      capability: "reference",
      tier: "manual",
      action: "transferer",
      label: "Transférer le dépôt incubateur-ademe/annuaire",
      params: { objet: "dep-1" },
      idempotencyKey: "github:reference:dep-1",
      manual: {
        deeplink: "https://exemple.fr/dep-1",
        doneWhen:
          "Le dépôt incubateur-ademe/annuaire a un nouveau responsable, et n'a pas été supprimé.",
        saisie: { libelle: "Compte du repreneur", obligatoire: true },
      },
    });

    // Then un archivage ne demande rien, et une page sans adresse n'a pas de lien
    expect(archivage.action).toBe("archiver");
    expect(archivage.manual?.doneWhen).toBe(
      "La page Feuille de route est archivée, et n'a pas été supprimée.",
    );
    expect(archivage.manual).not.toHaveProperty("saisie");
    expect(archivage.manual).not.toHaveProperty("deeplink");
  });
});

function never(): never {
  throw new Error("référence attendue");
}
