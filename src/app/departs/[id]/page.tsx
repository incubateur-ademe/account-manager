import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import Link from "next/link";
import { notFound } from "next/navigation";

import { type EtatEtape, estSoldee, peutAnnuler, peutPointer } from "@/core/depart";
import { peremptionDuPlan } from "@/core/plan";
import { prisma } from "@/lib/db";
import { calculerPlanDeDepart } from "@/lib/depart";
import { requireOperateur } from "@/lib/session";
import {
  BoutonAnnuler,
  BoutonClore,
  BoutonConfirmer,
  BoutonRecalculer,
  Pointage,
} from "./Pointage";

export const dynamic = "force-dynamic";

const dateFr = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });

const TIER: Record<string, { libelle: string; severite: "success" | "warning" | "info" }> = {
  auto: { libelle: "automatique", severite: "success" },
  assisted: { libelle: "assisté", severite: "info" },
  manual: { libelle: "à faire à la main", severite: "warning" },
};

const ETAPE: Record<EtatEtape, { libelle: string; severite: "success" | "warning" | "error" }> = {
  PENDING: { libelle: "à faire", severite: "warning" },
  SUCCEEDED: { libelle: "fait", severite: "success" },
  ALREADY_ABSENT: { libelle: "déjà absent", severite: "success" },
  SKIPPED: { libelle: "écartée", severite: "warning" },
  FAILED: { libelle: "échec", severite: "error" },
  STALE: { libelle: "situation changée", severite: "warning" },
};

interface MarcheASuivre {
  runbook?: string;
  deeplink?: string;
  doneWhen?: string;
}

function marche(valeur: unknown): MarcheASuivre {
  return valeur && typeof valeur === "object" ? (valeur as MarcheASuivre) : {};
}

export default async function DepartPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOperateur();
  const { id } = await params;
  const { deja } = await searchParams;

  const dossier = await prisma.departureCase.findUnique({
    where: { id },
    select: {
      id: true,
      state: true,
      cancelledReason: true,
      effectiveDate: true,
      firstSignalAt: true,
      person: { select: { id: true, username: true, fullname: true } },
      plans: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          state: true,
          planDigest: true,
          expiresAt: true,
          createdAt: true,
          createdBy: true,
          confirmedBy: true,
          confirmedAt: true,
          steps: {
            orderBy: [{ systemKey: "asc" }, { label: "asc" }],
            select: {
              id: true,
              systemKey: true,
              tier: true,
              label: true,
              riskLevel: true,
              state: true,
              manual: true,
              lastError: true,
              executedAt: true,
            },
          },
        },
      },
    },
  });

  if (!dossier) {
    notFound();
  }

  const maintenant = new Date();
  const plan = dossier.plans[0];
  const annule = dossier.state === "CANCELLED";

  // Recalculé à l'affichage et comparé à ce qui est figé : c'est la seule façon de
  // savoir qu'une collecte est passée depuis. Le plan affiché reste celui qui a été
  // enregistré, jamais le recalcul.
  //
  // Sauf sur un dossier annulé : rien ne s'y compare plus, et sonder les connecteurs
  // pour afficher une dérive sans issue serait un appel sortant pour rien.
  const actuel = annule
    ? null
    : await calculerPlanDeDepart(dossier.person.id, dossier.person.username, maintenant);

  const etat = plan && actuel ? peremptionDuPlan(plan, actuel.empreinte, maintenant) : null;
  const brouillon = !annule && plan?.state === "DRAFT";
  // Adossé à la garde plutôt que recopié : l'écran connaissait la règle de son côté,
  // et c'est cet écart qui a muré le dossier le jour où une étape a échoué.
  const pointable = plan !== undefined && !annule && peutPointer(plan.state).possible;
  const clos = dossier.state === "DONE";
  const remplace = plan?.state === "EXPIRED" || plan?.state === "STALE";
  const restantes = plan?.steps.filter((etape) => !estSoldee(etape.state as EtatEtape)).length ?? 0;

  return (
    <main className={fr.cx("fr-container", "fr-my-6w")}>
      <h1 className={fr.cx("fr-mb-1v")}>
        Départ de {dossier.person.fullname}{" "}
        {clos ? (
          <Badge severity="success" noIcon>
            dossier clos
          </Badge>
        ) : null}
        {annule ? (
          <Badge severity="info" noIcon>
            départ annulé
          </Badge>
        ) : null}
      </h1>
      <p className={fr.cx("fr-text--sm")}>
        <Link href={`/personnes/${dossier.person.username}`}>{dossier.person.username}</Link>
        {", ouvert le "}
        {dateFr.format(dossier.firstSignalAt)}
        {dossier.effectiveDate ? `, fin de mission au ${dateFr.format(dossier.effectiveDate)}` : ""}
      </p>

      {deja ? (
        <Alert
          severity="info"
          className={fr.cx("fr-mt-3w")}
          small
          description="Ce dossier était déjà ouvert : vous êtes revenu dessus, aucun second dossier n'a été créé. Un départ ne s'ouvre qu'une fois par personne tant qu'il n'est pas clos."
        />
      ) : null}

      {/* Rien à cocher sur un dossier annulé ou clos : la dire quand même ferait
          promettre un geste que l'écran n'offre plus. */}
      {annule || clos ? null : (
        <Alert
          severity="info"
          className={fr.cx("fr-my-3w")}
          small
          description="Cocher une étape n'exécute rien : l'outil consigne ce que vous déclarez avoir fait, il ne coupe aucun accès lui-même. La collecte suivante dira si le compte a réellement disparu."
        />
      )}

      {etat?.obsolete && brouillon ? (
        <Alert
          severity="warning"
          className={fr.cx("fr-mb-3w")}
          title="Ce plan ne décrit plus la situation"
          description={
            <>
              <p className={fr.cx("fr-mb-1w")}>
                Les accès observés ont changé depuis son calcul : il ne peut plus être confirmé en
                l'état.
              </p>
              {plan ? <BoutonRecalculer planId={plan.id} /> : null}
            </>
          }
        />
      ) : null}

      {etat?.perime && brouillon ? (
        <Alert
          severity="warning"
          className={fr.cx("fr-mb-3w")}
          title="Ce plan a dépassé sa date de validité"
          description={
            <>
              <p className={fr.cx("fr-mb-1w")}>
                Il valait jusqu'au {dateFr.format(plan?.expiresAt ?? maintenant)}. Ce qu'il décrit a
                été constaté avant cette date.
              </p>
              {plan && !etat.obsolete ? <BoutonRecalculer planId={plan.id} /> : null}
            </>
          }
        />
      ) : null}

      {actuel && actuel.nonConfirmes.length > 0 ? (
        <Alert
          severity="warning"
          className={fr.cx("fr-mb-3w")}
          title="Des comptes ne peuvent pas entrer dans ce plan"
          description={
            <>
              <p className={fr.cx("fr-mb-1w")}>
                {actuel.nonConfirmes.join(", ")}. Ces comptes lui sont rattachés sur une simple
                ressemblance de nom, jamais sur une preuve. Couper sur cette base reviendrait à
                couper l'accès d'un homonyme, donc aucune étape ne les vise.
              </p>
              <p className={fr.cx("fr-mb-0")}>
                <Link href="/comptes-isoles">
                  Confirmer ou détacher ces comptes pour qu'ils entrent dans un plan
                </Link>
              </p>
            </>
          }
        />
      ) : null}

      {actuel && actuel.sansConnecteur.length > 0 ? (
        <Alert
          severity="warning"
          className={fr.cx("fr-mb-3w")}
          title="Des comptes ne sont couverts par aucun connecteur"
          description={`${actuel.sansConnecteur.join(", ")}. Ces accès existent, mais rien ici ne sait quoi en faire : ils sont à traiter hors de l'outil.`}
        />
      ) : null}

      {annule ? (
        <Alert
          severity="info"
          className={fr.cx("fr-mb-3w")}
          title="Ce départ a été annulé"
          description={
            dossier.cancelledReason
              ? `${dossier.cancelledReason.replace(/[.!?]?$/, ".")} Aucun accès n'a été coupé par ce dossier, et un nouveau départ reste ouvrable.`
              : "Aucun accès n'a été coupé par ce dossier, et un nouveau départ reste ouvrable."
          }
        />
      ) : null}

      <h2 className={fr.cx("fr-h4")}>
        {annule
          ? "Ce qui n'aura pas lieu"
          : remplace
            ? "Ce que ce plan proposait"
            : brouillon
              ? "Ce qui sera à faire"
              : "Ce qu'il reste à faire"}
      </h2>

      {!plan ? (
        <p>
          Aucun plan n'a été enregistré pour ce dossier : son calcul n'a pas abouti.
          {annule || clos
            ? ""
            : " L'annuler est la seule issue, un nouveau départ restant ouvrable ensuite."}
        </p>
      ) : plan.steps.length === 0 ? (
        <p>
          Aucune étape : aucun compte rattaché de façon sûre n'a été trouvé sur les systèmes que
          l'outil sait traiter.
        </p>
      ) : (
        <>
          <ol className={fr.cx("fr-mt-2w")}>
            {plan.steps.map((etape) => {
              const aide = marche(etape.manual);
              const tier = TIER[etape.tier] ?? { libelle: etape.tier, severite: "info" as const };
              const pointee = ETAPE[etape.state as EtatEtape];
              const soldee = estSoldee(etape.state as EtatEtape);

              return (
                <li key={etape.id} className={fr.cx("fr-mb-4w")}>
                  <strong>{etape.label}</strong>{" "}
                  <Badge severity={pointee.severite} small noIcon>
                    {pointee.libelle}
                  </Badge>{" "}
                  <Badge severity={tier.severite} small noIcon>
                    {tier.libelle}
                  </Badge>{" "}
                  {etape.riskLevel === "HIGH" ? (
                    <Badge severity="error" small noIcon>
                      risque élevé
                    </Badge>
                  ) : null}
                  {aide.runbook ? (
                    <p className={fr.cx("fr-text--sm", "fr-mb-1v", "fr-mt-1v")}>{aide.runbook}</p>
                  ) : null}
                  {aide.deeplink ? (
                    <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
                      <a href={aide.deeplink} target="_blank" rel="noreferrer">
                        Ouvrir la page concernée
                      </a>
                    </p>
                  ) : null}
                  {aide.doneWhen ? (
                    <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
                      <em>C'est fait quand : {aide.doneWhen}</em>
                    </p>
                  ) : null}
                  {etape.lastError ? (
                    <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
                      <strong>Note :</strong> {etape.lastError}
                    </p>
                  ) : null}
                  {etape.executedAt ? (
                    <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
                      Pointée le {dateFr.format(etape.executedAt)}.
                    </p>
                  ) : null}
                  {pointable ? <Pointage etapeId={etape.id} faite={soldee} /> : null}
                </li>
              );
            })}
          </ol>

          {brouillon ? (
            <>
              <p className={fr.cx("fr-text--sm")}>
                Confirmer, c'est dire que vous répondez de cette liste. Elle ne bougera plus
                ensuite, et chaque étape pourra être pointée.
              </p>
              <BoutonConfirmer planId={plan.id} />
            </>
          ) : null}

          {/* Sur l'état du plan, et non sur un décompte d'étapes : un plan `EXECUTING`
              porte par construction au moins une étape en attente, si bien que la
              condition d'avant ne pouvait jamais être vraie et qu'aucun dossier ne
              se cloturait. */}
          {!annule && !clos && plan.state === "EXECUTED" ? (
            <BoutonClore dossierId={dossier.id} />
          ) : null}

          {pointable && restantes > 0 ? (
            <p className={fr.cx("fr-text--sm")}>
              {restantes} étape{restantes > 1 ? "s" : ""} en attente. Le dossier se clôt quand il
              n'en reste aucune.
            </p>
          ) : null}

          {plan.state === "PARTIALLY_EXECUTED" ? (
            <Alert
              severity="warning"
              className={fr.cx("fr-mt-2w")}
              title="Des accès sont restés ouverts"
              description="Une étape au moins a échoué. Le dossier ne peut pas être clos tant qu'elle n'est pas reprise."
            />
          ) : null}
        </>
      )}

      <BoutonAnnuler
        dossierId={dossier.id}
        etapes={plan?.steps.length ?? 0}
        annulable={peutAnnuler(dossier.state, plan?.state ?? null).possible}
      />

      {plan ? (
        <p className={fr.cx("fr-text--sm", "fr-mt-3w")}>
          Plan calculé le {dateFr.format(plan.createdAt)} par {plan.createdBy}
          {plan.confirmedBy
            ? `, confirmé le ${dateFr.format(plan.confirmedAt ?? maintenant)} par ${plan.confirmedBy}`
            : annule || remplace || etat?.perime
              ? ""
              : `, valable jusqu'au ${dateFr.format(plan.expiresAt)}`}
          .
        </p>
      ) : null}
    </main>
  );
}
