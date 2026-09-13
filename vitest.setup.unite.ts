import { afterEach, beforeEach, expect } from "vitest";

/**
 * Une plainte de React fait échouer le test qui l'a provoquée.
 *
 * Sans ça, un écran peut crier et passer quand même. C'est arrivé : cinq tests de
 * composants ont été écrits sur les files de travail, tous verts, pendant que React
 * répétait « In HTML, `<p>` cannot be a descendant of `<p>`. This will cause a
 * hydration error. » Le badge du système de design rend lui-même un `p`, et il vivait
 * dans un autre depuis toujours. L'écran se rendait côté serveur puis mourait au
 * réveil, et aucune assertion ne pouvait le voir : le défaut n'est pas dans ce qui est
 * rendu, il est dans le fait que le navigateur refuse de reprendre la main dessus.
 *
 * Le message est la seule trace, et le laisser passer revient à s'interdire de voir
 * toute une famille de défauts.
 *
 * Les plaintes se mettent de côté et se vérifient à la fin du scénario, plutôt que de
 * lever sur place : React appelle `console.error` depuis son propre rattrapage
 * d'erreurs, qui avale ce qu'on y jetterait, et le test passerait au vert en affichant
 * l'échec. Une plainte arrive de toute façon après la ligne qui l'a causée.
 *
 * Posé ici plutôt que dans chaque fichier de composant : une règle qu'on applique au
 * cas par cas est une règle qu'on oublie, et c'est le fichier neuf, écrit par quelqu'un
 * qui découvre l'écran, qui en a le plus besoin.
 */

const crier = console.error;
let plaintes: string[] = [];

console.error = (...arguments_: readonly unknown[]): void => {
  crier(...arguments_);
  plaintes.push(arguments_.map((part) => String(part)).join(" "));
};

beforeEach(() => {
  plaintes = [];
});

afterEach(() => {
  const dites = plaintes;
  plaintes = [];
  expect(dites, "React s'est plaint pendant ce test, et une plainte est un défaut").toEqual([]);
});
