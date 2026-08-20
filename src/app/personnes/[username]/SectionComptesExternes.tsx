import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import { Table } from "@codegouvfr/react-dsfr/Table";

import type { MatchMethod } from "@/generated/prisma/enums";

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
  fullname,
  comptes,
  systemesCollectes,
}: {
  fullname: string;
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
          <Table
            caption={`Comptes externes rattachés à ${fullname}`}
            noCaption
            headers={["Système", "Compte", "Rattachement", "Vu pour la dernière fois", ""]}
            data={comptes.map((identite) => {
              const methode = RATTACHEMENT_IDENTITE[identite.matchMethod];
              return [
                identite.provider,
                <span key="c">
                  {identite.handle}
                  {identite.vanishedAt ? (
                    <>
                      <br />
                      <Badge severity="info" small noIcon>
                        Disparu le {dateFr.format(identite.vanishedAt)}
                      </Badge>
                    </>
                  ) : null}
                </span>,
                <Badge key="r" severity={methode.sur ? "success" : "warning"} noIcon>
                  {methode.libelle}
                </Badge>,
                dateFr.format(identite.lastSeenAt),
                <Detacher key="d" id={identite.id} compte={identite.handle} />,
              ];
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
