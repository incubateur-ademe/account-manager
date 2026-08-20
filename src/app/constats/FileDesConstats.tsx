"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { createModal } from "@codegouvfr/react-dsfr/Modal";
import { Table } from "@codegouvfr/react-dsfr/Table";
import Link from "next/link";
import { useState } from "react";

import { ClotureConstat } from "./ClotureConstat";

export interface LigneConstat {
  id: string;
  dedupKey: string;
  titre: string;
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
      <Table
        headers={["Gravité", "Concerne", "Constat", "Ouvert le", ""]}
        data={lignes.map((ligne) => [
          <Badge key="g" severity={SEVERITE[ligne.severity]} noIcon>
            {LIBELLE_SEVERITE[ligne.severity]}
          </Badge>,
          // Un constat porte sur quelqu'un, sur un compte, ou sur les deux quand un
          // compte survit à son détenteur. Sans le compte, treize lignes d'affilée
          // diraient la même chose sans dire de quoi.
          <span key="p">
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
          </span>,
          ligne.titre,
          ligne.ouvertLe,
          <Button
            key="t"
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
          </Button>,
        ])}
      />

      <modale.Component title="Clore ce constat">
        {choisi === null ? null : (
          <>
            <p className={fr.cx("fr-mb-1w")}>
              <strong>{choisi.titre}</strong>
              {choisi.personne ? `, ${choisi.personne.fullname}` : null}
              {choisi.compte ? `, ${choisi.compte.provider} ${choisi.compte.handle}` : null}
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
