"use client";

import { fr } from "@codegouvfr/react-dsfr";
import { Button } from "@codegouvfr/react-dsfr/Button";
import { createModal } from "@codegouvfr/react-dsfr/Modal";
import { useActionState } from "react";
import { type EtatDepart, ouvrirDepart } from "@/app/dossiers/actions";
import style from "@/ui/Actions.module.css";
import { Aide } from "@/ui/Aide";

const modale = createModal({ id: "preparer-depart", isOpenedByDefault: false });

/**
 * Le geste passe par une confirmation, parce que rien ne le défait.
 *
 * Sans elle, le premier clic emmène sur un dossier qu'on n'a pas encore décidé
 * d'ouvrir, et le doute qui suit fait recliquer : le dossier ne se dédouble pas,
 * mais on ne l'apprend qu'après coup.
 */
export function BoutonDepart({ username }: { username: string }) {
  const [etat, formAction, pending] = useActionState<EtatDepart | null, FormData>(
    ouvrirDepart,
    null,
  );

  return (
    <>
      <span className={style["geste"]}>
        <Button
          className={fr.cx("fr-mr-1v")}
          priority="primary"
          size="small"
          nativeButtonProps={modale.buttonProps}
        >
          Préparer le départ
        </Button>
        <Aide>
          {
            "Ouvrir un dossier de départ et calculer la liste de ce qu'il faudra retirer, système par système. Rien n'est exécuté et aucun accès n'est coupé."
          }
        </Aide>
      </span>

      <modale.Component title="Préparer le départ">
        <p className={fr.cx("fr-text--sm")}>
          Un dossier est ouvert et la liste de ce qu'il faut retirer est calculée à partir des
          comptes observés, système par système. Rien n'est exécuté et aucun accès n'est coupé : le
          plan reste à confirmer, puis à pointer à la main.
        </p>
        <p className={fr.cx("fr-text--sm")}>
          Le geste est tracé à votre nom. Si un dossier est déjà ouvert sur cette personne, vous y
          serez ramené plutôt que d'en créer un second.
        </p>

        <form action={formAction}>
          <input type="hidden" name="username" value={username} />
          <Button type="submit" priority="primary" disabled={pending}>
            {pending ? "Calcul du plan…" : "Ouvrir le dossier"}
          </Button>
          {etat?.erreur ? (
            <p className={fr.cx("fr-error-text", "fr-mt-1v")} role="alert">
              {etat.erreur}
            </p>
          ) : null}
        </form>
      </modale.Component>
    </>
  );
}
