import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Badge } from "@codegouvfr/react-dsfr/Badge";

import type { MatchMethod } from "@/generated/prisma/enums";
import { TableCustom } from "@/ui/TableCustom";

import { Detacher } from "./Detacher";
import { dateFr, RATTACHEMENT_IDENTITE } from "./libelles";

export interface CompteExterne {
  id: string;
  provider: string;
  handle: string;
  matchMethod: MatchMethod;
  lastSeenAt: Date;
  vanishedAt: Date | null;
}

export function SectionComptesExternes({
  comptes,
  systemesCollectes,
}: {
  comptes: readonly CompteExterne[];
  systemesCollectes: readonly string[];
}) {
  return (
    <section className={fr.cx("fr-mt-4w")}>
      <h2 className={fr.cx("fr-h5")}>Comptes externes</h2>

      {comptes.length === 0 ? (
        <Alert
          severity="info"
          small
          description={
            systemesCollectes.length === 0
              ? "Aucun connecteur n'a encore lu de système cible. Cette liste est vide faute d'observation, ce qui ne dit rien des accès réellement détenus."
              : `Aucun compte ne lui est rattaché sur les systèmes déjà collectés (${systemesCollectes.join(", ")}). Tout système absent de cette liste n'a jamais été lu : son état reste inconnu.`
          }
        />
      ) : (
        <>
          <TableCustom
            header={[
              { children: "Système" },
              { children: "Compte" },
              { children: "Rattachement" },
              { children: "Vu pour la dernière fois" },
              { children: "" },
            ]}
            body={comptes.map((identite) => {
              const methode = RATTACHEMENT_IDENTITE[identite.matchMethod];
              return {
                key: identite.id,
                row: [
                  { children: identite.provider },
                  {
                    children: (
                      <span>
                        {identite.handle}
                        {identite.vanishedAt ? (
                          <>
                            <br />
                            <Badge severity="info" small noIcon>
                              Disparu le {dateFr.format(identite.vanishedAt)}
                            </Badge>
                          </>
                        ) : null}
                      </span>
                    ),
                  },
                  {
                    children: (
                      <Badge severity={methode.sur ? "success" : "warning"} noIcon>
                        {methode.libelle}
                      </Badge>
                    ),
                  },
                  { children: dateFr.format(identite.lastSeenAt) },
                  { children: <Detacher id={identite.id} compte={identite.handle} /> },
                ],
              };
            })}
          />
          <p className={fr.cx("fr-text--sm", "fr-mt-2w")}>
            Systèmes collectés à ce jour :{" "}
            {systemesCollectes.length === 0 ? "aucun" : systemesCollectes.join(", ")}. Tout système
            absent de cette liste n'a jamais été lu. Un rattachement heuristique ou absent ne peut
            jamais produire de révocation.
          </p>
        </>
      )}
    </section>
  );
}
