# Interactive service picker for spm. Requires fzf and jq.
# Usage: source this file, then run spm_app_selector start|restart|logs|stop|flush

spm_app_selector() {
  local command=""
  local config=""
  local app_name=""

  while [[ $# -gt 0 ]]; do
    case $1 in
      --config=*)
        config="${1#*=}"
        shift
        ;;
      --appName=*)
        app_name="${1#*=}"
        shift
        ;;
      -h|--help)
        echo "Usage: spm_app_selector [OPTIONS] COMMAND"
        echo ""
        echo "Options:"
        echo "  --appName=APP_NAME    Specify the application name directly."
        echo "  --config=CONFIG_FILE  Specify the ecosystem configuration file."
        echo "  -h, --help            Display this help message."
        echo ""
        echo "Examples:"
        echo "  spm_app_selector start"
        echo "  spm_app_selector --appName=api restart"
        echo "  spm_app_selector --config=ecosystem.config.js logs"
        return 0
        ;;
      start|stop|kill|restart|logs|flush)
        command="$1"
        shift
        break
        ;;
      *)
        echo "Unknown option or command: $1"
        return 1
        ;;
    esac
  done

  if [[ -z "$command" ]]; then
    echo "Usage: spm_app_selector [OPTIONS] COMMAND"
    echo "COMMAND must be one of: start stop kill restart logs flush"
    return 1
  fi

  if [[ -z "$config" ]]; then
    if [[ -f ecosystem.config.js ]]; then
      config="ecosystem.config.js"
    elif [[ -f ecosystem.config.cjs ]]; then
      config="ecosystem.config.cjs"
    elif [[ -f ecosystem.custom.config.js ]]; then
      config="ecosystem.custom.config.js"
    fi
  fi

  if [[ -z "$config" ]]; then
    echo "No ecosystem configuration file found."
    return 1
  fi

  if [[ -z "$app_name" ]]; then
    app_name=$(spm ${config:+--config "$config"} jlist 2>/dev/null | jq -r '.[].name' | fzf)
  fi

  if [[ -n "$app_name" ]]; then
    if [[ -n "$config" ]]; then
      spm --config "$config" "$command" "$app_name"
    else
      spm "$command" "$app_name"
    fi
  else
    echo "No application selected."
    return 1
  fi
}
