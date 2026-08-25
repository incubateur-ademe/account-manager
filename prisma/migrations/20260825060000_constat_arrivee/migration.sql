-- Migration ecrite a la main. Une valeur ajoutee a un type enumere ne peut pas etre
-- utilisee dans la transaction qui l'ajoute : aucun ordre de ce fichier n'ecrit
-- 'SCOPE_ENTRY' dans une ligne, et rien n'est retro-rempli. Le stock initial est
-- ecarte par une regle de calcul datee, pas par une ecriture.
--
-- AFTER pour que l'ordre physique du type suive l'ordre du fichier schema.prisma,
-- sans quoi une introspection ulterieure signalerait une derive.
ALTER TYPE "FindingKind" ADD VALUE 'SCOPE_ENTRY' AFTER 'SCOPE_EXIT';
