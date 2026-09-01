import type { EspaceMembreProviderWrappers } from "@incubateur-ademe/next-auth-espace-membre-provider";

import { audit } from "@/lib/audit";
import { deciderConnexion, voieDuProvider } from "@/lib/connexion";

/**
 * Ce que le paquet d'authentification nous demande de décider, sorti de sa
 * configuration pour être jouable seul.
 *
 * Ce qui se joue ici tient en trois lignes de câblage, et c'est précisément pour ça
 * qu'elles vivent dans un module à elles : la plus dangereuse du chantier est celle qui
 * n'existe pas, un `if` sur la phase d'envoi qu'une relecture trouverait élégant
 * d'ajouter. Une ligne absente ne se relit pas, elle se teste.
 *
 * Le type vient du wrapper lui-même, sans quoi une signature écrite à la main
 * divergerait du paquet sans que rien ne le dise.
 */
type Rappels = Parameters<EspaceMembreProviderWrappers["CallbacksWrapper"]>[0];

export const rappelsDeConnexion: Rappels = {
  /**
   * Appelé deux fois par connexion, à l'envoi du lien et à son retour, et il décide les
   * deux fois sur l'état du moment.
   *
   * **Rien ici ne regarde `email.verificationRequest`, et c'est l'invariant du
   * module.** Le wrapper de l'espace-membre n'intercepte que la première invocation de
   * sa propre voie et nous délègue toutes les autres : un contrôle rangé sous la phase
   * d'envoi ouvrirait une session à un lien émis à midi et suivi à midi vingt, alors que
   * le droit a été révoqué à midi une. Le droit relu à chaque page ne rattrape pas ça,
   * il ne gouverne que ce qu'une session déjà ouverte peut faire.
   */
  async signIn({ user, account }) {
    const voie = voieDuProvider(account?.provider);
    const decision = await deciderConnexion(voie, user);

    audit({
      actorKind: "HUMAN",
      actorUsername: decision.username ?? undefined,
      action:
        decision.accepte && decision.viaBreakGlass ? "auth.signin.break_glass" : "auth.signin",
      targetType: "session",
      after: decision.accepte ? { voie } : { voie, refus: decision.refus },
      result: decision.accepte ? "SUCCESS" : "FAILURE",
    });

    return decision.accepte;
  },

  /**
   * Ce que la session portera pour des semaines, décidé une seule fois, à la connexion :
   * `account` n'y est présent qu'à ce moment, les appels suivants relisant un jeton
   * déjà rempli.
   *
   * La décision est reprise ici plutôt que recopiée du contrôle précédent : elle est la
   * seule à savoir d'où vient l'identifiant, et un jeton qu'elle n'aurait pas produit
   * serait un jeton que rien n'a autorisé.
   */
  async jwt({ token, user, account }) {
    const voie = voieDuProvider(account?.provider);
    if (voie === null) {
      return token;
    }

    const decision = await deciderConnexion(voie, user);
    if (!decision.accepte) {
      // Un jeton nul efface le cookie. Ce qui passe ici est un droit mort entre les deux
      // contrôles : mieux vaut une session qui n'ouvre pas qu'une session à retirer.
      return null;
    }

    token["username"] = decision.username;
    token["personId"] = decision.personId;
    token["voie"] = decision.voie;
    return token;
  },

  session({ session, token }) {
    const username = token["username"];
    if (typeof username === "string") {
      session.user.username = username;
    }
    const personId = token["personId"];
    session.user.personId = typeof personId === "string" ? personId : null;
    const voie = token["voie"];
    if (voie === "ESPACE_MEMBRE" || voie === "ADRESSE") {
      session.user.voie = voie;
    }
    return session;
  },
};
