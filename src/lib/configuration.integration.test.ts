import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { policy } from "@/lib/policy";
import { chargerLesSurcharges } from "@/lib/surcharges";

const REPERTOIRE = mkdtempSync(join(tmpdir(), "configuration-"));
copyFileSync(resolve(process.cwd(), "config/config.exemple.yaml"), join(REPERTOIRE, "config.yaml"));
process.env["POLICY_DIR"] = REPERTOIRE;

describe("un réglage posé en base gouverne ce que le fichier déclarait", () => {
  beforeEach(async () => {
    await prisma.configOverride.deleteMany();
    await chargerLesSurcharges();
  });

  it("l'emporte sur le fichier, et redonne la main au fichier quand il est levé", async () => {
    // Given un seuil déclaré dans le fichier, et rien en base
    expect(policy().thresholds.graceDays).toBe(7);

    // When quelqu'un le règle depuis l'outil
    await prisma.configOverride.create({
      data: { path: "thresholds.graceDays", value: 21, updatedBy: "operatrice.exemple" },
    });
    await chargerLesSurcharges();

    // Then c'est le sien qui vaut. Sans cela l'interface ne servirait à rien : ce qui se
    // change sans livraison doit pouvoir corriger ce qui en demandait une
    expect(policy().thresholds.graceDays).toBe(21);

    // Then les autres valeurs du même objet ne bougent pas : surcharger un seuil ne doit
    // pas effacer ceux que le fichier portait à côté
    expect(policy().thresholds.soonDays).toBe(30);

    // When le réglage est levé
    await prisma.configOverride.deleteMany({ where: { path: "thresholds.graceDays" } });
    await chargerLesSurcharges();

    // Then le fichier reprend la main, et non le défaut du schéma : lever une surcharge
    // rend la valeur à qui la portait avant, sans quoi lever reviendrait à effacer
    expect(policy().thresholds.graceDays).toBe(7);
  });

  it("porte une liste entière, et non une entrée de plus", async () => {
    // Given les domaines déclarés dans le fichier
    const declares = policy().mail.domainsLostOnDeparture;
    expect(declares.length).toBeGreaterThan(0);

    // When quelqu'un en règle la liste depuis l'outil
    await prisma.configOverride.create({
      data: {
        path: "mail.domainsLostOnDeparture",
        value: ["un.exemple"],
        updatedBy: "operatrice.exemple",
      },
    });
    await chargerLesSurcharges();

    // Then elle remplace et ne complète pas. Une liste qui fusionnerait interdirait d'en
    // retirer une entrée, ce qui est le premier usage qu'on en a
    expect(policy().mail.domainsLostOnDeparture).toEqual(["un.exemple"]);
  });

  it("refuse un réglage que le schéma n'accepte pas, plutôt que de l'appliquer à moitié", async () => {
    // Given un seuil réglé sur une valeur que le schéma refuse
    await prisma.configOverride.create({
      data: { path: "thresholds.graceDays", value: "vingt et un", updatedBy: "operatrice.exemple" },
    });
    await chargerLesSurcharges();

    // Then la politique entière est refusée, et le refus nomme le chemin fautif. Appliquer
    // le reste laisserait tourner une politique dont personne ne sait ce qu'elle vaut
    expect(() => policy()).toThrow(/thresholds\.graceDays/);
  });
});
