import { fr } from "@codegouvfr/react-dsfr";
import Link from "next/link";
import type { ReactNode } from "react";

import { type Criteres, lienJournal } from "./criteres";

interface PaginationProps {
  criteres: Criteres;
  page: number;
  pages: number;
}

const VOISINES = 2;

function fenetre(page: number, pages: number): (number | null)[] {
  const retenues = new Set<number>([1, pages, page]);
  for (let ecart = -VOISINES; ecart <= VOISINES; ecart += 1) {
    const numero = page + ecart;
    if (numero >= 1 && numero <= pages) {
      retenues.add(numero);
    }
  }

  const triees = [...retenues].sort((a, b) => a - b);
  const avecTrous: (number | null)[] = [];
  let precedente = 0;
  for (const numero of triees) {
    if (precedente !== 0 && numero - precedente > 1) {
      avecTrous.push(null);
    }
    avecTrous.push(numero);
    precedente = numero;
  }

  return avecTrous;
}

function Element({
  href,
  classe,
  children,
}: {
  href: string | null;
  classe: string;
  children: ReactNode;
}) {
  return href === null ? (
    <span className={classe} aria-disabled="true">
      {children}
    </span>
  ) : (
    <Link className={classe} href={href}>
      {children}
    </Link>
  );
}

/**
 * Écrit à la main plutôt qu'avec le composant Pagination de react-dsfr : celui-ci
 * réclame une fonction en propriété, qui ne traverse pas la frontière serveur.
 */
export function Pagination({ criteres, page, pages }: PaginationProps) {
  if (pages <= 1) {
    return null;
  }

  const vers = (numero: number) => lienJournal(criteres, { page: numero });
  const classeLien = fr.cx("fr-pagination__link");

  return (
    <nav className={fr.cx("fr-pagination")} aria-label="Pagination du journal">
      <ul className={fr.cx("fr-pagination__list")}>
        <li>
          <Element
            href={page > 1 ? vers(1) : null}
            classe={fr.cx("fr-pagination__link", "fr-pagination__link--first")}
          >
            Première page
          </Element>
        </li>
        <li>
          <Element
            href={page > 1 ? vers(page - 1) : null}
            classe={fr.cx(
              "fr-pagination__link",
              "fr-pagination__link--prev",
              "fr-pagination__link--lg-label",
            )}
          >
            Page précédente
          </Element>
        </li>

        {fenetre(page, pages).map((numero, rang) =>
          numero === null ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: un trou n'a pas d'identité propre
            <li key={`trou-${rang}`}>
              <span className={classeLien}>…</span>
            </li>
          ) : (
            <li key={numero}>
              {numero === page ? (
                <span className={classeLien} aria-current="page">
                  {numero}
                </span>
              ) : (
                <Link className={classeLien} href={vers(numero)} title={`Page ${numero}`}>
                  {numero}
                </Link>
              )}
            </li>
          ),
        )}

        <li>
          <Element
            href={page < pages ? vers(page + 1) : null}
            classe={fr.cx(
              "fr-pagination__link",
              "fr-pagination__link--next",
              "fr-pagination__link--lg-label",
            )}
          >
            Page suivante
          </Element>
        </li>
        <li>
          <Element
            href={page < pages ? vers(pages) : null}
            classe={fr.cx("fr-pagination__link", "fr-pagination__link--last")}
          >
            Dernière page
          </Element>
        </li>
      </ul>
    </nav>
  );
}
