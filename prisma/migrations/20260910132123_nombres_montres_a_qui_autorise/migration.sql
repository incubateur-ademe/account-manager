-- Les nombres du refus tels qu'ils ont ete montres a qui autorisait une datation.
--
-- La borne d'ampleur les redevinait a la consommation, en relisant le dernier refus
-- enregistre dans une fenetre de passages. Ce n'est pas le meme nombre : une decision
-- posee sur une chute annoncee a 90 personnes, suivie d'un passage qui refuse a 80,
-- laissait passer une chute du soir a 85, plus profonde que celle qu'on avait examinee.
--
-- Nullables parce que les lignes anterieures n'en portent pas. Une decision sans nombres
-- ne se mesure pas, donc ne leve pas : elle est ecartee, et l'operateur la repose sur les
-- nombres du jour. C'est le sens sur, et c'est deja ce que fait la borne quand elle ne
-- trouve rien.
ALTER TABLE "ScopeDropOverride"
  ADD COLUMN "observe" INTEGER,
  ADD COLUMN "reference" INTEGER;
