import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import Link from "next/link";
import { notFound } from "next/navigation";

import { peremptionDuPlan } from "@/core/plan";
import { prisma } from "@/lib/db";
import { calculerPlanDeDepart } from "@/lib/depart";
import { requireOperateur } from "@/lib/session";

export const dynamic = "force-dynamic";

const dateFr = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });

const TIER: Record<string, { libelle: string; severite: "success" | "warning" | "info" }> = {
  auto: { libelle: "automatique", severite: "success" },
  assisted: { libelle: "assisté", severite: "info" },
  manual: { libelle: "à faire à la main", severite: "warning" },
};

interface MarcheASuivre {
  title?: string;
  runbook?: string;
  deeplink?: string;
  doneWhen?: string;
}

function marche(valeur: unknown): MarcheASuivre {
  return valeur && typeof valeur === "object" ? (valeur as MarcheASuivre) : {};
}

export default async function DepartPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOperateur();
  const { id } = await params;

  const dossier = await prisma.departureCase.findUnique({
    where: { id },
    select: {
      id: true,
      state: true,
      effectiveDate: true,
      firstSignalAt: true,
      person: { select: { username: true, fullname: true, missionEnd: true } },
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

  // Recalculé à l'affichage, et comparé à ce qui est figé : c'est la seule façon de
  // savoir qu'une collecte est passée depuis et que le plan ne décrit plus la
  // situation. Le plan affiché reste celui qui a été enregistré.
  const actuel = await calculerPlanDeDepart(
    (
      await prisma.person.findUniqueOrThrow({
        where: { username: dossier.person.username },
        select: { id: true },
      })
    ).id,
    dossier.person.username,
    maintenant,
  );

  const etat = plan ? peremptionDuPlan(plan, actuel.empreinte, maintenant) : null;

  return (
    <main className={fr.cx("fr-container", "fr-my-6w")}>
      <h1 className={fr.cx("fr-mb-1v")}>Départ de {dossier.person.fullname}</h1>
      <p className={fr.cx("fr-text--sm")}>
        <Link href={`/personnes/${dossier.person.username}`}>{dossier.person.username}</Link>
        {" — dossier ouvert le "}
        {dateFr.format(dossier.firstSignalAt)}
        {dossier.effectiveDate ? `, fin de mission au ${dateFr.format(dossier.effectiveDate)}` : ""}
      </p>

      <Alert
        severity="info"
        className={fr.cx("fr-my-3w")}
        small
        description="Ce plan dit ce qu'il faut faire. Il n'exécute rien : chaque étape se fait à la main, sur le système concerné, et rien ici ne le vérifiera pour vous."
      />

      {etat?.obsolete ? (
        <Alert
          severity="warning"
          className={fr.cx("fr-mb-3w")}
          title="Ce plan ne décrit plus la situation"
          description="Une collecte est passée depuis son calcul : la personne a gagné ou perdu un compte. Rouvrez un dossier pour obtenir un plan à jour."
        />
      ) : null}

      {etat?.perime ? (
        <Alert
          severity="warning"
          className={fr.cx("fr-mb-3w")}
          title="Ce plan a dépassé sa date de validité"
          description={`Calculé le ${dateFr.format(plan?.createdAt ?? maintenant)}, il valait jusqu'au ${dateFr.format(plan?.expiresAt ?? maintenant)}. Ce qu'il décrit a été constaté avant cette date.`}
        />
      ) : null}

      {actuel.sansConnecteur.length > 0 ? (
        <Alert
          severity="warning"
          className={fr.cx("fr-mb-3w")}
          title="Des comptes ne sont couverts par aucun connecteur"
          description={`${actuel.sansConnecteur.join(", ")}. Ces accès existent, mais rien ici ne sait quoi en faire : ils sont à traiter hors de l'outil.`}
        />
      ) : null}

      <h2 className={fr.cx("fr-h4")}>Ce qu'il reste à faire</h2>

      {!plan || plan.steps.length === 0 ? (
        <p>
          Aucune étape. Cette personne n'a de compte sur aucun système que l'outil sait traiter.
        </p>
      ) : (
        <ol className={fr.cx("fr-mt-2w")}>
          {plan.steps.map((etape) => {
            const aide = marche(etape.manual);
            const tier = TIER[etape.tier] ?? { libelle: etape.tier, severite: "info" as const };

            return (
              <li key={etape.id} className={fr.cx("fr-mb-3w")}>
                <strong>{etape.label}</strong>{" "}
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
                  <p className={fr.cx("fr-text--sm", "fr-mb-0")}>
                    <em>C'est fait quand : {aide.doneWhen}</em>
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      <p className={fr.cx("fr-text--sm", "fr-mt-3w")}>
        Plan calculé le {dateFr.format(plan?.createdAt ?? maintenant)} par {plan?.createdBy},
        valable jusqu'au {dateFr.format(plan?.expiresAt ?? maintenant)}. Cocher les étapes et
        enregistrer ce qui a été fait viendra ensuite : pour l'instant, le journal garde l'ouverture
        du dossier, pas son exécution.
      </p>
    </main>
  );
}
