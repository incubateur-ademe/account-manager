-- Migration additive : aucune donnee existante n'est touchee, aucune reprise n'est
-- necessaire. La valeur 'ALREADY_PRESENT' de StepState n'est pas ajoutee ici, elle
-- existe deja : la poser une seconde fois ferait echouer l'application.

-- L'echeance decidee d'un octroi vit sur l'etape et pas sur AccessGrant : cette
-- table est reconstruite par la collecte, une echeance decidee y serait effacee a la
-- premiere nuit.
--
-- La justification ne se remplit jamais automatiquement depuis un profil : le profil
-- EST la justification, et la recopier ferait naitre la file des acces a justifier
-- deja pleine de faux. Elle n'aura de valeur que le jour ou un octroi hors profil se
-- saisira.
ALTER TABLE "PlanStep" ADD COLUMN     "grantExpiresAt" TIMESTAMP(3),
ADD COLUMN     "justification" TEXT;

-- Sert le balayage qui produira les EXPIRED_GRANT, constat deja declare et sans
-- producteur. Aucun code ne le lit aujourd'hui.
-- CreateIndex
CREATE INDEX "PlanStep_grantExpiresAt_idx" ON "PlanStep"("grantExpiresAt");
