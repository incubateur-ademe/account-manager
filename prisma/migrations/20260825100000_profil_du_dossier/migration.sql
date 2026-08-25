-- Migration additive : une colonne nullable, aucune reprise de donnees. Les dossiers
-- deja ouverts la portent a NULL, ce qui est exact : ils ont ete ouverts avant que le
-- choix d'un profil n'existe, et leur plan ne porte aucune etape d'octroi.

-- Le profil vit sur le dossier et pas sur le plan : c'est lui qui rend le recalcul
-- reproductible. L'execution recalcule le plan et le compare a l'empreinte confirmee ;
-- un recalcul qui ignorerait le profil ne retrouverait aucune etape d'octroi, et tout
-- plan d'arrivee se declarerait obsolete au moment de partir.
--
-- Une cle et non une cle etrangere : les profils sont declares dans le fichier de
-- politique, aucune table ne les porte.
ALTER TABLE "AccessCase" ADD COLUMN     "profileKey" TEXT;
