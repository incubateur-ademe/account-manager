import { fr } from "@codegouvfr/react-dsfr";
import { Badge } from "@codegouvfr/react-dsfr/Badge";

import { autoriseUneRevocation } from "@/core/rapprochement";
import type { OnOffboard } from "@/generated/prisma/enums";
import { DESTIN_AU_DEPART } from "@/ui/severites";
import { TableCustom } from "@/ui/TableCustom";

export interface ObjetDeLaFiche {
  id: string;
  provider: string;
  handle: string;
  libelle: string;
  url: string | null;
  onOffboard: OnOffboard;
  /** Le compte n'est rattaché que par ressemblance : le départ ne touchera pas l'objet. */
  aConfirmer: boolean;
}

/** Les objets des comptes de la personne, ceux d'un compte disparu compris, comme le départ. */
export function objetsDeLaFiche(
  identites: readonly {
    provider: string;
    handle: string;
    matchMethod: string;
    references: readonly {
      id: string;
      onOffboard: OnOffboard;
      resource: { label: string; url: string | null };
    }[];
  }[],
): ObjetDeLaFiche[] {
  return identites.flatMap((identite) =>
    identite.references.map((reference) => ({
      id: reference.id,
      provider: identite.provider,
      handle: identite.handle,
      libelle: reference.resource.label,
      url: reference.resource.url,
      onOffboard: reference.onOffboard,
      aConfirmer: !autoriseUneRevocation(identite.matchMethod),
    })),
  );
}

export function SectionObjetsPossedes({ objets }: { objets: readonly ObjetDeLaFiche[] }) {
  if (objets.length === 0) {
    return null;
  }

  return (
    <section className={fr.cx("fr-mt-4w")}>
      <h2 className={fr.cx("fr-h5")}>Objets possédés</h2>

      <TableCustom
        header={[
          { children: "Objet" },
          { children: "Système" },
          { children: "Compte" },
          { children: "Au départ" },
        ]}
        body={objets.map((objet) => ({
          key: objet.id,
          row: [
            {
              children: objet.url ? (
                <a
                  href={objet.url}
                  target="_blank"
                  rel="noreferrer"
                  title={`${objet.libelle}, nouvelle fenêtre`}
                >
                  {objet.libelle}
                </a>
              ) : (
                objet.libelle
              ),
            },
            { children: objet.provider },
            { children: objet.handle },
            {
              children: objet.aConfirmer ? (
                <Badge severity="info" small noIcon>
                  Rattachement à confirmer
                </Badge>
              ) : (
                <Badge severity={DESTIN_AU_DEPART[objet.onOffboard].severite} small noIcon>
                  {DESTIN_AU_DEPART[objet.onOffboard].libelle}
                </Badge>
              ),
            },
          ],
        }))}
      />
    </section>
  );
}
