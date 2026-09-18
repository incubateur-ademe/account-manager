import { describe, expect, it } from "vitest";

import { MESURES, sourceDeTest } from "./releve-ui";

/**
 * Ce que le relevé doit voir, et ce qu'il doit laisser passer.
 *
 * Il bloque `pnpm verify`, donc une mesure trop large arrête tout le monde sur un cas légitime et
 * finit désactivée, et une mesure trop étroite affiche un zéro qui ne prouve rien. Sept l'ont déjà
 * été, chacune découverte en la confrontant à du code réel : ces scénarios tiennent les exclusions
 * qui ont coûté le plus cher à trouver.
 *
 * Les cas sont écrits à la main plutôt que lus sur le disque : un test qui mesure le dépôt
 * changerait de verdict à chaque écran ajouté, et ne dirait plus ce que la mesure sait faire.
 */

function compter(id: string, chemin: string, contenu: string): number {
  const mesure = MESURES.find((une) => une.id === id);
  if (mesure === undefined) throw new Error(`Mesure inconnue : ${id}`);
  return mesure.compter([sourceDeTest(chemin, contenu)]).valeur;
}

const ECRAN = "src/app/personnes/page.tsx";

describe("ce que le relevé compte, et ce qu'il refuse de compter", () => {
  it("voit le défaut visé sous chacune des formes que le dépôt écrit", () => {
    // Given un titre injecté par un composant DSFR qui ne déclare pas son niveau.
    expect(compter("titres-injectes-sans-niveau", ECRAN, `<Alert title="X" />`)).toBe(1);
    expect(compter("titres-injectes-sans-niveau", ECRAN, `<Alert as="h2" title="X" />`)).toBe(0);

    // Then une prop posée sur sa propre ligne compte autant qu'une prop en ligne : le formateur du
    // dépôt coupe au-delà de cent caractères, et une mesure qui lit la ligne raterait tout ce qu'il
    // a reformaté.
    expect(compter("titres-injectes-sans-niveau", ECRAN, `<Alert\n  title="X"\n/>`)).toBe(1);
    expect(
      compter("titres-injectes-sans-niveau", ECRAN, `<Alert\n  as="h3"\n  title="X"\n/>`),
    ).toBe(0);

    // Then un Accordion pose le sien par son label. Ne lire que la prop title laissait ce h3
    // s'injecter sans que le plafond zéro le voie.
    expect(compter("titres-injectes-sans-niveau", ECRAN, `<Accordion label="X" />`)).toBe(1);
    expect(
      compter("titres-injectes-sans-niveau", ECRAN, `<Accordion titleAs="h2" label="X" />`),
    ).toBe(0);

    // Then une modale laisse son titre en h1 tant qu'elle ne dit rien.
    expect(compter("titres-de-modale-en-h1", ECRAN, `<modale.Component title="X">`)).toBe(1);
    expect(
      compter("titres-de-modale-en-h1", ECRAN, `<modale.Component titleAs="h2" title="X">`),
    ).toBe(0);

    // Then un bouton sans priorité déclarée est rendu primaire par react-dsfr.
    expect(
      compter("boutons-de-priorite-implicite", ECRAN, `<Button type="submit">Régler</Button>`),
    ).toBe(1);
    expect(
      compter("boutons-de-priorite-implicite", ECRAN, `<Button priority="secondary">X</Button>`),
    ).toBe(0);
  });

  it("ne compte pas les textes qu'aucun opérateur ne lit", () => {
    // Given la règle du dépôt, qui veut le POURQUOI en commentaire : mieux le code est documenté,
    // plus une mesure naïve gonfle.
    const commentaire = `// Une phrase de commentaire : elle explique un choix, et personne ne la lit à l'écran.`;
    expect(compter("deux-points-explicatifs", ECRAN, commentaire)).toBe(0);

    // Then un commentaire posé ENTRE deux balises non plus. Le fragment de texte nu court d'un « > »
    // au « < » suivant, donc il traverse le code écrit entre deux cellules d'un tableau.
    const entreDeuxCellules = `<td>Valeur</td>\n{/* un commentaire : posé là */}\n<td>Autre</td>`;
    expect(compter("deux-points-explicatifs", ECRAN, entreDeuxCellules)).toBe(0);

    // Then une description de schéma Zod documente le fichier de politique, jamais un écran.
    const schema = `.meta({\n  description:\n    "Les accès que ce profil ouvre : un profil sans accès reste licite.",\n})`;
    expect(compter("deux-points-explicatifs", "src/core/policy.ts", schema)).toBe(0);

    // Then le texte rendu, lui, se compte, qu'il soit dans un littéral ou nu entre deux balises.
    expect(
      compter("deux-points-explicatifs", ECRAN, `<p>Aucune collecte : la liste est vide.</p>`),
    ).toBe(1);
    expect(
      compter("deux-points-explicatifs", ECRAN, `title="Aucune collecte : la liste est vide."`),
    ).toBe(1);
  });

  it("sépare l'affirmation de la clause qui revient dessus", () => {
    // Given deux phrases qui disent la même chose, dont une seule se reprend après coup.
    const affirme = `<p>Cette liste ne dit rien des accès réels.</p>`;
    const seReprend = `<p>Cette liste est vide, ce qui ne dit rien des accès réels.</p>`;

    // Then seule la seconde est un défaut : compter la première punirait la réécriture qu'on
    // demande, et la mesure se ferait désactiver par qui la corrige.
    expect(compter("clauses-de-nuance", ECRAN, affirme)).toBe(0);
    expect(compter("clauses-de-nuance", ECRAN, seReprend)).toBe(1);
  });

  it("laisse passer les cas légitimes qui feraient désactiver la mesure", () => {
    // Given un contrôle désactivé le temps d'une soumission, et un autre sans raison.
    expect(compter("controles-desactives", ECRAN, `<Button disabled={enCours}>X</Button>`)).toBe(0);
    expect(
      compter("controles-desactives", ECRAN, `<Button disabled={envoiEnCours}>X</Button>`),
    ).toBe(0);
    expect(compter("controles-desactives", ECRAN, `<Button disabled={!possible}>X</Button>`)).toBe(
      1,
    );

    // Then aria-disabled marque une borne de pagination, pas un contrôle grisé.
    expect(compter("controles-desactives", ECRAN, `<span aria-disabled="true">1</span>`)).toBe(0);

    // Then un texte d'aide sous un label emploie la même classe qu'une valeur absente, et seule la
    // longueur les sépare : une absence se dit en un mot, une consigne en une phrase.
    const valeurAbsente = `<span className={fr.cx("fr-hint-text")}>inconnue</span>`;
    const texteDAide = `<span className={fr.cx("fr-hint-text")}>Ce que ce compte fait, en une phrase courte</span>`;
    expect(compter("valeur-absente-ecrite-a-la-main", ECRAN, valeurAbsente)).toBe(1);
    expect(compter("valeur-absente-ecrite-a-la-main", ECRAN, texteDAide)).toBe(0);

    // Then un libellé d'attente qui nomme son geste est ce qu'on demande ; seul le générique compte,
    // sans quoi la mesure monterait à chaque geste nommé.
    expect(compter("libelles-d-attente-muets", ECRAN, `{pending ? "Clôture…" : "Clore"}`)).toBe(0);
    expect(compter("libelles-d-attente-muets", ECRAN, `{pending ? "En cours…" : "Clore"}`)).toBe(1);
  });

  it("n'exige un titre d'onglet que là où un écran se rend, et le lie à sa déclaration", () => {
    // Given une route qui se termine par un refus : elle ne rend aucun écran.
    const refus = `export default async function Page(): Promise<never> {\n  notFound();\n}`;
    expect(compter("ecrans-sans-titre-d-onglet", "src/app/moi/[...reste]/page.tsx", refus)).toBe(0);

    // Then un écran sans metadata en manque un.
    expect(compter("ecrans-sans-titre-d-onglet", ECRAN, `export default function Page() {}`)).toBe(
      1,
    );

    // Then un objet metadata sans champ title laisse l'onglet muet tout autant.
    const sansTitre = `export const metadata: Metadata = { description: "x" };`;
    expect(compter("ecrans-sans-titre-d-onglet", ECRAN, sansTitre)).toBe(1);

    // Then un title: posé AVANT la déclaration, dans un autre objet, ne la nomme pas pour autant.
    const ailleurs = `const colonnes = [{ title: "Nom" }];\nexport const metadata: Metadata = { description: "x" };`;
    expect(compter("ecrans-sans-titre-d-onglet", ECRAN, ailleurs)).toBe(1);

    // Then une metadata qui porte son titre suffit.
    const avecTitre = `export const metadata: Metadata = { title: "Personnes suivies" };`;
    expect(compter("ecrans-sans-titre-d-onglet", ECRAN, avecTitre)).toBe(0);
  });

  it("voit un saut de hiérarchie à travers les fichiers, pas seulement dans la page", () => {
    const mesure = MESURES.find((une) => une.id === "sauts-de-niveau-de-titre");
    if (mesure === undefined) throw new Error("mesure absente");

    // Given une page dont le h1 est chez elle et le titre suivant chez un composant qu'elle monte.
    const page = sourceDeTest(
      "src/app/collectes/page.tsx",
      `import { GardeFou } from "./GardeFou";\nexport default function Page() {\n  return <main><h1>Collectes</h1><GardeFou /></main>;\n}`,
    );
    const enfant = sourceDeTest("src/app/collectes/GardeFou.tsx", `<Alert title="Bloqué" />`);

    // Then le saut se voit, alors qu'aucun des deux fichiers pris seul ne le montre : c'est le défaut
    // qu'une première version ratait, et son zéro passait pour une garantie.
    expect(mesure.compter([page, enfant]).valeur).toBe(1);

    // Then le site rapporté tient debout des deux côtés : la page et la ligne où le composant est
    // monté, puis dans l'extrait le fichier et la ligne où le titre est écrit. Croiser les deux
    // donnait une ligne qui n'existe pas dans le fichier nommé.
    const [saut] = mesure.compter([page, enfant]).sites;
    expect(saut?.chemin).toBe("src/app/collectes/page.tsx");
    expect(saut?.ligne).toBe(3);
    expect(saut?.extrait).toBe("h1 puis h3, titre écrit dans src/app/collectes/GardeFou.tsx:1");

    // Then il disparaît dès que l'enfant déclare le bon niveau.
    const corrige = sourceDeTest(
      "src/app/collectes/GardeFou.tsx",
      `<Alert as="h2" title="Bloqué" />`,
    );
    expect(mesure.compter([page, corrige]).valeur).toBe(0);

    // Then deux balises rigoureusement identiques gardent chacune sa place. Retrouver leur position
    // en cherchant leur texte donnait la première aux deux, l'ordre de lecture devenait faux et le
    // saut qui suivait la seconde disparaissait du compteur.
    const jumelles = sourceDeTest(
      "src/app/collectes/page.tsx",
      `export default function Page() {\n  return <main>\n    <h1>Collectes</h1>\n    <Alert as="h2" title="X" />\n    <h3>Détail</h3>\n    <Alert as="h2" title="X" />\n    <h4>Reste</h4>\n  </main>;\n}`,
    );
    expect(mesure.compter([jumelles]).valeur).toBe(1);

    // Then un export enveloppé garde ses titres. Sa déclaration ne porte aucun JSX, son corps vit
    // dans l'argument que rien ne monte en balise, et borner la lecture à cette ligne coupait
    // l'écran de son titre sans qu'aucun compteur ne bouge. C'est la forme des frontières d'erreur
    // de Next, donc chaque nouvelle serait née muette.
    const frontiere = sourceDeTest(
      "src/app/collectes/Frontiere.tsx",
      `function Repli() {\n  return <Alert as="h4" title="Panne" />;\n}\nexport const Frontiere = catchError(Repli);`,
    );
    const pageAFrontiere = sourceDeTest(
      "src/app/collectes/page.tsx",
      `import { Frontiere } from "./Frontiere";\nexport default function Page() {\n  return <main><h1>Collectes</h1><Frontiere /></main>;\n}`,
    );
    expect(mesure.compter([pageAFrontiere, frontiere]).valeur).toBe(1);

    // Then un composant monté deux fois rend ses titres deux fois, et son second montage peut créer
    // un saut. Ne retenir que le premier montage insérait ici un h2 de moins, et le saut de h2 à h4
    // disparaissait du compteur.
    const bloc = sourceDeTest(
      "src/app/collectes/Bloc.tsx",
      `export function Bloc() {\n  return <Alert as="h2" title="Bloc" />;\n}`,
    );
    const monteDeuxFois = sourceDeTest(
      "src/app/collectes/page.tsx",
      `import { Bloc } from "./Bloc";\nexport default function Page() {\n  return <main><h1>Collectes</h1><Bloc /><h3>Détail</h3><Bloc /><h4>Reste</h4></main>;\n}`,
    );
    expect(mesure.compter([monteDeuxFois, bloc]).valeur).toBe(1);

    // Then le même second montage ne crée rien quand il tombe au bon endroit. Ce qui se mesure est
    // la place du titre dans l'ordre de lecture, jamais le nombre de montages.
    const monteDeuxFoisSansSaut = sourceDeTest(
      "src/app/collectes/page.tsx",
      `import { Bloc } from "./Bloc";\nexport default function Page() {\n  return <main><h1>Collectes</h1><Bloc /><h3>Détail</h3><Bloc /><h3>Reste</h3></main>;\n}`,
    );
    expect(mesure.compter([monteDeuxFoisSansSaut, bloc]).valeur).toBe(0);

    // Then un symbole monté ne rend que SES titres, et non ceux de ses voisins de fichier. Donner à
    // chaque symbole les titres de tout son fichier faisait hériter au bouton de recalcul les
    // titres que seul le pointage atteint, et ces titres fantômes comblaient un vrai saut.
    const voisinsDeFichier = sourceDeTest(
      "src/app/collectes/Pointage.tsx",
      `export function BoutonRecalculer() {\n  return <Button priority="secondary">Recalculer</Button>;\n}\n\nexport function Pointage() {\n  return <Alert title="Remises" />;\n}`,
    );
    const monteLeBouton = sourceDeTest(
      "src/app/collectes/page.tsx",
      `import { BoutonRecalculer } from "./Pointage";\nexport default function Page() {\n  return <main><h1>Collectes</h1><h2>Détail</h2><BoutonRecalculer /><h4>Reste</h4></main>;\n}`,
    );
    expect(mesure.compter([monteLeBouton, voisinsDeFichier]).valeur).toBe(1);

    // Then un corps monte aussi des composants déclarés plus bas dans son propre fichier, sans les
    // importer. Ne suivre que les imports rendait la borne par symbole aveugle aux trois Alert que
    // Remises n'atteint qu'à travers Remise.
    const voisinLocal = sourceDeTest(
      "src/app/collectes/Remises.tsx",
      `function Remise() {\n  return <Alert title="Remise" />;\n}\n\nexport function Remises() {\n  return <Remise />;\n}`,
    );
    const pageDesRemises = sourceDeTest(
      "src/app/collectes/page.tsx",
      `import { Remises } from "./Remises";\nexport default function Page() {\n  return <main><h1>Collectes</h1><Remises /></main>;\n}`,
    );
    expect(mesure.compter([pageDesRemises, voisinLocal]).valeur).toBe(1);

    // Then un montage se situe à sa propre balise, et non à celle d'un composant dont le nom
    // commence pareil.
    const voisin = sourceDeTest(
      "src/app/collectes/page.tsx",
      `import { GardeFou } from "./GardeFou";\nexport default function Page() {\n  return <main><GardeFouEnTete /><h1>Collectes</h1><GardeFou /></main>;\n}`,
    );
    expect(mesure.compter([voisin, enfant]).valeur).toBe(1);
  });

  it("distingue un refus qui étiquette d'un refus qui dit ce qui s'est passé", () => {
    const ACTION = "src/app/constats/actions.ts";

    // Given les deux formes qu'un même refus prenait dans ce dépôt.
    expect(
      compter("refus-en-forme-d-etiquette", ACTION, `return { erreur: "Constat introuvable." };`),
    ).toBe(1);
    expect(
      compter(
        "refus-en-forme-d-etiquette",
        ACTION,
        `return { erreur: "Aucun constat n'a été choisi. Rechargez la page." };`,
      ),
    ).toBe(0);

    // Then le mot seul ne condamne pas : celui qui dit la suite passe, et c'est la forme
    // qu'on demande. Compter le mot ferait de la mesure un interdit de vocabulaire.
    expect(
      compter(
        "refus-en-forme-d-etiquette",
        ACTION,
        `return { erreur: "Acteur inconnu. Dites qui doit faire cette étape." };`,
      ),
    ).toBe(0);

    // Then une étiquette plus longue que quatre mots se voit quand même, la longueur seule
    // ne séparant pas « Sens de la décision non reconnu » d'une vraie phrase.
    expect(
      compter(
        "refus-en-forme-d-etiquette",
        ACTION,
        `return { erreur: "Sens de la décision non reconnu." };`,
      ),
    ).toBe(1);
  });

  it("ne lit comme refus que ce qui en est un", () => {
    const VERDICT = "src/core/derogation.ts";

    // Given un verdict, dont le motif vit sous `raison` et non sous `erreur`.
    const surDeuxLignes = `return {\n  possible: false,\n  raison: "Tolérance introuvable.",\n};`;
    expect(compter("refus-en-forme-d-etiquette", VERDICT, surDeuxLignes)).toBe(1);

    // Then `raison` sert aussi de libellé de champ et de code machine. Les lire comme des
    // refus ferait monter la mesure sur du texte qu'aucun refus n'affiche.
    // Then une propriété intercalée entre le verdict et sa raison ne rend pas le refus invisible :
    // c'est l'objet qui fait l'unité, pas la ligne.
    const intercale = `return {\n  possible: false,\n  cible: null,\n  raison: "Plan introuvable.",\n};`;
    expect(compter("refus-en-forme-d-etiquette", VERDICT, intercale)).toBe(1);

    // Then l'ordre des propriétés non plus.
    const inverse = `return {\n  raison: "Plan introuvable.",\n  possible: false,\n};`;
    expect(compter("refus-en-forme-d-etiquette", VERDICT, inverse)).toBe(1);

    /*
     * Les deux exclusions se prouvent sur des textes que la mesure compterait si elle les voyait.
     * Une forme qu'elle écarte de toute façon, trop courte ou trop peu bavarde, rendrait zéro sans
     * rien dire de l'exclusion visée.
     */
    const libelle = `const champ = { raison: "Constat introuvable." };`;
    expect(compter("refus-en-forme-d-etiquette", "src/app/dossiers/redaction.ts", libelle)).toBe(0);

    // Then un code machine reste hors du compte jusque DANS un verdict, où l'appartenance ne le
    // sauve pas : ce n'est pas une phrase.
    const machine = `return { possible: false, raison: "non-lu" };`;
    expect(compter("refus-en-forme-d-etiquette", "src/core/collecte.ts", machine)).toBe(0);
  });

  it("n'exonère que la ligne qui emploie un composant, jamais le fichier entier", () => {
    // Given un fichier qui emploie CallOut et qui, ailleurs, en réécrit la classe à la main.
    const melange = `<CallOut title="X">y</CallOut>\n<div className={fr.cx("fr-callout")}>z</div>`;

    // Then la seconde ligne compte. Exonérer le fichier entier masquait une pagination réécrite à la
    // main dans un fichier qui s'appelait Pagination.tsx.
    expect(compter("composants-dsfr-reecrits-a-la-main", "src/ui/X.tsx", melange)).toBe(1);
  });
});
