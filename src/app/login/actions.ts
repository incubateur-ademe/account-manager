"use server";

import { ESPACE_MEMBRE_PROVIDER_ID } from "@incubateur-ademe/next-auth-espace-membre-provider";

import { voieDeConnexion } from "@/core/participation";
import { signIn } from "@/lib/auth";
import { PROVIDER_ADRESSE } from "@/lib/connexion";

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
 * Le texte ne suffit pas, trois autres canaux disent la même chose et se ferment
 * ailleurs : l'URL, par `redirect: false` qui garde les deux issues sur cet écran ; les
 * saisies que le normalisateur du paquet refuse, écartées en amont par
 * `voieDeConnexion` ; et le temps, ici. Une branche acceptée fait une poignée de main
 * SMTP complète que la branche refusée ne fait pas.
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

  await attendreLePlancher(depart);

  return MESSAGE_UNIQUE;
}
