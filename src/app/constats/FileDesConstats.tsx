"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { createModal } from "@codegouvfr/react-dsfr/Modal";
import Link from "next/link";
import { useState } from "react";

import { TableCustom } from "@/ui/TableCustom";

import { ClotureConstat } from "./ClotureConstat";

export interface LigneConstat {
  id: string;
  dedupKey: string;
  titre: string;
  /** Ce que le calcul a constaté, pour que la modale n'oblige pas à le deviner. */
  explication: string;
  action: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  ouvertLe: string;
  personne: { username: string; fullname: string } | null;
  compte: { provider: string; handle: string } | null;
}

const SEVERITE = { HIGH: "error", MEDIUM: "warning", LOW: "info" } as const;
const LIBELLE_SEVERITE = { HIGH: "Haute", MEDIUM: "Moyenne", LOW: "Basse" } as const;

const modale = createModal({ id: "clore-constat", isOpenedByDefault: false });

/**
 * Le formulaire de clôture vit dans une modale, et non dans chaque ligne.
 *
 * Déplié treize fois, il portait treize fois son libellé et son texte d'aide, pour
 * des lignes de près de trois cents pixels. La modale le dit une fois, et rappelle
 * sur quoi elle porte : sans ce rappel, elle obligerait à mémoriser la ligne avant de
 * cliquer.
 */
export function FileDesConstats({ lignes }: { lignes: readonly LigneConstat[] }) {
  const [choisi, setChoisi] = useState<LigneConstat | null>(null);

  return (
    <>
      <TableCustom
        header={[
          { children: "Gravité" },
          { children: "Concerne" },
          { children: "Constat" },
          { children: "Ouvert le" },
          { children: "" },
        ]}
        body={lignes.map((ligne) => [
          {
            children: (
              <Badge severity={SEVERITE[ligne.severity]} noIcon>
                {LIBELLE_SEVERITE[ligne.severity]}
              </Badge>
            ),
          },
          // Un constat porte sur quelqu'un, sur un compte, ou sur les deux quand un
          // compte survit à son détenteur. Sans le compte, treize lignes d'affilée
          // diraient la même chose sans dire de quoi.
          {
            children: (
              <span>
                {ligne.personne ? (
                  <Link href={`/personnes/${ligne.personne.username}`} className={fr.cx("fr-link")}>
                    {ligne.personne.fullname}
                  </Link>
                ) : ligne.compte ? (
                  <Link href="/comptes-isoles" className={fr.cx("fr-link")}>
                    {ligne.compte.handle}
                  </Link>
                ) : (
                  "inconnue"
                )}
                <br />
                <span className={fr.cx("fr-text--sm")}>
                  {ligne.compte
                    ? `${ligne.compte.provider} : ${ligne.compte.handle}`
                    : (ligne.personne?.username ?? "")}
                </span>
              </span>
            ),
          },
          // La consigne complète vit en bas de page, une fois par type. Au survol,
          // elle est là sans qu'on ait à descendre la chercher.
          { children: <span title={ligne.explication}>{ligne.titre}</span> },
          { children: ligne.ouvertLe },
          {
            children: (
              <Button
                priority="secondary"
                size="small"
                nativeButtonProps={{
                  ...modale.buttonProps,
                  onClick: () => {
                    setChoisi(ligne);
                  },
                }}
              >
                Clore
              </Button>
            ),
          },
        ])}
      />

      <modale.Component title="Clore ce constat">
        {choisi === null ? null : (
          <>
            <p className={fr.cx("fr-text--lead", "fr-mb-1v")}>
              {choisi.personne?.fullname ?? choisi.compte?.handle ?? "Cible inconnue"}
            </p>
            <p className={fr.cx("fr-text--sm", "fr-mb-2w")}>
              {choisi.personne ? choisi.personne.username : null}
              {choisi.personne && choisi.compte ? " · " : null}
              {choisi.compte ? `${choisi.compte.provider} : ${choisi.compte.handle}` : null}
            </p>

            <p className={fr.cx("fr-mb-1w")}>
              <strong>{choisi.titre}</strong>
            </p>
            <p className={fr.cx("fr-text--sm")}>{choisi.explication}</p>
            <p className={fr.cx("fr-text--sm")}>
              <strong>Ce qu'il y a à faire :</strong> {choisi.action}
            </p>
            <p className={fr.cx("fr-text--sm")}>
              Clore à la main dit qu'une situation qui dure a bien été traitée, pour qu'elle cesse
              de revenir chaque nuit. La collecte rouvrira le constat le jour où elle constatera à
              nouveau la situation.
            </p>
            <ClotureConstat key={choisi.id} dedupKey={choisi.dedupKey} onSucces={modale.close} />
          </>
        )}
      </modale.Component>
    </>
  );
}
