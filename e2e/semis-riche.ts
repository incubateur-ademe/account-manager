import type { Client } from "pg";

/**
 * De quoi voir les écrans pleins, et pas seulement leur état vide.
 *
 * Le premier relevé visuel a semé deux personnes et une startup : il a bien montré les messages
 * d'absence, mal la densité d'un tableau peuplé et pas du tout les écrans qui n'existent que sous
 * condition. Celui-ci couvre chaque famille dans plusieurs états, pour que chaque écran ait quelque
 * chose à rendre et que les cas limites se voient.
 *
 * Les identifiants sont lisibles plutôt que des `cuid()` : une capture doit pouvoir se relire.
 */

export const STARTUP_ACTIVE = "suivi-de-friche";
export const STARTUP_TERMINALE = "cartographie-sols";
export const STARTUP_SORTIE = "bilan-carbone-express";

export const DOSSIER_ARRIVEE = "dos-arrivee-de-noor";
export const DOSSIER_DEPART = "dos-depart-de-tao";
export const DOSSIER_CLOS = "dos-depart-de-remi";

const JOUR = "86400000";

export async function semerLesEcransPleins(client: Client): Promise<void> {
  await client.query(`
    INSERT INTO "Startup" (id, ghid, name, "incubatorGhid", "currentPhase", "phaseStart", "firstSeenAt", "lastSeenAt", "vanishedAt")
    VALUES
      ('sta-friche', '${STARTUP_ACTIVE}', 'Suivi de friche', 'ademe', 'construction', now() - interval '200 days', now() - interval '400 days', now(), NULL),
      ('sta-sols', '${STARTUP_TERMINALE}', 'Cartographie des sols', 'ademe', 'alumni', now() - interval '40 days', now() - interval '900 days', now(), NULL),
      ('sta-carbone', '${STARTUP_SORTIE}', 'Bilan carbone express', 'ademe', NULL, NULL, now() - interval '1000 days', now() - interval '90 days', now() - interval '80 days')
  `);

  /*
   * Six personnes, chacune pour un cas : échéance absente, échéance dépassée, échéance proche,
   * disparue du référentiel, identifiant fabriqué, et une rattachée à une startup terminée.
   */
  await client.query(`
    INSERT INTO "Person" (id, username, fullname, "primaryEmail", "communicationEmail", "githubLogin", "missionEnd", source, attachment, startups, "firstSeenAt", "lastSeenAt", "vanishedAt", "usernameFabricated")
    VALUES
      ('per-noor', 'noor.exemple', 'Noor Exemple', 'noor@exemple.fr', NULL, 'noor-gh', NULL, 'BETA', 'STARTUPS', ARRAY['${STARTUP_ACTIVE}'], now() - interval '300 days', now(), NULL, false),
      ('per-tao', 'tao.exemple', 'Tao Exemple', 'tao@exemple.fr', 'tao.perso@exemple.fr', NULL, (now() - interval '60 days')::date, 'BETA', 'STARTUPS', ARRAY['${STARTUP_ACTIVE}'], now() - interval '500 days', now(), NULL, false),
      ('per-lou', 'lou.exemple', 'Lou Exemple', 'lou@exemple.fr', NULL, 'lou-gh', (now() + interval '12 days')::date, 'BETA', 'BOTH', ARRAY['${STARTUP_ACTIVE}','${STARTUP_TERMINALE}'], now() - interval '200 days', now(), NULL, false),
      ('per-remi', 'remi.exemple', 'Rémi Exemple', 'remi@exemple.fr', NULL, NULL, (now() - interval '5 days')::date, 'BETA', 'NONE', ARRAY[]::text[], now() - interval '700 days', now() - interval '30 days', now() - interval '20 days', false),
      ('per-zoe', 'compte.a.nommer.1', 'Zoé Inconnue', NULL, NULL, NULL, NULL, 'LOCAL', 'NONE', ARRAY[]::text[], now() - interval '10 days', now(), NULL, true),
      ('per-sacha', 'sacha.exemple', 'Sacha Exemple', 'sacha@exemple.fr', NULL, NULL, NULL, 'BETA', 'STARTUPS', ARRAY['${STARTUP_TERMINALE}'], now() - interval '600 days', now(), NULL, false)
  `);

  await client.query(`
    INSERT INTO "ScopeOverride" (id, "personId", decision, reason, "createdBy", "createdAt")
    VALUES ('sco-sacha', 'per-sacha', 'INCLUDE', 'Accompagne encore la reprise du portefeuille', 'operatrice.exemple', now() - interval '3 days')
  `);

  await client.query(`
    INSERT INTO "StartupAssignment" (id, "personId", "startupGhid", until, reason, "createdBy", "createdAt")
    VALUES ('ass-lou', 'per-lou', '${STARTUP_ACTIVE}', (now() + interval '120 days')::date, 'Renfort saisonnier', 'operatrice.exemple', now() - interval '20 days')
  `);

  await client.query(`
    INSERT INTO "Resource" (id, provider, "externalId", label, url, "parentId")
    VALUES
      ('res-gh-org', 'github', 'incubateur-ademe', 'incubateur-ademe', 'https://github.com/incubateur-ademe', NULL),
      ('res-notion', 'notion', 'espace-incubateur', 'Espace incubateur', NULL, NULL),
      ('res-scalingo', 'scalingo', 'ademe-prod', 'ademe-prod', NULL, NULL)
  `);

  /*
   * Des identités de chaque méthode de rapprochement, dont deux non rattachées : ce sont elles qui
   * peuplent la file des comptes isolés, et HEURISTIC est celle qui ne peut jamais révoquer.
   */
  await client.query(`
    INSERT INTO "ExternalIdentity" (id, provider, "externalId", "idKind", handle, "personId", "serviceAccountId", "matchMethod", "firstSeenAt", "lastSeenAt", "vanishedAt")
    VALUES
      ('ext-noor-gh', 'github', 'gh-1', 'OPAQUE', 'noor-gh', 'per-noor', NULL, 'GITHUB_LOGIN', now() - interval '300 days', now(), NULL),
      ('ext-tao-notion', 'notion', 'nt-1', 'EMAIL', 'tao@exemple.fr', 'per-tao', NULL, 'EMAIL_EXACT', now() - interval '250 days', now(), NULL),
      ('ext-lou-sca', 'scalingo', 'sc-1', 'EMAIL', 'lou@exemple.fr', 'per-lou', NULL, 'EMAIL_EXACT', now() - interval '100 days', now(), NULL),
      ('ext-orphelin-1', 'github', 'gh-9', 'OPAQUE', 'ancien-stagiaire', NULL, NULL, 'NONE', now() - interval '150 days', now(), NULL),
      ('ext-orphelin-2', 'notion', 'nt-9', 'EMAIL', 'p.martin@exemple.fr', NULL, NULL, 'HEURISTIC', now() - interval '90 days', now(), NULL),
      ('ext-disparu', 'scalingo', 'sc-9', 'EMAIL', 'remi@exemple.fr', 'per-remi', NULL, 'EMAIL_EXACT', now() - interval '400 days', now() - interval '40 days', now() - interval '30 days')
  `);

  await client.query(`
    INSERT INTO "AccessGrant" (id, "externalIdentityId", "resourceId", role, "lastActivityAt", "firstSeenAt", "lastSeenAt", "vanishedAt")
    VALUES
      ('gra-1', 'ext-noor-gh', 'res-gh-org', 'admin', now() - interval '2 days', now() - interval '300 days', now(), NULL),
      ('gra-2', 'ext-tao-notion', 'res-notion', 'member', now() - interval '200 days', now() - interval '250 days', now(), NULL),
      ('gra-3', 'ext-orphelin-1', 'res-gh-org', 'member', NULL, now() - interval '150 days', now(), NULL)
  `);

  await client.query(`
    INSERT INTO "ServiceAccount" (id, key, label, purpose, "ownerUsername", "reviewEveryDays", "lastReviewedAt", provider, "createdAt", "updatedAt", "expiresAt")
    VALUES
      ('svc-ci', 'ci-deploiement', 'CI de déploiement', 'Pousse les images et déclenche les mises en production', 'noor.exemple', 90, now() - interval '30 days', 'github', now() - interval '200 days', now(), NULL),
      ('svc-sonde', 'sonde-metrologie', 'Sonde de métrologie', 'Relève les compteurs des applications', 'tao.exemple', 180, now() - interval '400 days', 'scalingo', now() - interval '500 days', now(), (now() + interval '20 days'))
  `);

  /*
   * Des constats de plusieurs natures et de plusieurs sévérités, dont un clos : la file ne doit pas
   * se lire comme une liste d'un seul type.
   *
   * Seuls les types que le produit sait produire. Les cinq autres que l'énumération déclare sont une
   * dette dormante assumée dans `src/core/constat.ts` : les semer ferait voir un écran que personne
   * ne rencontre, et afficherait leur constante anglaise faute de libellé.
   */
  await client.query(`
    INSERT INTO "Finding" (id, kind, "personId", "externalIdentityId", severity, "dedupKey", "openedAt", "closedAt", "closeReason", "closedBy")
    VALUES
      ('fin-1', 'UNREGISTERED', NULL, 'ext-orphelin-1', 'MEDIUM', 'unregistered:github:gh-9', now() - interval '20 days', NULL, NULL, NULL),
      ('fin-2', 'ORPHAN', NULL, 'ext-orphelin-2', 'MEDIUM', 'orphan:notion:nt-9', now() - interval '15 days', NULL, NULL, NULL),
      ('fin-3', 'SCOPE_EXIT', 'per-remi', NULL, 'HIGH', 'scope-exit:per-remi', now() - interval '18 days', NULL, NULL, NULL),
      ('fin-4', 'SCOPE_ENTRY', 'per-zoe', NULL, 'LOW', 'scope-entry:per-zoe', now() - interval '9 days', NULL, NULL, NULL),
      ('fin-5', 'INACTIVE_STARTUP', 'per-sacha', NULL, 'MEDIUM', 'inactive:${STARTUP_TERMINALE}', now() - interval '6 days', NULL, NULL, NULL),
      ('fin-6', 'OVERDUE_MANUAL_ACTION', 'per-tao', 'ext-tao-notion', 'HIGH', 'overdue:ext-tao-notion', now() - interval '25 days', NULL, NULL, NULL),
      ('fin-7', 'ORPHAN', NULL, 'ext-disparu', 'LOW', 'orphan:ext-disparu', now() - interval '50 days', now() - interval '2 days', 'Compte supprimé à la main sur le système', 'operatrice.exemple')
  `);

  await client.query(`
    INSERT INTO "Derogation" (id, "targetType", "targetId", reason, "createdBy", "createdAt", "expiresAt")
    VALUES ('der-1', 'FINDING', 'fin-4', 'Arrivée annoncée, la fiche suivra à la prochaine collecte', 'operatrice.exemple', now() - interval '2 days', now() + interval '28 days')
  `);

  await client.query(`
    INSERT INTO "AccessCase" (id, "personId", state, "firstSignalAt", "effectiveDate", kind, "closedAt", "profileKey")
    VALUES
      ('${DOSSIER_ARRIVEE}', 'per-noor', 'CONFIRMED', now() - interval '5 days', (now() + interval '10 days')::date, 'ONBOARDING', NULL, NULL),
      ('${DOSSIER_DEPART}', 'per-tao', 'CANDIDATE', now() - interval '12 days', (now() - interval '60 days')::date, 'OFFBOARDING', NULL, NULL),
      ('${DOSSIER_CLOS}', 'per-remi', 'DONE', now() - interval '40 days', (now() - interval '20 days')::date, 'OFFBOARDING', now() - interval '18 days', NULL)
  `);

  await client.query(`
    INSERT INTO "CaseParticipation" (id, "accessCaseId", "personId", reason, "grantedBy", "grantedAt", "expiresAt")
    VALUES ('par-lou', '${DOSSIER_DEPART}', 'per-lou', 'Accompagne ce départ côté startup', 'operatrice.exemple', now() - interval '3 days', now() + interval '27 days')
  `);

  await client.query(`
    INSERT INTO "PlanTemplate" (id, "ownerKey", kind, "startupsMayExtend", "createdAt", "updatedAt")
    VALUES
      ('tpl-inc-on', 'incubateur', 'ONBOARDING', true, now() - interval '100 days', now()),
      ('tpl-inc-off', 'incubateur', 'OFFBOARDING', false, now() - interval '100 days', now()),
      ('tpl-friche-on', '${STARTUP_ACTIVE}', 'ONBOARDING', false, now() - interval '50 days', now()),
      ('tpl-orphelin', 'startup-qui-nexiste-plus', 'ONBOARDING', false, now() - interval '80 days', now())
  `);

  await client.query(`
    INSERT INTO "PlanTemplateStep" (id, "templateId", key, position, title, runbook, "doneWhen", "riskLevel", "createdAt", "updatedAt", "expectedActor", "validationBy")
    VALUES
      ('tps-1', 'tpl-inc-on', 'ouvrir-github', 1, 'Inviter dans l''organisation GitHub', 'Depuis la page des membres, inviter le compte', 'L''invitation apparaît en attente', 'LOW', now(), now(), 'OPERATOR', NULL),
      ('tps-2', 'tpl-inc-on', 'ouvrir-notion', 2, 'Ouvrir l''espace Notion', NULL, 'La personne apparaît dans les membres', 'LOW', now(), now(), 'OPERATOR', NULL),
      ('tps-3', 'tpl-inc-off', 'retirer-github', 1, 'Retirer de l''organisation GitHub', NULL, 'Le compte ne figure plus dans les membres', 'HIGH', now(), now(), 'OPERATOR', 'OPERATOR'),
      ('tps-4', 'tpl-friche-on', 'acces-prod', 1, 'Donner l''accès à la production', 'Passer par la console', 'La personne figure dans les collaborateurs', 'HIGH', now(), now(), 'DELEGATE', 'OPERATOR')
  `);

  /*
   * Un plan par état intéressant : un confirmé en cours d'exécution, un partiellement exécuté qui
   * porte une étape en échec, et un périmé.
   */
  await client.query(`
    INSERT INTO "Plan" (id, "accessCaseId", kind, state, "planDigest", "confirmedDigest", "createdBy", "confirmedBy", "confirmedAt", "createdAt", "expiresAt")
    VALUES
      ('pla-arrivee', '${DOSSIER_ARRIVEE}', 'ONBOARDING', 'CONFIRMABLE', 'digest-a', NULL, 'operatrice.exemple', NULL, NULL, now() - interval '2 days', now() + interval '5 days'),
      ('pla-depart', '${DOSSIER_DEPART}', 'OFFBOARDING', 'PARTIALLY_EXECUTED', 'digest-b', 'digest-b', 'operatrice.exemple', 'operatrice.exemple', now() - interval '4 days', now() - interval '6 days', now() + interval '3 days'),
      ('pla-clos', '${DOSSIER_CLOS}', 'OFFBOARDING', 'EXECUTED', 'digest-c', 'digest-c', 'operatrice.exemple', 'operatrice.exemple', now() - interval '25 days', now() - interval '30 days', now() - interval '10 days')
  `);

  /*
   * Un geste hors dossier, brouillon, sur une fiche que le relevé ouvre. Son empreinte
   * ne peut pas correspondre à ce que le calcul rendrait, les connecteurs étant ici sans
   * credential : la section se relève donc dans son état écarté, qui est celui où elle
   * retire la confirmation et nomme la sortie.
   */
  await client.query(`
    INSERT INTO "Plan" (id, "accessCaseId", "subjectId", kind, state, intent, "planDigest", "createdBy", "createdAt", "expiresAt")
    VALUES ('pla-geste', NULL, 'per-noor', 'MANUAL_OP', 'DRAFT', '{"systeme":"scalingo","scope":{"nature":"jeton","region":"osc-fr1","application":"service-annuaire","usage":"astreinte"},"justification":"Renfort pendant une astreinte"}'::jsonb, 'digest-geste', 'operatrice.exemple', now() - interval '1 days', now() + interval '6 days')
  `);

  await client.query(`
    INSERT INTO "PlanStep" (id, "planId", "systemKey", tier, capability, action, label, params, "riskLevel", "expectedState", state, attempts, "lastError", "executedAt", "idempotencyKey", manual, ordre, "expectedActor", validation)
    VALUES
      ('stp-a1', 'pla-arrivee', 'github', 'automated', 'grant', 'invite', 'Inviter noor-gh dans incubateur-ademe', '{}'::jsonb, 'LOW', '"ALREADY_PRESENT"'::jsonb, 'PENDING', 0, NULL, NULL, 'idem-a1', NULL, 1, 'OPERATOR', 'NONE'),
      ('stp-a2', 'pla-arrivee', 'notion', 'assisted', 'grant', 'invite', 'Ouvrir l''espace Notion à Noor Exemple', '{}'::jsonb, 'LOW', '"ALREADY_PRESENT"'::jsonb, 'PENDING', 0, NULL, NULL, 'idem-a2', '{"runbook":"Depuis la console, inviter l''adresse"}'::jsonb, 2, 'OPERATOR', 'NONE'),
      ('stp-b1', 'pla-depart', 'github', 'automated', 'revoke', 'remove', 'Retirer tao-gh de incubateur-ademe', '{}'::jsonb, 'HIGH', '"ALREADY_ABSENT"'::jsonb, 'SUCCEEDED', 1, NULL, now() - interval '3 days', 'idem-b1', NULL, 1, 'OPERATOR', 'ACCEPTED'),
      ('stp-b2', 'pla-depart', 'notion', 'automated', 'revoke', 'remove', 'Retirer tao@exemple.fr de l''espace Notion', '{}'::jsonb, 'HIGH', '"ALREADY_ABSENT"'::jsonb, 'FAILED', 3, 'La requête a expiré sans réponse du système', now() - interval '2 days', 'idem-b2', NULL, 2, 'OPERATOR', 'NONE'),
      ('stp-b3', 'pla-depart', 'scalingo', 'manual', 'revoke', 'remove', 'Retirer l''accès Scalingo à la main', '{}'::jsonb, 'MEDIUM', '"ALREADY_ABSENT"'::jsonb, 'PENDING', 0, NULL, NULL, 'idem-b3', '{"runbook":"Console Scalingo, onglet collaborateurs"}'::jsonb, 3, 'DELEGATE', 'AWAITING'),
      ('stp-c1', 'pla-clos', 'github', 'automated', 'revoke', 'remove', 'Retirer remi de incubateur-ademe', '{}'::jsonb, 'HIGH', '"ALREADY_ABSENT"'::jsonb, 'SUCCEEDED', 1, NULL, now() - interval '24 days', 'idem-c1', NULL, 1, 'OPERATOR', 'ACCEPTED'),
      ('stp-g1', 'pla-geste', 'scalingo', 'manual', 'grant', 'emettre-un-jeton', 'Émettre un jeton restreint sur service-annuaire', '{}'::jsonb, 'HIGH', '"ALREADY_PRESENT"'::jsonb, 'PENDING', 0, NULL, NULL, 'idem-g1', '{"runbook":"Depuis le proxy, émettre le jeton et le porter dans la fiche du compte machine","doneWhen":"Le jeton figure dans la fiche du compte machine"}'::jsonb, 1, 'OPERATOR', 'NONE')
  `);

  /*
   * Trois collectes par système, dont une tronquée et une en échec : l'écran des collectes n'a de
   * sens qu'avec un historique, et la fraîcheur se lit sur la dernière.
   */
  await client.query(`
    INSERT INTO "SyncRun" (id, provider, capability, "startedAt", "finishedAt", status, "itemsSeen", error)
    VALUES
      ('run-gh-1', 'github', 'list', now() - interval '2 hours', now() - interval '2 hours' + interval '40 seconds', 'OK', 42, NULL),
      ('run-gh-2', 'github', 'list', now() - interval '1 day', now() - interval '1 day' + interval '38 seconds', 'OK', 41, NULL),
      ('run-nt-1', 'notion', 'list', now() - interval '3 hours', now() - interval '3 hours' + interval '2 minutes', 'PARTIAL', 17, '{"message":"Deux pages n''ont pas pu être lues"}'::jsonb),
      ('run-sc-1', 'scalingo', 'list', now() - interval '40 hours', NULL, 'FAILED', 0, '{"message":"Jeton refusé par le système"}'::jsonb),
      ('run-sc-2', 'scalingo', 'list', now() - interval '3 days', now() - interval '3 days' + interval '20 seconds', 'OK', 9, NULL)
  `);

  await client.query(`
    INSERT INTO "AuditEvent" (id, at, "actorKind", "actorUsername", action, "targetType", "targetId", result, before, after)
    VALUES
      ('aud-1', now() - interval '2 days', 'HUMAN', 'operatrice.exemple', 'CASE_OPEN', 'AccessCase', '${DOSSIER_ARRIVEE}', 'OK', NULL, '{"kind":"ONBOARDING"}'::jsonb),
      ('aud-2', now() - interval '3 days', 'HUMAN', 'operatrice.exemple', 'FINDING_CLOSE', 'Finding', 'fin-7', 'OK', '{"state":"open"}'::jsonb, '{"state":"closed"}'::jsonb),
      ('aud-3', now() - interval '2 days', 'SYSTEM', NULL, 'STEP_EXECUTE', 'PlanStep', 'stp-b2', 'FAILED', NULL, '{"error":"timeout"}'::jsonb),
      ('aud-4', now() - interval '1 day', 'HUMAN', 'operatrice.exemple', 'DEROGATION_CREATE', 'Finding', 'fin-4', 'OK', NULL, '{"expiresAt":"+28d"}'::jsonb),
      ('aud-5', now() - interval '5 hours', 'SYSTEM', NULL, 'SYNC_RUN', 'SyncRun', 'run-nt-1', 'PARTIAL', NULL, '{"itemsSeen":17}'::jsonb)
  `);

  await client.query(`
    INSERT INTO "ConfigOverride" (path, value, "updatedBy", "updatedAt")
    VALUES ('thresholds.collectStaleHours', '36'::jsonb, 'operatrice.exemple', now() - interval '6 days')
  `);
}

export const IGNORER = JOUR;
