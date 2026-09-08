import { fr } from "@codegouvfr/react-dsfr";
import { Table } from "@codegouvfr/react-dsfr/Table";
import type { Metadata } from "next";
import Link from "next/link";

import { LIBELLE_DOSSIER, LIBELLE_ETAT_DOSSIER } from "@/core/libelle-dossier";
import { dossiersOuvertsPour } from "@/lib/participation";
import { requireUtilisateur } from "@/lib/session";
import { dateFr } from "@/ui/dates";

export const metadata: Metadata = { title: "Mon espace" };

// Une autorisation ne se mémorise pas : un droit révoqué doit disparaître d'ici au
// rechargement suivant, sans attendre l'expiration de quoi que ce soit.
export const dynamic = "force-dynamic";

export default async function MonEspacePage() {
  const utilisateur = await requireUtilisateur();
  const dossiers = await dossiersOuvertsPour(utilisateur.personId);

  return (
    <main className={fr.cx("fr-container", "fr-my-6w")}>
      <h1>Mon espace</h1>
      <p>Vous êtes connecté en tant que {utilisateur.nom ?? utilisateur.username}.</p>

      <h2 className={fr.cx("fr-h4")}>Les dossiers qui vous sont ouverts</h2>
      {dossiers.length === 0 ? (
        <p>
          Aucun dossier ne vous est ouvert en ce moment. Un accès se demande à l'équipe transverse
          de l'incubateur, il porte sur un dossier et il a une date de fin.
        </p>
      ) : (
        <Table
          headers={["Personne concernée", "Sens", "État", "Accès jusqu'au"]}
          data={dossiers.map((dossier) => [
            // Vers la route du participant et non vers celle du dossier, qui le
            // renverrait ici : ce ne sont pas deux vues du même écran.
            <Link key={dossier.id} href={`/moi/dossiers/${dossier.id}`}>
              {dossier.porteur}
            </Link>,
            LIBELLE_DOSSIER[dossier.sens].nom,
            LIBELLE_ETAT_DOSSIER[dossier.etat],
            dateFr.format(dossier.expiresAt),
          ])}
        />
      )}
    </main>
  );
}
