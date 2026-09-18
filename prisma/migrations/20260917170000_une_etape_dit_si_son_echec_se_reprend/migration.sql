-- Une etape porte desormais ce que son connecteur a dit de la reprise de son dernier echec.
--
-- Sans cette colonne, `retryable` ne servait qu'a formuler un motif au journal : l'etape
-- retombait en FAILED, FAILED fait partie des etats que l'execution reprend, et un second
-- clic la representait telle quelle. Sur une emission de jeton dont l'echec est ambigu,
-- c'est-a-dire dont on ignore si un blob est ne la-bas, ce second passage en emettait un
-- second, que rien ne liste et que rien ne revoque.
--
-- Nullable et sans defaut : une ligne anterieure n'a jamais rien declare, et lui poser
-- « reprenable » ou « non reprenable » inventerait la parole d'un connecteur. Nul se lit
-- donc « rien n'a ete dit », et une etape dans cet etat continue d'etre reprise.

-- AlterTable
ALTER TABLE "PlanStep" ADD COLUMN     "retryable" BOOLEAN;
