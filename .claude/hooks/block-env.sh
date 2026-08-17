#!/bin/sh
# Bloque toute lecture / ecriture d'un fichier d'environnement porteur de secrets,
# et toute commande shell qui en reference un.
#
# Ce depot manipule un triplet OVH a portee compte entier, un token de session Notion
# lie a une personne physique et un jeton GitHub d'organisation. Aucun de ces secrets
# ne doit transiter par le contexte de l'agent.
#
# Autorise en revanche les gabarits versionnes (.env.example, .env.dist) : sans eux,
# la configuration attendue par src/lib/env.ts serait indocumentable.
#
# Hook PreToolUse. exit 2 = blocage, message sur stderr.

set -u

if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' "BLOQUE: jq est introuvable, le garde-fou anti-.env ne peut pas s'appliquer. Installe jq." >&2
  exit 2
fi

input=$(cat)
tool=$(printf '%s' "$input" | jq -r '.tool_name // empty')

# Gabarits versionnes, sans valeur reelle.
is_allowed_env() {
  case "$1" in
    .env.example|.env.dist) return 0 ;;
    *) return 1 ;;
  esac
}

is_blocked_env_path() {
  base=${1##*/}
  case "$base" in
    .env|.env.*) is_allowed_env "$base" && return 1 || return 0 ;;
    *) return 1 ;;
  esac
}

# Decoupe la commande sur les separateurs shell courants avant d'inspecter chaque
# token. Un grep direct laisserait passer la seconde occurrence d'une commande comme
# `cat .env.example .env`, le separateur etant consomme par le premier match.
first_blocked_token() {
  # Le \n final n'est pas cosmetique : sans lui, `read` abandonne le dernier token
  # et `cat .env` passerait au travers.
  printf '%s\n' "$1" \
    | tr ' \t"'"'"'=:|&;<>(){},`$' '\n' \
    | while IFS= read -r token; do
        [ -n "$token" ] || continue
        if is_blocked_env_path "$token"; then
          printf '%s' "$token"
          break
        fi
      done
}

case "$tool" in
  Read | Write | Edit | NotebookEdit)
    path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')
    if [ -n "$path" ] && is_blocked_env_path "$path"; then
      printf '%s\n' "BLOQUE: acces a $path interdit (secrets)." >&2
      printf '%s\n' "Les valeurs reelles ne se lisent ni ne s'ecrivent. Pour documenter la configuration, utilise .env.example ou .env.dist." >&2
      exit 2
    fi
    ;;
  Grep)
    for candidate in \
      "$(printf '%s' "$input" | jq -r '.tool_input.path // empty')" \
      "$(printf '%s' "$input" | jq -r '.tool_input.glob // empty')"; do
      if [ -n "$candidate" ] && is_blocked_env_path "$candidate"; then
        printf '%s\n' "BLOQUE: recherche ciblant $candidate interdite (secrets)." >&2
        exit 2
      fi
    done
    ;;
  Bash)
    cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
    if [ -n "$cmd" ]; then
      offender=$(first_blocked_token "$cmd")
      if [ -n "$offender" ]; then
        printf '%s\n' "BLOQUE: la commande reference $offender (secrets)." >&2
        printf '%s\n' "Seuls .env.example et .env.dist sont manipulables." >&2
        exit 2
      fi
    fi
    ;;
esac

exit 0
