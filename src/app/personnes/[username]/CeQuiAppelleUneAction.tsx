import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import Link from "next/link";

import type { ConstatKind } from "@/core/constat";
import { LIBELLE_CONSTAT } from "@/core/libelle-constat";

export interface ConstatOuvert {
  id: string;
  kind: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
}

export interface MotifDAction {
  cle: string;
  severite: "error" | "warning" | "info";
  titre: string;
  description: string;
  /** Où le geste se fait, quand ce n'est pas sur cette page. */
  lien?: { href: string; libelle: string };
}

const SEVERITE_CONSTAT = { HIGH: "error", MEDIUM: "warning", LOW: "info" } as const;

/**
 * Ce qui appelle un geste, et rien d'autre. Une information seulement notable qui
 * entrerait ici ferait apparaître le bloc sur chaque fiche, et un bloc qui paraît
 * partout ne signale plus rien.
 */
export function CeQuiAppelleUneAction({ motifs }: { motifs: readonly MotifDAction[] }) {
  if (motifs.length === 0) {
    return null;
  }

  return (
    <section className={fr.cx("fr-mt-4w")} aria-labelledby="a-faire">
      <h2 className={fr.cx("fr-h5")} id="a-faire">
        Ce qu'il y a à faire
      </h2>
      {motifs.map((motif) => (
        <Alert
          key={motif.cle}
          className={fr.cx("fr-mb-2w")}
          severity={motif.severite}
          small
          description={
            <>
              <strong>{motif.titre}</strong> {motif.description}
              {motif.lien ? (
                <>
                  {" "}
                  <Link className={fr.cx("fr-link", "fr-text--sm")} href={motif.lien.href}>
                    {motif.lien.libelle}
                  </Link>
                </>
              ) : null}
            </>
          }
        />
      ))}
    </section>
  );
}

export function motifsDesConstats(ouverts: readonly ConstatOuvert[]): MotifDAction[] {
  return ouverts.map((constat) => {
    const libelle = LIBELLE_CONSTAT[constat.kind as ConstatKind];
    return {
      cle: `constat-${constat.id}`,
      severite: SEVERITE_CONSTAT[constat.severity],
      titre: libelle?.titre ?? constat.kind,
      description: libelle?.action ?? "",
      lien: { href: "/constats", libelle: "Le traiter dans la file" },
    };
  });
}
