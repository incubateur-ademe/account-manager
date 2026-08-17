import { loadPolicy } from "@/lib/policy";

/**
 * La politique est ecrite a la main, dans un autre depot, par quelqu'un qui n'a
 * pas le code sous les yeux. Sans cette commande, une faute ne se voit qu'au
 * demarrage du conteneur, apres un build complet : trop tard et trop loin de
 * l'endroit ou la corriger.
 *
 * POLICY_DIR pointe le repertoire a verifier, "config" par defaut.
 */
const politique = loadPolicy();

const lignes = [
  `incubateur          ${politique.scope.incubator}`,
  `transverses         ${politique.scope.transverse.length}`,
  `locaux              ${politique.scope.local.length}`,
  `comptes de service  ${politique.serviceAccounts.length}`,
  `phases terminales   ${politique.startups.terminalPhases.join(", ")}`,
  `report              ${politique.thresholds.graceDays} j`,
  `echeance proche     ${politique.thresholds.soonDays} j`,
  `mission ancienne    ${politique.thresholds.staleDays} j`,
  `chute maximale      ${Math.round(politique.thresholds.maxScopeDrop * 100)} %`,
  `collecte perimee    ${politique.thresholds.collectStaleHours} h`,
  `systemes            ${politique.systems.length}`,
  `derogations         ${politique.permanentDerogations.length}`,
];

console.log(`[politique] valide\n${lignes.map((ligne) => `  ${ligne}`).join("\n")}`);
