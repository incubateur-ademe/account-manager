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
  resourceId: string;
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
  /** Par objet, ses références : une par compte qui le possède. */
  sections: Record<SectionDObjets, [ObjetPossede, ...ObjetPossede[]][]>;
  /** Le nombre d'objets, et non de références. */
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
        resourceId: true,
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

  const sections = classerObjetsPossedes(objets);
  return { sections, total: compter(sections), recensent };
}

export async function compterObjetsPossedes(): Promise<{ total: number; orphelins: number }> {
  const lignes = await prisma.reference.findMany({
    where: VIVANTES,
    select: {
      resourceId: true,
      externalIdentity: {
        select: { matchMethod: true, person: { select: { vanishedAt: true } } },
      },
    },
  });
  const sections = classerObjetsPossedes(
    lignes.map(({ resourceId, externalIdentity }) => ({ resourceId, compte: externalIdentity })),
  );
  return { total: compter(sections), orphelins: sections.orphelins.length };
}

function compter(sections: Record<SectionDObjets, readonly unknown[]>): number {
  return Object.values(sections).reduce((total, objets) => total + objets.length, 0);
}

async function systemesQuiRecensent(): Promise<string[]> {
  const praticables = await Promise.all(
    CONNECTEURS.map(async (connecteur) =>
      (await recensementPraticable(connecteur)) ? [connecteur.contract.key] : [],
    ),
  );
  return praticables.flat();
}
