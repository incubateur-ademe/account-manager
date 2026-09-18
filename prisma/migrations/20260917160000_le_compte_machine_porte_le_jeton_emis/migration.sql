-- Un jeton restreint emis se range dans le compte machine qui le porte deja pour tout le
-- reste : cle, libelle, objet, detenteur, systeme et periodicite de revue.
--
-- Additive et nullable de bout en bout : les comptes machine anterieurs ne viennent
-- d'aucune emission, et leur poser une cible ou un terme inventerait ce qu'aucune trace
-- ne dit. Une colonne vide y signifie « declare a la main », pas « donnee manquante ».
--
-- Ce qui n'entre pas ici, et qui est le point de la decision : la cle client. Le couple
-- blob plus cle vaut l'acces lui-meme, le proxy ne garde rien, et l'ADR-0001 a refuse en
-- toutes lettres de faire de cette base le coffre des credentials du parc. Le blob seul
-- est inerte, et il est la seule trace au monde de ce qui a ete emis, aucune route du
-- proxy ne sachant lister ce qui vit.

-- AlterTable
ALTER TABLE "ServiceAccount" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "fgpBlob" TEXT,
ADD COLUMN     "fgpScopes" TEXT[],
ADD COLUMN     "fgpTarget" TEXT,
ADD COLUMN     "issuedBy" TEXT;

-- L'echeance se lit a chaque affichage de la file des revues, pour en sortir les jetons
-- morts : sans elle, un jeton expire resterait « revue en retard » pour toujours.
-- CreateIndex
CREATE INDEX "ServiceAccount_expiresAt_idx" ON "ServiceAccount"("expiresAt");
