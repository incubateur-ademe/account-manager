import { fr } from "@codegouvfr/react-dsfr";
import { Alert } from "@codegouvfr/react-dsfr/Alert";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Etape, type EtapeNommee } from "@/app/dossiers/[id]/Etape";
import { Validation } from "@/app/dossiers/[id]/Pointage";
import {
  type Acteur,
  type ActeurNomme,
  type Declarant,
  type EtatPlan,
  type EtatValidation,
  peutValider,
  planPointable,
  type SensDossier,
  type Verdict,
} from "@/core/dossier";
import { LIBELLE_DOSSIER } from "@/core/libelle-dossier";
import { origineFigeeSchema } from "@/core/modele-plan";
import { etapesAControlerPar, etapesVisiblesPour } from "@/core/participation";
import { prisma } from "@/lib/db";
import { droitDeParticiper } from "@/lib/participation";
import { requireUtilisateur } from "@/lib/session";

// Une autorisation ne se mémorise pas : un droit révoqué doit fermer cette page au
// rechargement suivant, sans attendre l'expiration de quoi que ce soit.
export const dynamic = "force-dynamic";

/**
 * Fixe, et il faut qu'il le reste : un titre qui nommerait le dossier s'écrirait dans
 * l'onglet avant que la garde ait tranché, `generateMetadata` s'exécutant pour son
 * propre compte.
 */
export const metadata: Metadata = { title: "Un dossier qui vous est ouvert" };

export function EtapeDuParticipant({
  etape,
  template,
  pointable,
  etatPlan,
  sens,
  declarant,
  controle,
}: {
  etape: EtapeNommee;
  template: unknown;
  pointable: boolean;
  etatPlan: EtatPlan;
  sens: SensDossier;
  declarant: Declarant;
  /** Ce que la garde de validation répond à ce lecteur, ou rien s'il ne contrôle pas. */
  controle: Verdict | null;
}) {
  const origine = origineFigeeSchema.safeParse(template);
  const validation = etape.validation as EtatValidation;

  return (
    <Etape
      etape={etape}
      saisie={origine.success ? (origine.data.saisie ?? null) : null}
      pointable={pointable}
      etatPlan={etatPlan}
      sens={sens}
      declarant={declarant}
      journal={
        // Le refus se dit, son motif non : c'est une note libre que cette requête ne
        // lit pas. La phrase ne désigne donc plus l'équipe transverse, un délégué
        // refusant depuis qu'un écran le lui ouvre, et elle renvoie vers le contrôle
        // plutôt que vers quelqu'un. Le prix est un aller-retour hors de l'outil quand
        // le motif compte, et il est assumé.
        //
        // Elle ne nomme pas le rôle non plus, alors que `validationBy` est là et que
        // `Etape` le nomme sous `AWAITING` : là il dit le regard attendu, ici il dirait
        // le regard qui a eu lieu, et les deux ne coïncident pas. Un opérateur valide
        // ce qu'un délégué aurait dû valider, donc une étape confiée au contrôle d'un
        // délégué a pu être refusée par un opérateur. Qui a refusé s'appelle
        // `validatedBy`, et c'est une colonne que cette route ne lit pas.
        validation === "REFUSED" ? (
          <p className={fr.cx("fr-text--sm", "fr-mb-1v")}>
            <strong>Déclaration refusée.</strong> L'étape est de nouveau à faire : qui contrôle
            cette étape vous dira ce qui manque.
          </p>
        ) : null
      }
      controle={
        controle === null ? null : (
          <Validation
            etapeId={etape.id}
            // Un geste déclaré et jamais un écart : la raison d'un écart vit dans la
            // note libre d'un opérateur, que cette route ne lit pas, et la projection
            // écarte pour cette raison les étapes qui en portent une.
            ecart={false}
            possible={controle.possible}
            raison={controle.possible ? null : controle.raison}
          />
        )
      }
    />
  );
}

/**
 * Ce qu'un participant voit d'un dossier, et c'est une route à lui plutôt qu'une
 * version amputée de celle d'un opérateur.
 *
 * La différence n'est pas de forme. L'écran d'un opérateur livre du contexte d'équipe
 * en une demi-douzaine d'endroits qui n'ont rien en commun, et le censurer champ par
 * champ rédige par soustraction : il laisse passer, par construction, tout ce qu'on y
 * ajoutera demain sans y penser. Ici la question ne se pose pas, la requête ne lisant
 * pas ce qui ne le regarde pas et le composant partagé n'ayant nulle part où
 * l'accueillir.
 *
 * Le refus est un `notFound` et non une redirection : renvoyer vers l'écran de
 * connexion quelqu'un dont la session est valide lui affirmerait qu'elle a échoué.
 */
export default async function DossierDuParticipantPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const utilisateur = await requireUtilisateur();
  const { id } = await params;

  if (!(await droitDeParticiper(utilisateur.personId, id))) {
    notFound();
  }

  const dossier = await prisma.accessCase.findUnique({
    where: { id },
    select: {
      id: true,
      kind: true,
      state: true,
      person: { select: { id: true, fullname: true } },
      plans: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: {
          id: true,
          state: true,
          steps: {
            orderBy: [{ ordre: "asc" }, { systemKey: "asc" }, { label: "asc" }, { id: "asc" }],
            // Rien de plus, et c'est cette liste qu'on relit plutôt que mille lignes
            // d'écran : ni note libre, ni nom de signataire, ni marche à suivre, ni
            // terme d'accès, ni clé technique. Un champ ajouté ici est une décision,
            // jamais une distraction.
            //
            // `declaredBy` est le seul qui se lise sans jamais se rendre. « Personne ne
            // valide sa propre déclaration » se compare sur ce nom-là, et sans lui
            // l'écran offrirait une signature que l'action refuse ; le montrer serait
            // autre chose, et ce serait faux : l'étape qu'un délégué contrôle attend le
            // porteur, mais un opérateur a pu la pointer en substitution, auquel cas ce
            // nom est le sien.
            select: {
              id: true,
              label: true,
              state: true,
              validation: true,
              expectedActor: true,
              validationBy: true,
              declaredBy: true,
              reponse: true,
              template: true,
            },
          },
        },
      },
    },
  });

  if (dossier === null) {
    notFound();
  }

  const mots = LIBELLE_DOSSIER[dossier.kind];
  const plan = dossier.plans[0];

  // Le porteur d'un dossier à qui l'équipe a ouvert le sien y reste le porteur, et il
  // se reconnaît à sa fiche et non à son nom : le jeton fige le nom à la connexion, et
  // renommer une fiche fabriquée pendant qu'une session de son titulaire est ouverte en
  // ferait un délégué sur son propre dossier. La garde a exigé un droit vivant, donc
  // une fiche : il ne reste ici aucun rôle nul à envisager.
  const role: Acteur =
    utilisateur.personId === dossier.person.id
      ? "SUBJECT"
      : utilisateur.operateur
        ? "OPERATOR"
        : "DELEGATE";

  const toutes = plan?.steps ?? [];

  // Ce qui le nomme, et rien d'autre : une étape confiée à quelqu'un d'autre n'est pas
  // une étape qu'on lui refuse de pointer, c'est une étape dont l'existence même ne le
  // regarde pas.
  const siennes = etapesVisiblesPour(role, toutes);

  // Ce qu'il ne fait pas mais qu'il signe, sans quoi `validerEtape` resterait ouverte à
  // un rôle qui n'a nulle part où l'exercer. Les écarts en sortent, pour ne pas montrer
  // ce que l'action refuse : leur raison vit dans la note libre d'un opérateur, que
  // cette requête ne lit pas. C'est `validerEtape` qui tient la règle, ce filtre-ci ne
  // fait que se taire là où elle refusera.
  const aControler = etapesAControlerPar(role, toutes).filter((etape) => etape.state !== "SKIPPED");

  const etatPlan = (plan?.state ?? "DRAFT") as EtatPlan;
  const verdictDuPlan = planPointable(etatPlan);
  const pointable = plan !== undefined && verdictDuPlan.possible;
  // La raison telle que `planPointable` la rend, plutôt qu'une seconde table d'états :
  // un plan clos et un plan en brouillon ferment tous les deux, et une phrase unique en
  // ferait mentir une sur deux.
  const raisonDuPlan = verdictDuPlan.possible ? null : verdictDuPlan.raison;
  const declarant: Declarant = { role, operateur: utilisateur.operateur };
  const valideur: ActeurNomme = { username: utilisateur.username, role };

  return (
    <main className={fr.cx("fr-container", "fr-my-6w")}>
      <h1 className={fr.cx("fr-mb-1v")}>
        {mots.nom} de {dossier.person.fullname}
      </h1>
      <p className={fr.cx("fr-text--sm")}>
        <Link href="/moi">Revenir à mon espace</Link>
      </p>

      <Alert severity="info" className={fr.cx("fr-my-3w")} small description={mots.cocher} />

      <h2 className={fr.cx("fr-h4")}>Ce qui vous revient</h2>

      {siennes.length === 0 ? (
        <p>Aucune étape de ce dossier ne vous revient.</p>
      ) : (
        <>
          {raisonDuPlan === null ? null : (
            <p>Ces étapes vous reviennent, mais rien ne s'y pointe. {raisonDuPlan}</p>
          )}
          <ol>
            {siennes.map((etape) => (
              <EtapeDuParticipant
                key={etape.id}
                etape={etape}
                template={etape.template}
                pointable={pointable}
                etatPlan={etatPlan}
                sens={dossier.kind}
                declarant={declarant}
                controle={null}
              />
            ))}
          </ol>
        </>
      )}

      {aControler.length === 0 ? null : (
        <>
          <h2 className={fr.cx("fr-h4")}>Ce qui attend votre regard</h2>
          <p>
            Quelqu'un d'autre a déclaré ces étapes, et le plan vous en confie le contrôle : vous
            dites ce que cette déclaration vaut, vous ne la refaites pas.
          </p>
          {raisonDuPlan === null ? null : <p>Rien ne s'y signe pour autant. {raisonDuPlan}</p>}
          <ol>
            {aControler.map((etape) => (
              <EtapeDuParticipant
                key={etape.id}
                etape={etape}
                template={etape.template}
                // Il la contrôle, il ne la pointe pas : `peutPointer` refuse ce geste à
                // qui n'est pas l'acteur attendu, et l'offrir serait mentir.
                pointable={false}
                etatPlan={etatPlan}
                sens={dossier.kind}
                declarant={declarant}
                // Le verdict de la garde, comme sur l'écran de l'équipe : la règle qui
                // interdit de signer sa propre déclaration se dit ici aussi, plutôt que
                // de tomber au clic.
                controle={
                  pointable
                    ? peutValider(
                        {
                          validation: etape.validation as EtatValidation,
                          validationBy: etape.validationBy as Acteur | null,
                          declaredBy: etape.declaredBy,
                        },
                        valideur,
                      )
                    : null
                }
              />
            ))}
          </ol>
        </>
      )}

      {/* Sur les deux listes et jamais sur une seule : cette phrase parle du dossier
          entier, et une étape rendue au-dessus la rend fausse.

          Elle ne dit pas chez qui est le reste, parce que la page l'ignore : ce qu'elle
          ne montre pas est aussi bien une étape de l'équipe transverse qu'une étape de
          la personne concernée, celle-là même que ce lecteur signera dès qu'elle sera
          déclarée, `etapesAControlerPar` n'ouvrant la seconde liste qu'à ce qui attend
          déjà un regard. Nommer un destinataire demanderait de lire ce qu'on refuse de
          montrer, donc elle dit la règle de la page, qui est ce qu'on sait.

          Elle ne promet pas non plus qu'une étape apparaîtra le jour où elle attendra
          ce lecteur, et cette promesse-là serait fausse : un écart attend le regard
          d'un opérateur, et la projection l'écarte même pour celui qui pourrait le
          signer. « Ne montre que » est une borne haute, la seule qui tienne des trois
          rôles. */}
      {siennes.length === 0 && aControler.length === 0 ? (
        <p>
          Rien n'attend non plus votre regard. Cette page ne montre que ce qui vous revient et ce
          que vous avez à signer : le reste de ce dossier ne vous est pas montré.
        </p>
      ) : null}
    </main>
  );
}
