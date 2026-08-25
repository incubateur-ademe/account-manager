"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { createModal } from "@codegouvfr/react-dsfr/Modal";
import Link from "next/link";
import { useState } from "react";
import { FormulaireOuverture } from "@/app/dossiers/FormulaireOuverture";
import type { ConstatKind } from "@/core/constat";
import { LIBELLE_DOSSIER } from "@/core/libelle-dossier";
import type { RiskLevel } from "@/generated/prisma/enums";
import styleActions from "@/ui/Actions.module.css";
import { Aide } from "@/ui/Aide";
import type { ChoixDeProfils } from "@/ui/profils";
import { LIBELLE_SEVERITE, SEVERITE_CONSTAT } from "@/ui/severites";
import { TableCustom } from "@/ui/TableCustom";
import style from "@/ui/TableCustom.module.css";

import { ClotureConstat } from "./ClotureConstat";

export interface LigneConstat {
  id: string;
  dedupKey: string;
  /** Ce qui décide du geste offert, là où le libellé ne décide que du texte. */
  kind: ConstatKind;
  titre: string;
  /** Ce que le calcul a constaté, pour que la modale n'oblige pas à le deviner. */
  explication: string;
  action: string;
  severity: RiskLevel;
  ouvertLe: string;
  personne: { username: string; fullname: string } | null;
  compte: { provider: string; handle: string } | null;
}

const modale = createModal({ id: "clore-constat", isOpenedByDefault: false });

// Le seul constat dont la file offre autre chose que la clôture. Sa modale est
// déclarée ici, une fois, et non par ligne : elle porte la même explication que celle
// de la fiche, montée par le même formulaire.
const modaleArrivee = createModal({ id: "preparer-arrivee-constat", isOpenedByDefault: false });

/**
 * Le formulaire de clôture vit dans une modale, et non dans chaque ligne.
 *
 * Déplié treize fois, il portait treize fois son libellé et son texte d'aide, pour
 * des lignes de près de trois cents pixels. La modale le dit une fois, et rappelle
 * sur quoi elle porte : sans ce rappel, elle obligerait à mémoriser la ligne avant de
 * cliquer.
 */
export function FileDesConstats({
  lignes,
  designe,
  profils,
}: {
  lignes: readonly LigneConstat[];
  /** Clé du constat sur lequel une fiche vient de renvoyer. */
  designe?: string;
  /** Les profils qu'une arrivée peut appliquer, lus par le serveur qui monte cette file. */
  profils: ChoixDeProfils;
}) {
  const [choisi, setChoisi] = useState<LigneConstat | null>(null);
  const [arrivee, setArrivee] = useState<{ username: string; fullname: string } | null>(null);

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
        body={lignes.map((ligne) => ({
          // Arriver d'une fiche sur une file de quinze lignes sans savoir laquelle
          // on venait traiter revenait à chercher deux fois.
          className: ligne.dedupKey === designe ? style["ligneDesignee"] : undefined,
          key: ligne.dedupKey,
          row: [
            {
              children: (
                <Badge severity={SEVERITE_CONSTAT[ligne.severity]} noIcon>
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
                    <Link
                      href={`/personnes/${ligne.personne.username}`}
                      className={fr.cx("fr-link")}
                    >
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
            {
              // La consigne complète vit en bas de page, une fois par type. Ici, le
              // point d'interrogation la donne sans qu'on ait à descendre la
              // chercher, et le mode d'aide décide s'il paraît.
              children: (
                <span className={styleActions["geste"]}>
                  {ligne.titre}
                  <Aide>{`${ligne.explication} Ce qu'il y a à faire : ${ligne.action}`}</Aide>
                </span>
              ),
            },
            { children: ligne.ouvertLe },
            {
              // Une arrivée constatée appelle deux issues, et la consigne les nomme
              // toutes les deux : préparer ce qui n'a pas été fait, ou dire ce qui
              // l'a été ailleurs. Les autres constats n'ont que la seconde.
              children: (
                <>
                  {ligne.kind === "SCOPE_ENTRY" && ligne.personne ? (
                    <Button
                      className={fr.cx("fr-mr-1v")}
                      priority="secondary"
                      size="small"
                      nativeButtonProps={{
                        ...modaleArrivee.buttonProps,
                        id: `arrivee-${ligne.dedupKey}`,
                        type: "button",
                        onClick: () => {
                          setArrivee(ligne.personne);
                        },
                      }}
                    >
                      {LIBELLE_DOSSIER.ONBOARDING.ouvrir}
                    </Button>
                  ) : null}
                  <Button
                    priority="secondary"
                    size="small"
                    nativeButtonProps={{
                      ...modale.buttonProps,
                      // Réécrit, sinon toutes les lignes porteraient l'identifiant de
                      // la modale, et deux boutons de la file celui de l'autre.
                      id: `clore-${ligne.dedupKey}`,
                      onClick: () => {
                        setChoisi(ligne);
                      },
                    }}
                  >
                    Clore
                  </Button>
                </>
              ),
            },
          ],
        }))}
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

      <modaleArrivee.Component title={LIBELLE_DOSSIER.ONBOARDING.ouvrir}>
        {arrivee === null ? null : (
          <>
            <p className={fr.cx("fr-text--lead", "fr-mb-1v")}>{arrivee.fullname}</p>
            <p className={fr.cx("fr-text--sm", "fr-mb-2w")}>{arrivee.username}</p>
            <FormulaireOuverture
              key={arrivee.username}
              username={arrivee.username}
              sens="ONBOARDING"
              profils={profils}
            />
          </>
        )}
      </modaleArrivee.Component>
    </>
  );
}
