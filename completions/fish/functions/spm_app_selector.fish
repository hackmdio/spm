function spm_app_selector
    argparse 'h/help' 'appName=' 'config=' -- $argv
    or return

    if set -q _flag_help
        echo "Usage: spm_app_selector [OPTIONS] -- [COMMAND]"
        echo ""
        echo "Options:"
        echo "  --appName=APP_NAME    Specify the application name directly."
        echo "  --config=CONFIG_FILE  Specify the ecosystem configuration file (ecosystem.config.js or ecosystem.custom.config.js)."
        echo "  -h, --help            Display this help message and exit."
        echo ""
        echo "Examples:"
        echo "  spm_app_selector start"
        echo "  spm_app_selector --appName=api restart"
        echo "  spm_app_selector --config=ecosystem.config.js logs"
        return
    end

    if not set -q _flag_config
        if test -f ecosystem.config.js
            set _flag_config ecosystem.config.js
        else if test -f ecosystem.config.cjs
            set _flag_config ecosystem.config.cjs
        else if test -f ecosystem.custom.config.js
            set _flag_config ecosystem.custom.config.js
        end
    end

    if not set -q _flag_config
        echo "No ecosystem configuration file found."
        return
    end

    set -l command $argv[1]
    if test -z "$command"
        echo "Usage: spm_app_selector [OPTIONS] COMMAND"
        echo "COMMAND must be one of: start stop kill restart logs flush"
        return 1
    end

    if set -q _flag_appName
        set APP_NAME $_flag_appName
    else
        set spm_args
        if set -q _flag_config
            set -a spm_args --config $_flag_config
        end
        set APP_NAME (spm $spm_args jlist 2>/dev/null | jq -r '.[].name' | fzf)
    end

    if test -n "$APP_NAME"
        set spm_args
        if set -q _flag_config
            set -a spm_args --config $_flag_config
        end
        spm $spm_args $command $APP_NAME
    else
        echo "No application selected."
    end
end
