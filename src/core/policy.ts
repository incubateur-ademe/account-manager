import { z } from "zod";

/**
 * Les explications vivent dans `.meta()` et non en commentaire : c'est le seul
 * endroit que le générateur de JSON Schema sait lire, donc le seul qui atteigne la
 * personne qui écrit le fichier sans avoir le code sous les yeux. Un commentaire dit
 * la même chose à un lecteur de moins.
 */
const username = z
  .string()
  .min(1)
  .regex(
    /^[a-z0-9.-]+$/,
    "un username beta.gouv ne contient que minuscules, chiffres, points et tirets",
  )
  .meta({
    description:
      "Username beta.gouv, pivot d'identité de tout le système. Minuscules, chiffres, points et tirets.",
    examples: ["claire.durand"],
  });

const version = z.literal(1).meta({
  description:
    "Version du format, non du contenu. Elle existe pour qu'un fichier écrit pour une autre version du code soit refusé net plutôt que lu de travers, ce qui compte dès lors que ce fichier ne vit pas dans le même dépôt que le code.",
  examples: [1],
});

const serviceAccountSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .meta({
        description:
          "Identifiant stable du compte, qui lui sert d'identité en base. Le changer crée un nouveau compte plutôt que de renommer l'ancien.",
        examples: ["bot-de-deploiement"],
      }),
    label: z
      .string()
      .min(1)
      .meta({
        description: "Nom lisible, tel qu'il apparaît à l'écran.",
        examples: ["Bot de déploiement"],
      }),
    purpose: z
      .string()
      .min(1)
      .meta({
        description:
          "À quoi sert ce compte. Sert à décider, lors d'une revue, s'il a encore lieu d'être.",
        examples: ["Déclenche les mises en service des applications de l'incubateur"],
      }),
    ownerUsername: username.meta({
      description:
        "Qui répond de ce compte. Obligatoire : un compte machine sans responsable est précisément ce que cet outil cherche à éviter.",
      examples: ["claire.durand"],
    }),
    reviewEveryDays: z
      .number()
      .int()
      .positive()
      .default(180)
      .meta({
        description:
          "Périodicité de revue en jours. Un compte machine n'a pas de fin de mission : c'est le seul signal qu'il puisse émettre. Faute de revue enregistrée, le compte à rebours court depuis sa déclaration.",
        examples: [180, 90],
      }),
    identities: z
      .array(
        z.object({
          provider: z
            .string()
            .min(1)
            .meta({
              description: "Clé du système cible, telle que la déclare son connecteur.",
              examples: ["github"],
            }),
          externalId: z
            .string()
            .min(1)
            .meta({
              description:
                "Identifiant du compte sur ce système, tel que la collecte le rend. Il ne se devine pas : il se relève à la première collecte.",
              examples: ["123456789"],
            }),
        }),
      )
      .default([])
      .meta({
        description:
          "Comptes que ce compte de service détient sur les systèmes cibles. Sans cette déclaration, chaque collecte les rendrait comme des comptes que personne ne réclame, à chaque passage.",
        examples: [[{ provider: "github", externalId: "123456789" }]],
      }),
  })
  .meta({ description: "Un compte non humain : bot, jeton d'intégration continue, clé d'API." });

const derogationSchema = z
  .object({
    targetType: z
      .string()
      .min(1)
      .meta({
        description: "Nature de ce qui est toléré.",
        examples: ["identite"],
      }),
    targetId: z
      .string()
      .min(1)
      .meta({
        description: "Ce que la dérogation vise, désigné comme la collecte le nomme.",
        examples: ["github:compte-partage"],
      }),
    reason: z
      .string()
      .min(1)
      .meta({
        description:
          "Pourquoi cet écart est admis. Obligatoire : un écart toléré sans trace redevient un écart oublié.",
        examples: ["Compte de démonstration conservé à la demande de la direction"],
      }),
    owner: username.meta({
      description: "Qui répond de cette tolérance.",
      examples: ["claire.durand"],
    }),
  })
  .meta({ description: "Un écart admis pour de bon, qu'aucune collecte ne doit plus signaler." });

const systemSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .meta({
        description: "Clé du système, telle que la déclare son connecteur.",
        examples: ["mon-systeme"],
      }),
    label: z
      .string()
      .min(1)
      .meta({
        description: "Nom lisible du système.",
        examples: ["Mon système"],
      }),
    criticality: z
      .enum(["low", "medium", "high"])
      .default("medium")
      .meta({
        description: "Ce que coûte un accès oublié sur ce système.",
        examples: ["high"],
      }),
    runbook: z
      .string()
      .min(1)
      .meta({
        description:
          "Ce qu'il faut faire à la main quand aucune voie automatique n'existe, ou quand celle-ci tombe.",
        examples: ["https://exemple.org/procedures/mon-systeme"],
      }),
  })
  .meta({ description: "Un système couvert par le catalogue." });

/**
 * Qui l'incubateur suit, et quels comptes machine il détient. Tout ce fichier nomme :
 * des personnes, des propriétaires, des jetons. C'est ce qui le rend sensible et ce
 * qui justifie qu'il puisse vivre hors du dépôt du code.
 */
export const accountsSchema = z
  .object({
    version,

    scope: z
      .object({
        incubator: z
          .string()
          .min(1)
          .default("ademe")
          .meta({
            description:
              "Identifiant beta.gouv de l'incubateur, tel qu'il apparaît dans les adresses de l'espace-membre. Toute la collecte est scopée dessus : c'est lui qui définit « nous ».",
            examples: ["ademe"],
          }),
        transverse: z
          .array(username)
          .default([])
          .meta({
            description:
              "Fait autorité sur l'appartenance au périmètre. Une équipe transverse n'apparaît dans aucune startup d'État : sans cette liste, elle serait invisible. L'en retirer est le geste qui l'en sort.",
            examples: [["claire.durand", "samir.benali"]],
          }),
        local: z
          .array(
            z.object({
              username,
              until: z.iso.date().meta({
                description: "Dernier jour travaillé, inclusif, au format AAAA-MM-JJ.",
                examples: ["2027-06-30"],
              }),
            }),
          )
          .default([])
          .meta({
            description:
              "Personnes qui ont des accès sans avoir de fiche espace-membre. Faute de source amont, leur date de fin est saisie ici et n'est rafraîchie par personne : elle vieillit en silence, ce qui rend cette liste bonne à garder courte.",
            examples: [[{ username: "prestataire.exemple", until: "2027-06-30" }]],
          }),
      })
      .meta({ description: "Qui l'incubateur suit, et sous quelle autorité." }),

    serviceAccounts: z
      .array(serviceAccountSchema)
      .refine(
        (comptes) => new Set(comptes.map((compte) => compte.key)).size === comptes.length,
        "deux comptes de service ne peuvent pas partager la même clé, qui est leur identité en base",
      )
      .default([])
      .meta({
        description:
          "Comptes non humains. Ils n'ont pas de fin de mission, d'où la revue périodique, et leur propriétaire est obligatoire.",
        examples: [
          [
            {
              key: "bot-de-deploiement",
              label: "Bot de déploiement",
              purpose: "Déclenche les mises en service des applications de l'incubateur",
              ownerUsername: "claire.durand",
              reviewEveryDays: 180,
              identities: [],
            },
          ],
        ],
      }),
  })
  .meta({
    description:
      "Personnes suivies et comptes de service. Ce fichier nomme, il ne vit donc pas nécessairement dans le dépôt du code.",
  });

/**
 * Les règles du produit : des seuils, un vocabulaire, deux catalogues. Rien n'y
 * désigne quiconque, et tout y a un défaut raisonnable, si bien qu'une instance qui
 * ne fournirait pas ce fichier fonctionnerait quand même.
 */
export const configSchema = z
  .object({
    version,

    startups: z
      .object({
        terminalPhases: z
          .array(z.string().min(1))
          .default(["abandon", "abandon-investigation", "transfere", "alumni"])
          .meta({
            description:
              "Phases dans lesquelles une startup ne justifie plus aucun accès. Cette liste est de la configuration et non du code : le vocabulaire de beta.gouv évolue, et décider qu'une phase est terminale est un choix métier.",
            examples: [["abandon", "abandon-investigation", "transfere", "alumni"]],
          }),
      })
      .prefault({})
      .meta({ description: "Ce que l'incubateur tient pour une startup finie." }),

    thresholds: z
      .object({
        graceDays: z
          .number()
          .int()
          .nonnegative()
          .default(7)
          .meta({
            description:
              "Report accordé après une échéance avant de conclure qu'il y a à faire. Un renouvellement signé en retard est la règle plutôt que l'exception, et couper le jour même produirait surtout des remises en service.",
            examples: [7],
          }),
        soonDays: z
          .number()
          .int()
          .positive()
          .default(30)
          .meta({
            description:
              "En deçà, une échéance est annoncée comme proche. Ce nombre est celui que l'interface écrit en toutes lettres.",
            examples: [30],
          }),
        staleDays: z
          .number()
          .int()
          .positive()
          .default(180)
          .meta({
            description:
              "Au-delà, une mission terminée relève de l'historique et non d'une action.",
            examples: [180],
          }),
        maxScopeDrop: z
          .number()
          .min(0)
          .max(1)
          .default(0.2)
          .meta({
            description:
              "Part du périmètre qu'une collecte peut perdre d'un coup avant de refuser d'en tirer la moindre disparition. Une réponse tronquée mais valide ne se distingue d'un départ collectif que par son ampleur.",
            examples: [0.2],
          }),
        collectStaleHours: z
          .number()
          .int()
          .positive()
          .default(48)
          .meta({
            description:
              "Âge au-delà duquel les écrans préviennent que la collecte ne tourne plus, plutôt que d'afficher un périmètre gelé avec l'assurance d'un périmètre frais.",
            examples: [48],
          }),
      })
      // prefault et non default : la valeur passe par le schéma, qui applique alors
      // les défauts de chaque seuil. Un default exigerait de tous les répéter ici, et
      // cette copie finirait par mentir.
      .prefault({})
      .meta({ description: "Les délais et les proportions qui gouvernent les décisions." }),

    systems: z
      .array(systemSchema)
      .default([])
      .meta({
        description:
          "Réservé : catalogue des systèmes couverts. Aucun code ne le lit encore, le catalogue vit pour l'instant dans la documentation d'architecture.",
        examples: [
          [
            {
              key: "mon-systeme",
              label: "Mon système",
              criticality: "medium",
              runbook: "https://exemple.org/procedures/mon-systeme",
            },
          ],
        ],
      }),

    permanentDerogations: z
      .array(derogationSchema)
      .default([])
      .meta({
        description:
          "Réservé : écarts admis pour de bon, qu'aucune collecte ne doit plus signaler. Aucun code ne le lit encore.",
        examples: [
          [
            {
              targetType: "identite",
              targetId: "github:compte-partage",
              reason: "Compte de démonstration conservé à la demande de la direction",
              owner: "claire.durand",
            },
          ],
        ],
      }),
  })
  .meta({
    description:
      "Règles du produit : seuils, vocabulaire, catalogues. Rien n'y désigne personne et tout y a un défaut raisonnable.",
  });

export type Accounts = z.infer<typeof accountsSchema>;
export type Config = z.infer<typeof configSchema>;

/**
 * Les deux fichiers réunis, tels que le reste du code les consomme. La version de
 * chacun a servi à les accepter, elle n'a plus rien à dire ensuite : c'est une
 * propriété du fichier, pas de la politique.
 */
export type Policy = Omit<Accounts, "version"> & Omit<Config, "version">;
