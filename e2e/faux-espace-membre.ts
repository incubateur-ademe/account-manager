import { createServer } from "node:http";

/**
 * Le referentiel des personnes, joue en local, pour qu'une collecte se deroule vraiment.
 *
 * C'est le seul systeme amont que ce depot sait deja pointer ailleurs, `ESPACE_MEMBRE_URL`
 * etant une variable du schema avec sa valeur de production par defaut. Les trois
 * connecteurs, eux, portent leur hote en dur et restent hors de portee d'un double : leurs
 * credentials sont vides en bout en bout, ils se resolvent au tier `none`, et la collecte
 * les saute en le disant. Ce double ouvre donc le passage du perimetre, celui des startups
 * et celui des constats, qui est ce qui remplit les ecrans.
 *
 * Aucune personne reelle ici, ce depot etant public. Les noms sont inventes, et la forme
 * seule vient du contrat decrit par `src/lib/espace-membre.ts`.
 */

const PORT = Number(process.env["PORT_FAUX_ESPACE_MEMBRE"] ?? 3211);

/** Le meme que `scope.incubator` de la politique jetable posee par la configuration. */
const INCUBATEUR = "mon-incubateur";

const STARTUPS = [
  {
    ghid: "suivi-de-friche",
    name: "Suivi de friche",
    current_phase: "construction",
    phases: [{ name: "construction", start: "2026-03-02T00:00:00.000Z" }],
  },
  {
    ghid: "cartographie-sols",
    name: "Cartographie des sols",
    current_phase: "alumni",
    phases: [{ name: "alumni", start: "2026-08-01T00:00:00.000Z" }],
  },
];

/**
 * Trois personnes, une par sort que la collecte doit savoir produire. Noor reste en poste,
 * Tao a une mission terminee, et Iris tient a une startup en phase terminale.
 */
const MEMBRES = [
  {
    uuid: "11111111-1111-4111-8111-111111111111",
    username: "noor.exemple",
    fullname: "Noor Exemple",
    github: "noor-gh",
    primary_email: "noor@exemple.invalid",
    communication_email: "noor@exemple.invalid",
    attachment: "startups",
    missions: [{ end: "2027-12-31", startups: [{ ghid: "suivi-de-friche" }] }],
  },
  {
    uuid: "22222222-2222-4222-8222-222222222222",
    username: "tao.exemple",
    fullname: "Tao Exemple",
    github: null,
    primary_email: "tao@exemple.invalid",
    communication_email: "tao@exemple.invalid",
    attachment: "startups",
    missions: [{ end: "2026-07-31", startups: [{ ghid: "suivi-de-friche" }] }],
  },
  {
    uuid: "33333333-3333-4333-8333-333333333333",
    username: "iris.exemple",
    fullname: "Iris Exemple",
    github: "iris-gh",
    primary_email: "iris@exemple.invalid",
    communication_email: "iris@exemple.invalid",
    attachment: "startups",
    missions: [{ end: "2027-06-30", startups: [{ ghid: "cartographie-sols" }] }],
  },
];

const rendre = (reponse: import("node:http").ServerResponse, corps: unknown): void => {
  reponse.writeHead(200, { "content-type": "application/json" });
  reponse.end(JSON.stringify(corps));
};

createServer((requete, reponse) => {
  const chemin = new URL(requete.url ?? "/", `http://127.0.0.1:${PORT}`).pathname;

  if (chemin === "/healthz") {
    rendre(reponse, { ok: true });
    return;
  }
  if (chemin === `/api/protected/incubators/${INCUBATEUR}/startups`) {
    rendre(reponse, STARTUPS);
    return;
  }
  if (chemin === `/api/protected/incubators/${INCUBATEUR}/members`) {
    rendre(reponse, MEMBRES);
    return;
  }

  // Nommer la route refusee plutot que rendre une liste vide : un perimetre a zero
  // personne ressemble trait pour trait a une panne du referentiel, et se lirait comme
  // le depart de tout le monde.
  reponse.writeHead(404, { "content-type": "application/json" });
  reponse.end(JSON.stringify({ erreur: `route non doublee : ${chemin}` }));
}).listen(PORT);
