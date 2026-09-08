"use server";

import { ESPACE_MEMBRE_PROVIDER_ID } from "@incubateur-ademe/next-auth-espace-membre-provider";
import { cookies } from "next/headers";

import { voieDeConnexion } from "@/core/participation";
import { signIn } from "@/lib/auth";
import { COOKIES_DE_DESTINATION, PROVIDER_ADRESSE } from "@/lib/connexion";

/**
 * La même phrase quoi qu'il arrive : lien envoyé, identifiant inconnu, adresse
 * inconnue, saisie vide, panne du serveur de courrier.
 *
 * Ce que le message unique referme n'est pas propre à la voie nouvelle. Le contrôle de
 * la voie espace-membre interroge l'annuaire beta.gouv **entier**, et distinguer
 * « inconnu » de « connu mais non autorisé » en faisait un oracle d'appartenance à cet
 * annuaire, interrogeable sans être connecté. Le diagnostic part à la console et au
 * journal, que seuls des opérateurs lisent, et un opérateur qui se trompe
 * d'identifiant le perd à l'écran. Coût assumé.
 */
const MESSAGE_UNIQUE =
  "Si cette saisie ouvre un accès, un lien de connexion vient de partir. Vérifiez votre boîte : il est valable peu de temps.";

/**
 * Le texte ne suffit pas, et la liste des autres canaux ne se tient pas pour close.
 * Ceux qu'on connaît : l'URL, par `redirect: false` qui garde les deux issues sur cet
 * écran ; les saisies que le normalisateur du paquet refuse, écartées en amont par
 * `voieDeConnexion` ; les cookies, ci-dessous ; et le temps, ici. Une branche acceptée
 * fait une poignée de main SMTP complète que la branche refusée ne fait pas.
 *
 * C'est un plancher et non un temps constant : il masque l'écart ordinaire, il ne
 * masquerait pas un serveur de courrier qui mettrait plusieurs secondes. Le retirer
 * « parce qu'il ralentit la connexion » rouvre le canal sans changer une ligne de
 * message.
 */
const PLANCHER_MS = 1500;

async function attendreLePlancher(depart: number): Promise<void> {
  const reste = PLANCHER_MS - (Date.now() - depart);
  if (reste > 0) {
    await new Promise((resoudre) => setTimeout(resoudre, reste));
  }
}

/**
 * Le cinquième canal, et le seul qui ne se voyait pas : `Set-Cookie`.
 *
 * L'acceptation traverse `sendToken` et rend au paquet un cookie de destination, que
 * `signIn` pose sur la réponse de cette action **après** l'appel. Le refus, lui, lève
 * une `AccessDenied` que le paquet relance en mode brut, si bien qu'il sort avant cette
 * pose et n'écrit rien. La présence d'un en-tête `Set-Cookie` disait donc exactement ce
 * que la phrase unique refuse de dire, en plus net que le temps, et sous le seul
 * contrôle de qui poste sans cookie.
 *
 * Effacer plutôt que reposer : le bocal de la réponse est indexé par nom, une pose
 * suivie d'un effacement du même nom se réduit à l'effacement seul, et les deux branches
 * émettent alors le même en-tête à l'octet près. Le cookie ne manque à personne,
 * `sendToken` écrivant déjà la destination dans l'adresse du lien, que le retour relit là.
 *
 * **Appelée de part et d'autre de l'appel, et les deux fois comptent.** Le bocal garde
 * l'ordre de première insertion : un nom que seule la branche acceptée fait connaître
 * prendrait son rang avant les autres, et l'ordre des en-têtes redirait ce que leur
 * contenu ne dit plus. Le passage d'avant réserve les rangs, celui d'après fixe les
 * valeurs.
 *
 * Appelée pour toute soumission, la saisie malformée comprise, et jamais sous un
 * `catch` : avaler une panne d'ici laisserait la branche acceptée seule à porter son
 * cookie, c'est-à-dire rouvrirait précisément ce que cette fonction ferme.
 */
async function neutraliserLaDestinationRetenue(): Promise<void> {
  const bocal = await cookies();
  for (const nom of COOKIES_DE_DESTINATION) {
    bocal.delete(nom);
  }
}

/**
 * Le proxy transmet la page demandée avant la redirection vers la connexion, pour
 * y ramener une fois le lien suivi. La valeur vient de l'URL, donc de n'importe
 * qui : seul un chemin de cette application est accepté. `//ailleurs` est une
 * adresse absolue déguisée, et suffirait à faire de cet écran un tremplin vers un
 * site tiers portant notre nom de domaine dans la barre précédente.
 *
 * Elle alimente `redirectTo`, c'est-à-dire le lien envoyé par courriel, et jamais la
 * réponse à ce formulaire : celle-ci ne redirige nulle part, sans quoi la destination
 * dirait ce que le message tait.
 */
function destination(suite: string): string {
  return suite.startsWith("/") && !suite.startsWith("//") ? suite : "/";
}

export async function loginAction(
  _state: string | null,
  formData: FormData,
): Promise<string | null> {
  const depart = Date.now();

  const saisie = String(formData.get("username") ?? "").trim();
  const suite = destination(String(formData.get("suite") ?? ""));
  const voie = voieDeConnexion(saisie);

  await neutraliserLaDestinationRetenue();

  if (voie !== null) {
    try {
      // `redirect: false` : sans lui l'acceptation quitte cet écran pour la page de
      // confirmation d'envoi pendant que le refus y reste, et la barre d'adresse dit
      // alors ce que la phrase unique refuse de dire. Rien ici ne peut donc lever une
      // redirection, et ce `catch` n'en avale aucune.
      await signIn(voie === "ESPACE_MEMBRE" ? ESPACE_MEMBRE_PROVIDER_ID : PROVIDER_ADRESSE, {
        email: saisie,
        redirectTo: suite,
        redirect: false,
      });
    } catch (error: unknown) {
      console.error("[connexion] aucun lien envoyé", error);
    }
  }

  await neutraliserLaDestinationRetenue();
  await attendreLePlancher(depart);

  return MESSAGE_UNIQUE;
}
