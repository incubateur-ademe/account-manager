import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { policySchema } from "./policy";

/**
 * Le fichier d'exemple est la seule documentation de la forme attendue, et rien ne le
 * relisait : `pnpm policy:check` valide la politique réelle, qui vit dans un autre dépôt
 * et n'est pas là quand on vérifie celui-ci. Un exemple devenu invalide se découvre alors
 * au démarrage d'un déploiement, `loadPolicy` levant sur un fichier que quelqu'un a copié
 * depuis lui.
 */
const EXEMPLE = fileURLToPath(new URL("../../config/config.exemple.yaml", import.meta.url));

describe("le fichier de politique d'exemple", () => {
  it("se valide contre le schéma, et montre une dérogation que le code sait lire", () => {
    // Given le fichier d'exemple versionné,
    const brut: unknown = parse(readFileSync(EXEMPLE, "utf8"));

    // When on le valide comme le démarrage le ferait,
    const verdict = policySchema.safeParse(brut);

    // Then il passe, et le dire ainsi plutôt que par un booléen fait apparaître le
    // chemin fautif dans la sortie le jour où il ne passe plus,
    expect(verdict.error?.issues ?? []).toEqual([]);
    expect(verdict.success).toBe(true);

    // Then la dérogation qu'il montre porte la cible exacte que la réconciliation sait
    // apparier, et la valeur entière est épinglée plutôt que sa forme : un exemple qui
    // montrerait un nom d'usage apprendrait à tout le monde le geste qui se casse au
    // premier renommage, et « quelque chose avant un deux-points » ne l'empêcherait pas.
    const [derogation] = verdict.data?.permanentDerogations ?? [];
    expect(derogation?.targetType).toBe("identite");
    expect(derogation?.targetId).toBe("github:MDQ6VXNlcjEwNDI=");
    expect(derogation?.reason).not.toBe("");
    expect(derogation?.owner).not.toBe("");
  });
});
