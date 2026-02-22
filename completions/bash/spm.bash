# Bash completion for spm
# Usage: source this file or copy to /etc/bash_completion.d/spm
# Requires: bash-completion (Linux) or bash-completion2 (macOS: brew install bash-completion@2)

_spm_services() {
  spm jlist 2>/dev/null | jq -r '.[].name'
}

_spm() {
  local cur prev words cword
  if declare -f _init_completion &>/dev/null; then
    _init_completion -s || return
  else
    words=("${COMP_WORDS[@]}")
    cword=$COMP_CWORD
    cur="${words[cword]}"
    prev="${words[cword-1]}"
  fi

  local subcommands="start stop kill logs list jlist restart flush rotate"
  local rotate_subcommands="start watch stop"

  case $prev in
    -c|--config)
      if declare -f _filedir &>/dev/null; then
        _filedir
      else
        COMPREPLY=($(compgen -f -X '!*.@(js|mjs|cjs)' -- "$cur"))
      fi
      return
      ;;
    -s|--signal)
      COMPREPLY=($(compgen -W "SIGTERM SIGINT SIGKILL" -- "$cur"))
      return
      ;;
    -n|--lines)
      return
      ;;
    -f|--filter)
      return
      ;;
    --cleanup-interval)
      return
      ;;
    spm)
      COMPREPLY=($(compgen -W "$subcommands -c --config -v --verbose -h --help" -- "$cur"))
      return
      ;;
    rotate)
      COMPREPLY=($(compgen -W "$rotate_subcommands" -- "$cur"))
      return
      ;;
  esac

  # Check if we're completing after a subcommand that takes a service name
  for ((i = 1; i < cword; i++)); do
    case ${words[i]} in
      start|stop|kill|restart|logs|flush)
        COMPREPLY=($(compgen -W "$(_spm_services)" -- "$cur"))
        return
        ;;
      rotate)
        if [[ $i -eq $((cword - 1)) ]]; then
          COMPREPLY=($(compgen -W "$rotate_subcommands" -- "$cur"))
        fi
        return
        ;;
    esac
  done

  # Check for logs options
  if [[ " ${words[@]} " =~ " logs " ]]; then
    case $cur in
      -*) COMPREPLY=($(compgen -W "-t --tail -n --lines -f --filter -h --help" -- "$cur")) ;;
      *)  COMPREPLY=($(compgen -W "$(_spm_services)" -- "$cur")) ;;
    esac
    return
  fi

  # Check for stop/kill options
  if [[ " ${words[@]} " =~ " stop " ]] || [[ " ${words[@]} " =~ " kill " ]]; then
    case $cur in
      -*) COMPREPLY=($(compgen -W "-s --signal -h --help" -- "$cur")) ;;
      *)  COMPREPLY=($(compgen -W "$(_spm_services)" -- "$cur")) ;;
    esac
    return
  fi

  # Default: complete subcommands or global options
  COMPREPLY=($(compgen -W "$subcommands -c --config -v --verbose -h --help" -- "$cur"))
}

complete -F _spm spm
