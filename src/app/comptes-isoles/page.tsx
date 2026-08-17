import { fr } from "@codegouvfr/react-dsfr";
import { Badge } from "@codegouvfr/react-dsfr/Badge";
import { Table } from "@codegouvfr/react-dsfr/Table";
import type { Metadata } from "next";

import { prisma } from "@/lib/db";
import { requireOperateur } from "@/lib/session";

import { Rattacher } from "./Rattacher";

export const metadata: Metadata = { title: "Comptes isolés" };

export const dynamic = "force-dynamic";

const LISTE_CIBLES = "cibles-de-rattachement";

const dateFr = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" });

export default async function ComptesIsolesPage() {
  await requireOperateur();

  const [isoles, personnes, comptes] = await Promise.all([
    prisma.externalIdentity.findMany({
      // Un rattachement par ressemblance appelle le même geste qu'un compte sans
      // détenteur : quelqu'un doit trancher. Le laisser hors de cette file le
      // rendrait invisible, alors qu'il ne pourra jamais justifier une révocation.
      where: {
        vanishedAt: null,
        OR: [{ personId: null, serviceAccountId: null }, { matchMethod: "HEURISTIC" }],
      },
      orderBy: [{ provider: "asc" }, { handle: "asc" }],
      select: {
        id: true,
        provider: true,
        handle: true,
        matchMethod: true,
        firstSeenAt: true,
        lastSeenAt: true,
        grants: {
          where: { vanishedAt: null },
          select: { role: true, resource: { select: { label: true } } },
        },
      },
    }),
    prisma.person.findMany({
      where: { vanishedAt: null },
      orderBy: { username: "asc" },
      select: { username: true, fullname: true },
    }),
    prisma.serviceAccount.findMany({ orderBy: { key: "asc" }, select: { key: true, label: true } }),
  ]);

  return (
    <main className={fr.cx("fr-container", "fr-my-6w")}>
      <h1>Comptes isolés</h1>

      <p className={fr.cx("fr-text--lead")}>
        Des comptes existent sur des systèmes de l'incubateur sans qu'aucune personne suivie ni
        aucun compte de service ne s'en réclame. Ce n'est pas une anomalie de la collecte : c'est
        précisément ce que cet outil existe pour mettre au jour.
      </p>

      {/* Une seule liste pour toute la page : la répéter par ligne alourdirait le
          document d'autant de copies qu'il y a de comptes à traiter. */}
      <datalist id={LISTE_CIBLES}>
        {personnes.map((personne) => (
          <option key={personne.username} value={personne.username}>
            {personne.fullname}
          </option>
        ))}
        {comptes.map((compte) => (
          <option key={compte.key} value={compte.key}>
            {compte.label}
          </option>
        ))}
      </datalist>

      {isoles.length === 0 ? (
        <p>
          Aucun compte isolé. Tout ce qui a été observé est rattaché à quelqu'un, ou à un compte de
          service déclaré.
        </p>
      ) : (
        <>
          <p className={fr.cx("fr-text--sm")}>
            {isoles.length} compte{isoles.length > 1 ? "s" : ""} sans détenteur connu. Un compte
            rattaché à la main l'est de façon sûre, et pourra donc justifier une révocation : c'est
            un jugement, il est journalisé avec votre nom.
          </p>

          <Table
            caption="Comptes observés qu'aucune personne suivie ne réclame"
            noCaption
            headers={["Système", "Compte", "Accès constatés", "Vu", "Rattacher à"]}
            data={isoles.map((identite) => [
              identite.provider,
              <span key="c">
                <strong>{identite.handle}</strong>
                {identite.matchMethod === "HEURISTIC" ? (
                  <>
                    <br />
                    <Badge severity="warning" small noIcon>
                      Ressemblance non confirmée
                    </Badge>
                  </>
                ) : null}
              </span>,
              <span key="a" className={fr.cx("fr-text--sm")}>
                {identite.grants.length === 0
                  ? "aucun"
                  : identite.grants
                      .map((acces) => `${acces.role} sur ${acces.resource.label}`)
                      .join(", ")}
              </span>,
              <span key="v" className={fr.cx("fr-text--sm")}>
                depuis le {dateFr.format(identite.firstSeenAt)}
                <br />
                encore le {dateFr.format(identite.lastSeenAt)}
              </span>,
              <Rattacher key="r" id={identite.id} listeId={LISTE_CIBLES} />,
            ])}
          />
        </>
      )}
    </main>
  );
}
