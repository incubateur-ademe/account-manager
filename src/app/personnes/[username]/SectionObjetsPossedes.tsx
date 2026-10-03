import { fr } from "@codegouvfr/react-dsfr";
import { Badge } from "@codegouvfr/react-dsfr/Badge";

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
              children: (
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
