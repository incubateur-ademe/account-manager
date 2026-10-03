import { CONNECTEURS } from "@/connectors";
import { recensementPraticable } from "@/core/connector";
import { classerObjetsPossedes, type SectionDObjets } from "@/core/objets-possedes";
import type { Prisma } from "@/generated/prisma/client";
import type { MatchMethod, OnOffboard } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";

/**
 * Les références que l'écran et le compteur de l'accueil classent, et la seule définition
 * de ce qu'ils comptent. Deux clauses écrites à part finiraient par afficher le même
 * intitulé sur deux populations.
 */
const VIVANTES = { vanishedAt: null } as const satisfies Prisma.ReferenceWhereInput;

export interface ObjetPossede {
  id: string;
  provider: string;
  onOffboard: OnOffboard;
  resource: { label: string; url: string | null };
  compte: {
    handle: string;
    matchMethod: MatchMethod;
    vanishedAt: Date | null;
    serviceAccountId: string | null;
    person: { username: string; fullname: string; vanishedAt: Date | null } | null;
  } | null;
}

export interface ObjetsPossedes {
  sections: Record<SectionDObjets, ObjetPossede[]>;
  total: number;
  /** Les systèmes dont la capacité de recenser est praticable, dans l'ordre du registre. */
  recensent: string[];
}

export async function lireLesObjetsPossedes(): Promise<ObjetsPossedes> {
  const [lignes, recensent] = await Promise.all([
    prisma.reference.findMany({
      where: VIVANTES,
      orderBy: [{ provider: "asc" }, { resource: { label: "asc" } }],
      select: {
        id: true,
        provider: true,
        onOffboard: true,
        resource: { select: { label: true, url: true } },
        externalIdentity: {
          select: {
            handle: true,
            matchMethod: true,
            vanishedAt: true,
            serviceAccountId: true,
            person: { select: { username: true, fullname: true, vanishedAt: true } },
          },
        },
      },
    }),
    systemesQuiRecensent(),
  ]);

  const objets: ObjetPossede[] = lignes.map(({ externalIdentity, ...ligne }) => ({
    ...ligne,
    compte: externalIdentity,
  }));

  return { sections: classerObjetsPossedes(objets), total: objets.length, recensent };
}

export async function compterObjetsPossedes(): Promise<{ total: number; orphelins: number }> {
  const lignes = await prisma.reference.findMany({
    where: VIVANTES,
    select: {
      externalIdentity: {
        select: { matchMethod: true, vanishedAt: true, person: { select: { vanishedAt: true } } },
      },
    },
  });
  const sections = classerObjetsPossedes(
    lignes.map(({ externalIdentity }) => ({ compte: externalIdentity })),
  );
  return { total: lignes.length, orphelins: sections.orphelins.length };
}

async function systemesQuiRecensent(): Promise<string[]> {
  const praticables = await Promise.all(
    CONNECTEURS.map(async (connecteur) =>
      (await recensementPraticable(connecteur)) ? [connecteur.contract.key] : [],
    ),
  );
  return praticables.flat();
}
