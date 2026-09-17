// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Masse } from "@/core/plan";
import type { RemiseDeCredential, ResultatDExecution } from "@/lib/execution";

/**
 * Ce qu'un opérateur lit quand un passage vient d'émettre une clé, et ce qu'il ne doit
 * surtout pas trouver ailleurs.
 *
 * Ce bloc est le seul endroit au monde où cette clé existe : le service qui l'a émise
 * n'en garde rien, cette base ne la stocke pas, et le journal ne la verra jamais. Un
 * écran qui la recevrait sans la rendre laisserait derrière lui un jeton vivant, que
 * rien ne révoque, et dont la clé n'a atteint personne.
 *
 * Le formulaire est monté pour de vrai, et l'action est doublée : ce qu'il enverra se
 * lit dans son DOM, et ce qu'il montre vient de ce que l'action a rendu, pas des
 * accessoires qu'on lui a passés.
 */

const { passage } = vi.hoisted(() => ({
  passage: { resultat: undefined as ResultatDExecution | undefined },
}));

vi.mock("./actions", () => ({
  lancerExecution: vi.fn(() => Promise.resolve({ execution: passage.resultat })),
  annulerDossier: vi.fn(() => Promise.resolve(null)),
  cloreDossier: vi.fn(() => Promise.resolve(null)),
  confirmerPlan: vi.fn(() => Promise.resolve(null)),
  pointerEtape: vi.fn(() => Promise.resolve(null)),
  recalculerPlan: vi.fn(() => Promise.resolve(null)),
  validerEtape: vi.fn(() => Promise.resolve(null)),
}));

const { lancerExecution } = await import("./actions");
const { BoutonExecuter } = await import("./Pointage");
const { compteRendu, LIBELLE_LANCEMENT, LIBELLE_REMISE } = await import("./redaction-execution");

const PLAN = "plan-du-depart";
const MASSE: Masse = { executables: 3, seuil: 20, depasse: false };

/** Une clé inventée, et qui ne ressemble à rien de réel : elle n'a qu'à se retrouver. */
const CLE = "fgp_cle_cliente_inventee_pour_ce_test";
const JETON_CHIFFRE = "blob-chiffre-inevente-0123456789abcdef";

function passageQuiRemet(remises: readonly RemiseDeCredential[]): ResultatDExecution {
  return { simulation: false, executees: 1, soldees: 1, echecs: 0, remises };
}

const REMISE: RemiseDeCredential = {
  key: "scalingo:jeton:plan-du-depart",
  label: "Jeton Scalingo pour camille.exemple sur suivi-des-friches",
  aRemettre: CLE,
};

/** Le passage entier, joué par un clic : l'état rendu ne s'injecte pas autrement. */
async function lancer(resultat: ResultatDExecution): Promise<void> {
  passage.resultat = resultat;
  const utilisateur = userEvent.setup();
  render(<BoutonExecuter planId={PLAN} masse={MASSE} raisonDeMasse={null} simulation={false} />);
  await utilisateur.click(screen.getByRole("button", { name: LIBELLE_LANCEMENT.bouton.reel }));
}

/** Ce que le formulaire monté a réellement envoyé à l'action. */
function envoye(): Record<string, FormDataEntryValue> {
  const appels = vi.mocked(lancerExecution).mock.calls;
  return Object.fromEntries(appels[0]?.[1] as FormData);
}

/**
 * Tous les attributs du document, valeurs des champs comprises.
 *
 * React pose `value` en propriété et pas toujours en attribut : les deux se relisent,
 * sans quoi un champ caché porterait la clé sans que ce parcours le voie.
 */
function toutCeQuiNEstPasDuTexte(): string[] {
  return [...document.querySelectorAll("*")].flatMap((element) => [
    ...[...element.attributes].map((attribut) => attribut.value),
    ...(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
      ? [element.value]
      : []),
  ]);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  passage.resultat = undefined;
});

describe("la clé qu'un passage remet, et qui ne se relira jamais", () => {
  it("se lit une fois, dit ce qu'elle coûte si on la perd, et ne se retrouve dans aucun attribut", async () => {
    // Given un passage réel qui n'a rien émis, ce qui est le cas de la quasi-totalité
    // d'entre eux
    // When on lance l'exécution
    await lancer(passageQuiRemet([]));

    // Then le compte rendu se lit, et rien ne parle d'une clé : un bandeau de secret
    // sur un passage qui n'en porte aucun ferait chercher une valeur inexistante
    expect(screen.getByRole("status").textContent).toBe(compteRendu(passageQuiRemet([])));
    expect(screen.queryByText(LIBELLE_REMISE.titre)).toBeNull();
    expect(screen.queryByText(LIBELLE_REMISE.cle)).toBeNull();

    cleanup();
    vi.clearAllMocks();

    // Given un passage qui vient d'émettre un jeton pour quelqu'un, et dont la fiche
    // s'est bien rangée
    // When on lance l'exécution
    await lancer(passageQuiRemet([REMISE]));

    // Then la clé est là, une fois et une seule : deux occurrences, c'est deux endroits
    // à effacer d'une capture d'écran, et un de trop dans un vidage de DOM
    expect(screen.getAllByText(CLE)).toHaveLength(1);
    expect(screen.getByText(LIBELLE_REMISE.cle)).toBeDefined();

    // Then l'écran dit qu'elle ne se lira qu'ici, ce qu'il faut en faire tout de suite,
    // et ce qu'il en coûte de la perdre : réémettre, l'ancien jeton restant vivant
    expect(screen.getByText(LIBELLE_REMISE.unSeulAffichage)).toBeDefined();
    expect(screen.getByText(LIBELLE_REMISE.aRemettre)).toBeDefined();
    expect(screen.getByText(LIBELLE_REMISE.perdue)).toBeDefined();

    // Then il nomme le jeton et l'entrée qui le porte désormais, sans sa clé. Un
    // opérateur qui ne saurait pas lequel des deux jetons il tient dans une réémission
    // ne pourrait plus les distinguer, aucun des deux ne se révoquant
    expect(screen.getByText(REMISE.label)).toBeDefined();
    expect(screen.getByText(LIBELLE_REMISE.registre(REMISE.key))).toBeDefined();

    // Then rien ne dit qu'il manque une fiche, et le jeton chiffré n'est pas rendu :
    // il est rangé, donc cette page n'en est pas la seule copie
    expect(screen.queryByText(LIBELLE_REMISE.echec.titre)).toBeNull();
    expect(screen.queryByText(LIBELLE_REMISE.echec.seuleCopie)).toBeNull();
    expect(screen.queryByText(LIBELLE_REMISE.echec.jeton)).toBeNull();

    // Then ce que le formulaire a envoyé ne porte que le plan : la clé n'est dans
    // aucune valeur que la soumission suivante renverrait, ni que la revalidation
    // rejouerait
    expect(envoye()).toEqual({ planId: PLAN });

    // Then elle n'est dans aucun attribut ni dans aucun champ : ni un `title`, ni un
    // `aria-label`, ni un `href` qui la ferait entrer dans une barre d'adresse, un
    // référent ou un journal de serveur
    for (const valeur of toutCeQuiNEstPasDuTexte()) {
      expect(valeur).not.toContain(CLE);
    }
    expect(window.location.search).toBe("");

    // Then et elle n'est que du texte : aucun champ du document ne la porte, pas même
    // caché
    expect([...document.querySelectorAll("input, textarea")]).toHaveLength(1);
    expect(document.querySelector("input")?.getAttribute("name")).toBe("planId");
  });

  it("remet aussi le jeton chiffré quand sa fiche n'a pas pu s'écrire, parce que la page en est alors la seule copie", async () => {
    // Given un jeton émis là-bas, dont l'écriture de la fiche a échoué ici : il vit,
    // il ne se révoque pas, et rien au monde n'en garde trace hors de cette page
    const echec = "Unique constraint failed on the fields: (`key`)";

    // When on lance l'exécution
    await lancer(passageQuiRemet([{ ...REMISE, echecDeRangement: echec, blob: JETON_CHIFFRE }]));

    // Then la clé se lit comme dans le cas nominal, une fois
    expect(screen.getAllByText(CLE)).toHaveLength(1);
    expect(screen.getByText(LIBELLE_REMISE.unSeulAffichage)).toBeDefined();

    // Then l'échec se lit, avec sa cause, et l'écran ne prétend pas que le jeton aurait
    // échoué : il a bien été émis, et le dire échoué enverrait réémettre par-dessus
    expect(screen.getByText(LIBELLE_REMISE.echec.titre)).toBeDefined();
    expect(screen.getByText(LIBELLE_REMISE.echec.raison(echec)).textContent).toContain(echec);

    // Then le jeton chiffré est rendu avec sa clé, et l'écran dit pourquoi : il n'existe
    // nulle part ailleurs, et sans lui plus rien ne dira qu'un jeton a été émis
    expect(screen.getByText(LIBELLE_REMISE.echec.seuleCopie)).toBeDefined();
    expect(screen.getByText(LIBELLE_REMISE.echec.jeton)).toBeDefined();
    expect(screen.getAllByText(JETON_CHIFFRE)).toHaveLength(1);

    // Then la phrase qui annonce une entrée dans les comptes de service ne se lit pas :
    // elle n'existe pas, et l'y envoyer chercher ferait conclure que rien n'a été émis
    expect(screen.queryByText(LIBELLE_REMISE.registre(REMISE.key))).toBeNull();

    // Then ni la clé ni le jeton ne sont dans un attribut, dans un champ ou dans ce que
    // le formulaire renverra
    expect(envoye()).toEqual({ planId: PLAN });
    for (const valeur of toutCeQuiNEstPasDuTexte()) {
      expect(valeur).not.toContain(CLE);
      expect(valeur).not.toContain(JETON_CHIFFRE);
    }
  });
});
