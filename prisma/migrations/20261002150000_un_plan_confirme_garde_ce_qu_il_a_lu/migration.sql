-- Les comptes et les acces lus par le calcul d'un plan, figes a sa confirmation.
ALTER TABLE "Plan" ADD COLUMN "confirmedReads" JSONB;
