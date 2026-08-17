"use client";

import { useEffect } from "react";

// Ce composant remplace le document entier : ni le layout racine, ni la feuille de
// style du DSFR ne sont chargés quand il s'affiche. Tout ce dont il a besoin tient
// donc ici, sans import d'interface.
const STYLES = `
:root {
  color-scheme: light dark;
  --fond: #ffffff;
  --texte: #161616;
  --attenue: #666666;
  --accent: #000091;
}
@media (prefers-color-scheme: dark) {
  :root {
    --fond: #1e1e1e;
    --texte: #ffffff;
    --attenue: #929292;
    --accent: #8585f6;
  }
}
body {
  margin: 0;
  background-color: var(--fond);
  color: var(--texte);
  font-family: Marianne, arial, sans-serif;
  line-height: 1.5;
}
.enveloppe { max-width: 40rem; margin: 0 auto; padding: 4rem 1.5rem; }
.enveloppe h1 { font-size: 1.75rem; line-height: 1.25; margin: 0 0 0.5rem; }
.surtitre { font-size: 0.875rem; color: var(--attenue); margin: 0 0 2rem; }
.enveloppe p { margin: 0 0 1rem; }
.reference { font-size: 0.875rem; color: var(--attenue); }
.actions { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-top: 2rem; }
.action {
  display: inline-flex;
  align-items: center;
  font: inherit;
  font-weight: 500;
  padding: 0.5rem 1.5rem;
  border: 1px solid var(--accent);
  background-color: var(--accent);
  color: var(--fond);
  text-decoration: none;
  cursor: pointer;
}
.action--secondaire { background-color: transparent; color: var(--accent); }
.action:focus-visible { outline: 2px solid var(--texte); outline-offset: 2px; }
`;

export default function ErreurGlobale({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("Erreur fatale", error);
  }, [error]);

  return (
    <html lang="fr">
      <body>
        <title>Erreur technique</title>
        <style>{STYLES}</style>
        <main className="enveloppe">
          <h1>Le gestionnaire de comptes est hors service</h1>
          <p className="surtitre">Erreur technique</p>
          <p>
            L'application n'a pas réussi à afficher quoi que ce soit. Le problème vient d'elle, pas
            de votre poste.
          </p>
          <p>
            Réessayez une fois. Si cet écran revient, l'application est réellement en panne :
            prévenez le mainteneur avec l'heure et la référence ci-dessous, le détail de l'erreur
            l'attend dans les journaux du serveur.
          </p>
          {error.digest ? <p className="reference">Référence à citer : {error.digest}</p> : null}
          <div className="actions">
            <button type="button" className="action" onClick={() => retry()}>
              Réessayer
            </button>
            <a className="action action--secondaire" href="/">
              Retour à l'accueil
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
