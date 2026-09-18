import type { Page } from "@playwright/test";

/**
 * Ce qu'un écran pèse et de quoi il est fait, mesuré dans le navigateur.
 *
 * Le relevé de `src/cli/releve-ui.ts` lit du code : il sait dire qu'un formulaire existe, pas qu'il
 * occupe un tiers de la page au milieu d'un écran de lecture. Or c'est cette proportion qui tranche
 * les arbitrages de forme, et pas seulement celui de la modale : un tableau de trois lignes qui porte
 * deux boutons chacune, un accordéon déplié par défaut qui pousse le reste sous la ligne de
 * flottaison, une alerte de soixante mots là où une phrase suffirait, un contenu identique répété à
 * chaque ligne. Aucun de ces jugements ne se fait sur du texte source.
 */

export interface Bloc {
  readonly quoi: string;
  readonly hauteur: number;
  readonly partDePage: number;
  readonly detail: string;
}

export interface Anatomie {
  readonly hauteur: number;
  readonly primaires: readonly string[];
  readonly modalesSansChamp: readonly string[];
  readonly modalesBavardes: readonly string[];
  readonly lignesTropHautes: readonly string[];
  readonly colonnesConstantes: number;
  readonly sousLaLigne: number;
  readonly titres: readonly string[];
  readonly blocs: readonly Bloc[];
  readonly interactifs: number;
  readonly repetitions: readonly string[];
  readonly deborde: boolean;
}

export async function anatomieDe(page: Page): Promise<Anatomie> {
  return page.evaluate(() => {
    const hauteurPage = document.body.scrollHeight;
    const part = (h: number) => Math.round((h / Math.max(hauteurPage, 1)) * 100);
    const texteDe = (n: Element) => (n.textContent ?? "").replace(/\s+/gu, " ").trim();

    const blocs: { quoi: string; hauteur: number; partDePage: number; detail: string }[] = [];

    /*
     * Le contenu d'une modale fermée vit dans le document et se mesure comme le reste. Le compter
     * fait voir des blocs que personne n'a sous les yeux : une première version de ce fichier a fait
     * conclure à six formulaires empilés sur /configuration, là où la capture montre un tableau.
     */
    const seVoit = (noeud: Element): boolean => {
      const boite = noeud.closest("dialog");
      if (boite !== null && !boite.hasAttribute("open")) return false;
      /*
       * Un accordéon replié garde son contenu dans le document, sous un fr-collapse que rien
       * n'a déplié. Sa hauteur n'est pas nulle pour autant, donc le mesurer ferait compter ce
       * que personne ne lit tant qu'il n'a pas cliqué.
       */
      const pliant = noeud.closest(".fr-collapse");
      if (pliant !== null && !pliant.classList.contains("fr-collapse--expanded")) return false;
      const rect = noeud.getBoundingClientRect();
      return rect.height > 0 && rect.width > 0;
    };

    for (const formulaire of document.querySelectorAll("form")) {
      if (!seVoit(formulaire)) continue;
      const h = Math.round(formulaire.getBoundingClientRect().height);
      const champs = formulaire.querySelectorAll(
        "input:not([type=hidden]), select, textarea",
      ).length;
      const boutons = formulaire.querySelectorAll("button, [type=submit]").length;
      const aides = formulaire.querySelectorAll(".fr-hint-text").length;
      const mots = texteDe(formulaire).split(" ").length;
      blocs.push({
        quoi: "formulaire",
        hauteur: h,
        partDePage: part(h),
        detail: `${champs} champ(s), ${boutons} bouton(s), ${aides} texte(s) d'aide, ${mots} mots`,
      });
    }

    for (const table of document.querySelectorAll("table")) {
      if (!seVoit(table)) continue;
      const h = Math.round(table.getBoundingClientRect().height);
      const lignes = [...table.querySelectorAll("tbody tr")];
      const colonnes = table.querySelectorAll("thead th").length;
      const interactifsParLigne = lignes.length
        ? Math.round(
            lignes.reduce(
              (n, l) =>
                n + l.querySelectorAll("button, a, input:not([type=hidden]), select").length,
              0,
            ) / lignes.length,
          )
        : 0;
      const hauteurLigne = lignes.length ? Math.round(h / lignes.length) : 0;
      /* Une cellule dont le texte revient à l'identique sur chaque ligne est une consigne répétée. */
      const parColonne: string[][] = [];
      for (const ligne of lignes) {
        [...ligne.querySelectorAll("td")].forEach((cellule, index) => {
          const colonne = parColonne[index] ?? [];
          colonne.push(texteDe(cellule));
          parColonne[index] = colonne;
        });
      }
      const colonnesConstantes = parColonne.filter(
        (valeurs) =>
          valeurs.length > 1 && new Set(valeurs).size === 1 && (valeurs[0] ?? "").length > 20,
      ).length;
      blocs.push({
        quoi: "tableau",
        hauteur: h,
        partDePage: part(h),
        detail: `${lignes.length} ligne(s) de ${hauteurLigne}px, ${colonnes} colonne(s), ${interactifsParLigne} interactif(s) par ligne, ${colonnesConstantes} colonne(s) au contenu identique partout`,
      });
    }

    for (const pliant of document.querySelectorAll(".fr-accordion, details")) {
      if (!seVoit(pliant)) continue;
      const h = Math.round(pliant.getBoundingClientRect().height);
      const ouvert =
        pliant instanceof HTMLDetailsElement
          ? pliant.open
          : pliant.querySelector("[aria-expanded=true]") !== null;
      blocs.push({
        quoi: "pliant",
        hauteur: h,
        partDePage: part(h),
        detail: `${ouvert ? "déplié" : "replié"}, ${texteDe(pliant).split(" ").length} mots`,
      });
    }

    for (const alerte of document.querySelectorAll(".fr-alert, .fr-callout")) {
      if (!seVoit(alerte)) continue;
      const h = Math.round(alerte.getBoundingClientRect().height);
      const mots = texteDe(alerte).split(" ").length;
      blocs.push({
        quoi: alerte.classList.contains("fr-callout") ? "encart" : "alerte",
        hauteur: h,
        partDePage: part(h),
        detail: `${mots} mots : « ${texteDe(alerte).slice(0, 80)} »`,
      });
    }

    /*
     * Une même consigne rendue à plusieurs endroits du même écran. Les cellules de tableau en sont
     * exclues : une valeur qui revient à chaque ligne est ce qu'un tableau fait, et « à faire à la
     * main » répété douze fois dit l'état de douze capacités, pas une consigne recopiée. Le seuil
     * de dix mots écarte de même les libellés d'état, qui tiennent en quatre ou cinq.
     */
    const phrases = new Map<string, number>();
    for (const noeud of document.querySelectorAll("main p, main li, main dd")) {
      if (!seVoit(noeud) || noeud.closest("table") !== null) continue;
      const texte = texteDe(noeud);
      if (texte.split(" ").length < 10) continue;
      phrases.set(texte, (phrases.get(texte) ?? 0) + 1);
    }

    /*
     * Une modale ouverte se mesure ici, et nulle part ailleurs : son contenu vit dans des composants
     * enfants qu'aucune lecture du source ne suit, et ses champs ne se comptent qu'une fois rendus.
     */
    const modalesSansChamp: string[] = [];
    const modalesBavardes: string[] = [];
    for (const boite of document.querySelectorAll("dialog[open]")) {
      const titre = (boite.querySelector("h1,h2,h3")?.textContent ?? "").trim().slice(0, 50);
      const champs = boite.querySelectorAll("input:not([type=hidden]), select, textarea").length;
      const mots = texteDe(boite).split(" ").length;
      if (champs === 0) modalesSansChamp.push(`${titre} (${mots} mots)`);
      else if (mots / champs > 60) {
        modalesBavardes.push(`${titre} (${mots} mots / ${champs} champ(s))`);
      }
    }

    const lignesTropHautes: string[] = [];
    let colonnesConstantes = 0;
    for (const table of document.querySelectorAll("table")) {
      if (!seVoit(table)) continue;
      const lignes = [...table.querySelectorAll("tbody tr")].filter(seVoit);
      if (lignes.length === 0) continue;
      const haute = Math.round(
        lignes.reduce((n, l) => n + l.getBoundingClientRect().height, 0) / lignes.length,
      );
      if (haute > 120) {
        lignesTropHautes.push(
          `${haute}px sur ${lignes.length} ligne(s) : « ${texteDe(table.querySelector("thead") ?? table).slice(0, 60)} »`,
        );
      }
      const parColonne: string[][] = [];
      for (const ligne of lignes) {
        [...ligne.querySelectorAll("td")].forEach((cellule, index) => {
          const colonne = parColonne[index] ?? [];
          colonne.push(texteDe(cellule));
          parColonne[index] = colonne;
        });
      }
      colonnesConstantes += parColonne.filter(
        (v) => v.length > 1 && new Set(v).size === 1 && (v[0] ?? "").length > 20,
      ).length;
    }

    return {
      hauteur: hauteurPage,
      primaires: [...document.querySelectorAll("main .fr-btn")]
        .filter(
          (b) =>
            seVoit(b) &&
            !b.className.includes("fr-btn--secondary") &&
            !b.className.includes("fr-btn--tertiary") &&
            /* Le « ? » du mode aide porte fr-btn sans variante : il déclenche une infobulle,
               il ne fait rien. Le compter en action primaire donnait six primaires par fiche. */
            !b.className.includes("fr-btn--tooltip"),
        )
        .map((b) => `${b.tagName.toLowerCase()} « ${texteDe(b).slice(0, 40)} »`),
      modalesSansChamp,
      modalesBavardes,
      lignesTropHautes,
      colonnesConstantes,
      sousLaLigne: Math.max(0, hauteurPage - window.innerHeight),
      titres: [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map(
        (t) => `${t.tagName.toLowerCase()}  ${texteDe(t).slice(0, 70)}`,
      ),
      blocs,
      interactifs: [
        ...document.querySelectorAll(
          "main button, main a, main input:not([type=hidden]), main select, main textarea",
        ),
      ].filter(seVoit).length,
      repetitions: [...phrases.entries()]
        .filter(([, n]) => n > 1)
        .map(([texte, n]) => `${n}x  ${texte.slice(0, 90)}`),
      deborde: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
}

export function rendreAnatomie(nom: string, chemin: string, a: Anatomie): string[] {
  const lourds = [...a.blocs].sort((x, y) => y.hauteur - x.hauteur).slice(0, 8);
  return [
    `\n## ${nom}  (${chemin})`,
    `${a.hauteur}px de haut, dont ${a.sousLaLigne}px sous la ligne de flottaison. ${a.interactifs} éléments interactifs.`,
    a.deborde ? "**DÉBORDEMENT HORIZONTAL**" : "",
    "",
    "### Titres",
    ...a.titres.map((t) => `  ${t}`),
    a.titres.length === 0 ? "  (aucun)" : "",
    "",
    "### Blocs, du plus haut au plus bas",
    ...lourds.map(
      (b) =>
        `  ${b.quoi.padEnd(11)} ${String(b.hauteur).padStart(5)}px  ${String(b.partDePage).padStart(3)}%  ${b.detail}`,
    ),
    lourds.length === 0 ? "  (aucun)" : "",
    a.repetitions.length > 0 ? "\n### Contenu répété dans l'écran" : "",
    ...a.repetitions.map((r) => `  ${r}`),
  ];
}
