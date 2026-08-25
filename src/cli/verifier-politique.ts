import { CONNECTEURS, catalogueDOctroi } from "@/connectors";
import { verifierProfils } from "@/core/octroi";
import { verifierConfigurations } from "@/lib/configuration-connecteur";
import { loadPolicy } from "@/lib/policy";

/**
 * La politique est ecrite a la main, dans un autre depot, par quelqu'un qui n'a
 * pas le code sous les yeux. Sans cette commande, une faute ne se voit qu'au
 * demarrage du conteneur, apres un build complet : trop tard et trop loin de
 * l'endroit ou la corriger.
 *
 * POLICY_DIR pointe le repertoire a verifier, "config" par defaut.
 */
function resume(): string[] {
  const politique = loadPolicy();
  const contrats = CONNECTEURS.map((connecteur) => connecteur.contract);

  // C'est la seule commande qui tourne dans le depot de configuration, donc le
  // seul « avant demarrage » qui existe reellement : aucun conteneur ne la lance.
  verifierConfigurations(contrats);

  // Seconde passe : les scopes des profils contre les schemas des connecteurs. Elle
  // ne peut pas vivre dans le schema Zod de la politique, qui leve : une faute de
  // frappe dans un profil arreterait alors la collecte nocturne de tout le parc au
  // lieu du seul octroi qu'elle abime.
  const refus = verifierProfils(politique.profiles, catalogueDOctroi());

  if (refus.length > 0) {
    throw new Error(
      `Profils invalides :\n${refus
        .map((refuse) => `  profiles.${refuse.profil} > ${refuse.systeme} : ${refuse.motif}`)
        .join(
          "\n",
        )}\n\nIls se corrigent dans la cle profiles du fichier config.yaml de la politique.`,
    );
  }

  return [
    `incubateur          ${politique.scope.incubator}`,
    `transverses         ${politique.scope.transverse.length}`,
    `locaux              ${politique.scope.local.length}`,
    `comptes de service  ${politique.serviceAccounts.length}`,
    `phases terminales   ${politique.startups.terminalPhases.join(", ")}`,
    `report              ${politique.thresholds.graceDays} j`,
    `echeance proche     ${politique.thresholds.soonDays} j`,
    `mission ancienne    ${politique.thresholds.staleDays} j`,
    `chute maximale      ${Math.round(politique.thresholds.maxScopeDrop * 100)} %`,
    `arrivees maximales  ${Math.round(politique.thresholds.maxNewPersonShare * 100)} %`,
    `collecte perimee    ${politique.thresholds.collectStaleHours} h`,
    `systemes            ${politique.systems.length}`,
    `profils             ${politique.profiles.length}`,
    `acces de profil     ${politique.profiles.reduce((total, profil) => total + profil.accesses.length, 0)}`,
    `derogations         ${politique.permanentDerogations.length}`,
    `connecteurs regles  ${contrats.filter((contrat) => contrat.configSchema).length}`,
  ];
}

try {
  console.log(
    `[politique] valide\n${resume()
      .map((ligne) => `  ${ligne}`)
      .join("\n")}`,
  );
} catch (error) {
  // Le destinataire edite un YAML, il ne lit pas de pile d'appels : le message
  // porte deja le fichier et la cle fautive, le reste est du bruit qui masque
  // la seule ligne utile dans un journal d'integration continue.
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
