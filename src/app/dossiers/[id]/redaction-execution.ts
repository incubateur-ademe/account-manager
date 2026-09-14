import type { ResultatDExecution } from "@/lib/execution";

/**
 * Les phrases du bloc de lancement, sorties de l'écran pour être relues.
 *
 * Rien ne rend cet écran dans les tests, et c'est le bloc qui promet le plus : ce qui
 * part et ce qui ne part pas, ce qui bouge et ce qui ne bouge pas, ce qui ne sera plus
 * revérifié au lancement. Une phrase fausse s'y lit juste avant le clic qui écrit.
 *
 * La règle de rédaction n'est pas celle des commentaires du dépôt : un texte d'écran dit
 * ce qui va se passer, jamais par quel rouage. Le pourquoi reste dans le code, où il est
 * déjà.
 */

function pluriel(nombre: number, singulier: string, pluriel: string): string {
  return nombre > 1 ? pluriel : singulier;
}

export const LIBELLE_LANCEMENT = {
  titre: { simulation: "Lancer une simulation", reel: "Lancer l'exécution" },
  bouton: {
    simulation: "Lancer la simulation",
    reel: "Lancer l'exécution",
    enCours: { simulation: "Simulation…", reel: "Exécution…" },
  },
  simulation: {
    titre: "Rien ne partira",
    description:
      "Les actions ne sont pas autorisées sur ce serveur : ce bouton n'écrira rien sur les systèmes couverts. Seules partent les relectures d'état, et elles ne font que lire. Les étapes prêtes resteront à faire et leur état ne bougera pas ; le journal, lui, dira étape par étape ce qui aurait été appelé.",
  },
  reel: {
    titre: "Les actions sont autorisées",
    description:
      "Ce bouton écrira réellement sur les systèmes couverts, étape par étape. Ce qui se défait le mieux part en premier : si l'exécution s'interrompt, ce qu'elle laisse derrière elle est ce qu'on sait le mieux reprendre.",
  },
  /**
   * Ce qui se lit avant le clic sur les deux serveurs : la vérification part aussi en
   * simulation, et son refus d'écrire sur un état inattendu ne dépend pas non plus de
   * l'autorisation.
   */
  verification:
    "Avant d'agir, l'outil relit l'état de chaque étape que le système concerné sait relire, et ne refait pas ce qui est déjà en place. Tous ne savent pas le faire, et une étape qui ne relève d'aucun système, comme celles qui viennent d'un modèle, n'est relue par personne : c'est à vous de constater qu'une charte est signée ou qu'un poste est rendu. Une étape trouvée déjà en place est terminée sans le moindre appel, sauf si quelqu'un doit la contrôler : elle attend alors ce second regard comme les autres. Une étape dont l'état constaté ne correspond pas à l'état attendu n'est jamais exécutée : redonner un accès déjà ouvert changerait le rôle en place au lieu de ne rien faire.",
  /**
   * Les termes vivent hors de ce que l'outil confronte au lancement, si bien qu'un
   * terme changé depuis ne fera rien refuser. La phrase dit donc quand les lire, et
   * non ce qui les tient hors de la confrontation.
   */
  termes:
    "Ce plan pose des termes. Ils ne seront pas revérifiés au lancement : lisez-les maintenant.",
  masse: {
    aucune:
      "Aucune étape de ce plan ne peut être faite par l'outil lui-même : le lancement s'arrêtera après les relectures d'état qu'il sait faire.",
    /** Le plafond au-delà duquel l'exécution réclame une seconde parole. */
    quelques: (executables: number, seuil: number) =>
      `${executables} ${pluriel(executables, "étape", "étapes")} de ce plan ${pluriel(executables, "porte", "portent")} un geste que l'outil fait lui-même, pour un plafond de ${seuil}.`,
  },
  relecture: (executables: number) =>
    `J'ai relu les ${executables} étapes que cette exécution toucherait, et j'en réponds.`,
} as const;

/**
 * Ce qu'un lancement a fait, dit à celui qui vient de le lancer.
 *
 * Le décompte des étapes terminées ne dit pas comment elles l'ont été hors simulation :
 * il réunit celles que la vérification a trouvées déjà en place et celles qu'un appel
 * vient de faire. Les annoncer toutes « sans appel d'écriture » démentait les appels
 * annoncés dans la même phrase.
 *
 * En simulation, la page n'a rien à montrer d'elle-même : aucune étape prête n'a changé
 * d'état, et sans cette phrase le lancement passerait pour un clic sans effet.
 */
export function compteRendu({
  simulation,
  executees,
  soldees,
  echecs,
}: ResultatDExecution): string {
  const echec = echecs === 0 ? "" : ` ${echecs} ${pluriel(echecs, "étape", "étapes")} en échec.`;

  if (simulation) {
    return `Simulation : rien n'a été écrit. ${soldees} ${pluriel(soldees, "étape terminée", "étapes terminées")} par la vérification, sans aucun appel d'écriture. Les étapes prêtes restent à faire, leur état ne bouge pas, et le journal dit étape par étape ce qui aurait été appelé.${echec}`;
  }

  return `${executees} ${pluriel(executees, "appel parti", "appels partis")} vers les systèmes couverts. ${soldees} ${pluriel(soldees, "étape terminée", "étapes terminées")} en tout, celles que la vérification a trouvées déjà en place comprises.${echec}`;
}
