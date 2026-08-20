import { type CxArg, cx } from "@codegouvfr/react-dsfr/tools/cx";
import { type JSX, type PropsWithChildren, useId } from "react";

import style from "./TableCustom.module.css";

export interface TableCustomProps {
  body: Array<
    | { className?: CxArg; key?: string; row: Array<JSX.IntrinsicElements["td"]> }
    | Array<JSX.IntrinsicElements["td"]>
  >;
  bodyRef?: React.Ref<HTMLTableSectionElement>;
  classes?: Partial<Record<"col" | "row" | "table" | `col-${number}`, CxArg>>;
  className?: CxArg;
  compact?: boolean;
  header: TableCustomHeadColProps[];
  showColWhenNullData?: boolean;
}
export const TableCustom = ({
  classes,
  compact,
  header,
  body,
  bodyRef,
  className,
  showColWhenNullData,
}: TableCustomProps) => {
  const tableId = `table-custom-${useId()}`;

  return (
    <div id={tableId} className={cx(style["table"], compact && style["tableCompact"], className)}>
      <table className={cx(classes?.table)}>
        <thead className={style["tableHead"]}>
          <tr>
            {header.map((col, id) =>
              !showColWhenNullData && col.children === null ? null : (
                <TableCustomHeadCol
                  key={`${tableId}-head-${cleDe(col.children, id)}`}
                  {...col}
                  className={cx(classes?.[`col-${id}`], col.className)}
                />
              ),
            )}
          </tr>
        </thead>
        <tbody ref={bodyRef}>
          {body.map((row, rowId) => {
            const rowArray = Array.isArray(row) ? row : row.row;
            const cleFournie = Array.isArray(row) ? undefined : row.key;
            const cleLigne = cleFournie ?? `${tableId}-ligne-${cleDeLigne(rowArray, rowId)}`;
            return (
              <tr
                key={cleLigne}
                className={cx(style["tableBodyRow"], !Array.isArray(row) && row.className)}
              >
                {rowArray.map((bodyCol, colId) =>
                  !showColWhenNullData && bodyCol.children === null ? null : (
                    <TableCustomBodyRowCol
                      key={`${cleLigne}-${header[colId]?.children ? cleDe(header[colId].children, colId) : colId}`}
                      {...bodyCol}
                      className={cx(classes?.[`col-${colId}`], bodyCol.className)}
                    />
                  ),
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

/**
 * Une clé stable tirée du contenu quand il est textuel, du rang sinon : l'ordre des
 * lignes change au tri, et une clé qui suit le rang ferait suivre l'état des
 * composants montés dedans plutôt que la donnée.
 *
 * Elle lit toute la ligne et pas seulement sa première cellule : deux comptes du
 * même système commencent par le même mot, et la clé les confondait.
 */
function texteDe(contenu: unknown): string {
  return typeof contenu === "string" || typeof contenu === "number" ? String(contenu) : "";
}

function cleDe(contenu: unknown, rang: number): string {
  const texte = texteDe(contenu);
  return texte === "" ? `rang-${rang}` : texte.slice(0, 40);
}

function cleDeLigne(cellules: readonly JSX.IntrinsicElements["td"][], rang: number): string {
  const texte = cellules
    .map((cellule) => texteDe(cellule.children))
    .filter((morceau) => morceau !== "")
    .join("-");
  return texte === "" ? `rang-${rang}` : texte.slice(0, 80);
}

export interface TableCustomHeadColProps extends PropsWithChildren {
  className?: CxArg;
  colSpan?: JSX.IntrinsicElements["td"]["colSpan"];
  onClick?: JSX.IntrinsicElements["th"]["onClick"];
  orderDirection?: "asc" | "desc" | false;
}
export const TableCustomHeadCol = ({
  children,
  colSpan,
  orderDirection,
  onClick,
  className,
}: TableCustomHeadColProps) => (
  <th
    className={cx(style["tableHeadCol"], onClick && style["tableHeadColClickable"], className)}
    scope="col"
    colSpan={colSpan}
    onClick={onClick}
  >
    {children}
    {orderDirection && <span>{orderDirection === "asc" ? "⬆" : "⬇"}</span>}
  </th>
);

export const TableCustomBodyRowCol = ({
  children,
  className,
  ...rest
}: JSX.IntrinsicElements["td"]) => (
  <td {...rest} className={cx(style["tableBodyRowCol"], className)}>
    {children}
  </td>
);
