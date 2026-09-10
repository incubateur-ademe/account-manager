-- Ce que la datation toucherait, compte avec la requete qui la ferait.
--
-- Les deux colonnes voisines disent la taille des listes lues, celle-ci dit la
-- consequence. Les deux mondes ne coincident pas : la resolution amont tourne avant que
-- le passage ne se declare complet, donc une nuit degradee fait naitre des fiches sans
-- toucher la reference du dernier passage complet. Un ecart annonce a quatre personnes
-- pouvait ainsi en dater onze, et c'est ce nombre-la qu'un operateur doit voir avant de
-- decider, donc celui que sa decision emporte.
--
-- Nullable, et propre au perimetre : les systemes cibles ne l'ecrivent pas, leur
-- reference etant deja un decompte de lignes vivantes, c'est-a-dire deja la consequence.
ALTER TABLE "ScopeDropOverride"
  ADD COLUMN "datables" INTEGER;
