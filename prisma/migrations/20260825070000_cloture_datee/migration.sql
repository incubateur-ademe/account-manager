-- Date la cloture d'un dossier, et rien d'autre : aucune regle d'arrivee ne la lit,
-- un retour se constatant a la reapparition de la personne et pas a la cloture de son
-- depart. Elle existe parce que dater la fin d'un dossier est une donnee metier a part
-- entiere, et parce que l'historique des departs clos ne se reconstitue pas apres coup.
--
-- Aucun retro-remplissage : une cloture passee ne se date pas apres coup, et lui poser
-- la date du jour ferait dire a la colonne le contraire de ce qu'elle affirme.
ALTER TABLE "AccessCase" ADD COLUMN "closedAt" TIMESTAMP(3);
