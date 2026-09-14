import { describe, expect, it } from "vitest";

import {
  type Cible,
  cleDeCible,
  couvertureDesConstats,
  type Derogation,
  derogationsEnCours,
  leveeAdmissible,
  lireCible,
  poseAdmissible,
  TOLERANCE_MAX_JOURS,
} from "./derogation";

const JOUR = 24 * 60 * 60 * 1000;
const POSE = new Date("2026-09-01T10:00:00Z");

const dans = (jours: number, heure = "10:00:00") =>
  new Date(`${new Date(POSE.getTime() + jours * JOUR).toISOString().slice(0, 10)}T${heure}Z`);

const COMPTE: Cible = { type: "identite", provider: "github", externalId: "1042" };
const QUELQUUN: Cible = { type: "personne", username: "camille.exemple" };

const toleree = (over: Partial<Derogation> = {}): Derogation => ({
  id: "der-1",
  cible: COMPTE,
  raison: "compte de démonstration conservé le temps de la campagne",
  responsable: "operatrice.exemple",
  provenance: "base",
  poseeLe: POSE,
  echeance: dans(7),
  leveeLe: null,
  ...over,
});

const constat = (cible: Cible | null, cle: string) => ({ cle, cible });

const cles = (constats: readonly { cle: string }[]) => constats.map((c) => c.cle);

describe("une tolérance couvre un temps borné, et rien au-delà", () => {
  it("couvre son dernier jour en entier, puis laisse l'écart revenir le lendemain", () => {
    // Given une tolérance posée le 1er septembre et dont le dernier jour couvert est le 8,
    const derogation = toleree();
    const ecart = [constat(COMPTE, "UNREGISTERED:github:1042")];

    // When on la juge au fil des jours,
    const auDernierJourALAube = derogationsEnCours([derogation], dans(7, "00:00:01"));
    const auDernierJourLeSoir = derogationsEnCours([derogation], dans(7, "23:59:59"));
    const leLendemain = derogationsEnCours([derogation], dans(8, "00:00:01"));

    // Then elle couvre ce dernier jour du premier au dernier instant, parce que personne
    // n'écrit une date en pensant « jusqu'à cette nuit »,
    expect(auDernierJourALAube).toHaveLength(1);
    expect(auDernierJourLeSoir).toHaveLength(1);

    // Then et elle ne couvre plus rien le jour suivant, sans qu'aucun geste ne soit
    // nécessaire : c'est tout le mécanisme anti-pourrissement,
    expect(leLendemain).toEqual([]);

    // Then ce que le partage des constats rend visible : l'écart se tait pendant qu'elle
    // court, et il remonte de lui-même ensuite.
    const pendant = couvertureDesConstats(ecart, auDernierJourLeSoir);
    expect(cles(pendant.retenus)).toEqual([]);
    expect(pendant.couverts.map((couvert) => couvert.par.id)).toEqual(["der-1"]);

    const apres = couvertureDesConstats(ecart, leLendemain);
    expect(cles(apres.retenus)).toEqual(["UNREGISTERED:github:1042"]);
    expect(apres.couverts).toEqual([]);
  });

  it("distingue une levée d'une péremption, et se juge à l'instant qu'on lui donne", () => {
    // Given une tolérance levée au bout de deux jours, et une permanente sans échéance,
    const levee = toleree({ leveeLe: dans(2) });
    const permanente = toleree({
      id: "der-yaml",
      provenance: "politique",
      poseeLe: null,
      echeance: null,
    });

    // When on les juge avant et après la levée,
    // Then la levée couvre encore la veille, ne couvre plus le jour même, et ne couvre
    // pas davantage plus tard : lever n'avance pas l'échéance, ça coupe,
    expect(derogationsEnCours([levee], dans(1))).toHaveLength(1);
    expect(derogationsEnCours([levee], dans(2))).toEqual([]);
    expect(derogationsEnCours([levee], dans(3))).toEqual([]);

    // Then la permanente couvre à toute date, avant comme longtemps après,
    expect(derogationsEnCours([permanente], dans(-400))).toHaveLength(1);
    expect(derogationsEnCours([permanente], dans(4000))).toHaveLength(1);

    // Then une tolérance de base ne couvre pas avant d'avoir été posée, ce qui est la
    // condition pour rejuger un plan confirmé à l'instant de sa confirmation,
    expect(derogationsEnCours([toleree()], dans(-1))).toEqual([]);

    // Then et une seconde tolérance sur la même cible reprend la couverture là où la
    // première l'a laissée, sans que rien n'ait à les relier.
    const reprise = toleree({ id: "der-2", poseeLe: dans(2), echeance: dans(30) });
    const couverture = couvertureDesConstats(
      [constat(COMPTE, "UNREGISTERED:github:1042")],
      derogationsEnCours([levee, reprise], dans(5)),
    );
    expect(couverture.couverts.map((couvert) => couvert.par.id)).toEqual(["der-2"]);
  });
});

describe("une tolérance ne couvre que ce qu'elle nomme", () => {
  it("n'étend jamais une personne à ses comptes, ni un compte à sa personne", () => {
    // Given un écart sur un compte, un écart sur quelqu'un, et une contradiction d'action
    // déclarée, qui ne vise ni l'un ni l'autre,
    const constats = [
      constat(COMPTE, "UNREGISTERED:github:1042"),
      constat(QUELQUUN, "SCOPE_EXIT:camille.exemple"),
      constat(null, "OVERDUE_MANUAL_ACTION:github:camille.exemple"),
    ];

    // When seule la personne est tolérée,
    const parPersonne = couvertureDesConstats(
      constats,
      derogationsEnCours([toleree({ cible: QUELQUUN })], POSE),
    );

    // Then son écart de périmètre se tait, et le compte qu'elle détient continue de
    // remonter : couvrir quelqu'un n'est pas couvrir tout ce qu'il détient,
    expect(cles(parPersonne.retenus)).toEqual([
      "UNREGISTERED:github:1042",
      "OVERDUE_MANUAL_ACTION:github:camille.exemple",
    ]);
    expect(cles(parPersonne.couverts.map((couvert) => couvert.constat))).toEqual([
      "SCOPE_EXIT:camille.exemple",
    ]);

    // When c'est le compte qui est toléré,
    const parCompte = couvertureDesConstats(constats, derogationsEnCours([toleree()], POSE));

    // Then l'écart de périmètre de sa détentrice remonte quand même, ce qui serait le
    // pire des silences : quelqu'un hors périmètre garde des accès,
    expect(cles(parCompte.retenus)).toEqual([
      "SCOPE_EXIT:camille.exemple",
      "OVERDUE_MANUAL_ACTION:github:camille.exemple",
    ]);

    // Then et rien ne tait jamais la contradiction d'une action déclarée, qui ne porte
    // sur aucune cible parce qu'elle porte sur ce qu'un humain a affirmé.
    const toutTolere = couvertureDesConstats(
      constats,
      derogationsEnCours([toleree(), toleree({ id: "der-3", cible: QUELQUUN })], POSE),
    );
    expect(cles(toutTolere.retenus)).toEqual(["OVERDUE_MANUAL_ACTION:github:camille.exemple"]);
  });

  it("se relit depuis sa clé sans jamais fabriquer une cible qu'on n'a pas écrite", () => {
    // Given des cibles dont l'une porte un identifiant qui contient lui-même le séparateur,
    const parAdresse: Cible = {
      type: "identite",
      provider: "github",
      externalId: "email:quelquun@exemple.fr",
    };

    // When on les écrit puis on les relit,
    // Then elles reviennent identiques, le découpage s'arrêtant au fournisseur et non au
    // dernier séparateur, sans quoi on obtiendrait un compte différent en silence,
    expect(lireCible(cleDeCible(parAdresse))).toEqual(parAdresse);
    expect(lireCible(cleDeCible(COMPTE))).toEqual(COMPTE);
    expect(lireCible(cleDeCible(QUELQUUN))).toEqual(QUELQUUN);

    // Then une clé qui ne décrit aucune cible ne se devine pas : elle se refuse, ce qui
    // fait qu'une entrée de politique illisible ne couvre rien plutôt que n'importe quoi,
    for (const illisible of [
      "",
      "identite",
      "identite:",
      "identite:github",
      "identite:github:",
      "identite::1042",
      "personne",
      "personne:",
      "personne:camille:exemple",
      "compte:github:1042",
      ":github:1042",
    ]) {
      expect(lireCible(illisible)).toBeNull();
    }

    // Then et une cible refusée ne couvre rien, l'appariement se faisant sur la clé
    // entière.
    const couverture = couvertureDesConstats(
      [constat(COMPTE, "UNREGISTERED:github:1042")],
      derogationsEnCours([toleree({ cible: parAdresse })], POSE),
    );
    expect(cles(couverture.retenus)).toEqual(["UNREGISTERED:github:1042"]);
  });
});

describe("ce qu'une pose exige, et ce qu'une levée exige", () => {
  const refus = (verdict: ReturnType<typeof poseAdmissible>) =>
    verdict.possible ? null : verdict.raison;

  it("refuse chaque manquement en le nommant, et accepte jusqu'au dernier jour admissible", () => {
    // Given une demande par ailleurs valable,
    const valable = {
      cible: COMPTE,
      raison: "compte partagé le temps de la campagne",
      echeance: dans(30),
    };

    // Then elle passe,
    expect(poseAdmissible(valable, new Set(), POSE)).toEqual({ possible: true });

    // Then chaque manquement se refuse en disant lequel, parce que c'est ce que l'écran
    // montre et qu'une phrase générique ferait recommencer le geste à l'aveugle,
    expect(refus(poseAdmissible({ ...valable, cible: null }, new Set(), POSE))).toContain(
      "ne se tolère pas",
    );
    expect(refus(poseAdmissible({ ...valable, raison: "  " }, new Set(), POSE))).toContain(
      "pourquoi",
    );
    expect(refus(poseAdmissible({ ...valable, echeance: dans(-1) }, new Set(), POSE))).toContain(
      "déjà passée",
    );
    expect(refus(poseAdmissible(valable, new Set([cleDeCible(COMPTE)]), POSE))).toContain(
      "déjà toléré",
    );

    // Then le plafond est une borne inclusive : le dernier jour qu'il autorise passe, et
    // le suivant non. Sans cette exactitude, une tolérance de six mois pile se ferait
    // refuser sans que personne ne comprenne pourquoi,
    expect(
      poseAdmissible({ ...valable, echeance: dans(TOLERANCE_MAX_JOURS) }, new Set(), POSE),
    ).toEqual({ possible: true });
    expect(
      refus(
        poseAdmissible({ ...valable, echeance: dans(TOLERANCE_MAX_JOURS + 1) }, new Set(), POSE),
      ),
    ).toContain(`${TOLERANCE_MAX_JOURS} jours`);

    // Then une échéance du jour même passe : tolérer jusqu'à ce soir est un geste
    // légitime, et c'est le lendemain que l'écart revient.
    expect(poseAdmissible({ ...valable, echeance: POSE }, new Set(), POSE)).toEqual({
      possible: true,
    });
  });

  it("ne lève ni une tolérance déclarée en git, ni une déjà levée, ni une déjà éteinte", () => {
    // Then une permanente ne se lève pas depuis l'interface : elle vit dans un fichier
    // versionné, et la lever ici la ferait revenir au prochain démarrage,
    const permanente = toleree({ provenance: "politique", poseeLe: null, echeance: null });
    expect(leveeAdmissible(permanente, POSE)).toMatchObject({ possible: false });

    // Then une tolérance déjà levée ne se relève pas,
    expect(leveeAdmissible(toleree({ leveeLe: dans(1) }), dans(2))).toMatchObject({
      possible: false,
    });

    // Then une tolérance éteinte par son échéance non plus : le geste n'aurait rien à
    // couper, et il laisserait au journal la trace d'une décision que personne n'a eu à
    // prendre,
    expect(leveeAdmissible(toleree(), dans(30))).toMatchObject({ possible: false });

    // Then et celle qui court se lève.
    expect(leveeAdmissible(toleree(), dans(1))).toEqual({ possible: true });
  });
});
