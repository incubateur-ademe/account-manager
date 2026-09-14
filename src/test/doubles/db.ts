/**
 * Les doubles de `@/lib/db`, pour ce qu'un harnais doit refuser plutôt que pour ce qu'il
 * rend.
 *
 * Un double de base écrit en objet littéral ne refuse rien. Un modèle qu'il ne déclare pas
 * vaut `undefined`, si bien que la lecture qui l'atteint casse sur « impossible de lire
 * findMany », un message qui nomme la propriété sans dire ce qui l'a demandée ni pourquoi
 * c'est un défaut. Une lecture partie trop tôt ressemble alors à une panne de harnais, et
 * se répare en ajoutant le modèle manquant : le double grossit, et la lecture qu'on voulait
 * interdire devient servie.
 *
 * Les deux fabriques d'ici refusent en se nommant. Elles ne rendent aucune donnée et n'ont
 * pas vocation à en rendre : les projections de chaque harnais sont délibérément
 * différentes, chacune gardant ce que son scénario observe.
 */

/** La surface de `@/lib/db`, telle qu'un `vi.mock` doit la rendre. */
export interface DoubleDeBase {
  prisma: unknown;
  deconnecter: () => Promise<void>;
}

/**
 * Le double d'un harnais qui ne doit rien lire du tout : tout accès lève en nommant le
 * modèle atteint, symboles compris.
 *
 * `relever` sert au scénario qui prouve l'ordre plutôt que le refus. Une assertion sur le
 * message rendu ne dit rien de ce qui a été lu pour le rendre, et c'est le relevé des accès
 * qui porte la démonstration.
 */
export function barriereDeBase(
  options: { raison?: string; relever?: (acces: string) => void } = {},
): DoubleDeBase {
  const raison = options.raison ?? "accès en base interdit";
  return {
    prisma: new Proxy(
      {},
      {
        get(_cible, propriete) {
          const nom = String(propriete);
          options.relever?.(`prisma.${nom}`);
          throw new Error(`${raison} : prisma.${nom}`);
        },
      },
    ),
    deconnecter: () => Promise.resolve(),
  };
}

/**
 * Le double d'un harnais qui lit vraiment : les modèles déclarés passent, et tout autre
 * lève en se nommant.
 *
 * C'est la seule façon qu'un harnais a de dire « ce modèle n'est pas doublé parce que le
 * code ne doit pas le lire ». Un modèle doublé par précaution dit l'inverse : il répond,
 * donc il autorise, et la lecture qu'il sert ne se voit nulle part.
 *
 * Les symboles passent sans être jugés : `then`, `Symbol.toPrimitive` et leurs voisins sont
 * interrogés par le moteur lui-même, sur un objet qu'on attend ou qu'on inspecte, et les
 * refuser ferait échouer des chemins qui ne lisent aucune donnée.
 */
export function doublerBase<T extends object>(modeles: T): DoubleDeBase {
  return {
    prisma: new Proxy(modeles, {
      get(cible, propriete, recepteur) {
        if (typeof propriete === "symbol" || propriete in cible) {
          return Reflect.get(cible, propriete, recepteur);
        }
        throw new Error(`ce harnais ne double pas prisma.${propriete}`);
      },
    }),
    deconnecter: () => Promise.resolve(),
  };
}
